"""Standalone document upload API routes.

Owns non-Canvas document intake while existing document review routes continue
to serve the shared remediation workflow during the migration.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from auth import get_current_user
from canvas_hosts import parse_canvas_course_url
from canvas_sync import get_active_pat
from encryption import encrypt
from r2_storage import is_r2_configured, upload_bytes
from services.document_records import get_owned_session, write_platform_event
from services.documents.analysis import run_document_analysis_job
from services.documents.assets import document_replacement_storage_key
from services.documents.canvas_deploy import (
    STANDALONE_CANVAS_DEPLOY_JOB_TYPE,
    list_canvas_courses,
    run_standalone_canvas_deploy_job,
)
from services.documents.inventory import (
    document_has_active_canvas_placement,
    filter_document_inventory_rows,
    get_session_document_row,
    normalize_document_analysis,
    session_document_rows,
)
from services.documents.pdf_probe import pdf_accessibility_probe
from services.documents.replacements import (
    persist_replacement_candidate,
    run_document_file_archive_job,
    run_document_replacement_deploy_job,
    selected_document_references,
)
from services.documents.remediation import run_document_remediation_job
from services.documents.standalone import (
    create_standalone_document,
    filename_extension,
    normalize_document_content_type,
    safe_upload_filename,
    standalone_document_row,
    validate_document_upload,
)
from services.documents.work_history import DOCUMENT_WORK_EVENT_TYPES, build_document_work_history
from services.editor.file_upload import (
    MAX_EDITOR_FILE_UPLOAD_BYTES,
    normalize_editor_file_content_type,
    safe_upload_filename as safe_editor_upload_filename,
    validate_editor_file_upload,
)
from services.pdf_export.readiness import build_pdf_export_readiness
from services.job_dispatch import dispatch_background_task
from services.job_queue import JobAdmissionError, enqueue_background_job, env_int
from services.tagflow_assets import attach_tagflow_preview_signed_urls
from supabase_client import get_supabase
from routers.credentials import validate_pat

router = APIRouter(prefix="/canvas", tags=["documents"])
ASU_CANVAS_BASE_URL = "https://canvas.asu.edu"


class StandaloneCanvasDeployRequest(BaseModel):
    canvas_url: str
    filename: str | None = None


class DocumentReferenceSelection(BaseModel):
    content_item_id: str
    link_index: int = Field(ge=1)
    href: str = Field(min_length=1, max_length=2048)


class DocumentReplacementDeployRequest(BaseModel):
    references: list[DocumentReferenceSelection] = Field(default_factory=list, max_length=250)


def store_active_canvas_pat(supabase, *, user_id: str, canvas_base_url: str, pat_token: str) -> None:
    validate_pat(canvas_base_url, pat_token)
    now = datetime.now(timezone.utc)
    supabase.table("user_canvas_credentials").update(
        {"status": "revoked", "updated_at": now.isoformat()}
    ).eq("user_id", user_id).eq("canvas_base_url", canvas_base_url).eq(
        "status", "active"
    ).execute()
    supabase.table("user_canvas_credentials").insert({
        "user_id": user_id,
        "canvas_base_url": canvas_base_url,
        "credential_type": "pat",
        "status": "active",
        "pat_token_enc": encrypt(pat_token),
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "last_validated_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }).execute()


@router.get("/sessions/{session_id}/canvas-courses")
async def list_standalone_canvas_courses(
    session_id: str,
    q: str | None = Query(default=None, max_length=200),
    x_canvas_pat: str = Header(default=""),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    pat_token = x_canvas_pat.strip()
    if pat_token:
        store_active_canvas_pat(
            supabase,
            user_id=user_id,
            canvas_base_url=ASU_CANVAS_BASE_URL,
            pat_token=pat_token,
        )
    else:
        try:
            pat_token = get_active_pat(supabase, user_id, ASU_CANVAS_BASE_URL)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Active ASU Canvas token required. {exc}")

    try:
        return {
            "items": list_canvas_courses(
                canvas_base_url=ASU_CANVAS_BASE_URL,
                pat_token=pat_token,
                q=q,
                limit=None if (q or "").strip() else 50,
            )
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Canvas course lookup failed: {exc}")


@router.get("/sessions/{session_id}/documents")
async def list_session_documents(
    session_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = None,
    status: Literal[
        "all",
        "linked",
        "unlinked",
        "filename_links",
        "replacement_deployed",
        "ready_to_archive",
        "still_placed",
        "cleanup_marked",
        "archived",
    ] = "all",
    file_type: Literal["all", "pdf", "word", "powerpoint", "spreadsheet", "image", "other"] = "all",
    sort: Literal["priority", "name_asc", "name_desc"] = "priority",
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    rows = session_document_rows(supabase, session_id, user_id)

    inventory = filter_document_inventory_rows(
        rows,
        q=q,
        file_type=file_type,
        status=status,
        sort=sort,
    )
    filtered = inventory["rows"]
    total_count = len(filtered)

    return {
        "items": filtered[offset: offset + limit],
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
        "next_offset": offset + limit if offset + limit < total_count else None,
        "counts": inventory["counts"],
        "file_type_counts": inventory["file_type_counts"],
    }


@router.post("/sessions/{session_id}/documents/upload")
async def upload_standalone_session_document(
    session_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if not is_r2_configured():
        raise HTTPException(status_code=503, detail="R2 storage is required before uploading standalone documents")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    filename = safe_upload_filename(file.filename, fallback="document.pdf")
    content_type = normalize_document_content_type(filename, file.content_type)
    data = await file.read()
    validate_document_upload(filename, content_type, data)

    initial_review = None
    if filename.lower().endswith(".pdf") or content_type == "application/pdf":
        initial_review = pdf_accessibility_probe(data)

    document = create_standalone_document(
        supabase,
        session_id=session_id,
        user_id=user_id,
        filename=filename,
        content_type=content_type,
        data=data,
        initial_accessibility_review=initial_review,
    )
    now = datetime.now(timezone.utc).isoformat()
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="standalone_document_uploaded",
        properties={
            "document_id": document["id"],
            "filename": filename,
            "content_type": content_type,
            "size": len(data),
            "initial_accessibility_review": initial_review,
            "uploaded_at": now,
        },
    )

    queued_jobs: list[dict[str, Any]] = []
    if filename.lower().endswith(".pdf") or content_type == "application/pdf":
        for job_type, runner in (
            ("document_analysis", run_document_analysis_job),
            ("document_remediation", run_document_remediation_job),
        ):
            try:
                enqueued = enqueue_background_job(
                    supabase,
                    user_id=user_id,
                    session_id=session_id,
                    job_type=job_type,
                    payload={
                        "session_id": session_id,
                        "document_id": document["id"],
                        "filename": filename,
                        "source": "standalone_document_upload",
                    },
                    duplicate_fields=("document_id",),
                    max_active_job_type_per_user=env_int(
                        "PDF_REMEDIATION_MAX_ACTIVE_JOBS_PER_USER" if job_type == "document_remediation" else "DOCUMENT_ANALYSIS_MAX_ACTIVE_JOBS_PER_USER",
                        3 if job_type == "document_remediation" else 4,
                    ),
                )
            except JobAdmissionError:
                continue
            job_id = enqueued.job["id"]
            queued_jobs.append({"job_id": job_id, "job_type": job_type, "created": enqueued.created})
            if enqueued.created:
                dispatch_background_task(background_tasks, runner, job_id, session_id, user_id, document["id"])

        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="standalone_document_remediation_queued",
            properties={
                "document_id": document["id"],
                "queued_job_count": len(queued_jobs),
            },
        )

    return {
        "document": standalone_document_row(document),
        "queued_jobs": queued_jobs,
    }


@router.get("/sessions/{session_id}/documents/{document_id}")
async def get_session_document_detail(
    session_id: str,
    document_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    latest_jobs = supabase.table("background_jobs").select(
        "id, job_type, status, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "job_type", ["document_analysis", "document_remediation", "document_structure_preview", "tagflow_ai_suggestions", "pdf_export", "standalone_document_canvas_deploy"]
    ).order("queued_at", desc=True).limit(20).execute()
    document_jobs = [
        job for job in (latest_jobs.data or [])
        if (job.get("payload") or {}).get("document_id") in {row.get("id"), row.get("canvas_id")}
    ]
    analysis_jobs = [job for job in document_jobs if job.get("job_type") == "document_analysis"]
    replacement_jobs_result = supabase.table("background_jobs").select(
        "id, job_type, status, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", "document_replacement_deploy"
    ).order("queued_at", desc=True).limit(25).execute()
    deployment_history = [
        job for job in (replacement_jobs_result.data or [])
        if (job.get("payload") or {}).get("document_id") == row.get("id")
        or (job.get("result") or {}).get("document_id") == row.get("id")
    ]
    archive_jobs_result = supabase.table("background_jobs").select(
        "id, job_type, status, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", "document_file_archive"
    ).order("queued_at", desc=True).limit(25).execute()
    archive_history = [
        job for job in (archive_jobs_result.data or [])
        if (job.get("payload") or {}).get("document_id") == row.get("id")
        or (job.get("result") or {}).get("document_id") == row.get("id")
    ]
    platform_events_result = supabase.table("platform_events").select(
        "id, event_type, properties, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "event_type", list(DOCUMENT_WORK_EVENT_TYPES)
    ).order("created_at", desc=True).limit(100).execute()
    analysis = normalize_document_analysis(row, row.get("document_analysis"))

    work_history = build_document_work_history(
        row=row,
        user_id=user_id,
        session_id=session_id,
        document_jobs=document_jobs,
        deployment_history=deployment_history,
        archive_history=archive_history,
        platform_events=platform_events_result.data or [],
    )
    response_row = dict(row)
    if isinstance(response_row.get("document_remediation"), dict):
        remediation = {
            **response_row["document_remediation"],
            "export_readiness": build_pdf_export_readiness(response_row["document_remediation"]),
        }
        response_row["document_remediation"] = attach_tagflow_preview_signed_urls(remediation)

    return {
        "document": response_row,
        "analysis": analysis,
        "latest_job": analysis_jobs[0] if analysis_jobs else None,
        "jobs": document_jobs,
        "deployment_history": deployment_history,
        "archive_history": archive_history,
        "work_history": work_history,
    }


@router.post("/sessions/{session_id}/documents/{document_id}/analysis")
async def start_session_document_analysis(
    session_id: str,
    document_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)

    job_payload = {
        "session_id": session_id,
        "document_id": row["id"],
        "canvas_file_id": row.get("canvas_id"),
        "filename": row.get("filename"),
    }
    try:
        enqueued = enqueue_background_job(
            supabase,
            user_id=user_id,
            session_id=session_id,
            job_type="document_analysis",
            payload=job_payload,
            duplicate_fields=("document_id",),
            max_active_job_type_per_user=env_int("DOCUMENT_ANALYSIS_MAX_ACTIVE_JOBS_PER_USER", 4),
        )
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    job_id = enqueued.job["id"]
    if enqueued.created:
        dispatch_background_task(background_tasks, run_document_analysis_job, job_id, session_id, user_id, row["id"])
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_analysis_queued",
            properties={
                "job_id": job_id,
                "document_id": row["id"],
                "canvas_file_id": row.get("canvas_id"),
                "filename": row.get("filename"),
            },
        )

    return {"job_id": job_id, "document_id": row["id"], "status": enqueued.job.get("status") or "queued", "created": enqueued.created}


@router.post("/sessions/{session_id}/documents/{document_id}/remediation")
async def start_session_document_remediation(
    session_id: str,
    document_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    if (row.get("extension") or "").lower() != "pdf" and row.get("mime_type") != "application/pdf":
        raise HTTPException(status_code=422, detail="Document remediation is currently available for PDF files only")

    job_payload = {
        "session_id": session_id,
        "document_id": row["id"],
        "canvas_file_id": row.get("canvas_id"),
        "filename": row.get("filename"),
        "scope": "metadata_and_structure_extraction",
    }
    try:
        enqueued = enqueue_background_job(
            supabase,
            user_id=user_id,
            session_id=session_id,
            job_type="document_remediation",
            payload=job_payload,
            duplicate_fields=("document_id",),
            max_active_job_type_per_user=env_int("PDF_REMEDIATION_MAX_ACTIVE_JOBS_PER_USER", 3),
        )
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    job_id = enqueued.job["id"]
    if enqueued.created:
        dispatch_background_task(background_tasks, run_document_remediation_job, job_id, session_id, user_id, row["id"])
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_remediation_queued",
            properties={
                "job_id": job_id,
                "document_id": row["id"],
                "canvas_file_id": row.get("canvas_id"),
                "filename": row.get("filename"),
                "scope": "metadata_and_structure_extraction",
            },
        )

    return {"job_id": job_id, "document_id": row["id"], "status": enqueued.job.get("status") or "queued", "created": enqueued.created}


@router.get("/sessions/{session_id}/documents/{document_id}/analysis/status")
async def get_session_document_analysis_status(
    session_id: str,
    document_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    jobs = supabase.table("background_jobs").select(
        "id, job_type, status, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", "document_analysis"
    ).order("queued_at", desc=True).limit(10).execute()
    document_jobs = [
        job for job in (jobs.data or [])
        if (job.get("payload") or {}).get("document_id") in {row.get("id"), row.get("canvas_id")}
    ]
    analysis = row.get("document_analysis")
    return {
        "document_id": row["id"],
        "latest_job": document_jobs[0] if document_jobs else None,
        "analysis": analysis if isinstance(analysis, dict) else None,
    }


@router.post("/sessions/{session_id}/documents/{document_id}/replacement")
async def upload_session_document_replacement(
    session_id: str,
    document_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if not is_r2_configured():
        raise HTTPException(status_code=503, detail="R2 storage is required before uploading replacement documents")

    filename = safe_editor_upload_filename(file.filename or "replacement")
    content_type = normalize_editor_file_content_type(filename, file.content_type)
    data = await file.read()
    validate_editor_file_upload(filename, content_type, data)
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded replacement file is empty")
    if len(data) > MAX_EDITOR_FILE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Replacement uploads must be 50 MB or smaller")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    replacement_id = str(uuid.uuid4())
    r2_key = document_replacement_storage_key(session_id, row["id"], replacement_id, filename)
    initial_review = pdf_accessibility_probe(data) if filename_extension(filename) == "pdf" or content_type == "application/pdf" else None
    now = datetime.now(timezone.utc).isoformat()
    candidate = {
        "id": replacement_id,
        "status": "uploaded",
        "filename": filename,
        "content_type": content_type,
        "size_bytes": len(data),
        "r2_key": r2_key,
        "uploaded_at": now,
        "source": "manual_replacement_upload",
        "initial_accessibility_review": initial_review,
        "canvas_deployment": {
            "status": "not_deployed",
            "canvas_file_id": None,
            "canvas_url": None,
            "job_id": None,
        },
    }

    try:
        upload_bytes(
            r2_key,
            data,
            content_type=content_type,
            cache_control="private, max-age=31536000, immutable",
            metadata={
                "filename": filename,
                "source_document_id": row["id"],
                "source_canvas_file_id": str(row.get("canvas_id") or ""),
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Replacement upload storage failed: {exc}")

    persist_replacement_candidate(
        supabase,
        session_id=session_id,
        user_id=user_id,
        row=row,
        candidate=candidate,
        now=now,
        r2_working_key=r2_key,
    )

    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="document_replacement_uploaded",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "replacement_id": replacement_id,
            "filename": filename,
            "size_bytes": len(data),
            "r2_key": r2_key,
            "initial_accessibility_review": initial_review,
        },
    )

    return {
        "document_id": row["id"],
        "replacement_candidate": candidate,
    }


@router.post("/sessions/{session_id}/documents/{document_id}/replacement/reference-review")
async def mark_session_document_replacement_references_reviewed(
    session_id: str,
    document_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    candidate = row.get("replacement_candidate") if isinstance(row.get("replacement_candidate"), dict) else None
    if not candidate:
        raise HTTPException(status_code=422, detail="Upload a replacement candidate before reviewing references")

    now = datetime.now(timezone.utc).isoformat()
    reviewed_candidate = {
        **candidate,
        "status": "references_reviewed",
        "reference_review": {
            "status": "reviewed",
            "reviewed_at": now,
            "reviewed_by": user_id,
            "linked_count": row.get("linked_count") or 0,
            "filename_link_count": row.get("filename_link_count") or 0,
            "generic_link_count": row.get("generic_link_count") or 0,
            "content_item_ids": list(dict.fromkeys(
                link.get("content_item_id")
                for link in row.get("linked_from", [])
                if link.get("content_item_id")
            )),
        },
    }
    persist_replacement_candidate(
        supabase,
        session_id=session_id,
        user_id=user_id,
        row=row,
        candidate=reviewed_candidate,
        now=now,
    )
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="document_replacement_references_reviewed",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "replacement_id": reviewed_candidate.get("id"),
            "linked_count": row.get("linked_count") or 0,
            "filename_link_count": row.get("filename_link_count") or 0,
            "reviewed_at": now,
        },
    )

    return {
        "document_id": row["id"],
        "replacement_candidate": reviewed_candidate,
    }


@router.post("/sessions/{session_id}/documents/{document_id}/replacement/deploy")
async def deploy_session_document_replacement(
    session_id: str,
    document_id: str,
    body: DocumentReplacementDeployRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    candidate = row.get("replacement_candidate") if isinstance(row.get("replacement_candidate"), dict) else None
    if not candidate:
        raise HTTPException(status_code=422, detail="Upload a replacement candidate before deploying to Canvas")
    if not candidate.get("r2_key"):
        raise HTTPException(status_code=422, detail="Replacement candidate is missing its stored file")

    requested = [
        reference.dict()
        for reference in body.references
    ]
    selected_references = selected_document_references(row, requested) if requested else []
    now = datetime.now(timezone.utc).isoformat()
    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": "document_replacement_deploy",
        "status": "queued",
        "payload": {
            "session_id": session_id,
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "replacement_id": candidate.get("id"),
            "selected_references": selected_references,
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to create replacement deployment job")

    job_id = job_result.data[0]["id"]
    queued_candidate = {
        **candidate,
        "status": "deployment_queued",
        "reference_review": {
            "status": "reviewed",
            "reviewed_at": now,
            "reviewed_by": user_id,
            "linked_count": len(selected_references),
            "filename_link_count": sum(1 for reference in selected_references if reference.get("is_filename_label")),
            "generic_link_count": sum(1 for reference in selected_references if reference.get("issue_code")),
            "content_item_ids": list(dict.fromkeys(
                reference.get("content_item_id")
                for reference in selected_references
                if reference.get("content_item_id")
            )),
        },
        "canvas_deployment": {
            **(candidate.get("canvas_deployment") if isinstance(candidate.get("canvas_deployment"), dict) else {}),
            "status": "queued",
            "job_id": job_id,
            "queued_at": now,
            "selected_reference_count": len(selected_references),
        },
    }
    persist_replacement_candidate(
        supabase,
        session_id=session_id,
        user_id=user_id,
        row=row,
        candidate=queued_candidate,
        now=now,
    )
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="document_replacement_deploy_queued",
        properties={
            "job_id": job_id,
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "replacement_id": candidate.get("id"),
            "selected_reference_count": len(selected_references),
        },
    )
    dispatch_background_task(
        background_tasks,
        run_document_replacement_deploy_job,
        job_id,
        session_id,
        user_id,
        row["id"],
        selected_references,
    )

    return {
        "job_id": job_id,
        "document_id": row["id"],
        "replacement_candidate": queued_candidate,
        "status": "queued",
    }


@router.post("/sessions/{session_id}/documents/{document_id}/archive")
async def archive_replaced_original_document(
    session_id: str,
    document_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    if not row.get("canvas_id"):
        raise HTTPException(status_code=422, detail="Document is not linked to a Canvas file")
    candidate = row.get("replacement_candidate") if isinstance(row.get("replacement_candidate"), dict) else {}
    deployment = candidate.get("canvas_deployment") if isinstance(candidate.get("canvas_deployment"), dict) else {}
    if deployment.get("status") != "succeeded" or document_has_active_canvas_placement(row):
        raise HTTPException(status_code=422, detail="Only originals with a deployed replacement and no active references or module placement can be archived")

    now = datetime.now(timezone.utc).isoformat()
    existing_decision = row.get("inventory_decision") if isinstance(row.get("inventory_decision"), dict) else None
    decision_payload = {
        "content_item_id": row["id"],
        "session_id": session_id,
        "user_id": user_id,
        "action": "delete",
        "reason": "Original file queued for CanvasCurate Archive after replacement",
        "updated_at": now,
    }
    if existing_decision and existing_decision.get("id"):
        supabase.table("content_inventory_decisions").update(decision_payload).eq(
            "id", existing_decision["id"]
        ).execute()
    else:
        supabase.table("content_inventory_decisions").insert(decision_payload).execute()

    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": "document_file_archive",
        "status": "queued",
        "payload": {
            "session_id": session_id,
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "target_folder_name": "CanvasCurate Archive",
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to create archive job")

    job_id = job_result.data[0]["id"]
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="document_original_archive_queued",
        properties={
            "job_id": job_id,
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
        },
    )
    dispatch_background_task(
        background_tasks,
        run_document_file_archive_job,
        job_id,
        session_id,
        user_id,
        row["id"],
    )

    return {
        "job_id": job_id,
        "document_id": row["id"],
        "status": "queued",
    }


@router.post("/sessions/{session_id}/documents/{document_id}/canvas-deploy")
async def deploy_standalone_document_to_canvas(
    session_id: str,
    document_id: str,
    payload: StandaloneCanvasDeployRequest,
    background_tasks: BackgroundTasks,
    x_canvas_pat: str = Header(default=""),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    canvas_base_url, canvas_course_id = parse_canvas_course_url(payload.canvas_url)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    pat_token = x_canvas_pat.strip()
    if pat_token:
        store_active_canvas_pat(
            supabase,
            user_id=user_id,
            canvas_base_url=canvas_base_url,
            pat_token=pat_token,
        )
    else:
        try:
            get_active_pat(supabase, user_id, canvas_base_url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Canvas personal access token required. {exc}")

    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": STANDALONE_CANVAS_DEPLOY_JOB_TYPE,
        "status": "queued",
        "payload": {
            "session_id": session_id,
            "document_id": document_id,
            "canvas_url": payload.canvas_url,
            "canvas_base_url": canvas_base_url,
            "canvas_course_id": canvas_course_id,
            "filename": payload.filename,
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to create Canvas deployment job")

    job_id = job_result.data[0]["id"]
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="standalone_document_canvas_deploy_queued",
        properties={
            "job_id": job_id,
            "document_id": document_id,
            "canvas_base_url": canvas_base_url,
            "canvas_course_id": canvas_course_id,
        },
    )
    dispatch_background_task(background_tasks, run_standalone_canvas_deploy_job, job_id, session_id, user_id, document_id)
    return {
        "status": "queued",
        "job_id": job_id,
        "job_type": STANDALONE_CANVAS_DEPLOY_JOB_TYPE,
        "document_id": document_id,
        "canvas_course_id": canvas_course_id,
    }
