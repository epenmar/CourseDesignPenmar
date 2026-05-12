"""Canvas deployment helpers for standalone document exports.

Uploads generated accessible PDF artifacts to a selected Canvas course without
treating the upload as a replacement for an existing Canvas file.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from canvas_hosts import parse_canvas_course_url
from canvas_sync import CanvasClient, get_active_pat
from r2_storage import download_bytes
from services.document_records import get_document_file_row, get_owned_session, update_document_metadata_fields, write_platform_event
from supabase_client import get_supabase

STANDALONE_CANVAS_DEPLOY_JOB_TYPE = "standalone_document_canvas_deploy"


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


def list_canvas_courses(
    *,
    canvas_base_url: str,
    pat_token: str,
    q: str | None = None,
    limit: int | None = 50,
) -> list[dict[str, Any]]:
    query = (q or "").strip()
    query_tokens = [token for token in query.lower().split() if token]
    client = CanvasClient(canvas_base_url, pat_token)
    try:
        rows: list[dict[str, Any]] = []
        if query:
            seen_account_ids: set[str] = set()
            try:
                accounts = client.get_paginated("/accounts", params={"per_page": 100})
                for account in accounts:
                    account_id = account.get("id") if isinstance(account, dict) else None
                    if not account_id or str(account_id) in seen_account_ids:
                        continue
                    seen_account_ids.add(str(account_id))
                    rows.extend(client.get_paginated(
                        f"/accounts/{quote(str(account_id), safe='')}/courses",
                        params={"search_term": query, "per_page": 100, "include[]": "term"},
                    ))
            except Exception:
                rows = []

            rows.extend(client.get_paginated(
                "/courses",
                params={
                    "search_term": query,
                    "per_page": 100,
                    "include[]": "term",
                    "state[]": ["available", "unpublished", "completed"],
                },
            ))
        else:
            rows = client.get_paginated(
                "/courses",
                params={
                    "per_page": 100,
                    "include[]": "term",
                    "state[]": ["available", "unpublished", "completed"],
                },
            )
    finally:
        client.close()

    items: list[dict[str, Any]] = []
    seen_course_ids: set[str] = set()
    for row in rows:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        course_id = str(row["id"])
        if course_id in seen_course_ids:
            continue
        term = row.get("term") if isinstance(row.get("term"), dict) else {}
        haystack = " ".join(
            str(value or "").lower()
            for value in (
                row.get("name"),
                row.get("course_code"),
                row.get("id"),
                row.get("sis_course_id"),
                term.get("name") if term else "",
            )
        )
        if query_tokens and not all(token in haystack for token in query_tokens):
            continue
        seen_course_ids.add(course_id)
        items.append({
            "course_id": course_id,
            "name": row.get("name") or row.get("course_code") or f"Canvas course {course_id}",
            "course_code": row.get("course_code"),
            "workflow_state": row.get("workflow_state"),
            "term_name": term.get("name") if term else None,
            "canvas_url": f"{canvas_base_url.rstrip('/')}/courses/{quote(course_id, safe='')}",
        })
    items.sort(key=lambda item: (
        str(item.get("term_name") or ""),
        str(item.get("name") or "").lower(),
        str(item.get("course_id") or ""),
    ))
    if limit is None:
        return items
    return items[:limit]


def accessible_export_artifact(document: dict[str, Any]) -> dict[str, Any]:
    metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
    remediation = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else {}
    artifact = remediation.get("export_artifact") if isinstance(remediation.get("export_artifact"), dict) else None
    if not artifact or not artifact.get("r2_key"):
        raise ValueError("Prepare an accessible PDF export before pushing to Canvas")
    return artifact


def run_standalone_canvas_deploy_job(job_id: str, session_id: str, user_id: str, document_id: str) -> None:
    supabase = get_supabase()
    started_at = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    try:
        get_owned_session(supabase, session_id, user_id)
        payload_result = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        payload = payload_result.data[0].get("payload") if payload_result.data else {}
        if not isinstance(payload, dict):
            payload = {}
        canvas_url = str(payload.get("canvas_url") or "")
        canvas_base_url, canvas_course_id = parse_canvas_course_url(canvas_url)
        pat_token = get_active_pat(supabase, user_id, canvas_base_url)

        document = get_document_file_row(supabase, session_id, user_id, document_id)
        artifact = accessible_export_artifact(document)
        data, content_type = download_bytes(str(artifact["r2_key"]))
        filename = str(payload.get("filename") or artifact.get("filename") or "accessible-document.pdf")
        if not filename.lower().endswith(".pdf"):
            filename = f"{filename}.pdf"
        file_row = upload_canvas_course_file(
            canvas_base_url=canvas_base_url,
            canvas_course_id=canvas_course_id,
            pat_token=pat_token,
            filename=filename,
            content_type=content_type or "application/pdf",
            data=data,
        )
        canvas_file_id = str(file_row.get("id") or "")
        canvas_file_page_url = (
            f"{canvas_base_url.rstrip('/')}/courses/{canvas_course_id}/files/{quote(canvas_file_id, safe='')}"
            if canvas_file_id
            else f"{canvas_base_url.rstrip('/')}/courses/{canvas_course_id}/files"
        )
        canvas_url_result = canvas_file_page_url
        deployed_at = datetime.now(timezone.utc).isoformat()
        deployment = {
            "status": "succeeded",
            "source": "standalone_pdf_export",
            "job_id": job_id,
            "canvas_base_url": canvas_base_url,
            "canvas_course_id": canvas_course_id,
            "canvas_file_id": canvas_file_id or None,
            "canvas_url": canvas_url_result,
            "canvas_file_page_url": canvas_file_page_url,
            "canvas_html_url": file_row.get("html_url"),
            "canvas_preview_url": file_row.get("preview_url"),
            "canvas_download_url": file_row.get("url"),
            "filename": filename,
            "size_bytes": len(data),
            "deployed_at": deployed_at,
            "export_artifact_id": artifact.get("id"),
        }
        metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
        deployments = metadata.get("standalone_canvas_deployments") if isinstance(metadata.get("standalone_canvas_deployments"), list) else []
        update_document_metadata_fields(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=document_id,
            metadata_patch={
                "standalone_canvas_deployment": deployment,
                "standalone_canvas_deployments": [deployment, *deployments],
            },
            updated_at=deployed_at,
        )
        result = {
            "document_id": document_id,
            **deployment,
        }
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": deployed_at,
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="standalone_document_canvas_deployed",
            properties=result,
        )
    except Exception as exc:
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
