"""Inventory listing and keep/remove/defer decision services.

Owns the database reads and writes behind the content inventory workflow while
the API router keeps the stable `/canvas/sessions/...` public routes.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import HTTPException

from services.canvas_file_references import referenced_canvas_file_labels_by_id
from services.document_records import get_owned_session
from services.inventory_decision_sync import sync_file_decisions_to_image_reviews
from supabase_client import get_supabase


CONTENT_TYPES = {"page", "assignment", "discussion", "quiz", "quiz_question", "file", "module", "module_item"}
TOP_LEVEL_INVENTORY_TYPES = {"page", "assignment", "discussion", "quiz", "file", "module", "module_item"}
CONTENT_TYPE_LABELS = {
    "page": "Page",
    "assignment": "Assignment",
    "discussion": "Discussion",
    "quiz": "Quiz",
    "quiz_question": "Quiz question",
    "file": "File",
    "module": "Module",
}
INVENTORY_SELECT = (
    "id, canvas_id, content_type, title, canvas_url, published, module_name, position, "
    "last_canvas_edit_at, last_synced_at, is_orphaned, duplicate_group_key, metadata, created_at"
)
INVENTORY_SORT_COLUMNS = {
    "title": "title",
    "content_type": "content_type",
    "file_location": "title",
    "course_location": "module_name",
    "created_at": "created_at",
    "last_synced_at": "last_synced_at",
}
INVENTORY_ACTIVITY_LINK_SELECT = "id, canvas_id, content_type, title, metadata"


def count_table_rows(supabase, table_name: str, session_id: str, user_id: str) -> int:
    result = supabase.table(table_name).select("*", count="exact", head=True).eq(
        "session_id", session_id
    ).eq("user_id", user_id).execute()
    return result.count or 0


def chunks(rows: list[dict], size: int = 200):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def inventory_link_metadata(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def normalized_inventory_title(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def inventory_assignment_shell_id(row: dict[str, Any]) -> str:
    content_type = str(row.get("content_type") or "")
    metadata = inventory_link_metadata(row)
    if content_type == "assignment":
        return str(row.get("canvas_id") or "")
    if metadata.get("source_content_type") == "assignment":
        return str(row.get("canvas_id") or "")
    return ""


def inventory_activity_assignment_id(row: dict[str, Any]) -> str:
    content_type = str(row.get("content_type") or "")
    if content_type not in {"discussion", "quiz"}:
        return ""
    if inventory_assignment_shell_id(row):
        return ""
    assignment_id = inventory_link_metadata(row).get("assignment_id")
    return str(assignment_id) if assignment_id else ""


def inventory_assignment_discussion_id(row: dict[str, Any]) -> str:
    metadata = inventory_link_metadata(row)
    discussion_topic_id = metadata.get("discussion_topic_id")
    if discussion_topic_id:
        return str(discussion_topic_id)
    discussion_topic = metadata.get("discussion_topic")
    if isinstance(discussion_topic, dict) and discussion_topic.get("id"):
        return str(discussion_topic["id"])
    return ""


def inventory_assignment_quiz_id(row: dict[str, Any]) -> str:
    quiz_id = inventory_link_metadata(row).get("quiz_id")
    return str(quiz_id) if quiz_id else ""


def linked_inventory_decision_item_ids(
    supabase,
    session_id: str,
    user_id: str,
    content_item_ids: list[str],
) -> list[str]:
    requested_ids = list(dict.fromkeys(content_item_ids))
    if not requested_ids:
        return []

    result = supabase.table("course_content_items").select(
        INVENTORY_ACTIVITY_LINK_SELECT
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_type", ["assignment", "discussion", "quiz"]
    ).execute()
    items = [row for row in result.data or [] if row.get("id")]
    items_by_id = {row["id"]: row for row in items}
    selected = [items_by_id[item_id] for item_id in requested_ids if item_id in items_by_id]
    if not selected:
        return requested_ids

    assignment_ids: set[str] = set()
    discussion_ids: set[str] = set()
    quiz_ids: set[str] = set()
    titles: set[str] = set()

    for row in selected:
        content_type = str(row.get("content_type") or "")
        title = normalized_inventory_title(row.get("title"))
        if title:
            titles.add(title)
        assignment_shell_id = inventory_assignment_shell_id(row)
        activity_assignment_id = inventory_activity_assignment_id(row)
        if assignment_shell_id:
            assignment_ids.add(assignment_shell_id)
        if activity_assignment_id:
            assignment_ids.add(activity_assignment_id)
        assignment_discussion_id = inventory_assignment_discussion_id(row)
        assignment_quiz_id = inventory_assignment_quiz_id(row)
        if assignment_discussion_id:
            discussion_ids.add(assignment_discussion_id)
        if assignment_quiz_id:
            quiz_ids.add(assignment_quiz_id)
        if content_type == "discussion" and row.get("canvas_id"):
            discussion_ids.add(str(row["canvas_id"]))
        if content_type == "quiz" and not assignment_shell_id and row.get("canvas_id"):
            quiz_ids.add(str(row["canvas_id"]))

    linked_ids = set(requested_ids)
    for row in items:
        content_type = str(row.get("content_type") or "")
        assignment_shell_id = inventory_assignment_shell_id(row)
        activity_assignment_id = inventory_activity_assignment_id(row)
        if assignment_shell_id and assignment_shell_id in assignment_ids:
            linked_ids.add(row["id"])
            continue
        if activity_assignment_id and activity_assignment_id in assignment_ids:
            linked_ids.add(row["id"])
            continue
        if content_type == "discussion":
            if row.get("canvas_id") and str(row["canvas_id"]) in discussion_ids:
                linked_ids.add(row["id"])
                continue
        if content_type == "quiz" and not assignment_shell_id:
            if row.get("canvas_id") and str(row["canvas_id"]) in quiz_ids:
                linked_ids.add(row["id"])
                continue
        if inventory_assignment_discussion_id(row) in discussion_ids:
            linked_ids.add(row["id"])
            continue
        if inventory_assignment_quiz_id(row) in quiz_ids:
            linked_ids.add(row["id"])
            continue
        title = normalized_inventory_title(row.get("title"))
        if title and title in titles and content_type in {"assignment", "discussion", "quiz"}:
            linked_ids.add(row["id"])

    return [item_id for item_id in requested_ids if item_id in linked_ids] + [
        item_id for item_id in linked_ids if item_id not in requested_ids
    ]


def upsert_inventory_decisions(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_item_ids: list[str],
    action: Literal["keep", "delete", "defer"],
    reason: str | None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    existing = supabase.table("content_inventory_decisions").select(
        "id, content_item_id"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", content_item_ids
    ).execute()
    existing_ids = {row["content_item_id"] for row in (existing.data or [])}
    missing_ids = [item_id for item_id in content_item_ids if item_id not in existing_ids]

    if existing_ids:
        supabase.table("content_inventory_decisions").update({
            "action": action,
            "reason": reason,
            "updated_at": now,
        }).eq("session_id", session_id).eq("user_id", user_id).in_(
            "content_item_id", list(existing_ids)
        ).execute()

    if missing_ids:
        supabase.table("content_inventory_decisions").insert([
            {
                "content_item_id": item_id,
                "session_id": session_id,
                "user_id": user_id,
                "action": action,
                "reason": reason,
                "updated_at": now,
            }
            for item_id in missing_ids
        ]).execute()

    result = supabase.table("content_inventory_decisions").select(
        "id, content_item_id, action, reason, applied_to_canvas, applied_at, created_at, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", content_item_ids
    ).execute()
    return {
        "decisions": result.data or [],
        "updated_count": len(existing_ids),
        "created_count": len(missing_ids),
    }


def fetch_all_content_items_for_decision_defaults(supabase, session_id: str, user_id: str) -> list[dict]:
    rows: list[dict] = []
    page_size = 1000
    offset = 0

    while True:
        result = supabase.table("course_content_items").select(
            "id, content_type, is_orphaned, metadata"
        ).eq("session_id", session_id).eq("user_id", user_id).in_(
            "content_type", list(TOP_LEVEL_INVENTORY_TYPES)
        ).range(
            offset, offset + page_size - 1
        ).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return rows


def fetch_existing_decision_item_ids(supabase, session_id: str, user_id: str) -> set[str]:
    item_ids: set[str] = set()
    page_size = 1000
    offset = 0

    while True:
        result = supabase.table("content_inventory_decisions").select(
            "content_item_id"
        ).eq("session_id", session_id).eq("user_id", user_id).range(
            offset, offset + page_size - 1
        ).execute()
        batch = result.data or []
        item_ids.update(row["content_item_id"] for row in batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return item_ids


def default_inventory_action(item: dict) -> Literal["keep", "delete"]:
    if item.get("content_type") == "quiz_question":
        return "keep"
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    linked_from = metadata.get("linked_from") if isinstance(metadata.get("linked_from"), list) else []
    if item.get("is_orphaned") and not linked_from and item.get("content_type") not in {"module", "module_item", "quiz_question"}:
        return "delete"
    return "keep"


def annotate_file_inventory_references(supabase, session_id: str, user_id: str, rows: list[dict]) -> None:
    file_rows = [
        row
        for row in rows
        if row.get("content_type") == "file" and row.get("canvas_id")
    ]
    if not file_rows:
        return

    file_ids = [str(row["canvas_id"]) for row in file_rows if row.get("canvas_id")]
    requested_file_ids = set(file_ids)
    labels_by_file_id = {
        file_id: labels
        for file_id, labels in referenced_canvas_file_labels_by_id(
            supabase,
            session_id=session_id,
            user_id=user_id,
        ).items()
        if file_id in requested_file_ids
    }
    image_result = supabase.table("course_images").select(
        "canvas_file_id, content_item_id, review_action"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "canvas_file_id", list(dict.fromkeys(file_ids))
    ).execute()
    image_rows = [
        row
        for row in image_result.data or []
        if row.get("canvas_file_id")
        and row.get("content_item_id")
        and row.get("review_action") != "delete"
    ]
    if image_rows:
        source_item_ids = list(dict.fromkeys(
            row["content_item_id"]
            for row in image_rows
            if row.get("content_item_id")
        ))
        source_result = supabase.table("course_content_items").select(
            "id, title, content_type, canvas_url, module_name, metadata"
        ).eq("session_id", session_id).eq("user_id", user_id).in_(
            "id", source_item_ids
        ).execute()
        source_by_id = {
            row["id"]: row
            for row in source_result.data or []
            if row.get("id")
        }

        for image_row in image_rows:
            source = source_by_id.get(image_row.get("content_item_id"))
            if not source:
                continue
            metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
            label = (
                source.get("module_name")
                or metadata.get("parent_quiz_title")
                or source.get("title")
                or CONTENT_TYPE_LABELS.get(str(source.get("content_type") or ""), "Referenced content")
            )
            if source.get("content_type") == "quiz_question" and metadata.get("parent_quiz_title"):
                label = str(metadata["parent_quiz_title"])
            file_id = str(image_row["canvas_file_id"])
            labels_by_file_id.setdefault(file_id, [])
            if label and str(label) not in labels_by_file_id[file_id]:
                labels_by_file_id[file_id].append(str(label))

    for row in file_rows:
        labels = labels_by_file_id.get(str(row.get("canvas_id") or ""), [])
        if not labels:
            continue
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        linked_from = metadata.get("linked_from") if isinstance(metadata.get("linked_from"), list) else []
        next_linked_from = list(dict.fromkeys([str(value) for value in linked_from if value] + labels))
        row["metadata"] = {
            **metadata,
            "linked_from": next_linked_from,
        }


def reconcile_referenced_file_inventory_decisions(supabase, session_id: str, user_id: str, rows: list[dict]) -> None:
    protected_file_ids = [
        row["id"]
        for row in rows
        if row.get("id")
        and row.get("content_type") == "file"
        and isinstance(row.get("metadata"), dict)
        and isinstance(row["metadata"].get("linked_from"), list)
        and row["metadata"]["linked_from"]
    ]
    if not protected_file_ids:
        return

    decision_result = supabase.table("content_inventory_decisions").select(
        "id, action, reason"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", protected_file_ids
    ).execute()
    now = datetime.now(timezone.utc).isoformat()
    for decision in decision_result.data or []:
        reason = str(decision.get("reason") or "")
        if decision.get("action") == "delete" and reason.startswith("Defaulted to "):
            supabase.table("content_inventory_decisions").update({
                "action": "keep",
                "reason": "Defaulted to keep because item is referenced by kept course content",
                "updated_at": now,
            }).eq("id", decision["id"]).execute()


def seed_default_inventory_decisions(supabase, session_id: str, user_id: str) -> int:
    item_count_result = supabase.table("course_content_items").select("*", count="exact", head=True).eq(
        "session_id", session_id
    ).eq("user_id", user_id).in_("content_type", list(TOP_LEVEL_INVENTORY_TYPES)).execute()
    item_count = item_count_result.count or 0
    decision_count = count_table_rows(supabase, "content_inventory_decisions", session_id, user_id)
    if item_count == 0 or decision_count >= item_count:
        return 0

    items = fetch_all_content_items_for_decision_defaults(supabase, session_id, user_id)
    if not items:
        return 0

    existing_item_ids = fetch_existing_decision_item_ids(supabase, session_id, user_id)
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for item in items:
        if item["id"] in existing_item_ids:
            continue
        action = default_inventory_action(item)
        rows.append({
            "content_item_id": item["id"],
            "session_id": session_id,
            "user_id": user_id,
            "action": action,
            "reason": "Defaulted to remove because item is orphaned" if action == "delete" else "Defaulted to keep because item is placed or referenced",
            "updated_at": now,
        })

    for chunk in chunks(rows):
        supabase.table("content_inventory_decisions").insert(chunk).execute()

    return len(rows)


def apply_inventory_filters(query, session_id: str, user_id: str, content_type: str | None, q: str | None):
    query = query.eq("session_id", session_id).eq("user_id", user_id)
    if content_type:
        if content_type not in CONTENT_TYPES:
            raise HTTPException(status_code=422, detail="Invalid content type")
        query = query.eq("content_type", content_type)
    else:
        query = query.in_("content_type", list(TOP_LEVEL_INVENTORY_TYPES))
    if q:
        normalized = q.strip()
        if normalized:
            query = query.ilike("title", f"%{normalized}%")
    return query


def inventory_order(query, sort: str, direction: Literal["asc", "desc"]):
    desc = direction == "desc"
    if sort == "status":
        return query.order("duplicate_group_key", desc=desc).order(
            "is_orphaned", desc=desc
        ).order("published", desc=not desc).order("title", desc=False)

    column = INVENTORY_SORT_COLUMNS.get(sort, "created_at")
    return query.order(column, desc=desc).order("id", desc=False)


def list_inventory_decisions(session_id: str, user_id: str) -> dict[str, Any]:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    result = supabase.table("content_inventory_decisions").select(
        "id, content_item_id, action, reason, applied_to_canvas, applied_at, created_at, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()

    return {"decisions": result.data or []}


def save_inventory_decision(
    *,
    session_id: str,
    user_id: str,
    content_item_id: str,
    action: Literal["keep", "delete", "defer"],
    reason: str | None,
) -> dict[str, Any]:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    item_result = supabase.table("course_content_items").select(
        "id"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    content_item_ids = linked_inventory_decision_item_ids(
        supabase,
        session_id,
        user_id,
        [content_item_id],
    )
    save_result = upsert_inventory_decisions(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_ids=content_item_ids,
        action=action,
        reason=reason,
    )
    image_sync_result = sync_file_decisions_to_image_reviews(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_ids=content_item_ids,
        action=action,
    )
    decisions = save_result["decisions"]
    decision_by_item_id = {
        row.get("content_item_id"): row
        for row in decisions
        if row.get("content_item_id")
    }
    primary_decision = decision_by_item_id.get(content_item_id)
    if not primary_decision:
        raise HTTPException(status_code=500, detail="Failed to load saved decision")

    return {
        **primary_decision,
        "linked_decisions": [dict(row) for row in decisions],
        "linked_content_item_ids": content_item_ids,
        "image_sync": image_sync_result,
    }


def save_bulk_inventory_decisions(
    *,
    session_id: str,
    user_id: str,
    content_item_ids: list[str],
    action: Literal["keep", "delete", "defer"],
    reason: str | None,
) -> dict[str, Any]:
    content_item_ids = list(dict.fromkeys(content_item_ids))
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    item_result = supabase.table("course_content_items").select(
        "id"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "id", content_item_ids
    ).execute()
    found_ids = {row["id"] for row in (item_result.data or [])}
    if len(found_ids) != len(content_item_ids):
        raise HTTPException(status_code=404, detail="One or more content items were not found")

    expanded_content_item_ids = linked_inventory_decision_item_ids(
        supabase,
        session_id,
        user_id,
        content_item_ids,
    )
    save_result = upsert_inventory_decisions(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_ids=expanded_content_item_ids,
        action=action,
        reason=reason,
    )
    image_sync_result = sync_file_decisions_to_image_reviews(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_ids=expanded_content_item_ids,
        action=action,
    )
    decisions = save_result["decisions"]

    return {
        "updated_count": save_result["updated_count"],
        "created_count": save_result["created_count"],
        "action": action,
        "content_item_ids": expanded_content_item_ids,
        "requested_content_item_ids": content_item_ids,
        "linked_decisions": decisions,
        "image_sync": image_sync_result,
    }


def list_session_inventory(
    *,
    session_id: str,
    user_id: str,
    limit: int,
    offset: int,
    content_type: str | None,
    q: str | None,
    sort: str,
    direction: Literal["asc", "desc"],
) -> dict[str, Any]:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    seeded_count = seed_default_inventory_decisions(supabase, session_id, user_id)

    normalized_type = None if content_type in {None, "", "all"} else content_type

    items_query = supabase.table("course_content_items").select(INVENTORY_SELECT)
    items_query = apply_inventory_filters(items_query, session_id, user_id, normalized_type, q)
    items_query = inventory_order(items_query, sort, direction).range(offset, offset + limit - 1)

    count_query = supabase.table("course_content_items").select("*", count="exact", head=True)
    count_query = apply_inventory_filters(count_query, session_id, user_id, normalized_type, q)

    tab_count_queries = []
    for type_name in ["all", "page", "assignment", "discussion", "quiz", "file", "module"]:
        query = supabase.table("course_content_items").select("*", count="exact", head=True).eq(
            "session_id", session_id
        ).eq("user_id", user_id)
        if type_name != "all":
            query = query.eq("content_type", type_name)
        else:
            query = query.in_("content_type", list(TOP_LEVEL_INVENTORY_TYPES))
        tab_count_queries.append((type_name, query))

    decision_count_query = supabase.table("content_inventory_decisions").select(
        "action"
    ).eq("session_id", session_id).eq("user_id", user_id)

    items_result = items_query.execute()
    count_result = count_query.execute()
    decision_count_result = decision_count_query.execute()

    tab_counts: dict[str, int] = {}
    for type_name, query in tab_count_queries:
        tab_counts[type_name] = query.execute().count or 0

    rows = items_result.data or []
    annotate_file_inventory_references(supabase, session_id, user_id, rows)
    reconcile_referenced_file_inventory_decisions(supabase, session_id, user_id, rows)
    item_ids = [row["id"] for row in rows]
    decisions_by_item: dict[str, str] = {}
    if item_ids:
        decision_result = supabase.table("content_inventory_decisions").select(
            "content_item_id, action"
        ).eq("session_id", session_id).eq("user_id", user_id).in_(
            "content_item_id", item_ids
        ).execute()
        decisions_by_item = {
            row["content_item_id"]: row["action"]
            for row in (decision_result.data or [])
        }

    decision_counts = {"keep": 0, "delete": 0, "defer": 0}
    for row in decision_count_result.data or []:
        action = row.get("action")
        if action in decision_counts:
            decision_counts[action] += 1

    for row in rows:
        row["decision_action"] = decisions_by_item.get(row["id"])

    total_count = count_result.count or 0
    next_offset = offset + limit if offset + limit < total_count else None

    return {
        "items": rows,
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
        "next_offset": next_offset,
        "tab_counts": tab_counts,
        "decision_counts": decision_counts,
        "seeded_decision_count": seeded_count,
    }
