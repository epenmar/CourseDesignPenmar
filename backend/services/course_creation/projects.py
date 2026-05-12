"""Course Creation project and source upload helpers.

This module owns standalone Course Creation persistence while the workflow is
still in draft form. Project setup lives in the owning create-session metadata;
source files use the existing R2-backed documents table so uploads inherit the
current retention and ownership model without adding to the legacy Canvas router.
"""

from __future__ import annotations

import json
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from r2_storage import is_r2_configured, upload_bytes

COURSE_CREATION_SOURCE = "course_creation_source"
COURSE_CREATION_EXTRACT_JOB_TYPE = "course_creation_source_extract"
COURSE_CREATION_OUTLINE_JOB_TYPE = "course_creation_outline_generate"
COURSE_CREATION_DRAFT_JOB_TYPE = "course_creation_drafts_generate"
MAX_SOURCE_UPLOAD_BYTES = 75 * 1024 * 1024
ALLOWED_SOURCE_EXTENSIONS = {
    "csv",
    "doc",
    "docx",
    "htm",
    "html",
    "md",
    "pdf",
    "ppt",
    "pptx",
    "txt",
    "xls",
    "xlsx",
}
ALLOWED_SOURCE_CONTENT_TYPES = {
    "application/msword",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/csv",
    "text/html",
    "text/markdown",
    "text/plain",
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def filename_extension(filename: str | None) -> str:
    value = filename or ""
    return value.rsplit(".", 1)[-1].lower() if "." in value else ""


def safe_upload_filename(filename: str | None, fallback: str = "source") -> str:
    clean = re.sub(r"\s+", " ", filename or "").replace("/", "-").replace("\\", "-")
    clean = re.sub(r"[\x00-\x1f]+", "", clean).strip(" .")
    return clean or fallback


def normalize_source_content_type(filename: str, content_type: str | None) -> str:
    normalized = (content_type or "").split(";", 1)[0].strip().lower()
    guessed = mimetypes.guess_type(filename)[0]
    if normalized in {"", "application/octet-stream"} and guessed:
        normalized = guessed.lower()
    return normalized or "application/octet-stream"


def validate_source_upload(filename: str, content_type: str, data: bytes) -> None:
    extension = filename_extension(filename)
    if extension not in ALLOWED_SOURCE_EXTENSIONS and content_type not in ALLOWED_SOURCE_CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail="Upload a PDF, Word, PowerPoint, Excel, CSV, Markdown, HTML, or text source file",
        )
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")
    if len(data) > MAX_SOURCE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Course source uploads must be 75 MB or smaller")


def source_storage_key(session_id: str, source_id: str, filename: str) -> str:
    extension = filename_extension(filename)
    suffix = f".{extension}" if extension else ""
    return f"course-creation/{session_id}/sources/{source_id}/original{suffix}"


def extraction_storage_key(session_id: str, source_id: str) -> str:
    return f"course-creation/{session_id}/sources/{source_id}/extraction.json"


def outline_debug_storage_key(session_id: str, job_id: str) -> str:
    return f"course-creation/{session_id}/outline-runs/{job_id}/ai-response.json"


def get_owned_course_creation_session(supabase, session_id: str, user_id: str) -> dict[str, Any]:
    result = supabase.table("sessions").select(
        "id, user_id, type, name, meta, created_at, updated_at"
    ).eq("id", session_id).eq("user_id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    session = result.data[0]
    if session.get("type") != "create":
        raise HTTPException(status_code=422, detail="Course Creation is only available for create sessions")
    return session


def course_creation_meta(session: dict[str, Any]) -> dict[str, Any]:
    meta = session.get("meta") if isinstance(session.get("meta"), dict) else {}
    project = meta.get("course_creation") if isinstance(meta.get("course_creation"), dict) else {}
    return project


def project_setup_from_meta(project: dict[str, Any]) -> dict[str, Any]:
    setup = project.get("setup") if isinstance(project.get("setup"), dict) else {}
    return {
        "course_title": str(setup.get("course_title") or ""),
        "course_code": str(setup.get("course_code") or ""),
        "course_description": str(setup.get("course_description") or ""),
        "audience": str(setup.get("audience") or ""),
        "level": str(setup.get("level") or ""),
        "term_length": str(setup.get("term_length") or ""),
        "module_count": setup.get("module_count"),
        "module_cadence": str(setup.get("module_cadence") or ""),
        "source_notes": str(setup.get("source_notes") or ""),
    }


def update_course_creation_setup(
    supabase,
    *,
    session: dict[str, Any],
    setup_patch: dict[str, Any],
) -> dict[str, Any]:
    now = utc_now_iso()
    meta = session.get("meta") if isinstance(session.get("meta"), dict) else {}
    project = meta.get("course_creation") if isinstance(meta.get("course_creation"), dict) else {}
    current_setup = project_setup_from_meta(project)
    next_setup = {**current_setup, **setup_patch}
    next_project = {
        **project,
        "status": project.get("status") or "draft",
        "setup": next_setup,
        "updated_at": now,
    }
    if not next_project.get("created_at"):
        next_project["created_at"] = now

    update_result = supabase.table("sessions").update({
        "name": next_setup.get("course_title") or session.get("name") or "New Course Build",
        "meta": {**meta, "course_creation": next_project},
        "updated_at": now,
    }).eq("id", session["id"]).eq("user_id", session["user_id"]).execute()
    if not update_result.data:
        raise HTTPException(status_code=500, detail="Failed to update Course Creation project")
    return update_result.data[0]


def update_course_creation_project_data(
    supabase,
    *,
    session_id: str,
    user_id: str,
    project_patch: dict[str, Any],
) -> dict[str, Any]:
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    now = utc_now_iso()
    meta = session.get("meta") if isinstance(session.get("meta"), dict) else {}
    project = meta.get("course_creation") if isinstance(meta.get("course_creation"), dict) else {}
    next_project = {
        **project,
        **project_patch,
        "updated_at": now,
    }
    if not next_project.get("created_at"):
        next_project["created_at"] = now
    result = supabase.table("sessions").update({
        "meta": {**meta, "course_creation": next_project},
        "updated_at": now,
    }).eq("id", session_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update Course Creation project")
    return result.data[0]


def compact_source_job(job: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(job, dict):
        return None
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    extraction = result.get("extraction") if isinstance(result.get("extraction"), dict) else {}
    compact_result = None
    if extraction:
        compact_result = {
            "status": extraction.get("status"),
            "message": extraction.get("message"),
            "page_count": extraction.get("page_count"),
            "chunk_count": extraction.get("chunk_count"),
            "text_char_count": extraction.get("text_char_count"),
            "artifact_key": extraction.get("artifact_key"),
            "extracted_at": extraction.get("extracted_at"),
        }
    elif result:
        compact_result = {
            key: value
            for key, value in result.items()
            if key not in {"extraction", "outline"}
        }
    return {
        "id": job.get("id"),
        "job_type": job.get("job_type"),
        "status": job.get("status"),
        "payload": {
            "session_id": payload.get("session_id"),
            "source_id": payload.get("source_id"),
            "filename": payload.get("filename"),
        },
        "result": compact_result,
        "error_message": job.get("error_message"),
        "queued_at": job.get("queued_at"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
    }


def source_row(document: dict[str, Any], latest_job: dict[str, Any] | None = None) -> dict[str, Any]:
    tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
    course_creation = (
        tag_data.get("course_creation")
        if isinstance(tag_data.get("course_creation"), dict)
        else {}
    )
    summary = (
        course_creation.get("extraction_summary")
        if isinstance(course_creation.get("extraction_summary"), dict)
        else None
    )
    return {
        "id": document.get("id"),
        "filename": document.get("filename"),
        "content_type": tag_data.get("mime_type"),
        "size_bytes": tag_data.get("size"),
        "status": document.get("status"),
        "extraction_status": course_creation.get("extraction_status") or "not_started",
        "extraction_summary": summary,
        "extraction_job_id": course_creation.get("extraction_job_id"),
        "latest_job": compact_source_job(latest_job),
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
    }


def list_course_creation_sources(supabase, *, session_id: str, user_id: str) -> list[dict[str, Any]]:
    result = supabase.table("documents").select(
        "id, filename, status, r2_original_key, r2_working_key, tag_data, deleted_at, created_at, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).order("created_at", desc=True).execute()
    documents = []
    source_ids: set[str] = set()
    for document in result.data or []:
        if document.get("deleted_at"):
            continue
        tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
        if tag_data.get("source") != COURSE_CREATION_SOURCE:
            continue
        documents.append(document)
        if document.get("id"):
            source_ids.add(str(document["id"]))

    jobs_by_source: dict[str, dict[str, Any]] = {}
    if source_ids:
        jobs_result = supabase.table("background_jobs").select(
            "id, job_type, status, payload, result, error_message, queued_at, started_at, finished_at"
        ).eq("session_id", session_id).eq("user_id", user_id).eq(
            "job_type", COURSE_CREATION_EXTRACT_JOB_TYPE
        ).order("queued_at", desc=True).limit(100).execute()
        for job in jobs_result.data or []:
            payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
            source_id = str(payload.get("source_id") or "")
            if source_id in source_ids and source_id not in jobs_by_source:
                jobs_by_source[source_id] = job

    return [source_row(document, jobs_by_source.get(str(document.get("id")))) for document in documents]


def get_course_creation_source(supabase, *, session_id: str, user_id: str, source_id: str) -> dict[str, Any]:
    result = supabase.table("documents").select(
        "id, filename, status, r2_original_key, r2_working_key, tag_data, deleted_at, created_at, updated_at"
    ).eq("id", source_id).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not result.data or result.data[0].get("deleted_at"):
        raise HTTPException(status_code=404, detail="Source file not found")
    document = result.data[0]
    tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
    if tag_data.get("source") != COURSE_CREATION_SOURCE:
        raise HTTPException(status_code=404, detail="Source file not found")
    return document


def create_course_creation_source(
    supabase,
    *,
    session_id: str,
    user_id: str,
    filename: str,
    content_type: str,
    data: bytes,
) -> dict[str, Any]:
    if not is_r2_configured():
        raise HTTPException(status_code=503, detail="R2 storage is required before uploading course sources")

    source_id = str(uuid.uuid4())
    now = utc_now_iso()
    r2_key = source_storage_key(session_id, source_id, filename)
    upload_bytes(
        r2_key,
        data,
        content_type=content_type,
        cache_control="private, max-age=31536000, immutable",
        metadata={
            "filename": filename,
            "source": COURSE_CREATION_SOURCE,
        },
    )
    document = {
        "id": source_id,
        "user_id": user_id,
        "session_id": session_id,
        "filename": filename,
        "status": "uploaded",
        "r2_original_key": r2_key,
        "tag_data": {
            "source": COURSE_CREATION_SOURCE,
            "mime_type": content_type,
            "size": len(data),
            "r2_original_key": r2_key,
            "course_creation": {
                "role": "source",
                "extraction_status": "not_started",
            },
        },
        "ai_suggestions": {},
        "created_at": now,
        "updated_at": now,
    }
    result = supabase.table("documents").insert(document).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create source file record")
    return result.data[0]


def mark_source_extraction_queued(
    supabase,
    *,
    session_id: str,
    user_id: str,
    source_id: str,
    job_id: str,
) -> None:
    document = get_course_creation_source(
        supabase,
        session_id=session_id,
        user_id=user_id,
        source_id=source_id,
    )
    tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
    course_creation = tag_data.get("course_creation") if isinstance(tag_data.get("course_creation"), dict) else {}
    now = utc_now_iso()
    supabase.table("documents").update({
        "tag_data": {
            **tag_data,
            "course_creation": {
                **course_creation,
                "extraction_status": "queued",
                "extraction_job_id": job_id,
                "extraction_queued_at": now,
            },
        },
        "updated_at": now,
    }).eq("id", source_id).eq("session_id", session_id).eq("user_id", user_id).execute()


def mark_source_deleted(supabase, *, session_id: str, user_id: str, source_id: str) -> None:
    get_course_creation_source(
        supabase,
        session_id=session_id,
        user_id=user_id,
        source_id=source_id,
    )
    now = utc_now_iso()
    supabase.table("documents").update({
        "status": "deleted",
        "deleted_at": now,
        "updated_at": now,
    }).eq("id", source_id).eq("session_id", session_id).eq("user_id", user_id).execute()


def project_response(supabase, *, session: dict[str, Any]) -> dict[str, Any]:
    project = course_creation_meta(session)
    sources = list_course_creation_sources(
        supabase,
        session_id=session["id"],
        user_id=session["user_id"],
    )
    return {
        "session_id": session["id"],
        "name": session.get("name") or "New Course Build",
        "status": project.get("status") or "draft",
        "setup": project_setup_from_meta(project),
        "sources": sources,
        "source_analysis": project.get("source_analysis") if isinstance(project.get("source_analysis"), dict) else None,
        "outline": project.get("outline") if isinstance(project.get("outline"), dict) else None,
        "outline_generation": project.get("outline_generation") if isinstance(project.get("outline_generation"), dict) else None,
        "draft_generation": project.get("draft_generation") if isinstance(project.get("draft_generation"), dict) else None,
        "created_at": project.get("created_at") or session.get("created_at"),
        "updated_at": project.get("updated_at") or session.get("updated_at"),
    }


def write_extraction_artifact(
    *,
    session_id: str,
    source_id: str,
    filename: str,
    extraction: dict[str, Any],
) -> str:
    key = extraction_storage_key(session_id, source_id)
    upload_bytes(
        key,
        json.dumps(extraction, ensure_ascii=True).encode("utf-8"),
        content_type="application/json",
        cache_control="private, max-age=31536000",
        metadata={
            "filename": filename,
            "source": COURSE_CREATION_SOURCE,
            "artifact": "extraction",
        },
    )
    return key


def write_outline_debug_artifact(
    *,
    session_id: str,
    job_id: str,
    debug_payload: dict[str, Any],
) -> str:
    key = outline_debug_storage_key(session_id, job_id)
    upload_bytes(
        key,
        json.dumps(debug_payload, ensure_ascii=True).encode("utf-8"),
        content_type="application/json",
        cache_control="private, max-age=31536000",
        metadata={
            "source": COURSE_CREATION_SOURCE,
            "artifact": "outline_ai_response",
            "job_id": job_id,
        },
    )
    return key
