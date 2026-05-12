"""Printable course content read model for Reports & Downloads."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from r2_storage import is_r2_configured, signed_get_url
from services.content_bodies import fetch_content_html_by_item_id


PRINTABLE_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz"}


def _fetch_all(query, *, page_size: int = 1000) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        result = query.range(offset, offset + page_size - 1).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def _metadata(row: dict[str, Any] | None) -> dict[str, Any]:
    value = (row or {}).get("metadata")
    return value if isinstance(value, dict) else {}


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _course_context(supabase, *, session: dict[str, Any], user_id: str) -> dict[str, Any]:
    course: dict[str, Any] = {}
    if session.get("source_course_id"):
        course_result = supabase.table("courses").select(
            "course_name, canvas_base_url, canvas_course_id"
        ).eq("id", session["source_course_id"]).eq("user_id", user_id).limit(1).execute()
        course = course_result.data[0] if course_result.data else {}

    course_url = ""
    if course.get("canvas_base_url") and course.get("canvas_course_id"):
        course_url = f"{str(course['canvas_base_url']).rstrip('/')}/courses/{course['canvas_course_id']}"

    return {
        "name": course.get("course_name") or session.get("name") or "Course",
        "url": course_url,
    }


def _item_body_title(item: dict[str, Any]) -> str:
    metadata = _metadata(item)
    return str(item.get("title") or metadata.get("name") or "Untitled")


def _item_summary(
    item: dict[str, Any],
    *,
    html_by_item_id: dict[str, str],
    media_replacements_by_item_id: dict[str, list[dict[str, Any]]],
    module_name: str | None = None,
    module_position: int | None = None,
    module_item_position: int | None = None,
    placement_id: str | None = None,
) -> dict[str, Any]:
    item_id = str(item.get("id") or "")
    metadata = _metadata(item)
    return {
        "id": item_id,
        "placement_id": placement_id,
        "title": _item_body_title(item),
        "content_type": item.get("content_type") or "page",
        "module_name": module_name or item.get("module_name") or metadata.get("parent_quiz_title") or "",
        "module_position": module_position,
        "module_item_position": module_item_position if module_item_position is not None else item.get("position"),
        "canvas_url": item.get("canvas_url") or "",
        "published": item.get("published"),
        "updated_at": item.get("updated_at"),
        "html_body": html_by_item_id.get(item_id) or "",
        "media_replacements": media_replacements_by_item_id.get(item_id, []),
    }


def _signed_media_url(r2_key: Any) -> str:
    if not r2_key or not is_r2_configured():
        return ""
    try:
        return signed_get_url(str(r2_key), expires_in=60 * 60)
    except Exception:
        return ""


def _media_replacements_by_item(
    supabase,
    *,
    session_id: str,
    user_id: str,
    item_ids: set[str],
) -> dict[str, list[dict[str, Any]]]:
    if not item_ids:
        return {}

    rows = _fetch_all(
        supabase.table("course_images").select(
            "id, content_item_id, canvas_url, canvas_file_id, r2_original_key, r2_thumb_key"
        ).eq("session_id", session_id).eq("user_id", user_id)
    )

    replacements: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        content_item_id = str(row.get("content_item_id") or "")
        if content_item_id not in item_ids:
            continue
        original_url = _signed_media_url(row.get("r2_original_key"))
        thumb_url = _signed_media_url(row.get("r2_thumb_key"))
        replacements[content_item_id].append({
            "image_id": str(row.get("id") or ""),
            "source_url": row.get("canvas_url") or "",
            "canvas_file_id": str(row.get("canvas_file_id") or "") or None,
            "print_src": original_url or thumb_url or "",
        })
    return dict(replacements)


def build_printable_content(
    supabase,
    *,
    session_id: str,
    user_id: str,
    session: dict[str, Any],
) -> dict[str, Any]:
    items = _fetch_all(
        supabase.table("course_content_items").select(
            "id, canvas_id, content_type, title, canvas_url, published, module_name, position, metadata, updated_at"
        ).eq("session_id", session_id).eq("user_id", user_id).in_(
            "content_type", sorted(PRINTABLE_CONTENT_TYPES)
        ).order("content_type").order("title")
    )
    item_by_id = {str(item["id"]): item for item in items if item.get("id")}
    html_by_item_id = fetch_content_html_by_item_id(supabase, list(item_by_id))
    media_replacements_by_item_id = _media_replacements_by_item(
        supabase,
        session_id=session_id,
        user_id=user_id,
        item_ids=set(item_by_id),
    )

    modules = _fetch_all(
        supabase.table("course_modules").select(
            "id, name, position, metadata"
        ).eq("session_id", session_id).eq("user_id", user_id).order("position").order("name")
    )
    module_by_id = {str(module["id"]): module for module in modules if module.get("id")}
    module_items = _fetch_all(
        supabase.table("course_module_items").select(
            "id, module_id, content_item_id, title, content_type, position"
        ).eq("session_id", session_id).eq("user_id", user_id).order("position").order("title")
    )

    printable_items: list[dict[str, Any]] = []
    placed_item_ids: set[str] = set()
    for module_item in sorted(
        module_items,
        key=lambda row: (
            _safe_int((module_by_id.get(str(row.get("module_id") or "")) or {}).get("position"), 99999),
            _safe_int(row.get("position"), 99999),
            str(row.get("title") or ""),
        ),
    ):
        content_item_id = str(module_item.get("content_item_id") or "")
        item = item_by_id.get(content_item_id)
        if not item:
            continue
        module = module_by_id.get(str(module_item.get("module_id") or "")) or {}
        placed_item_ids.add(content_item_id)
        printable_items.append(
            _item_summary(
                item,
                html_by_item_id=html_by_item_id,
                media_replacements_by_item_id=media_replacements_by_item_id,
                module_name=module.get("name") or item.get("module_name"),
                module_position=module.get("position"),
                module_item_position=module_item.get("position"),
                placement_id=module_item.get("id"),
            )
        )

    for item in sorted(
        (item for item in items if str(item.get("id") or "") not in placed_item_ids),
        key=lambda row: (
            str(row.get("module_name") or "zz_unplaced"),
            _safe_int(row.get("position"), 99999),
            str(row.get("title") or ""),
        ),
    ):
        printable_items.append(
            _item_summary(
                item,
                html_by_item_id=html_by_item_id,
                media_replacements_by_item_id=media_replacements_by_item_id,
            )
        )

    module_counts = Counter(item.get("module_name") or "Not in Module" for item in printable_items)
    response_modules = [
        {
            "name": module.get("name") or "Untitled Module",
            "position": module.get("position"),
            "item_count": module_counts.get(module.get("name") or "Untitled Module", 0),
        }
        for module in modules
        if module_counts.get(module.get("name") or "Untitled Module", 0)
    ]
    if module_counts.get("Not in Module"):
        response_modules.append({
            "name": "Not in Module",
            "position": None,
            "item_count": module_counts["Not in Module"],
        })

    return {
        "session": {
            "id": session.get("id"),
            "name": session.get("name"),
            "type": session.get("type"),
        },
        "course": _course_context(supabase, session=session, user_id=user_id),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "modules": response_modules,
        "items": printable_items,
    }
