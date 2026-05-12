"""Canvas page revision and source-course replacement services for the editor."""

from __future__ import annotations

import base64
import json
import mimetypes
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from api.editor.schemas import SourcePageReplaceRequest
from canvas_sync import CanvasClient, get_active_pat, html_to_text
from services.canvas_uploads import canvas_course_connection, upload_canvas_course_file
from services.content_revisions import next_revision_number
from services.document_records import get_owned_session, write_platform_event
from services.editor.content_read import get_session_content_item, user_id_from_token
from services.editor.file_upload import safe_upload_filename
from supabase_client import get_supabase


MAX_EDITOR_FILE_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_SOURCE_PAGE_FILE_REMAPS = 25


def encode_canvas_cursor(next_url: str | None) -> str | None:
    if not next_url:
        return None
    raw = json.dumps({"next_url": next_url}).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8")


def decode_canvas_cursor(cursor: str | None) -> str | None:
    if not cursor:
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid Canvas cursor")
    next_url = data.get("next_url")
    if not isinstance(next_url, str) or not next_url:
        raise HTTPException(status_code=422, detail="Invalid Canvas cursor")
    return next_url


def search_tokens(value: str | None) -> list[str]:
    return re.findall(r"[a-z0-9]+", " ".join(str(value or "").split()).casefold())


def search_text(value: str | None) -> str:
    return " ".join(search_tokens(value))


def canvas_page_url(item: dict) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    page_url = metadata.get("url")
    if not page_url and isinstance(item.get("canvas_url"), str) and "/pages/" in item["canvas_url"]:
        page_url = item["canvas_url"].rstrip("/").split("/pages/")[-1]
    if not page_url and item.get("canvas_id") and not str(item.get("canvas_id")).isdigit():
        page_url = item.get("canvas_id")
    if not page_url:
        raise HTTPException(status_code=422, detail="Canvas page URL is missing for this item")
    return str(page_url)


def quoted_canvas_page_url(item_or_page_url: dict | str) -> str:
    page_url = canvas_page_url(item_or_page_url) if isinstance(item_or_page_url, dict) else str(item_or_page_url)
    return quote(page_url, safe="")


def get_owned_page_item_with_body(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_item_id: str,
) -> tuple[dict[str, Any], str]:
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, published, metadata"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")
    item = item_result.data[0]
    if item.get("content_type") != "page":
        raise HTTPException(status_code=422, detail="Revision replacement is available for Canvas pages only")

    body_result = supabase.table("course_content_bodies").select(
        "html_body"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    current_html = body_result.data[0].get("html_body") if body_result.data else ""
    return item, current_html or ""


def simplify_canvas_revision(row: dict[str, Any]) -> dict[str, Any]:
    edited_by = row.get("edited_by") if isinstance(row.get("edited_by"), dict) else {}
    return {
        "revision_id": row.get("revision_id") or row.get("id"),
        "updated_at": row.get("updated_at") or row.get("created_at"),
        "latest": row.get("latest"),
        "edited_by": {
            "id": edited_by.get("id"),
            "display_name": edited_by.get("display_name") or edited_by.get("name"),
        } if edited_by else None,
        "title": row.get("title"),
    }


def write_page_replacement_revision(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_item_id: str,
    current_item: dict[str, Any],
    current_html: str,
    next_title: str,
    next_html: str,
    change_summary: str,
    event_type: str,
    event_properties: dict[str, Any],
) -> tuple[int | None, bool]:
    if next_title == current_item.get("title") and next_html == current_html:
        return None, False

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("course_content_items").update({
        "title": next_title,
        "updated_at": now,
    }).eq("id", content_item_id).execute()

    body_values = {
        "content_item_id": content_item_id,
        "html_body": next_html,
        "plain_text": html_to_text(next_html),
        "updated_at": now,
    }
    body_result = supabase.table("course_content_bodies").select(
        "content_item_id"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    if body_result.data:
        supabase.table("course_content_bodies").update(body_values).eq("content_item_id", content_item_id).execute()
    else:
        body_values["extracted_at"] = now
        supabase.table("course_content_bodies").insert(body_values).execute()

    revision_number = next_revision_number(supabase, content_item_id)
    supabase.table("content_revisions").insert({
        "content_item_id": content_item_id,
        "session_id": session_id,
        "user_id": user_id,
        "revision_number": revision_number,
        "before_title": current_item.get("title"),
        "after_title": next_title,
        "before_html": current_html,
        "after_html": next_html,
        "change_summary": change_summary,
        "created_at": now,
    }).execute()
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type=event_type,
        properties={
            "content_item_id": content_item_id,
            "content_type": "page",
            "title": next_title,
            "created_at": now,
            **event_properties,
        },
    )
    return revision_number, True


def canvas_file_reference_ids(html_body: str) -> list[str]:
    ids = re.findall(r"(?:/api/v1)?/(?:courses/\d+/)?files/(\d+)", html_body or "")
    return list(dict.fromkeys(ids))


def download_canvas_file_for_copy(
    client: CanvasClient,
    *,
    canvas_base_url: str,
    pat_token: str,
    file_id: str,
) -> tuple[dict[str, Any], bytes, str, str]:
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

    with httpx.Client(
        headers={"Authorization": f"Bearer {pat_token}", "Accept": "*/*"},
        timeout=60.0,
        follow_redirects=True,
    ) as download_client:
        response = download_client.get(download_url)
        response.raise_for_status()
        data = response.content

    if not data:
        raise HTTPException(status_code=422, detail=f"Source file {filename} was empty and could not be copied")
    if len(data) > MAX_EDITOR_FILE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Source file {filename} is larger than 50 MB and could not be copied")

    content_type = (
        file_row.get("content-type")
        or file_row.get("content_type")
        or response.headers.get("content-type")
        or mimetypes.guess_type(str(filename))[0]
        or "application/octet-stream"
    )
    return file_row, data, safe_upload_filename(str(filename), "source-file"), str(content_type).split(";", 1)[0].strip()


def rewrite_canvas_file_urls(
    html_body: str,
    *,
    canvas_base_url: str,
    target_canvas_course_id: str,
    remap: dict[str, dict[str, Any]],
) -> str:
    next_html = html_body
    base = canvas_base_url.rstrip("/")
    for old_file_id, file_info in remap.items():
        new_file_id = str(file_info["new_file_id"])

        def replace_reference(match: re.Match[str]) -> str:
            raw = match.group(0)
            suffix = match.group("suffix") or ""
            if "/api/v1/" in raw:
                return f"{base}/api/v1/courses/{target_canvas_course_id}/files/{new_file_id}"
            return f"{base}/courses/{target_canvas_course_id}/files/{new_file_id}{suffix}"

        next_html = re.sub(
            rf"(?:https?://[^\"'<> \t\r\n]+)?/(?:api/v1/)?(?:courses/\d+/)?files/{re.escape(old_file_id)}(?P<suffix>/(?:preview|download))?(?:\?[^\"'<> \t\r\n]*)?",
            replace_reference,
            next_html,
        )
    return next_html


def rewrite_source_course_links(
    html_body: str,
    *,
    canvas_base_url: str,
    source_canvas_course_id: str,
    target_canvas_course_id: str,
) -> tuple[str, int]:
    if source_canvas_course_id == target_canvas_course_id:
        return html_body, 0
    base = canvas_base_url.rstrip("/")
    count = 0
    pattern = re.compile(
        rf"(?P<prefix>(?:{re.escape(base)})?/courses/){re.escape(str(source_canvas_course_id))}(?P<tail>/(?:pages|assignments|discussion_topics|quizzes|modules)(?:/[^\"'<> \t\r\n]*)?)"
    )

    def replace_course(match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return f"{match.group('prefix')}{target_canvas_course_id}{match.group('tail')}"

    return pattern.sub(replace_course, html_body), count


def remap_source_page_canvas_assets(
    html_body: str,
    *,
    client: CanvasClient,
    canvas_base_url: str,
    pat_token: str,
    source_canvas_course_id: str,
    target_canvas_course_id: str,
) -> tuple[str, dict[str, Any]]:
    if not html_body or source_canvas_course_id == target_canvas_course_id:
        return html_body, {"copied_files": [], "file_count": 0, "course_link_rewrite_count": 0}

    file_ids = canvas_file_reference_ids(html_body)
    if len(file_ids) > MAX_SOURCE_PAGE_FILE_REMAPS:
        raise HTTPException(
            status_code=422,
            detail=f"This source page references {len(file_ids)} Canvas files. Copying is limited to {MAX_SOURCE_PAGE_FILE_REMAPS} files at a time.",
        )

    remap: dict[str, dict[str, Any]] = {}
    for file_id in file_ids:
        try:
            source_file, data, filename, content_type = download_canvas_file_for_copy(
                client,
                canvas_base_url=canvas_base_url,
                pat_token=pat_token,
                file_id=file_id,
            )
            copied_file = upload_canvas_course_file(
                canvas_base_url=canvas_base_url,
                canvas_course_id=target_canvas_course_id,
                pat_token=pat_token,
                filename=filename,
                content_type=content_type,
                data=data,
            )
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while copying source file {file_id}")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not copy source file {file_id}: {exc}")

        new_file_id = copied_file.get("id")
        if new_file_id is None:
            raise HTTPException(status_code=502, detail=f"Canvas did not return a file id while copying source file {file_id}")
        remap[file_id] = {
            "old_file_id": file_id,
            "new_file_id": str(new_file_id),
            "filename": copied_file.get("display_name") or copied_file.get("filename") or filename,
            "source_filename": source_file.get("display_name") or source_file.get("filename") or filename,
        }

    next_html = rewrite_canvas_file_urls(
        html_body,
        canvas_base_url=canvas_base_url,
        target_canvas_course_id=target_canvas_course_id,
        remap=remap,
    )
    next_html, course_link_rewrite_count = rewrite_source_course_links(
        next_html,
        canvas_base_url=canvas_base_url,
        source_canvas_course_id=source_canvas_course_id,
        target_canvas_course_id=target_canvas_course_id,
    )
    return next_html, {
        "copied_files": list(remap.values()),
        "file_count": len(remap),
        "course_link_rewrite_count": course_link_rewrite_count,
    }


async def list_canvas_page_revisions(
    session_id: str,
    content_item_id: str,
    user: dict,
    *,
    limit: int,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    item, _ = get_owned_page_item_with_body(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
    )
    course = canvas_course_connection(supabase, session_id, user_id)
    pat_token = get_active_pat(supabase, user_id, course["canvas_base_url"])
    client = CanvasClient(course["canvas_base_url"], pat_token)
    try:
        rows = client.get_paginated(
            f"/courses/{course['canvas_course_id']}/pages/{quoted_canvas_page_url(item)}/revisions"
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Canvas page revisions were not found")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while loading revisions")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas revision lookup failed: {exc}")
    finally:
        client.close()

    return {"items": [simplify_canvas_revision(row) for row in rows[:limit]]}


async def get_canvas_page_revision(
    session_id: str,
    content_item_id: str,
    revision_id: int,
    user: dict,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    item, _ = get_owned_page_item_with_body(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
    )
    course = canvas_course_connection(supabase, session_id, user_id)
    pat_token = get_active_pat(supabase, user_id, course["canvas_base_url"])
    client = CanvasClient(course["canvas_base_url"], pat_token)
    try:
        revision = client.get(
            f"/courses/{course['canvas_course_id']}/pages/{quoted_canvas_page_url(item)}/revisions/{revision_id}"
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Canvas revision not found")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while loading revision")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas revision lookup failed: {exc}")
    finally:
        client.close()

    return {
        **simplify_canvas_revision(revision),
        "body": revision.get("body") or "",
    }


async def restore_canvas_page_revision(
    session_id: str,
    content_item_id: str,
    revision_id: int,
    user: dict,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    item, current_html = get_owned_page_item_with_body(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
    )
    course = canvas_course_connection(supabase, session_id, user_id)
    pat_token = get_active_pat(supabase, user_id, course["canvas_base_url"])
    client = CanvasClient(course["canvas_base_url"], pat_token)
    try:
        revision = client.get(
            f"/courses/{course['canvas_course_id']}/pages/{quoted_canvas_page_url(item)}/revisions/{revision_id}"
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Canvas revision not found")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while restoring revision")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas revision restore failed: {exc}")
    finally:
        client.close()

    next_title = revision.get("title") or item.get("title") or "Untitled page"
    next_html = revision.get("body") or ""
    revision_number, saved = write_page_replacement_revision(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
        current_item=item,
        current_html=current_html,
        next_title=next_title,
        next_html=next_html,
        change_summary=f"Restored from Canvas page revision {revision_id}",
        event_type="content_restored_from_canvas_revision",
        event_properties={
            "canvas_revision_id": revision_id,
            "canvas_page_url": canvas_page_url(item),
            "source": "canvas_revision",
        },
    )
    detail = await get_session_content_item(session_id, content_item_id, user)
    detail["saved"] = saved
    detail["revision_number"] = revision_number
    detail["restored_from_canvas_revision"] = revision_id
    return detail


async def list_source_courses(
    session_id: str,
    user: dict,
    *,
    q: str | None,
    cursor: str | None,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    course = canvas_course_connection(supabase, session_id, user_id)
    pat_token = get_active_pat(supabase, user_id, course["canvas_base_url"])
    client = CanvasClient(course["canvas_base_url"], pat_token)
    query_tokens = search_tokens(q)
    items: list[dict[str, Any]] = []
    next_url = decode_canvas_cursor(cursor)
    try:
        scanned_pages = 0
        while len(items) < 50:
            scanned_pages += 1
            if next_url:
                response = client.client.get(next_url)
            else:
                response = client.client.get("/courses", params={"per_page": 50, "include[]": "term"})
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                rows = []

            for row in rows:
                term = row.get("term") if isinstance(row.get("term"), dict) else {}
                haystack = search_text(" ".join(
                    [
                        str(row.get("name") or ""),
                        str(row.get("course_code") or ""),
                        str(row.get("id") or ""),
                        str(row.get("sis_course_id") or ""),
                        str(term.get("name") if term else ""),
                    ]
                ))
                if query_tokens and not all(token in haystack for token in query_tokens):
                    continue
                items.append({
                    "course_id": str(row.get("id")),
                    "name": row.get("name") or row.get("course_code") or f"Canvas course {row.get('id')}",
                    "course_code": row.get("course_code"),
                    "workflow_state": row.get("workflow_state"),
                    "term_name": term.get("name") if term else None,
                })
                if len(items) >= 50:
                    break

            next_url = response.links.get("next", {}).get("url")
            if not next_url or not query_tokens or scanned_pages >= 50:
                break
        next_cursor = encode_canvas_cursor(next_url)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while loading courses")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas course lookup failed: {exc}")
    finally:
        client.close()

    return {"items": items, "next_cursor": next_cursor}


async def search_source_course_pages(
    session_id: str,
    source_course_id: str,
    title: str,
    user: dict,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    course = canvas_course_connection(supabase, session_id, user_id)
    pat_token = get_active_pat(supabase, user_id, course["canvas_base_url"])
    client = CanvasClient(course["canvas_base_url"], pat_token)
    try:
        response = client.client.get(
            f"/courses/{quote(str(source_course_id), safe='')}/pages",
            params={"per_page": 20, "search_term": title},
        )
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            rows = []
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Source course was not found or is not accessible")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while searching pages")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas page search failed: {exc}")
    finally:
        client.close()

    return {
        "items": [
            {
                "page_url": row.get("url"),
                "title": row.get("title") or row.get("url"),
                "html_url": row.get("html_url"),
                "updated_at": row.get("updated_at"),
                "published": row.get("published"),
            }
            for row in rows
            if row.get("url")
        ]
    }


async def get_source_course_page(
    session_id: str,
    source_course_id: str,
    page_url: str,
    user: dict,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    course = canvas_course_connection(supabase, session_id, user_id)
    pat_token = get_active_pat(supabase, user_id, course["canvas_base_url"])
    client = CanvasClient(course["canvas_base_url"], pat_token)
    try:
        page = client.get(
            f"/courses/{quote(str(source_course_id), safe='')}/pages/{quote(page_url, safe='')}"
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Source page was not found or is not accessible")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while loading source page")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas source page lookup failed: {exc}")
    finally:
        client.close()

    return {
        "page_url": page.get("url") or page_url,
        "title": page.get("title"),
        "html_url": page.get("html_url"),
        "body": page.get("body") or "",
        "updated_at": page.get("updated_at"),
    }


async def replace_from_source_course_page(
    session_id: str,
    content_item_id: str,
    body: SourcePageReplaceRequest,
    user: dict,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    item, current_html = get_owned_page_item_with_body(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
    )
    course = canvas_course_connection(supabase, session_id, user_id)
    canvas_base_url = course["canvas_base_url"]
    target_canvas_course_id = str(course["canvas_course_id"])
    pat_token = get_active_pat(supabase, user_id, course["canvas_base_url"])
    client = CanvasClient(course["canvas_base_url"], pat_token)
    try:
        source_page = client.get(
            f"/courses/{quote(body.source_course_id, safe='')}/pages/{quote(body.source_page_url, safe='')}"
        )
        source_html = source_page.get("body") or ""
        remapped_html, asset_remap = remap_source_page_canvas_assets(
            source_html,
            client=client,
            canvas_base_url=canvas_base_url,
            pat_token=pat_token,
            source_canvas_course_id=body.source_course_id,
            target_canvas_course_id=target_canvas_course_id,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Source page was not found or is not accessible")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while replacing content")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas source replacement failed: {exc}")
    finally:
        client.close()

    next_title = source_page.get("title") or item.get("title") or "Untitled page"
    next_html = remapped_html
    revision_number, saved = write_page_replacement_revision(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
        current_item=item,
        current_html=current_html,
        next_title=next_title,
        next_html=next_html,
        change_summary=f"Replaced from source course page: {next_title}",
        event_type="content_replaced_from_source_page",
        event_properties={
            "source": "source_course_page",
            "source_course_id": body.source_course_id,
            "source_page_url": body.source_page_url,
            "source_title": source_page.get("title"),
            "source_html_url": source_page.get("html_url"),
            "asset_remap": asset_remap,
        },
    )
    detail = await get_session_content_item(session_id, content_item_id, user)
    detail["saved"] = saved
    detail["revision_number"] = revision_number
    detail["replaced_from_source_page"] = body.source_page_url
    return detail
