"""Standalone document upload and read-model helpers.

Keeps non-Canvas document session behavior outside the legacy Canvas router
while returning rows shaped like the existing Documents inventory.
"""

from __future__ import annotations

import mimetypes
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from r2_storage import is_r2_configured, upload_bytes

MAX_DOCUMENT_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_DOCUMENT_EXTENSIONS = {
    "csv",
    "doc",
    "docx",
    "pdf",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
}
DOCUMENT_CONTENT_TYPES = {
    "application/msword",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/csv",
}


def filename_extension(filename: str | None) -> str:
    value = filename or ""
    return value.rsplit(".", 1)[-1].lower() if "." in value else ""


def safe_upload_filename(filename: str | None, fallback: str = "document") -> str:
    clean = re.sub(r"\s+", " ", filename or "").replace("/", "-").replace("\\", "-")
    clean = re.sub(r"[\x00-\x1f]+", "", clean).strip(" .")
    return clean or fallback


def normalize_document_content_type(filename: str, content_type: str | None) -> str:
    normalized = (content_type or "").split(";", 1)[0].strip().lower()
    guessed = mimetypes.guess_type(filename)[0]
    if normalized in {"", "application/octet-stream"} and guessed:
        normalized = guessed.lower()
    return normalized or "application/octet-stream"


def validate_document_upload(filename: str, content_type: str, data: bytes) -> None:
    extension = filename_extension(filename)
    if extension not in ALLOWED_DOCUMENT_EXTENSIONS and content_type not in DOCUMENT_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="Upload a PDF, Word, PowerPoint, CSV, or Excel file")
    if content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="Use the Images workflow for image files")
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")
    if len(data) > MAX_DOCUMENT_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Document uploads must be 50 MB or smaller")


def standalone_document_storage_key(session_id: str, document_id: str, filename: str) -> str:
    extension = filename_extension(filename)
    suffix = f".{extension}" if extension else ""
    return f"documents/standalone-uploads/{session_id}/{document_id}/original{suffix}"


def standalone_document_row(document: dict[str, Any]) -> dict[str, Any]:
    tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
    filename = document.get("filename") or "Untitled file"
    extension = filename_extension(filename)
    mime_type = tag_data.get("mime_type") or mimetypes.guess_type(filename)[0]
    initial_review = (
        tag_data.get("initial_accessibility_review")
        if isinstance(tag_data.get("initial_accessibility_review"), dict)
        else None
    )
    remediation_plan = (
        tag_data.get("document_remediation")
        if isinstance(tag_data.get("document_remediation"), dict)
        else None
    )
    remediation_probe = (
        remediation_plan.get("initial_probe")
        if isinstance(remediation_plan, dict) and isinstance(remediation_plan.get("initial_probe"), dict)
        else None
    )
    accessibility_review = initial_review or remediation_probe
    review_issues = accessibility_review.get("issues") if isinstance(accessibility_review, dict) else None
    if accessibility_review:
        accessibility_status = "needs_review" if review_issues else "passed_initial_check"
    elif extension == "pdf" or mime_type == "application/pdf":
        accessibility_status = "not_checked"
    else:
        accessibility_status = "unsupported_file_type"

    replacement_candidate = (
        tag_data.get("replacement_candidate")
        if isinstance(tag_data.get("replacement_candidate"), dict)
        else None
    )
    replacement_deployment = (
        replacement_candidate.get("canvas_deployment")
        if isinstance(replacement_candidate, dict) and isinstance(replacement_candidate.get("canvas_deployment"), dict)
        else None
    )

    return {
        "id": document.get("id"),
        "canvas_id": tag_data.get("canvas_file_id"),
        "title": filename,
        "filename": filename,
        "extension": extension,
        "mime_type": mime_type,
        "size_bytes": tag_data.get("size"),
        "folder_id": None,
        "folder_name": None,
        "folder_path": "Standalone uploads",
        "canvas_url": tag_data.get("canvas_url"),
        "published": None,
        "module_canvas_id": None,
        "module_name": None,
        "is_orphaned": False,
        "uploaded_via": tag_data.get("source") or "standalone_document_upload",
        "is_image_file": False,
        "non_embedded_image_file": False,
        "is_replacement_file": False,
        "source_document_id": None,
        "source_canvas_file_id": tag_data.get("source_canvas_file_id"),
        "replacement_candidate": replacement_candidate,
        "replacement_status": replacement_candidate.get("status") if replacement_candidate else None,
        "replacement_canvas_file_id": replacement_deployment.get("canvas_file_id") if replacement_deployment else None,
        "replacement_canvas_url": replacement_deployment.get("canvas_url") if replacement_deployment else None,
        "standalone_canvas_deployment": tag_data.get("standalone_canvas_deployment") if isinstance(tag_data.get("standalone_canvas_deployment"), dict) else None,
        "standalone_canvas_deployments": tag_data.get("standalone_canvas_deployments") if isinstance(tag_data.get("standalone_canvas_deployments"), list) else [],
        "canvas_archive": tag_data.get("canvas_archive") if isinstance(tag_data.get("canvas_archive"), dict) else None,
        "accessibility_status": accessibility_status,
        "accessibility_issue_count": len(review_issues or []),
        "accessibility_review": accessibility_review,
        "document_analysis": tag_data.get("document_analysis") if isinstance(tag_data.get("document_analysis"), dict) else None,
        "document_remediation": remediation_plan,
        "source_content_item": None,
        "linked_from": [],
        "linked_count": 0,
        "filename_link_count": 0,
        "generic_link_count": 0,
        "r2_original_key": document.get("r2_original_key"),
        "r2_working_key": document.get("r2_working_key"),
        "r2_export_key": document.get("r2_export_key"),
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
    }


def standalone_document_rows(supabase, session_id: str, user_id: str) -> list[dict[str, Any]]:
    result = supabase.table("documents").select(
        "id, filename, status, r2_original_key, r2_working_key, r2_export_key, page_count, tag_data, ai_suggestions, deleted_at, created_at, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    rows: list[dict[str, Any]] = []
    for document in result.data or []:
        if document.get("deleted_at"):
            continue
        tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
        if tag_data.get("content_item_id") or tag_data.get("canvas_file_id"):
            continue
        rows.append(standalone_document_row(document))
    return rows


def create_standalone_document(
    supabase,
    *,
    session_id: str,
    user_id: str,
    filename: str,
    content_type: str,
    data: bytes,
    initial_accessibility_review: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not is_r2_configured():
        raise HTTPException(status_code=503, detail="R2 storage is required before uploading standalone documents")

    document_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    r2_key = standalone_document_storage_key(session_id, document_id, filename)
    upload_bytes(
        r2_key,
        data,
        content_type=content_type,
        cache_control="private, max-age=31536000, immutable",
        metadata={
            "filename": filename,
            "source": "standalone_document_upload",
        },
    )
    document = {
        "id": document_id,
        "user_id": user_id,
        "session_id": session_id,
        "filename": filename,
        "status": "uploaded",
        "r2_original_key": r2_key,
        "page_count": initial_accessibility_review.get("page_count") if initial_accessibility_review else None,
        "tag_data": {
            "source": "standalone_document_upload",
            "mime_type": content_type,
            "size": len(data),
            "r2_original_key": r2_key,
            "initial_accessibility_review": initial_accessibility_review,
        },
        "ai_suggestions": {},
        "created_at": now,
        "updated_at": now,
    }
    result = supabase.table("documents").insert(document).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create document record")
    return result.data[0]
