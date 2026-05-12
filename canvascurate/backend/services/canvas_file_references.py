"""Helpers for finding Canvas file references across saved content bodies."""

from __future__ import annotations

import re

from services.content_bodies import fetch_content_body_rows


CANVAS_FILE_REFERENCE_PATTERN = re.compile(r"(?:/api/v1)?/(?:courses/\d+/)?files/(\d+)")
HTML_REFERENCE_CONTENT_TYPES = ["page", "assignment", "discussion", "quiz", "quiz_question"]


def canvas_file_reference_ids_from_html(html_values: list[str]) -> list[str]:
    ids: list[str] = []
    for html in html_values:
        ids.extend(CANVAS_FILE_REFERENCE_PATTERN.findall(html or ""))
    return list(dict.fromkeys(ids))


def kept_html_content_item_ids(supabase, *, session_id: str, user_id: str) -> list[str]:
    items_result = supabase.table("course_content_items").select(
        "id, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_type", HTML_REFERENCE_CONTENT_TYPES
    ).execute()
    delete_decision_result = supabase.table("content_inventory_decisions").select(
        "content_item_id"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "action", "delete"
    ).execute()
    deleted_ids = {
        row["content_item_id"]
        for row in delete_decision_result.data or []
        if row.get("content_item_id")
    }

    kept_ids: list[str] = []
    for item in items_result.data or []:
        item_id = item.get("id")
        if not item_id or item_id in deleted_ids:
            continue
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        if metadata.get("pending_delete"):
            continue
        kept_ids.append(item_id)
    return kept_ids


def referenced_canvas_file_ids_for_kept_content(supabase, *, session_id: str, user_id: str) -> set[str]:
    content_item_ids = kept_html_content_item_ids(supabase, session_id=session_id, user_id=user_id)
    if not content_item_ids:
        return set()
    body_rows = fetch_content_body_rows(supabase, content_item_ids)
    return set(canvas_file_reference_ids_from_html([
        str(row.get("html_body") or "")
        for row in body_rows
    ]))


def referenced_canvas_file_labels_by_id(supabase, *, session_id: str, user_id: str) -> dict[str, list[str]]:
    content_item_ids = kept_html_content_item_ids(supabase, session_id=session_id, user_id=user_id)
    if not content_item_ids:
        return {}

    item_result = supabase.table("course_content_items").select(
        "id, title, content_type, module_name, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "id", content_item_ids
    ).execute()
    item_by_id = {
        row["id"]: row
        for row in item_result.data or []
        if row.get("id")
    }

    labels_by_file_id: dict[str, list[str]] = {}
    for body_row in fetch_content_body_rows(supabase, content_item_ids):
        source = item_by_id.get(body_row.get("content_item_id"))
        if not source:
            continue
        metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
        label = (
            metadata.get("parent_quiz_title")
            if source.get("content_type") == "quiz_question"
            else None
        ) or source.get("module_name") or source.get("title") or "Referenced content"
        for file_id in canvas_file_reference_ids_from_html([str(body_row.get("html_body") or "")]):
            labels_by_file_id.setdefault(file_id, [])
            if str(label) not in labels_by_file_id[file_id]:
                labels_by_file_id[file_id].append(str(label))
    return labels_by_file_id
