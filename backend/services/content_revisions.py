"""Shared content revision persistence helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from canvas_sync import html_to_text


def next_revision_number(supabase, content_item_id: str) -> int:
    result = supabase.table("content_revisions").select(
        "revision_number"
    ).eq("content_item_id", content_item_id).order(
        "revision_number",
        desc=True,
    ).limit(1).execute()
    if not result.data:
        return 1
    return int(result.data[0]["revision_number"]) + 1


def save_content_revision(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_item_id: str,
    next_html: str,
    change_summary: str,
) -> dict[str, Any]:
    item_result = supabase.table("course_content_items").select(
        "id, title, published"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    current_item = item_result.data[0]
    current_title = current_item.get("title")
    body_result = supabase.table("course_content_bodies").select(
        "html_body"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    current_body = body_result.data[0] if body_result.data else {}
    current_html = current_body.get("html_body") or ""
    if next_html == current_html:
        return {"saved": False, "revision_number": None}

    now = datetime.now(timezone.utc).isoformat()
    plain_text = html_to_text(next_html)
    supabase.table("course_content_items").update({
        "updated_at": now,
    }).eq("id", content_item_id).execute()

    body_values = {
        "content_item_id": content_item_id,
        "html_body": next_html,
        "plain_text": plain_text,
        "updated_at": now,
    }
    if body_result.data:
        supabase.table("course_content_bodies").update(body_values).eq(
            "content_item_id", content_item_id
        ).execute()
    else:
        body_values["extracted_at"] = now
        supabase.table("course_content_bodies").insert(body_values).execute()

    revision_number = next_revision_number(supabase, content_item_id)
    supabase.table("content_revisions").insert({
        "content_item_id": content_item_id,
        "session_id": session_id,
        "user_id": user_id,
        "revision_number": revision_number,
        "before_title": current_title,
        "after_title": current_title,
        "before_html": current_html,
        "after_html": next_html,
        "change_summary": change_summary,
    }).execute()
    return {"saved": True, "revision_number": revision_number}
