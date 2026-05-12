"""Read models for Pending Review push and module apply history."""

from typing import Any


def list_content_push_history(
    supabase,
    *,
    session_id: str,
    user_id: str,
    limit: int,
) -> dict[str, list[dict[str, Any]]]:
    result = supabase.table("platform_events").select(
        "id, event_type, properties, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "event_type", "content_pushed"
    ).order("created_at", desc=True).limit(limit).execute()

    items = []
    for row in result.data or []:
        properties = row.get("properties") if isinstance(row.get("properties"), dict) else {}
        items.append({
            "id": row.get("id"),
            "event_type": row.get("event_type"),
            "created_at": row.get("created_at"),
            "batch_id": properties.get("batch_id"),
            "content_item_id": properties.get("content_item_id"),
            "canvas_id": properties.get("canvas_id"),
            "canvas_response_id": properties.get("canvas_response_id"),
            "content_type": properties.get("content_type"),
            "title": properties.get("title"),
            "canvas_url": properties.get("canvas_url"),
            "published": properties.get("published"),
            "revision_count": properties.get("revision_count") or 0,
            "first_revision_number": properties.get("first_revision_number"),
            "latest_revision_number": properties.get("latest_revision_number"),
            "first_changed_at": properties.get("first_changed_at"),
            "latest_changed_at": properties.get("latest_changed_at"),
            "latest_change_summary": properties.get("latest_change_summary"),
            "change_summaries": properties.get("change_summaries") if isinstance(properties.get("change_summaries"), list) else [],
        })

    return {"items": items}


def list_module_apply_history(
    supabase,
    *,
    session_id: str,
    user_id: str,
    limit: int,
) -> dict[str, list[dict[str, Any]]]:
    result = supabase.table("platform_events").select(
        "id, event_type, properties, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "event_type", "module_operations_applied"
    ).order("created_at", desc=True).limit(limit).execute()

    items = []
    for row in result.data or []:
        properties = row.get("properties") if isinstance(row.get("properties"), dict) else {}
        operations = properties.get("operations") if isinstance(properties.get("operations"), list) else []
        failed = properties.get("failed") if isinstance(properties.get("failed"), list) else []
        items.append({
            "id": row.get("id"),
            "event_type": row.get("event_type"),
            "created_at": row.get("created_at"),
            "applied_count": properties.get("applied_count") or len(operations),
            "failed_count": properties.get("failed_count") or len(failed),
            "operation_ids": properties.get("operation_ids") or [
                operation.get("id") for operation in operations if isinstance(operation, dict) and operation.get("id")
            ],
            "operations": operations,
            "failed": failed,
        })

    return {"items": items}
