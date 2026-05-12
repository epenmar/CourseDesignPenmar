"""PDF export API routes.

Provides tagged-PDF export validation, queueing, and authorized download
boundaries outside the legacy Canvas router.
"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse, Response

from api.pdf_export.schemas import PdfExportQueueRequest
from auth import get_current_user
from jobs.pdf_export import PDF_EXPORT_JOB_TYPE, build_pdf_export_job_payload, run_pdf_export_job
from services.job_dispatch import dispatch_background_task
from services.job_queue import JobAdmissionError, enqueue_background_job, env_int
from r2_storage import download_bytes
from services.document_records import get_document_file_row, get_owned_session, write_platform_event
from services.pdf_export.readiness import build_pdf_export_readiness
from services.pdf_export.source import load_source_pdf_bytes
from services.pdf_export.validator import validate_remediation_export
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas", tags=["pdf_export"])


def _get_document_remediation(supabase, session_id: str, user_id: str, document_id: str) -> tuple[dict, dict]:
    get_owned_session(supabase, session_id, user_id)
    row = get_document_file_row(supabase, session_id, user_id, document_id)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    remediation = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else None
    if not remediation:
        raise HTTPException(status_code=409, detail="Run PDF review before validating export")
    return row, remediation


def _attachment_response(data: bytes, *, filename: str, content_type: str | None) -> Response:
    safe_filename = filename.strip() or "document.pdf"
    return Response(
        content=data,
        media_type=content_type or "application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe_filename)}",
            "Access-Control-Expose-Headers": "Content-Disposition",
            "Cache-Control": "private, no-store",
        },
    )


def _pdf_filename(value: str | None, fallback: str) -> str:
    filename = (value or fallback).strip() or fallback
    return filename if filename.lower().endswith(".pdf") else f"{filename}.pdf"


def _accessible_pdf_filename(value: str | None) -> str:
    filename = _pdf_filename(value, "document.pdf")
    return f"{filename[:-4]} accessible.pdf"


@router.get("/sessions/{session_id}/documents/{document_id}/pdf-export/validation")
async def validate_session_document_pdf_export(
    session_id: str,
    document_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    row, remediation = _get_document_remediation(supabase, session_id, user_id, document_id)
    validation = validate_remediation_export(remediation)
    return {
        "document_id": row["id"],
        "validation": validation,
        "export_readiness": build_pdf_export_readiness(remediation),
    }


@router.post("/sessions/{session_id}/documents/{document_id}/pdf-export/queue")
async def queue_session_document_pdf_export(
    session_id: str,
    document_id: str,
    background_tasks: BackgroundTasks,
    payload: PdfExportQueueRequest | None = None,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    row, remediation = _get_document_remediation(supabase, session_id, user_id, document_id)
    validation = validate_remediation_export(remediation)
    if validation.get("error_count", 0) and not (payload and payload.force):
        return JSONResponse(
            status_code=409,
            content={
                "status": "blocked",
                "document_id": row["id"],
                "job_type": PDF_EXPORT_JOB_TYPE,
                "validation": validation,
                "export_readiness": build_pdf_export_readiness(remediation),
            },
        )

    job_payload = build_pdf_export_job_payload(session_id=session_id, document=row)
    try:
        enqueued = enqueue_background_job(
            supabase,
            user_id=user_id,
            session_id=session_id,
            job_type=PDF_EXPORT_JOB_TYPE,
            payload=job_payload,
            duplicate_fields=("document_id",),
            max_active_job_type_per_user=env_int("PDF_EXPORT_MAX_ACTIVE_JOBS_PER_USER", 2),
        )
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    job_id = enqueued.job["id"]
    queued_at = datetime.now(timezone.utc).isoformat()
    if enqueued.created:
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_pdf_export_queued",
            properties={
                "job_id": job_id,
                "document_id": row["id"],
                "canvas_file_id": row.get("canvas_id"),
                "warning_count": validation.get("warning_count", 0),
            },
        )
        dispatch_background_task(background_tasks, run_pdf_export_job, job_id, session_id, user_id, row["id"])

    return {
        "status": enqueued.job.get("status") or "queued",
        "job_id": job_id,
        "created": enqueued.created,
        "queued_at": queued_at,
        "document_id": row["id"],
        "job_type": PDF_EXPORT_JOB_TYPE,
        "job_payload": job_payload,
        "validation": validation,
        "export_readiness": build_pdf_export_readiness(remediation),
        "message": "PDF export job queued. The worker will generate the current PDF artifact and register it as the replacement candidate.",
    }


@router.get("/sessions/{session_id}/documents/{document_id}/pdf-export/original")
async def download_session_document_pdf_original(
    session_id: str,
    document_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_document_file_row(supabase, session_id, user_id, document_id)
    data, content_type = load_source_pdf_bytes(
        supabase,
        session_id=session_id,
        user_id=user_id,
        document=row,
    )
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    filename = _pdf_filename(str(metadata.get("filename") or row.get("title") or ""), "original-document.pdf")
    return _attachment_response(data, filename=filename, content_type=content_type)


@router.get("/sessions/{session_id}/documents/{document_id}/pdf-export/artifact")
async def download_session_document_pdf_export_artifact(
    session_id: str,
    document_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    row, remediation = _get_document_remediation(supabase, session_id, user_id, document_id)
    artifact = remediation.get("export_artifact") if isinstance(remediation.get("export_artifact"), dict) else None
    if not artifact or not artifact.get("r2_key"):
        raise HTTPException(status_code=404, detail="Generated PDF export artifact not found")

    data, content_type = download_bytes(str(artifact["r2_key"]))
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    filename = _accessible_pdf_filename(str(metadata.get("filename") or row.get("title") or ""))
    return _attachment_response(data, filename=filename, content_type=content_type or artifact.get("content_type"))
