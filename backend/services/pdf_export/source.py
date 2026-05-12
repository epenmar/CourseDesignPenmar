"""PDF source loading for export jobs.

Loads reviewed PDF bytes from R2 when available or from the source Canvas file
when the document originated from Canvas.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from canvas_sync import CanvasClient, get_active_pat
from r2_storage import download_bytes, is_r2_configured
from services.document_records import get_owned_session


def canvas_course_connection(supabase, session_id: str, user_id: str) -> dict[str, Any]:
    session = get_owned_session(supabase, session_id, user_id)
    source_course_id = session.get("source_course_id")
    if not source_course_id:
        raise ValueError("Session has no source course")

    course_result = supabase.table("courses").select(
        "canvas_base_url, canvas_course_id"
    ).eq("id", source_course_id).eq("user_id", user_id).limit(1).execute()
    if not course_result.data:
        raise ValueError("Source course not found")

    course = course_result.data[0]
    if not course.get("canvas_base_url") or not course.get("canvas_course_id"):
        raise ValueError("Source course is missing Canvas connection details")
    return course


def download_canvas_file_bytes(
    *,
    canvas_base_url: str,
    pat_token: str,
    file_id: str,
) -> tuple[bytes, str | None]:
    client = CanvasClient(canvas_base_url, pat_token)
    try:
        file_row = client.get(f"/files/{quote(file_id, safe='')}")
        download_url = file_row.get("url") or file_row.get("download_url")
        if not isinstance(download_url, str) or not download_url:
            download_url = f"{canvas_base_url.rstrip('/')}/api/v1/files/{quote(file_id, safe='')}/download"

        with httpx.Client(
            headers={"Authorization": f"Bearer {pat_token}", "Accept": "*/*"},
            timeout=60.0,
            follow_redirects=True,
        ) as download_client:
            response = download_client.get(download_url)
            response.raise_for_status()
            data = response.content
        if not data:
            raise ValueError("Canvas source PDF was empty")
        content_type = (
            file_row.get("content-type")
            or file_row.get("content_type")
            or response.headers.get("content-type")
        )
        return data, str(content_type).split(";", 1)[0].strip() if content_type else None
    finally:
        client.close()


def load_source_pdf_bytes(
    supabase,
    *,
    session_id: str,
    user_id: str,
    document: dict[str, Any],
) -> tuple[bytes, str | None]:
    metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
    r2_key = metadata.get("r2_original_key")
    if isinstance(r2_key, str) and r2_key and is_r2_configured():
        return download_bytes(r2_key)

    canvas_file_id = document.get("canvas_id")
    if not canvas_file_id:
        raise ValueError("PDF bytes are not available for this document")

    course = canvas_course_connection(supabase, session_id, user_id)
    canvas_base_url = course["canvas_base_url"]
    pat_token = get_active_pat(supabase, user_id, canvas_base_url)
    return download_canvas_file_bytes(
        canvas_base_url=canvas_base_url,
        pat_token=pat_token,
        file_id=str(canvas_file_id),
    )

