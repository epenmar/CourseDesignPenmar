"""Editor content save, local revision, and issue flag services."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from api.editor.schemas import ContentIssueRequest, ContentSaveRequest
from canvas_sync import html_to_text
from content_inventory import compact_whitespace
from services.content_revisions import next_revision_number
from services.document_records import get_owned_session, write_platform_event
from services.editor.content_read import get_session_content_item, user_id_from_token
from services.editor.quiz_questions import quiz_question_child_ids_for_parent
from supabase_client import get_supabase


async def save_session_content_item(
    session_id: str,
    content_item_id: str,
    body: ContentSaveRequest,
    user: dict,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    item_result = supabase.table("course_content_items").select(
        "id, title, published"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    current_item = item_result.data[0]
    current_title = current_item.get("title")
    current_published = current_item.get("published")
    next_title = compact_whitespace(body.title) if body.title is not None else current_title
    next_html = body.html_body or ""
    next_published = body.published if body.published is not None else current_published

    body_result = supabase.table("course_content_bodies").select(
        "html_body, plain_text"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    current_body = body_result.data[0] if body_result.data else {}
    current_html = current_body.get("html_body") or ""

    if next_title == current_title and next_html == current_html and next_published == current_published:
        detail = await get_session_content_item(session_id, content_item_id, user)
        detail["saved"] = False
        return detail

    now = datetime.now(timezone.utc).isoformat()
    plain_text = html_to_text(next_html)

    supabase.table("course_content_items").update({
        "title": next_title,
        "published": next_published,
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
        "after_title": next_title,
        "before_html": current_html,
        "after_html": next_html,
        "change_summary": compact_whitespace(body.change_summary) or None,
    }).execute()

    detail = await get_session_content_item(session_id, content_item_id, user)
    detail["saved"] = True
    detail["revision_number"] = revision_number
    return detail


async def list_content_revisions(
    session_id: str,
    content_item_id: str,
    user: dict,
    *,
    limit: int,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    item = item_result.data[0]
    revision_item_ids = [content_item_id]
    if item.get("content_type") == "quiz":
        revision_item_ids.extend(
            quiz_question_child_ids_for_parent(
                supabase,
                session_id,
                user_id,
                str(item.get("canvas_id")),
                include_pending_delete=True,
            )
        )

    revision_result = supabase.table("content_revisions").select(
        "id, content_item_id, revision_number, before_title, after_title, change_summary, created_at"
    ).in_("content_item_id", revision_item_ids).eq("session_id", session_id).eq(
        "user_id", user_id
    ).order("created_at", desc=True).limit(limit).execute()

    return {"items": revision_result.data or []}


async def restore_content_revision(
    session_id: str,
    content_item_id: str,
    revision_id: str,
    user: dict,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    current_item = item_result.data[0]
    allowed_revision_item_ids = [content_item_id]
    if current_item.get("content_type") == "quiz":
        allowed_revision_item_ids.extend(
            quiz_question_child_ids_for_parent(
                supabase,
                session_id,
                user_id,
                str(current_item.get("canvas_id")),
                include_pending_delete=True,
            )
        )

    revision_result = supabase.table("content_revisions").select(
        "id, content_item_id, revision_number, before_title, after_title, before_html, after_html, change_summary"
    ).eq("id", revision_id).in_("content_item_id", allowed_revision_item_ids).eq(
        "session_id", session_id
    ).eq("user_id", user_id).limit(1).execute()
    if not revision_result.data:
        raise HTTPException(status_code=404, detail="Revision not found")

    revision = revision_result.data[0]
    target_content_item_id = revision.get("content_item_id") or content_item_id
    target_item_result = supabase.table("course_content_items").select(
        "id, title, content_type, metadata"
    ).eq("id", target_content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not target_item_result.data:
        raise HTTPException(status_code=404, detail="Revision content item not found")
    target_item = target_item_result.data[0]
    if target_item.get("content_type") == "quiz_question":
        metadata = target_item.get("metadata") if isinstance(target_item.get("metadata"), dict) else {}
        if "deleted" not in (revision.get("change_summary") or "").lower():
            raise HTTPException(status_code=422, detail="Quiz question edit revisions cannot be restored directly yet. Edit the question and save a new revision instead.")
        restored_html = revision.get("before_html") or ""
        restored_metadata = {**metadata, "pending_delete": False}
        now = datetime.now(timezone.utc).isoformat()
        supabase.table("course_content_items").update({
            "metadata": restored_metadata,
            "last_synced_at": now,
            "updated_at": now,
        }).eq("id", target_content_item_id).execute()
        body_values = {
            "content_item_id": target_content_item_id,
            "html_body": restored_html,
            "plain_text": html_to_text(restored_html),
            "updated_at": now,
        }
        body_result = supabase.table("course_content_bodies").select(
            "content_item_id"
        ).eq("content_item_id", target_content_item_id).limit(1).execute()
        if body_result.data:
            supabase.table("course_content_bodies").update(body_values).eq("content_item_id", target_content_item_id).execute()
        else:
            body_values["extracted_at"] = now
            supabase.table("course_content_bodies").insert(body_values).execute()
        detail = await get_session_content_item(session_id, content_item_id, user)
        detail["saved"] = True
        detail["revision_number"] = None
        detail["restored_from_revision"] = revision["revision_number"]
        return detail

    body_result = supabase.table("course_content_bodies").select(
        "html_body"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    current_html = body_result.data[0].get("html_body") if body_result.data else ""

    restored_title = revision.get("after_title") or current_item.get("title")
    restored_html = revision.get("after_html") or ""
    now = datetime.now(timezone.utc).isoformat()

    supabase.table("course_content_items").update({
        "title": restored_title,
        "updated_at": now,
    }).eq("id", content_item_id).execute()

    body_values = {
        "content_item_id": content_item_id,
        "html_body": restored_html,
        "plain_text": html_to_text(restored_html),
        "updated_at": now,
    }
    if body_result.data:
        supabase.table("course_content_bodies").update(body_values).eq(
            "content_item_id", content_item_id
        ).execute()
    else:
        body_values["extracted_at"] = now
        supabase.table("course_content_bodies").insert(body_values).execute()

    next_number = next_revision_number(supabase, content_item_id)
    supabase.table("content_revisions").insert({
        "content_item_id": content_item_id,
        "session_id": session_id,
        "user_id": user_id,
        "revision_number": next_number,
        "before_title": current_item.get("title"),
        "after_title": restored_title,
        "before_html": current_html,
        "after_html": restored_html,
        "change_summary": f"Restored from revision {revision['revision_number']}",
    }).execute()

    detail = await get_session_content_item(session_id, content_item_id, user)
    detail["saved"] = True
    detail["revision_number"] = next_number
    detail["restored_from_revision"] = revision["revision_number"]
    return detail


async def flag_content_issue(
    session_id: str,
    content_item_id: str,
    body: ContentIssueRequest,
    user: dict,
) -> dict:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, module_name"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    item = item_result.data[0]
    now = datetime.now(timezone.utc).isoformat()
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="content_issue_flagged",
        properties={
            "content_item_id": content_item_id,
            "canvas_id": item.get("canvas_id"),
            "content_type": item.get("content_type"),
            "title": item.get("title"),
            "module_name": item.get("module_name"),
            "issue_type": body.issue_type,
            "note": compact_whitespace(body.note),
            "created_at": now,
            "audit_report_candidate": True,
        },
    )
    return {"status": "ok", "created_at": now}
