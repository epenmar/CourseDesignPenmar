"""Create local editor content items pending Canvas publication."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from api.editor.schemas import ContentCreateRequest
from canvas_sync import html_to_text, sha256_payload, word_count
from content_inventory import compact_whitespace
from services.content_revisions import next_revision_number
from services.document_records import get_owned_session, write_platform_event
from services.editor.content_read import get_session_content_item, user_id_from_token
from supabase_client import get_supabase


def canvas_module_item_type(content_type: str) -> str:
    if content_type == "page":
        return "Page"
    if content_type == "assignment":
        return "Assignment"
    if content_type == "discussion":
        return "Discussion"
    return content_type.title()


async def create_session_content_item(
    session_id: str,
    body: ContentCreateRequest,
    user: dict[str, Any],
) -> dict[str, Any]:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    title = compact_whitespace(body.title)
    if not title:
        raise HTTPException(status_code=422, detail="Title is required")

    module_metadata: dict[str, Any] = {}
    selected_module: dict[str, Any] | None = None
    if body.module_id:
        module_result = supabase.table("course_modules").select(
            "id, canvas_module_id, name"
        ).eq("id", body.module_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).limit(1).execute()
        if not module_result.data:
            raise HTTPException(status_code=404, detail="Module not found")
        module = module_result.data[0]
        selected_module = module
        module_metadata = {
            "desired_module_id": module["id"],
            "desired_canvas_module_id": module["canvas_module_id"],
            "desired_module_name": module.get("name"),
        }

    content_item_id = str(uuid.uuid4())
    local_canvas_id = f"local:{content_item_id}"
    html_body = body.html_body if body.html_body is not None else "<p></p>"
    plain_text = html_to_text(html_body)
    now = datetime.now(timezone.utc).isoformat()
    metadata = {
        "is_new_local": True,
        "created_in_v2": True,
        "created_pending_canvas_push": True,
        **module_metadata,
    }
    item_values = {
        "id": content_item_id,
        "session_id": session_id,
        "user_id": user_id,
        "canvas_id": local_canvas_id,
        "content_type": body.content_type,
        "title": title,
        "canvas_url": None,
        "published": body.published,
        "module_canvas_id": module_metadata.get("desired_canvas_module_id"),
        "module_name": module_metadata.get("desired_module_name"),
        "position": None,
        "body_hash": sha256_payload({"title": title, "html_body": html_body, "metadata": metadata}),
        "body_word_count": word_count(plain_text),
        "last_canvas_edit_at": None,
        "last_synced_at": "1970-01-01T00:00:00+00:00",
        "is_orphaned": not bool(selected_module),
        "metadata": metadata,
        "created_at": now,
        "updated_at": now,
    }
    supabase.table("course_content_items").insert(item_values).execute()
    if selected_module:
        position_result = supabase.table("course_module_items").select(
            "position"
        ).eq("session_id", session_id).eq("user_id", user_id).eq(
            "module_id", selected_module["id"]
        ).order("position", desc=True).limit(1).execute()
        last_position = (position_result.data or [{}])[0].get("position") if position_result.data else 0
        next_position = int(last_position or 0) + 1
        supabase.table("course_module_items").insert({
            "session_id": session_id,
            "user_id": user_id,
            "module_id": selected_module["id"],
            "content_item_id": content_item_id,
            "canvas_module_id": str(selected_module["canvas_module_id"]),
            "canvas_module_item_id": f"local:{content_item_id}",
            "canvas_content_id": local_canvas_id,
            "page_url": None,
            "title": title,
            "module_item_type": canvas_module_item_type(body.content_type),
            "content_type": body.content_type,
            "position": next_position,
            "indent": 0,
            "published": body.published,
            "completion_requirement": {},
            "metadata": {
                "is_new_local": True,
                "pending_canvas_push": True,
            },
            "created_at": now,
            "updated_at": now,
        }).execute()
    supabase.table("course_content_bodies").insert({
        "content_item_id": content_item_id,
        "html_body": html_body,
        "plain_text": plain_text,
        "extracted_at": now,
        "updated_at": now,
    }).execute()
    revision_number = next_revision_number(supabase, content_item_id)
    supabase.table("content_revisions").insert({
        "content_item_id": content_item_id,
        "session_id": session_id,
        "user_id": user_id,
        "revision_number": revision_number,
        "before_title": None,
        "after_title": title,
        "before_html": "",
        "after_html": html_body,
        "change_summary": f"Created new {body.content_type}",
        "created_at": now,
    }).execute()
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="content_created_locally",
        properties={
            "content_item_id": content_item_id,
            "content_type": body.content_type,
            "title": title,
            "module_id": module_metadata.get("desired_module_id"),
            "canvas_module_id": module_metadata.get("desired_canvas_module_id"),
            "created_at": now,
        },
    )
    detail = await get_session_content_item(session_id, content_item_id, user)
    detail["saved"] = True
    detail["revision_number"] = revision_number
    return detail
