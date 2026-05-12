"""Read helpers for editor content records."""

import base64
import json
from typing import Any

from fastapi import HTTPException

from services.document_records import get_owned_session
from supabase_client import get_supabase


TOP_LEVEL_INVENTORY_TYPES = {
    "page",
    "assignment",
    "discussion",
    "quiz",
    "file",
    "module",
    "module_item",
}


def user_id_from_token(user: dict[str, Any]) -> str:
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return user_id


def encode_cursor(row: dict[str, Any]) -> str:
    raw = json.dumps({"created_at": row["created_at"]}).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8")


def decode_cursor(cursor: str) -> dict[str, Any]:
    try:
        return json.loads(base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid cursor")


async def get_content_preview(
    session_id: str,
    content_item_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    session = get_owned_session(supabase, session_id, user_id)

    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, module_name, metadata"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    body_result = supabase.table("course_content_bodies").select(
        "html_body, plain_text"
    ).eq("content_item_id", content_item_id).execute()
    body = body_result.data[0] if body_result.data else {}

    canvas_base_url = None
    canvas_course_url = None
    source_course_id = session.get("source_course_id")
    if source_course_id:
        course_result = supabase.table("courses").select(
            "canvas_base_url, canvas_course_id"
        ).eq("id", source_course_id).eq("user_id", user_id).execute()
        if course_result.data:
            course = course_result.data[0]
            canvas_base_url = course.get("canvas_base_url")
            canvas_course_id = course.get("canvas_course_id")
            if canvas_base_url and canvas_course_id:
                canvas_course_url = f"{canvas_base_url.rstrip('/')}/courses/{canvas_course_id}/"

    item = item_result.data[0]
    return {
        "id": item["id"],
        "canvas_id": item["canvas_id"],
        "content_type": item["content_type"],
        "title": item.get("title"),
        "canvas_url": item.get("canvas_url"),
        "canvas_base_url": canvas_base_url,
        "canvas_course_url": canvas_course_url,
        "module_name": item.get("module_name"),
        "metadata": item.get("metadata") or {},
        "html": body.get("html_body") or "",
        "plain_text": body.get("plain_text") or "",
    }


async def get_session_content_item(
    session_id: str,
    content_item_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    session = get_owned_session(supabase, session_id, user_id)

    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, published, module_name, metadata, updated_at"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    body_result = supabase.table("course_content_bodies").select(
        "html_body, plain_text, extracted_at, updated_at"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    body = body_result.data[0] if body_result.data else {}

    canvas_base_url = None
    canvas_course_url = None
    source_course_id = session.get("source_course_id")
    if source_course_id:
        course_result = supabase.table("courses").select(
            "canvas_base_url, canvas_course_id"
        ).eq("id", source_course_id).eq("user_id", user_id).limit(1).execute()
        if course_result.data:
            course = course_result.data[0]
            canvas_base_url = course.get("canvas_base_url")
            canvas_course_id = course.get("canvas_course_id")
            if canvas_base_url and canvas_course_id:
                canvas_course_url = f"{canvas_base_url.rstrip('/')}/courses/{canvas_course_id}/"

    revision_result = supabase.table("content_revisions").select(
        "id",
        count="exact",
    ).eq("content_item_id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()

    item = item_result.data[0]
    return {
        "id": item["id"],
        "canvas_id": item.get("canvas_id"),
        "content_type": item["content_type"],
        "title": item.get("title"),
        "canvas_url": item.get("canvas_url"),
        "published": item.get("published"),
        "canvas_base_url": canvas_base_url,
        "canvas_course_url": canvas_course_url,
        "module_name": item.get("module_name"),
        "metadata": item.get("metadata") or {},
        "updated_at": item.get("updated_at"),
        "html_body": body.get("html_body") or "",
        "plain_text": body.get("plain_text") or "",
        "extracted_at": body.get("extracted_at"),
        "body_updated_at": body.get("updated_at"),
        "revision_count": revision_result.count or 0,
    }


async def list_session_content(
    session_id: str,
    user: dict[str, Any],
    *,
    limit: int,
    cursor: str | None,
    content_type: str | None,
) -> dict[str, Any]:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    query = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, published, module_name, position, body_word_count, last_canvas_edit_at, last_synced_at, is_orphaned, duplicate_group_key, metadata, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).order(
        "created_at", desc=True
    )

    if content_type:
        query = query.eq("content_type", content_type)
    else:
        query = query.in_("content_type", list(TOP_LEVEL_INVENTORY_TYPES))
    if cursor:
        decoded = decode_cursor(cursor)
        query = query.lt("created_at", decoded["created_at"])

    result = query.limit(limit + 1).execute()
    rows = result.data or []
    next_cursor = encode_cursor(rows[limit - 1]) if len(rows) > limit else None

    return {"items": rows[:limit], "next_cursor": next_cursor}
