"""Synchronize review decisions between file inventory and image inventory."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal


DecisionAction = Literal["keep", "delete", "defer"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _file_items_by_canvas_id(
    supabase,
    *,
    session_id: str,
    user_id: str,
    canvas_file_ids: list[str],
) -> dict[str, dict[str, Any]]:
    if not canvas_file_ids:
        return {}

    result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "content_type", "file"
    ).in_("canvas_id", canvas_file_ids).execute()
    return {
        str(row["canvas_id"]): row
        for row in result.data or []
        if row.get("id") and row.get("canvas_id")
    }


def sync_file_decisions_to_image_reviews(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_item_ids: list[str],
    action: DecisionAction,
) -> dict[str, Any]:
    """Mirror a file inventory decision to image rows that reference the same Canvas file."""
    content_item_ids = list(dict.fromkeys([item_id for item_id in content_item_ids if item_id]))
    if not content_item_ids:
        return {"updated_image_count": 0, "canvas_file_ids": []}

    file_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "content_type", "file"
    ).in_("id", content_item_ids).execute()
    canvas_file_ids = [
        str(row["canvas_id"])
        for row in file_result.data or []
        if row.get("canvas_id") and not str(row.get("canvas_id")).startswith("local:")
    ]
    canvas_file_ids = list(dict.fromkeys(canvas_file_ids))
    if not canvas_file_ids:
        return {"updated_image_count": 0, "canvas_file_ids": []}

    result = supabase.table("course_images").update({
        "review_action": action,
        "updated_at": _now_iso(),
    }).eq("session_id", session_id).eq("user_id", user_id).in_(
        "canvas_file_id", canvas_file_ids
    ).execute()
    return {
        "updated_image_count": len(result.data or []),
        "canvas_file_ids": canvas_file_ids,
    }


def _aggregate_image_actions(actions: list[str]) -> DecisionAction:
    normalized = [action for action in actions if action in {"keep", "delete", "defer"}]
    if not normalized:
        return "defer"
    if "keep" in normalized:
        return "keep"
    if all(action == "delete" for action in normalized):
        return "delete"
    return "defer"


def sync_image_reviews_to_file_decisions(
    supabase,
    *,
    session_id: str,
    user_id: str,
    canvas_file_ids: list[str],
) -> dict[str, Any]:
    """Update file inventory decisions from grouped image review actions.

    A file is only marked delete when every known image occurrence for that
    Canvas file is marked delete. Any kept occurrence keeps the file decision.
    """
    canvas_file_ids = list(dict.fromkeys([
        str(file_id)
        for file_id in canvas_file_ids
        if file_id and not str(file_id).startswith("local:")
    ]))
    if not canvas_file_ids:
        return {"updated_file_decision_count": 0, "content_item_ids": []}

    file_items = _file_items_by_canvas_id(
        supabase,
        session_id=session_id,
        user_id=user_id,
        canvas_file_ids=canvas_file_ids,
    )
    if not file_items:
        return {"updated_file_decision_count": 0, "content_item_ids": []}

    image_result = supabase.table("course_images").select(
        "canvas_file_id, review_action"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "canvas_file_id", list(file_items.keys())
    ).execute()
    actions_by_file_id: dict[str, list[str]] = {}
    for row in image_result.data or []:
        file_id = str(row.get("canvas_file_id") or "")
        if file_id:
            actions_by_file_id.setdefault(file_id, []).append(str(row.get("review_action") or "keep"))

    now = _now_iso()
    desired_rows: list[dict[str, str]] = []
    for canvas_file_id, file_item in file_items.items():
        content_item_id = file_item["id"]
        action = _aggregate_image_actions(actions_by_file_id.get(canvas_file_id, []))
        reason = (
            "All image occurrences for this Canvas file are marked remove"
            if action == "delete"
            else "Synced from image inventory review state"
        )
        desired_rows.append({
            "content_item_id": content_item_id,
            "action": action,
            "reason": reason,
        })

    content_item_ids = [row["content_item_id"] for row in desired_rows]
    existing = supabase.table("content_inventory_decisions").select(
        "id, content_item_id"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", content_item_ids
    ).execute()
    existing_by_item_id = {
        row["content_item_id"]: row
        for row in existing.data or []
        if row.get("id") and row.get("content_item_id")
    }

    update_groups: dict[tuple[str, str], list[str]] = {}
    inserts: list[dict[str, Any]] = []
    for row in desired_rows:
        existing_decision = existing_by_item_id.get(row["content_item_id"])
        if existing_decision:
            update_groups.setdefault((row["action"], row["reason"]), []).append(existing_decision["id"])
        else:
            inserts.append({
                **row,
                "session_id": session_id,
                "user_id": user_id,
                "updated_at": now,
            })

    for (action, reason), decision_ids in update_groups.items():
        supabase.table("content_inventory_decisions").update({
            "action": action,
            "reason": reason,
            "updated_at": now,
        }).in_("id", decision_ids).execute()

    if inserts:
        supabase.table("content_inventory_decisions").insert(inserts).execute()

    return {
        "updated_file_decision_count": len(content_item_ids),
        "content_item_ids": content_item_ids,
    }
