"""Shared Canvas file upload helpers."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from services.document_records import get_owned_session


def canvas_course_connection(supabase, session_id: str, user_id: str) -> dict[str, Any]:
    session = get_owned_session(supabase, session_id, user_id)
    source_course_id = session.get("source_course_id")
    if not source_course_id:
        raise HTTPException(status_code=400, detail="Session has no source course")

    course_result = supabase.table("courses").select(
        "canvas_base_url, canvas_course_id"
    ).eq("id", source_course_id).eq("user_id", user_id).limit(1).execute()
    if not course_result.data:
        raise HTTPException(status_code=404, detail="Source course not found")

    course = course_result.data[0]
    if not course.get("canvas_base_url") or not course.get("canvas_course_id"):
        raise HTTPException(status_code=400, detail="Source course is missing Canvas connection details")
    return course


def canvas_image_html_url(canvas_base_url: str, canvas_course_id: str, file_row: dict[str, Any]) -> str:
    file_id = file_row.get("id")
    if file_id:
        return f"{canvas_base_url.rstrip('/')}/courses/{canvas_course_id}/files/{file_id}/preview"
    url = file_row.get("url") or file_row.get("preview_url")
    if isinstance(url, str) and url:
        return url
    raise HTTPException(status_code=502, detail="Canvas file upload did not return a usable image URL")


def canvas_file_html_url(canvas_base_url: str, canvas_course_id: str, file_row: dict[str, Any]) -> str:
    file_id = file_row.get("id")
    if file_id:
        return f"{canvas_base_url.rstrip('/')}/courses/{canvas_course_id}/files/{file_id}"
    url = file_row.get("html_url") or file_row.get("preview_url") or file_row.get("url")
    if isinstance(url, str) and url:
        return url.rstrip("/").removesuffix("/download").removesuffix("/preview")
    raise HTTPException(status_code=502, detail="Canvas file upload did not return a usable URL")


def editor_upload_filename(filename: str, content_type: str) -> str:
    if content_type != "image/jpeg":
        return filename
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    return f"{stem or 'image'}.jpg"


def upload_canvas_course_file(
    *,
    canvas_base_url: str,
    canvas_course_id: str,
    pat_token: str,
    filename: str,
    content_type: str,
    data: bytes,
) -> dict[str, Any]:
    api_url = f"{canvas_base_url.rstrip('/')}/api/v1/courses/{canvas_course_id}/files"
    with httpx.Client(
        headers={"Authorization": f"Bearer {pat_token}", "Accept": "application/json"},
        timeout=60.0,
        follow_redirects=True,
    ) as client:
        response = client.post(
            api_url,
            data={
                "name": filename,
                "size": str(len(data)),
                "content_type": content_type,
                "parent_folder_path": "CanvasCurate Uploads",
                "on_duplicate": "rename",
            },
        )
        response.raise_for_status()
        upload_target = response.json()
        if not isinstance(upload_target, dict):
            raise ValueError("Canvas file upload target was not an object")

        upload_url = upload_target.get("upload_url")
        upload_params = upload_target.get("upload_params")
        if not isinstance(upload_url, str) or not isinstance(upload_params, dict):
            raise ValueError("Canvas file upload target was missing upload_url or upload_params")

        upload_response = client.post(
            upload_url,
            data=upload_params,
            files={"file": (filename, data, content_type)},
        )
        upload_response.raise_for_status()
        file_row = upload_response.json()
        if not isinstance(file_row, dict):
            raise ValueError("Canvas file upload response was not an object")
        return file_row
