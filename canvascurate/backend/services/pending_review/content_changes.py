"""Pending content change read models."""

from typing import Any

from fastapi import HTTPException

from diff_engine import diff_summary, has_changes, unified_diff
from services.editor.quiz_questions import (
    combine_pending_summaries,
    quiz_question_pending_summary,
)
from services.pending_review.content_helpers import (
    EDITABLE_CONTENT_TYPES,
    content_change_fields,
    html_word_delta,
    parse_iso_datetime,
)
from services.content_bodies import fetch_content_html_by_item_id
from services.pending_review.module_operations import module_operation_response


def build_session_pending_changes(
    supabase,
    *,
    session_id: str,
    user_id: str,
) -> dict[str, Any]:
    items_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, published, module_name, last_synced_at, updated_at, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_type", EDITABLE_CONTENT_TYPES
    ).execute()
    items = items_result.data or []
    item_by_id = {item["id"]: item for item in items}
    quiz_by_canvas_id = {
        str(item.get("canvas_id")): item
        for item in items
        if item.get("content_type") == "quiz"
    }
    item_ids = list(item_by_id)

    revision_result = supabase.table("content_revisions").select(
        "id, content_item_id, revision_number, before_title, after_title, before_html, after_html, change_summary, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", item_ids
    ).order("revision_number", desc=False).execute() if item_ids else None
    module_item_result = supabase.table("course_module_items").select(
        "content_item_id, canvas_module_item_id"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", item_ids
    ).execute() if item_ids else None

    current_html_by_id = fetch_content_html_by_item_id(supabase, item_ids)
    module_item_by_content_id = {
        row["content_item_id"]: row
        for row in ((module_item_result.data if module_item_result else []) or [])
        if row.get("content_item_id")
    }
    revisions_by_item: dict[str, list[dict[str, Any]]] = {}
    for revision in ((revision_result.data if revision_result else []) or []):
        item = item_by_id.get(revision.get("content_item_id"))
        if not item:
            continue
        revision_at = parse_iso_datetime(revision.get("created_at"))
        last_synced_at = parse_iso_datetime(item.get("last_synced_at"))
        if last_synced_at and revision_at and revision_at <= last_synced_at:
            continue
        revisions_by_item.setdefault(revision["content_item_id"], []).append(revision)

    content_changes_by_id: dict[str, dict[str, Any]] = {}
    for content_item_id, revisions in revisions_by_item.items():
        if not revisions:
            continue
        item = item_by_id[content_item_id]
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        parent_quiz_item = None
        if item.get("content_type") == "quiz_question":
            parent_quiz_id = metadata.get("parent_quiz_canvas_id")
            parent_quiz_item = quiz_by_canvas_id.get(str(parent_quiz_id))
            if not parent_quiz_item:
                continue
        first_revision = revisions[0]
        latest_revision = revisions[-1]
        before_html = first_revision.get("before_html") or ""
        after_html = current_html_by_id.get(content_item_id, latest_revision.get("after_html") or "")
        changed = has_changes(before_html, after_html)
        before_title = first_revision.get("before_title")
        display_item = parent_quiz_item or item
        after_title = display_item.get("title")
        title_changed = False if parent_quiz_item else (before_title or "") != (after_title or "")
        body_changed = (before_html or "") != (after_html or "")
        affected_fields = ["quiz_questions"] if parent_quiz_item else content_change_fields(title_changed, body_changed)
        change_summary = (
            quiz_question_pending_summary(item, revisions)
            if parent_quiz_item
            else latest_revision.get("change_summary")
        )
        change_diff_summary = diff_summary(before_html, after_html) if not parent_quiz_item else change_summary

        target_content_item_id = display_item["id"]
        existing = content_changes_by_id.get(target_content_item_id)
        next_change = {
            "change_type": "content_edit",
            "review_status": "ready to push" if changed or title_changed else "local draft",
            "content_item_id": target_content_item_id,
            "content_type": display_item.get("content_type"),
            "title": display_item.get("title"),
            "canvas_url": display_item.get("canvas_url"),
            "module_name": display_item.get("module_name"),
            "revision_count": len(revisions),
            "first_revision_number": first_revision.get("revision_number"),
            "latest_revision_number": latest_revision.get("revision_number"),
            "first_changed_at": first_revision.get("created_at"),
            "latest_changed_at": latest_revision.get("created_at"),
            "change_summary": change_summary,
            "diff_summary": change_diff_summary,
            "has_changes": changed,
            "title_changed": title_changed,
            "body_changed": body_changed,
            "affected_fields": affected_fields,
            "before_title": before_title,
            "after_title": after_title,
            **html_word_delta(before_html, after_html),
        }
        if existing:
            existing["revision_count"] += next_change["revision_count"]
            existing["latest_revision_number"] = max(existing["latest_revision_number"] or 0, next_change["latest_revision_number"] or 0)
            existing["latest_changed_at"] = max(existing["latest_changed_at"] or "", next_change["latest_changed_at"] or "")
            existing["change_summary"] = combine_pending_summaries(existing.get("change_summary"), next_change.get("change_summary"))
            existing["diff_summary"] = combine_pending_summaries(existing.get("diff_summary"), next_change.get("diff_summary"))
            existing["has_changes"] = existing["has_changes"] or next_change["has_changes"]
            existing["title_changed"] = existing["title_changed"] or next_change["title_changed"]
            existing["body_changed"] = existing["body_changed"] or next_change["body_changed"]
            existing["affected_fields"] = sorted(set(existing["affected_fields"]) | set(next_change["affected_fields"]))
            existing["word_delta"] += next_change["word_delta"]
            existing["after_word_count"] += next_change["after_word_count"]
        else:
            content_changes_by_id[target_content_item_id] = next_change

    for item in items:
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        if not metadata.get("desired_canvas_module_id"):
            continue
        module_item = module_item_by_content_id.get(item["id"])
        canvas_module_item_id = str((module_item or {}).get("canvas_module_item_id") or "")
        if module_item and not canvas_module_item_id.startswith("local:"):
            continue
        existing = content_changes_by_id.get(item["id"])
        placement_summary = f"Place in {metadata.get('desired_module_name') or item.get('module_name') or 'selected module'}"
        if existing:
            existing["change_summary"] = combine_pending_summaries(existing.get("change_summary"), placement_summary)
            existing["diff_summary"] = combine_pending_summaries(existing.get("diff_summary"), "Module placement pending")
            existing["affected_fields"] = sorted(set(existing.get("affected_fields") or []) | {"module_placement"})
            existing["has_changes"] = True
            existing["review_status"] = "ready to push"
            continue
        content_changes_by_id[item["id"]] = {
            "change_type": "content_edit",
            "review_status": "ready to push",
            "content_item_id": item["id"],
            "content_type": item.get("content_type"),
            "title": item.get("title"),
            "canvas_url": item.get("canvas_url"),
            "module_name": metadata.get("desired_module_name") or item.get("module_name"),
            "revision_count": 0,
            "first_revision_number": None,
            "latest_revision_number": None,
            "first_changed_at": item.get("updated_at"),
            "latest_changed_at": item.get("updated_at"),
            "change_summary": placement_summary,
            "diff_summary": "Module placement pending",
            "has_changes": True,
            "title_changed": False,
            "body_changed": False,
            "affected_fields": ["module_placement"],
            "before_title": item.get("title"),
            "after_title": item.get("title"),
            "word_delta": 0,
            "before_word_count": 0,
            "after_word_count": 0,
        }

    content_changes = list(content_changes_by_id.values())
    content_changes.sort(key=lambda row: row.get("latest_changed_at") or "", reverse=True)
    module_result = supabase.table("module_queue_operations").select("*").eq(
        "session_id", session_id
    ).eq("user_id", user_id).eq("status", "staged").order(
        "updated_at", desc=True
    ).execute()
    module_changes = [module_operation_response(row) for row in module_result.data or []]
    return {
        "content_changes": content_changes,
        "module_changes": module_changes,
        "counts": {
            "content": len(content_changes),
            "modules": len(module_changes),
            "total": len(content_changes) + len(module_changes),
        },
    }


def build_content_pending_diff(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_item_id: str,
) -> dict[str, Any]:
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, module_name, last_synced_at"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    item = item_result.data[0]
    if item.get("content_type") not in EDITABLE_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="This content type does not support pending diffs")

    revision_result = supabase.table("content_revisions").select(
        "id, revision_number, before_title, after_title, before_html, after_html, change_summary, created_at"
    ).eq("content_item_id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).order("revision_number", desc=False).execute()

    last_synced_at = parse_iso_datetime(item.get("last_synced_at"))
    revisions = []
    for revision in revision_result.data or []:
        revision_at = parse_iso_datetime(revision.get("created_at"))
        if last_synced_at and revision_at and revision_at <= last_synced_at:
            continue
        revisions.append(revision)

    if not revisions:
        raise HTTPException(status_code=404, detail="No pending diff found for this item")

    body_result = supabase.table("course_content_bodies").select(
        "html_body"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    current_body = body_result.data[0] if body_result.data else {}

    first_revision = revisions[0]
    latest_revision = revisions[-1]
    before_html = first_revision.get("before_html") or ""
    after_html = current_body.get("html_body") or latest_revision.get("after_html") or ""
    changed = has_changes(before_html, after_html)
    before_title = first_revision.get("before_title")
    after_title = item.get("title")
    title_changed = (before_title or "") != (after_title or "")
    body_changed = (before_html or "") != (after_html or "")

    return {
        "change_type": "content_edit",
        "review_status": "ready to push" if changed or title_changed else "local draft",
        "content_item_id": content_item_id,
        "content_type": item.get("content_type"),
        "title": item.get("title"),
        "canvas_url": item.get("canvas_url"),
        "module_name": item.get("module_name"),
        "revision_count": len(revisions),
        "first_revision_number": first_revision.get("revision_number"),
        "latest_revision_number": latest_revision.get("revision_number"),
        "first_changed_at": first_revision.get("created_at"),
        "latest_changed_at": latest_revision.get("created_at"),
        "change_summary": latest_revision.get("change_summary"),
        "diff_summary": diff_summary(before_html, after_html),
        "has_changes": changed,
        "title_changed": title_changed,
        "body_changed": body_changed,
        "unified_diff": unified_diff(before_html, after_html) if changed else "",
        "affected_fields": content_change_fields(title_changed, body_changed),
        "before_title": before_title,
        "after_title": after_title,
        **html_word_delta(before_html, after_html),
    }
