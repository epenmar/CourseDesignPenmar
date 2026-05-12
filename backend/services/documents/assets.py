"""Document asset storage and source-byte helpers."""

from __future__ import annotations

import re
import uuid
from typing import Any

from canvas_sync import CanvasClient, get_active_pat
from r2_storage import download_bytes, is_r2_configured
from services.canvas_uploads import canvas_course_connection
from services.editor.canvas_recovery import download_canvas_file_for_copy
from services.editor.file_upload import filename_extension


def document_replacement_storage_key(session_id: str, document_id: str, replacement_id: str, filename: str) -> str:
    extension = filename_extension(filename)
    suffix = f".{extension}" if extension else ".pdf"
    return f"documents/replacements/{session_id}/{document_id}/{replacement_id}/candidate{suffix}"


def document_tagflow_preview_storage_key(
    session_id: str,
    document_id: str,
    version: int,
    page_number: int,
    variant: str,
) -> str:
    return f"documents/tagflow-previews/{session_id}/{document_id}/v{version}/page-{page_number}/{variant}.webp"


def document_pdf_figure_asset_storage_key(session_id: str, document_id: str, extracted_at: str, figure_id: str) -> str:
    safe_figure_id = re.sub(r"[^A-Za-z0-9_.-]+", "-", figure_id).strip("-") or "figure"
    safe_timestamp = re.sub(r"[^0-9A-Za-z]+", "", extracted_at)[:24] or uuid.uuid4().hex[:12]
    return f"documents/pdf-figures/{session_id}/{document_id}/{safe_timestamp}/{safe_figure_id}.webp"


def load_document_pdf_bytes(
    supabase,
    *,
    session_id: str,
    user_id: str,
    row: dict[str, Any],
) -> tuple[bytes, str | None]:
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, metadata"
    ).eq("id", row["id"]).eq("session_id", session_id).eq(
        "user_id", user_id
    ).eq("content_type", "file").limit(1).execute()
    item = item_result.data[0] if item_result.data else {}
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    r2_key = metadata.get("r2_original_key")
    if isinstance(r2_key, str) and r2_key and is_r2_configured():
        return download_bytes(r2_key)

    standalone_r2_key = row.get("r2_original_key")
    if isinstance(standalone_r2_key, str) and standalone_r2_key and is_r2_configured():
        return download_bytes(standalone_r2_key)

    canvas_file_id = row.get("canvas_id") or item.get("canvas_id")
    if not canvas_file_id:
        raise ValueError("PDF bytes are not available for this document")
    course = canvas_course_connection(supabase, session_id, user_id)
    canvas_base_url = course["canvas_base_url"]
    pat_token = get_active_pat(supabase, user_id, canvas_base_url)
    client = CanvasClient(canvas_base_url, pat_token)
    try:
        _, data, _, content_type = download_canvas_file_for_copy(
            client,
            canvas_base_url=canvas_base_url,
            pat_token=pat_token,
            file_id=str(canvas_file_id),
        )
        return data, content_type
    finally:
        client.close()
