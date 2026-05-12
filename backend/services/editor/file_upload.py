"""Editor file upload service for Canvas-backed content."""

from __future__ import annotations

import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException, UploadFile

from canvas_sync import get_active_pat, sha256_payload
from content_inventory import compact_whitespace
from r2_storage import is_r2_configured, upload_bytes
from services.canvas_uploads import canvas_course_connection, canvas_file_html_url, upload_canvas_course_file
from services.document_records import get_owned_session, write_platform_event
from services.documents.pdf_probe import pdf_accessibility_probe
from supabase_client import get_supabase


logger = logging.getLogger(__name__)

MAX_EDITOR_FILE_UPLOAD_BYTES = 50 * 1024 * 1024
EDITABLE_CONTENT_TYPES = ["page", "assignment", "discussion", "quiz", "quiz_question"]
ALLOWED_EDITOR_FILE_EXTENSIONS = {
    "csv",
    "doc",
    "docx",
    "pdf",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
}
EDITOR_FILE_CONTENT_TYPES = {
    "application/msword",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/csv",
}


def safe_upload_filename(filename: str, fallback: str = "document") -> str:
    clean = compact_whitespace(filename).replace("/", "-").replace("\\", "-")
    clean = re.sub(r"[\x00-\x1f]+", "", clean).strip(" .")
    return clean or fallback


def filename_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def normalize_editor_file_content_type(filename: str, content_type: str | None) -> str:
    normalized = (content_type or "").split(";", 1)[0].strip().lower()
    guessed = mimetypes.guess_type(filename)[0]
    if normalized in {"", "application/octet-stream"} and guessed:
        normalized = guessed.lower()
    return normalized or "application/octet-stream"


def validate_editor_file_upload(filename: str, content_type: str, data: bytes):
    extension = filename_extension(filename)
    if extension not in ALLOWED_EDITOR_FILE_EXTENSIONS and content_type not in EDITOR_FILE_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="Upload a PDF, Word, PowerPoint, CSV, or Excel file")
    if content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="Use the image upload tool for image files")
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")
    if len(data) > MAX_EDITOR_FILE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File uploads must be 50 MB or smaller")


def editor_file_storage_key(session_id: str, document_id: str, filename: str) -> str:
    extension = filename_extension(filename)
    suffix = f".{extension}" if extension else ""
    return f"documents/editor-uploads/{session_id}/{document_id}/original{suffix}"


async def upload_editor_file(
    *,
    session_id: str,
    content_item_id: str,
    user_id: str,
    file: UploadFile,
) -> dict[str, Any]:
    filename = safe_upload_filename(file.filename or "document")
    content_type = normalize_editor_file_content_type(filename, file.content_type)
    data = await file.read()
    validate_editor_file_upload(filename, content_type, data)

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    item_result = supabase.table("course_content_items").select(
        "id, title, content_type"
    ).eq("id", content_item_id).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")
    item = item_result.data[0]
    if item.get("content_type") not in EDITABLE_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="This content type does not support editor file uploads")

    course = canvas_course_connection(supabase, session_id, user_id)
    canvas_base_url = course["canvas_base_url"]
    canvas_course_id = course["canvas_course_id"]
    pat_token = get_active_pat(supabase, user_id, canvas_base_url)

    try:
        file_row = upload_canvas_course_file(
            canvas_base_url=canvas_base_url,
            canvas_course_id=canvas_course_id,
            pat_token=pat_token,
            filename=filename,
            content_type=content_type,
            data=data,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while uploading file")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Canvas file upload failed: {exc}")

    canvas_file_id = str(file_row.get("id")) if file_row.get("id") is not None else str(uuid.uuid4())
    canvas_url = canvas_file_html_url(canvas_base_url, canvas_course_id, file_row)
    now = datetime.now(timezone.utc).isoformat()
    title = file_row.get("display_name") or file_row.get("filename") or filename
    uploaded_filename = file_row.get("filename") or filename
    folder = file_row.get("folder") if isinstance(file_row.get("folder"), dict) else {}
    initial_review = pdf_accessibility_probe(data) if filename_extension(uploaded_filename) == "pdf" or content_type == "application/pdf" else None

    content_row = {
        "session_id": session_id,
        "user_id": user_id,
        "canvas_id": canvas_file_id,
        "content_type": "file",
        "title": title,
        "canvas_url": canvas_url,
        "published": not bool(file_row.get("hidden")),
        "module_name": None,
        "position": None,
        "body_hash": sha256_payload({"file": canvas_file_id, "filename": uploaded_filename}),
        "body_word_count": 0,
        "last_canvas_edit_at": file_row.get("updated_at") or file_row.get("created_at") or now,
        "last_synced_at": now,
        "is_orphaned": True,
        "metadata": {
            "filename": uploaded_filename,
            "content_type": file_row.get("content-type") or file_row.get("content_type") or content_type,
            "size": file_row.get("size") or len(data),
            "folder_id": file_row.get("folder_id") or folder.get("id"),
            "folder_name": folder.get("name"),
            "folder_path": folder.get("full_name"),
            "uploaded_via": "editor_file_upload",
            "source_content_item_id": content_item_id,
            "initial_accessibility_review": initial_review,
        },
        "updated_at": now,
    }
    existing_result = supabase.table("course_content_items").select("id").eq(
        "session_id", session_id
    ).eq("canvas_id", canvas_file_id).eq("content_type", "file").limit(1).execute()
    if existing_result.data:
        file_content_item_id = existing_result.data[0]["id"]
        supabase.table("course_content_items").update(content_row).eq("id", file_content_item_id).execute()
    else:
        insert_result = supabase.table("course_content_items").insert(content_row).execute()
        file_content_item_id = insert_result.data[0]["id"] if insert_result.data else None

    document_id = str(uuid.uuid4())
    r2_key = editor_file_storage_key(session_id, document_id, uploaded_filename)
    stored_in_r2 = False
    if is_r2_configured():
        try:
            upload_bytes(
                r2_key,
                data,
                content_type=content_type,
                cache_control="private, max-age=31536000, immutable",
                metadata={"filename": uploaded_filename, "canvas_file_id": canvas_file_id},
            )
            stored_in_r2 = True
            supabase.table("documents").insert({
                "id": document_id,
                "user_id": user_id,
                "session_id": session_id,
                "filename": uploaded_filename,
                "status": "uploaded",
                "r2_original_key": r2_key,
                "page_count": initial_review.get("page_count") if initial_review else None,
                "tag_data": {
                    "source": "editor_file_upload",
                    "content_item_id": file_content_item_id,
                    "canvas_file_id": canvas_file_id,
                    "canvas_url": canvas_url,
                    "mime_type": content_type,
                    "initial_accessibility_review": initial_review,
                },
                "ai_suggestions": {},
                "created_at": now,
                "updated_at": now,
            }).execute()
        except Exception:
            stored_in_r2 = False
            logger.exception(
                "Failed to store editor-uploaded document in R2/documents for session_id=%s content_item_id=%s",
                session_id,
                content_item_id,
            )

    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="editor_file_uploaded",
        properties={
            "content_item_id": content_item_id,
            "file_content_item_id": file_content_item_id,
            "canvas_file_id": canvas_file_id,
            "canvas_url": canvas_url,
            "filename": uploaded_filename,
            "content_type": content_type,
            "size": len(data),
            "stored_in_r2": stored_in_r2,
            "document_id": document_id if stored_in_r2 else None,
            "initial_accessibility_review": initial_review,
            "uploaded_at": now,
        },
    )

    return {
        "file": {
            "content_item_id": file_content_item_id,
            "canvas_file_id": canvas_file_id,
            "canvas_url": canvas_url,
            "filename": uploaded_filename,
            "title": title,
            "content_type": content_type,
            "size": len(data),
            "document_id": document_id if stored_in_r2 else None,
            "stored_in_r2": stored_in_r2,
            "initial_accessibility_review": initial_review,
        },
        "insert": {
            "href": canvas_url,
            "text": title or uploaded_filename,
            "canvas_file_id": canvas_file_id,
        },
    }
