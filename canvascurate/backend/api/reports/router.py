"""Reports & Downloads endpoints for session audit/export surfaces."""

from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from auth import get_current_user
from jobs.reports import REPORTS_COURSE_BACKUP_JOB_TYPE, run_reports_course_backup_job
from services.job_dispatch import dispatch_background_task
from services.reports.exports import EXPORT_BUILDERS
from services.reports.faculty_review_upload import apply_faculty_review_workbook
from services.reports.printable import build_printable_content
from services.reports.readiness import build_reports_overview
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas/sessions/{session_id}/reports", tags=["reports"])
MAX_FACULTY_REVIEW_UPLOAD_BYTES = 20 * 1024 * 1024


def _owned_session(supabase, *, session_id: str, user_id: str) -> dict:
    result = supabase.table("sessions").select(
        "id, user_id, type, status, name, source_course_id, meta, updated_at"
    ).eq("id", session_id).eq("user_id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return result.data[0]


def _download_filename(session: dict, filename: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", str(session.get("name") or "course")).strip("_")[:40] or "course"
    date_slug = datetime.utcnow().strftime("%Y%m%d")
    return f"{stem}_{date_slug}_{filename}"


@router.get("/overview")
async def get_reports_overview(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    session = _owned_session(supabase, session_id=session_id, user_id=user_id)
    return build_reports_overview(supabase, session_id=session_id, user_id=user_id, session=session)


@router.get("/printable-content")
async def get_printable_content(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    session = _owned_session(supabase, session_id=session_id, user_id=user_id)
    return build_printable_content(supabase, session_id=session_id, user_id=user_id, session=session)


@router.get("/downloads/{kind}")
async def download_report(
    session_id: str,
    kind: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    builder = EXPORT_BUILDERS.get(kind)
    if not builder:
        raise HTTPException(status_code=404, detail="Report download not found")

    supabase = get_supabase()
    session = _owned_session(supabase, session_id=session_id, user_id=user_id)
    body, media_type, filename = builder(supabase, session_id=session_id, user_id=user_id)
    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{_download_filename(session, filename)}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
            "Cache-Control": "no-store",
        },
    )


@router.post("/uploads/faculty-review")
async def upload_faculty_review(
    session_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    filename = file.filename or ""
    if not filename.casefold().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Upload the Faculty Review .xlsx workbook")

    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="Uploaded workbook is empty")
    if len(body) > MAX_FACULTY_REVIEW_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Faculty Review workbook is too large")

    supabase = get_supabase()
    _owned_session(supabase, session_id=session_id, user_id=user_id)
    try:
        result = apply_faculty_review_workbook(
            supabase,
            session_id=session_id,
            user_id=user_id,
            file_bytes=body,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Faculty Review workbook could not be applied: {exc}") from exc

    return {"result": result}


@router.post("/backups/imscc")
async def queue_imscc_backup(
    session_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    session = _owned_session(supabase, session_id=session_id, user_id=user_id)
    if not session.get("source_course_id"):
        raise HTTPException(status_code=422, detail="No source Canvas course is connected to this session")

    existing_result = supabase.table("background_jobs").select(
        "id, session_id, job_type, status, attempts, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", REPORTS_COURSE_BACKUP_JOB_TYPE
    ).in_("status", ["queued", "running", "retrying"]).order(
        "queued_at", desc=True
    ).limit(1).execute()
    if existing_result.data:
        return {"job": existing_result.data[0]}

    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": REPORTS_COURSE_BACKUP_JOB_TYPE,
        "status": "queued",
        "payload": {
            "source_course_id": session.get("source_course_id"),
        },
        "result": {
            "status": "queued",
            "progress": 0,
            "events": [{
                "message": "Queued IMSCC backup for the connected Canvas course",
                "status": "info",
            }],
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to queue IMSCC backup job")

    job = job_result.data[0]
    dispatch_background_task(background_tasks, run_reports_course_backup_job, job["id"], session_id, user_id)
    return {"job": job}


@router.get("/backups/imscc/{job_id}")
async def get_imscc_backup_job(
    session_id: str,
    job_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    result = get_supabase().table("background_jobs").select(
        "id, session_id, job_type, status, attempts, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("id", job_id).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", REPORTS_COURSE_BACKUP_JOB_TYPE
    ).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="IMSCC backup job not found")
    return {"job": result.data[0]}
