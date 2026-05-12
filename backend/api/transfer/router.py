"""Transfer API routes.

Provides Transfer readiness data and the first target-course Canvas write job
for Phase 6.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api.transfer.schemas import TransferJobRequest, TransferTargetValidationRequest
from auth import get_current_user
from jobs.transfer import (
    TRANSFER_COPY_COURSE_JOB_TYPE,
    TRANSFER_SAME_COURSE_JOB_TYPE,
    TRANSFER_TARGET_BACKUP_JOB_TYPE,
    TRANSFER_TARGET_JOB_TYPE,
    run_transfer_copy_course_job,
    run_transfer_target_backup_job,
    run_transfer_same_course_job,
    run_transfer_target_job,
)
from services.job_dispatch import dispatch_background_task
from services.document_records import get_owned_session
from services.transfer.canvas_target import resolve_source_course_access, validate_transfer_target_course
from services.transfer.readiness import build_transfer_readiness
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas", tags=["transfer"])


def current_user_id(user: dict) -> str:
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return user_id


def _source_course_for_session(supabase, *, session: dict, user_id: str) -> dict | None:
    if not session.get("source_course_id"):
        return None
    course_result = supabase.table("courses").select(
        "id, course_name, canvas_course_id, canvas_base_url"
    ).eq("id", session["source_course_id"]).eq("user_id", user_id).limit(1).execute()
    return course_result.data[0] if course_result.data else None


def _verify_completed_target_backup(
    supabase,
    *,
    session_id: str,
    user_id: str,
    backup_job_id: str | None,
    target_course: dict,
) -> None:
    if not backup_job_id:
        raise HTTPException(status_code=422, detail="Generate an IMSCC backup or confirm transfer without a backup before erasing the target course")
    backup_result = supabase.table("background_jobs").select(
        "id, status, result"
    ).eq("id", backup_job_id).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", TRANSFER_TARGET_BACKUP_JOB_TYPE
    ).limit(1).execute()
    if not backup_result.data:
        raise HTTPException(status_code=404, detail="Target backup job not found")
    backup_job = backup_result.data[0]
    result = backup_job.get("result") if isinstance(backup_job.get("result"), dict) else {}
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    if backup_job.get("status") != "succeeded" or not summary.get("backup_download_url"):
        raise HTTPException(status_code=422, detail="Target IMSCC backup is not ready yet")
    if str(summary.get("target_canvas_course_id") or "") != str(target_course.get("canvas_course_id") or ""):
        raise HTTPException(status_code=422, detail="Target IMSCC backup does not match the selected target course")


@router.get("/sessions/{session_id}/transfer/readiness")
async def get_transfer_readiness(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    return build_transfer_readiness(
        get_supabase(),
        session_id=session_id,
        user_id=current_user_id(user),
    )


@router.post("/sessions/{session_id}/transfer/target/validate")
async def validate_transfer_target(
    session_id: str,
    payload: TransferTargetValidationRequest,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return {
        "target_course": validate_transfer_target_course(
            supabase,
            user_id=user_id,
            canvas_url=payload.canvas_url,
        )
    }


@router.post("/sessions/{session_id}/transfer/target/backup")
async def queue_transfer_target_backup(
    session_id: str,
    payload: TransferTargetValidationRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    target_course = validate_transfer_target_course(
        supabase,
        user_id=user_id,
        canvas_url=payload.canvas_url,
    )
    existing_result = supabase.table("background_jobs").select(
        "id, status, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", TRANSFER_TARGET_BACKUP_JOB_TYPE
    ).in_("status", ["queued", "running", "retrying"]).order(
        "queued_at", desc=True
    ).limit(1).execute()
    if existing_result.data:
        for existing_job in existing_result.data:
            existing_payload = existing_job.get("payload") if isinstance(existing_job.get("payload"), dict) else {}
            existing_target = existing_payload.get("target_course") if isinstance(existing_payload.get("target_course"), dict) else {}
            if str(existing_target.get("canvas_course_id") or "") == str(target_course.get("canvas_course_id") or ""):
                return {"job": existing_job}

    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": TRANSFER_TARGET_BACKUP_JOB_TYPE,
        "status": "queued",
        "payload": {
            "canvas_url": payload.canvas_url,
            "target_course": target_course,
        },
        "result": {
            "status": "queued",
            "progress": 0,
            "events": [{
                "message": f"Queued IMSCC backup for {target_course['name']}",
                "status": "info",
            }],
            "target_course": target_course,
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to queue target backup job")

    job = job_result.data[0]
    dispatch_background_task(background_tasks, run_transfer_target_backup_job, job["id"], session_id, user_id)
    return {"job": job}


@router.post("/sessions/{session_id}/transfer/jobs")
async def queue_transfer_job(
    session_id: str,
    payload: TransferJobRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    session = get_owned_session(supabase, session_id, user_id)
    if payload.erase_first and payload.mode == "same_course":
        raise HTTPException(status_code=422, detail="Erase target first is only available for target-course transfer")
    if payload.mode in {"target_course", "copy_course"} and not payload.canvas_url.strip():
        raise HTTPException(status_code=422, detail="Target Canvas course URL is required")

    if payload.mode == "same_course":
        job_type = TRANSFER_SAME_COURSE_JOB_TYPE
    elif payload.mode == "copy_course":
        job_type = TRANSFER_COPY_COURSE_JOB_TYPE
    else:
        job_type = TRANSFER_TARGET_JOB_TYPE
    existing_result = supabase.table("background_jobs").select(
        "id, status, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq("job_type", job_type).in_(
        "status", ["queued", "running", "retrying"]
    ).order("queued_at", desc=True).limit(1).execute()
    if existing_result.data:
        return {"job": existing_result.data[0]}

    if payload.mode == "same_course":
        source_course = _source_course_for_session(supabase, session=session, user_id=user_id)
        if not source_course:
            raise HTTPException(status_code=422, detail="No source Canvas course is connected to this session")
        target_course, _pat_token = resolve_source_course_access(
            supabase,
            user_id=user_id,
            source_course=source_course,
        )
        queued_message = f"Queued same-course push to {target_course['name']}"
    elif payload.mode == "copy_course":
        source_course = _source_course_for_session(supabase, session=session, user_id=user_id)
        if not source_course:
            raise HTTPException(status_code=422, detail="Copy to target requires a connected source Canvas course")
        target_course = validate_transfer_target_course(
            supabase,
            user_id=user_id,
            canvas_url=payload.canvas_url,
        )
        if payload.erase_first and not payload.erase_without_backup_confirmed:
            _verify_completed_target_backup(
                supabase,
                session_id=session_id,
                user_id=user_id,
                backup_job_id=payload.target_backup_job_id,
                target_course=target_course,
            )
        queued_message = f"Queued Canvas course copy to {target_course['name']}"
    else:
        target_course = validate_transfer_target_course(
            supabase,
            user_id=user_id,
            canvas_url=payload.canvas_url,
        )
        if payload.erase_first and not payload.erase_without_backup_confirmed:
            _verify_completed_target_backup(
                supabase,
                session_id=session_id,
                user_id=user_id,
                backup_job_id=payload.target_backup_job_id,
                target_course=target_course,
            )
        queued_message = f"Queued transfer to {target_course['name']}"

    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": job_type,
        "status": "queued",
        "payload": {
            "mode": payload.mode,
            "canvas_url": payload.canvas_url,
            "erase_first": payload.erase_first,
            "target_backup_job_id": payload.target_backup_job_id,
            "erase_without_backup_confirmed": payload.erase_without_backup_confirmed,
            "target_course": target_course,
        },
        "result": {
            "status": "queued",
            "progress": 0,
            "events": [{
                "message": queued_message,
                "status": "info",
            }],
            "target_course": target_course,
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to queue Transfer job")

    job = job_result.data[0]
    if payload.mode == "same_course":
        dispatch_background_task(background_tasks, run_transfer_same_course_job, job["id"], session_id, user_id)
    elif payload.mode == "copy_course":
        dispatch_background_task(background_tasks, run_transfer_copy_course_job, job["id"], session_id, user_id)
    else:
        dispatch_background_task(background_tasks, run_transfer_target_job, job["id"], session_id, user_id)
    return {"job": job}


@router.get("/sessions/{session_id}/transfer/jobs/{job_id}")
async def get_transfer_job(
    session_id: str,
    job_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    result = get_supabase().table("background_jobs").select(
        "id, session_id, job_type, status, attempts, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("id", job_id).eq("session_id", session_id).eq("user_id", user_id).in_(
        "job_type", [TRANSFER_TARGET_JOB_TYPE, TRANSFER_SAME_COURSE_JOB_TYPE, TRANSFER_TARGET_BACKUP_JOB_TYPE, TRANSFER_COPY_COURSE_JOB_TYPE]
    ).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Transfer job not found")
    return {"job": result.data[0]}
