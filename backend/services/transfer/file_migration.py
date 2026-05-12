"""Referenced Canvas file migration helpers for Transfer workflows."""

from __future__ import annotations

import mimetypes
import re
from typing import Any, Callable
from urllib.parse import quote

import httpx

from canvas_sync import CanvasClient
from services.canvas_file_references import canvas_file_reference_ids_from_html


MAX_TRANSFER_FILE_BYTES = 50 * 1024 * 1024

EventWriter = Callable[[str, str], None]
ReportWriter = Callable[..., None]


def canvas_file_reference_ids(html_values: list[str]) -> list[str]:
    return canvas_file_reference_ids_from_html(html_values)


def download_source_canvas_file(
    client: CanvasClient,
    *,
    canvas_base_url: str,
    pat_token: str,
    file_id: str,
) -> tuple[str, str, bytes]:
    file_row = client.get(f"/files/{quote(file_id, safe='')}")
    filename = (
        file_row.get("display_name")
        or file_row.get("filename")
        or file_row.get("name")
        or f"canvas-file-{file_id}"
    )
    download_url = file_row.get("url") or file_row.get("download_url")
    if not isinstance(download_url, str) or not download_url:
        download_url = f"{canvas_base_url.rstrip('/')}/api/v1/files/{quote(file_id, safe='')}/download"
    elif download_url.startswith("/"):
        download_url = f"{canvas_base_url.rstrip('/')}{download_url}"

    with httpx.Client(
        headers={"Authorization": f"Bearer {pat_token}", "Accept": "*/*"},
        timeout=60.0,
        follow_redirects=True,
    ) as download_client:
        response = download_client.get(download_url)
        response.raise_for_status()
        data = response.content
        response_content_type = response.headers.get("content-type")

    if not data:
        raise ValueError(f"Source Canvas file {file_id} was empty")
    if len(data) > MAX_TRANSFER_FILE_BYTES:
        raise ValueError(f"Source Canvas file {file_id} is larger than 50 MB")

    content_type = (
        file_row.get("content-type")
        or file_row.get("content_type")
        or response_content_type
        or mimetypes.guess_type(str(filename))[0]
        or "application/octet-stream"
    )
    return str(filename), str(content_type).split(";", 1)[0].strip(), data


def safe_canvas_filename(value: str, fallback: str) -> str:
    filename = re.sub(r"[^\w.\- ()]", "_", value or "").strip(" .")
    return filename[:180] or fallback


def upload_target_canvas_file(
    *,
    canvas_base_url: str,
    pat_token: str,
    course_id: str,
    filename: str,
    content_type: str,
    data: bytes,
) -> dict[str, Any]:
    api_url = f"{canvas_base_url.rstrip('/')}/api/v1/courses/{course_id}/files"
    with httpx.Client(
        headers={"Authorization": f"Bearer {pat_token}", "Accept": "application/json"},
        timeout=60.0,
        follow_redirects=True,
    ) as upload_client:
        response = upload_client.post(
            api_url,
            data={
                "name": filename,
                "size": str(len(data)),
                "content_type": content_type,
                "parent_folder_path": "CanvasCurate Transfer Files",
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
        upload_response = upload_client.post(
            upload_url,
            data=upload_params,
            files={"file": (filename, data, content_type)},
        )
        upload_response.raise_for_status()
        file_row = upload_response.json()
        if not isinstance(file_row, dict):
            raise ValueError("Canvas file upload response was not an object")
        return file_row


def migrate_referenced_files(
    *,
    source_client: CanvasClient,
    source_canvas_base_url: str,
    target_canvas_base_url: str,
    pat_token: str,
    target_course_id: str,
    file_ids: list[str],
    add_event: EventWriter,
    add_report_item: ReportWriter,
) -> tuple[dict[str, str], int]:
    file_id_map: dict[str, str] = {}
    warnings = 0
    if not file_ids:
        return file_id_map, warnings

    add_event(f"Migrating {len(file_ids)} referenced Canvas file(s)...", "info")
    for file_id in file_ids:
        try:
            filename, content_type, data = download_source_canvas_file(
                source_client,
                canvas_base_url=source_canvas_base_url,
                pat_token=pat_token,
                file_id=file_id,
            )
            safe_filename = safe_canvas_filename(filename, f"canvas-file-{file_id}")
            uploaded = upload_target_canvas_file(
                canvas_base_url=target_canvas_base_url,
                pat_token=pat_token,
                course_id=target_course_id,
                filename=safe_filename,
                content_type=content_type,
                data=data,
            )
            new_file_id = uploaded.get("id")
            if new_file_id is None:
                raise ValueError("Canvas upload response did not include a file ID")
            file_id_map[file_id] = str(new_file_id)
            add_report_item(
                "migrated_files",
                title=safe_filename,
                content_type="file",
                action="migrate",
                status="done",
                reason=f"Canvas file {file_id} migrated to target file {new_file_id}",
            )
            add_event(f"Migrated file: {safe_filename}", "done")
        except Exception as exc:
            warnings += 1
            add_report_item(
                "warnings",
                title=f"Canvas file {file_id}",
                content_type="file",
                action="migrate",
                status="warning",
                reason=exc,
            )
            add_event(f"File migration warning for file {file_id}: {exc}", "warning")
    return file_id_map, warnings
