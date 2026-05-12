"""Pending Review module operation staging and discard services."""

from datetime import datetime, timezone
from functools import cmp_to_key
from typing import Any

import httpx
from fastapi import HTTPException

from api.pending_review.schemas import ModuleLevelOperationRequest, ModuleOperationRequest
from canvas_sync import CanvasClient, clean_metadata, get_active_pat
from content_inventory import compact_whitespace


def module_operation_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "change_type": "module_operation",
        "review_status": "staged module change",
        "operation_type": row.get("operation_type"),
        "target_type": row.get("target_type"),
        "module_id": row.get("module_id"),
        "module_item_id": row.get("module_item_id"),
        "content_item_id": row.get("content_item_id"),
        "canvas_module_id": row.get("canvas_module_id"),
        "canvas_module_item_id": row.get("canvas_module_item_id"),
        "title": row.get("title"),
        "action_label": row.get("action_label"),
        "detail": row.get("detail"),
        "before_state": row.get("before_state") or {},
        "after_state": row.get("after_state") or {},
        "status": row.get("status"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_staged_module_operations(supabase, *, session_id: str, user_id: str) -> dict[str, list[dict[str, Any]]]:
    result = supabase.table("module_queue_operations").select("*").eq(
        "session_id", session_id
    ).eq("user_id", user_id).eq("status", "staged").order(
        "updated_at", desc=True
    ).execute()
    return {"items": [module_operation_response(row) for row in result.data or []]}


def discard_local_module_create_operation(supabase, *, session_id: str, user_id: str, operation: dict[str, Any]):
    if operation.get("operation_type") != "module_create" or not operation.get("module_id"):
        return
    module_id = operation["module_id"]
    module_result = supabase.table("course_modules").select(
        "id, canvas_module_id"
    ).eq("id", module_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not module_result.data:
        return
    module = module_result.data[0]
    if not str(module.get("canvas_module_id") or "").startswith("local:"):
        return

    module_items_result = supabase.table("course_module_items").select(
        "content_item_id"
    ).eq("module_id", module_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).execute()
    content_item_ids = [
        row.get("content_item_id")
        for row in module_items_result.data or []
        if row.get("content_item_id")
    ]
    if content_item_ids:
        item_result = supabase.table("course_content_items").select(
            "id, metadata"
        ).eq("session_id", session_id).eq("user_id", user_id).in_(
            "id", content_item_ids
        ).execute()
        now = datetime.now(timezone.utc).isoformat()
        for item in item_result.data or []:
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            next_metadata = {**metadata}
            for key in ("desired_module_id", "desired_canvas_module_id", "desired_module_name"):
                next_metadata.pop(key, None)
            supabase.table("course_content_items").update({
                "module_canvas_id": None,
                "module_name": None,
                "is_orphaned": True,
                "metadata": next_metadata,
                "updated_at": now,
            }).eq("id", item["id"]).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()

    supabase.table("course_modules").delete().eq("id", module_id).eq(
        "session_id", session_id
    ).eq("user_id", user_id).execute()


def _module_apply_failure(
    operation: dict[str, Any],
    error: str,
    *,
    include_operation_type: bool = True,
) -> dict[str, Any]:
    failure = {
        "id": operation.get("id"),
        "title": operation.get("title"),
        "error": error,
    }
    if include_operation_type:
        failure["operation_type"] = operation.get("operation_type")
    return failure


def apply_module_item_canvas_operation(
    supabase,
    client,
    *,
    session_id: str,
    user_id: str,
    canvas_course_id: str,
    operation: dict[str, Any],
    now: str,
) -> dict[str, Any]:
    """Apply a single non-reorder module item operation to Canvas and local rows."""
    module_id = operation.get("canvas_module_id")
    module_item_id = operation.get("canvas_module_item_id")
    if not module_id or not module_item_id:
        return {
            "applied": None,
            "failed": _module_apply_failure(
                operation,
                "Module operation is missing Canvas IDs",
                include_operation_type=False,
            ),
        }

    after_state = operation.get("after_state") if isinstance(operation.get("after_state"), dict) else {}
    payload: dict[str, Any] = {}
    local_updates: dict[str, Any] = {"updated_at": now}

    if operation.get("operation_type") == "item_publish":
        if "published" not in after_state:
            return {
                "applied": None,
                "failed": _module_apply_failure(operation, "Published state is missing", include_operation_type=False),
            }
        next_published = bool(after_state["published"])
        payload["module_item[published]"] = str(next_published).lower()
        local_updates["published"] = next_published
    elif operation.get("operation_type") == "item_indent":
        if "indent" not in after_state:
            return {
                "applied": None,
                "failed": _module_apply_failure(operation, "Indent state is missing", include_operation_type=False),
            }
        next_indent = max(0, min(5, int(after_state["indent"])))
        payload["module_item[indent]"] = next_indent
        local_updates["indent"] = next_indent
    elif operation.get("operation_type") == "item_rename":
        title_value = after_state.get("title")
        if not isinstance(title_value, str) or not title_value.strip():
            return {
                "applied": None,
                "failed": _module_apply_failure(operation, "Title state is missing", include_operation_type=False),
            }
        next_title = compact_whitespace(title_value)
        payload["module_item[title]"] = next_title
        local_updates["title"] = next_title
    elif operation.get("operation_type") == "item_move":
        target_module_id = after_state.get("module_id")
        target_canvas_module_id = after_state.get("canvas_module_id")
        if not target_module_id or not target_canvas_module_id:
            return {
                "applied": None,
                "failed": _module_apply_failure(operation, "Target module is missing", include_operation_type=False),
            }
        if "position" not in after_state:
            return {
                "applied": None,
                "failed": _module_apply_failure(operation, "Position state is missing", include_operation_type=False),
            }
        next_position = max(1, int(after_state["position"]))
        payload["module_item[module_id]"] = target_canvas_module_id
        payload["module_item[position]"] = next_position
        local_updates["module_id"] = target_module_id
        local_updates["canvas_module_id"] = target_canvas_module_id
        local_updates["position"] = next_position
    elif operation.get("operation_type") == "item_remove":
        local_updates["removed"] = True
    else:
        return {
            "applied": None,
            "failed": _module_apply_failure(operation, "Unsupported module operation", include_operation_type=False),
        }

    try:
        operation_status_updated = False
        if operation.get("operation_type") == "item_remove":
            canvas_response = client.delete(
                f"/courses/{canvas_course_id}/modules/{module_id}/items/{module_item_id}"
            )
            supabase.table("module_queue_operations").update({
                "module_item_id": None,
                "status": "applied",
                "updated_at": now,
            }).eq("id", operation.get("id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            operation_status_updated = True
            supabase.table("course_module_items").delete().eq(
                "id", operation.get("module_item_id")
            ).eq("session_id", session_id).eq("user_id", user_id).execute()
            remaining_items_result = supabase.table("course_module_items").select(
                "id, position, title"
            ).eq("session_id", session_id).eq("user_id", user_id).eq(
                "canvas_module_id", module_id
            ).execute()
            remaining_items = sorted(
                remaining_items_result.data or [],
                key=lambda row: (row.get("position") or 999_999, row.get("title") or ""),
            )
            for index, item in enumerate(remaining_items):
                supabase.table("course_module_items").update({
                    "position": index + 1,
                    "updated_at": now,
                }).eq("id", item.get("id")).eq("session_id", session_id).eq(
                    "user_id", user_id
                ).execute()
        else:
            canvas_response = client.put_form(
                f"/courses/{canvas_course_id}/modules/{module_id}/items/{module_item_id}",
                payload,
            )
            supabase.table("course_module_items").update(local_updates).eq(
                "id", operation.get("module_item_id")
            ).eq("session_id", session_id).eq("user_id", user_id).execute()

        if not operation_status_updated:
            supabase.table("module_queue_operations").update({
                "status": "applied",
                "updated_at": now,
            }).eq("id", operation.get("id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()

        return {
            "applied": {
                "id": operation.get("id"),
                "module_item_id": operation.get("module_item_id"),
                "title": operation.get("title"),
                "operation_type": operation.get("operation_type"),
                "after_state": after_state,
                "canvas_response_id": canvas_response.get("id"),
            },
            "failed": None,
        }
    except httpx.HTTPStatusError as exc:
        return {
            "applied": None,
            "failed": _module_apply_failure(
                operation,
                f"Canvas returned HTTP {exc.response.status_code}",
            ),
        }
    except httpx.HTTPError as exc:
        return {
            "applied": None,
            "failed": _module_apply_failure(operation, f"Canvas apply failed: {exc}"),
        }


def apply_module_item_position_operations(
    supabase,
    client,
    *,
    session_id: str,
    user_id: str,
    canvas_course_id: str,
    position_operations: list[dict[str, Any]],
    now: str,
) -> dict[str, list[dict[str, Any]]]:
    applied: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    position_operations_by_module: dict[str, list[dict[str, Any]]] = {}

    for operation in position_operations:
        module_id = operation.get("canvas_module_id")
        module_item_id = operation.get("canvas_module_item_id")
        after_state = operation.get("after_state") if isinstance(operation.get("after_state"), dict) else {}
        if not module_id or not module_item_id:
            failed.append(_module_apply_failure(operation, "Module operation is missing Canvas IDs"))
            continue
        if "position" not in after_state:
            failed.append(_module_apply_failure(operation, "Position state is missing"))
            continue
        position_operations_by_module.setdefault(module_id, []).append(operation)

    if not position_operations_by_module:
        return {"applied": applied, "failed": failed}

    module_ids = list(position_operations_by_module)
    module_items_result = supabase.table("course_module_items").select(
        "id, canvas_module_id, canvas_module_item_id, title, position"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "canvas_module_id", module_ids
    ).execute()
    items_by_module: dict[str, list[dict[str, Any]]] = {}
    for item in module_items_result.data or []:
        items_by_module.setdefault(item.get("canvas_module_id"), []).append(item)

    for module_id, module_operations in position_operations_by_module.items():
        operations_by_item_id = {
            operation.get("module_item_id"): operation
            for operation in module_operations
            if operation.get("module_item_id")
        }
        module_items = sorted(
            items_by_module.get(module_id, []),
            key=lambda row: (row.get("position") or 999_999, row.get("title") or ""),
        )

        def effective_position(row: dict[str, Any]) -> int:
            operation = operations_by_item_id.get(row.get("id"))
            after_state = operation.get("after_state") if operation and isinstance(operation.get("after_state"), dict) else {}
            return int(after_state.get("position", row.get("position") or 999_999))

        def compare_effective_position(a: dict[str, Any], b: dict[str, Any]) -> int:
            a_position = effective_position(a)
            b_position = effective_position(b)
            if a_position != b_position:
                return a_position - b_position

            a_operation = operations_by_item_id.get(a.get("id"))
            b_operation = operations_by_item_id.get(b.get("id"))
            if a_operation and not b_operation:
                before_state = a_operation.get("before_state") if isinstance(a_operation.get("before_state"), dict) else {}
                before_position = int(before_state.get("position", a.get("position") or a_position))
                return 1 if a_position > before_position else -1
            if not a_operation and b_operation:
                before_state = b_operation.get("before_state") if isinstance(b_operation.get("before_state"), dict) else {}
                before_position = int(before_state.get("position", b.get("position") or b_position))
                return -1 if b_position > before_position else 1

            a_title = (a.get("title") or "").lower()
            b_title = (b.get("title") or "").lower()
            if a_title == b_title:
                return 0
            return -1 if a_title < b_title else 1

        desired_items = sorted(module_items, key=cmp_to_key(compare_effective_position))
        current_item_ids = [item.get("id") for item in module_items]
        desired_item_ids = [item.get("id") for item in desired_items]
        item_by_id = {item.get("id"): item for item in module_items}
        module_failed = False

        for index, desired_item_id in enumerate(desired_item_ids):
            if index < len(current_item_ids) and current_item_ids[index] == desired_item_id:
                continue
            desired_item = item_by_id.get(desired_item_id)
            if not desired_item or not desired_item.get("canvas_module_item_id"):
                continue
            try:
                client.put_form(
                    f"/courses/{canvas_course_id}/modules/{module_id}/items/{desired_item['canvas_module_item_id']}",
                    {"module_item[position]": index + 1},
                )
                current_item_ids.remove(desired_item_id)
                current_item_ids.insert(index, desired_item_id)
            except httpx.HTTPStatusError as exc:
                module_failed = True
                impacted_operations = [
                    operation for operation in module_operations
                    if operation.get("module_item_id") == desired_item_id
                ] or module_operations
                for operation in impacted_operations:
                    failed.append(_module_apply_failure(operation, f"Canvas returned HTTP {exc.response.status_code}"))
                break
            except httpx.HTTPError as exc:
                module_failed = True
                impacted_operations = [
                    operation for operation in module_operations
                    if operation.get("module_item_id") == desired_item_id
                ] or module_operations
                for operation in impacted_operations:
                    failed.append(_module_apply_failure(operation, f"Canvas apply failed: {exc}"))
                break

        if module_failed:
            continue

        final_positions = {
            module_item_id: index + 1
            for index, module_item_id in enumerate(current_item_ids)
            if module_item_id
        }
        for module_item_id, final_position in final_positions.items():
            supabase.table("course_module_items").update({
                "position": final_position,
                "updated_at": now,
            }).eq("id", module_item_id).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()

        for operation in module_operations:
            after_state = operation.get("after_state") if isinstance(operation.get("after_state"), dict) else {}
            supabase.table("module_queue_operations").update({
                "status": "applied",
                "updated_at": now,
            }).eq("id", operation.get("id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            applied.append({
                "id": operation.get("id"),
                "module_item_id": operation.get("module_item_id"),
                "title": operation.get("title"),
                "operation_type": operation.get("operation_type"),
                "after_state": {
                    **after_state,
                    "position": final_positions.get(operation.get("module_item_id"), after_state.get("position")),
                },
                "canvas_response_id": operation.get("canvas_module_item_id"),
            })

    return {"applied": applied, "failed": failed}


def apply_module_rename_operations(
    supabase,
    client,
    *,
    session_id: str,
    user_id: str,
    canvas_course_id: str,
    module_rename_operations: list[dict[str, Any]],
    now: str,
) -> dict[str, list[dict[str, Any]]]:
    applied: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for operation in module_rename_operations:
        module_id = operation.get("canvas_module_id")
        after_state = operation.get("after_state") if isinstance(operation.get("after_state"), dict) else {}
        name_value = after_state.get("name")
        if not module_id:
            failed.append(_module_apply_failure(operation, "Module operation is missing Canvas ID"))
            continue
        if not isinstance(name_value, str) or not name_value.strip():
            failed.append(_module_apply_failure(operation, "Module name state is missing"))
            continue

        next_name = compact_whitespace(name_value)
        try:
            canvas_response = client.put_form(
                f"/courses/{canvas_course_id}/modules/{module_id}",
                {"module[name]": next_name},
            )
            supabase.table("course_modules").update({
                "name": next_name,
                "updated_at": now,
            }).eq("id", operation.get("module_id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            supabase.table("module_queue_operations").update({
                "status": "applied",
                "updated_at": now,
            }).eq("id", operation.get("id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            applied.append({
                "id": operation.get("id"),
                "module_id": operation.get("module_id"),
                "title": operation.get("title"),
                "operation_type": operation.get("operation_type"),
                "after_state": {"name": next_name},
                "canvas_response_id": canvas_response.get("id"),
            })
        except httpx.HTTPStatusError as exc:
            failed.append(_module_apply_failure(operation, f"Canvas returned HTTP {exc.response.status_code}"))
        except httpx.HTTPError as exc:
            failed.append(_module_apply_failure(operation, f"Canvas apply failed: {exc}"))

    return {"applied": applied, "failed": failed}


def apply_module_delete_operations(
    supabase,
    client,
    *,
    session_id: str,
    user_id: str,
    canvas_course_id: str,
    module_delete_operations: list[dict[str, Any]],
    now: str,
) -> dict[str, list[dict[str, Any]]]:
    applied: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for operation in module_delete_operations:
        module_id = operation.get("canvas_module_id")
        local_module_id = operation.get("module_id")
        if not module_id or not local_module_id:
            failed.append(_module_apply_failure(operation, "Module operation is missing Canvas ID"))
            continue

        try:
            canvas_response = client.delete(
                f"/courses/{canvas_course_id}/modules/{module_id}"
            )
            supabase.table("module_queue_operations").update({
                "module_id": None,
                "status": "applied",
                "updated_at": now,
            }).eq("id", operation.get("id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            supabase.table("course_module_items").delete().eq(
                "module_id", local_module_id
            ).eq("session_id", session_id).eq("user_id", user_id).execute()
            supabase.table("course_modules").delete().eq(
                "id", local_module_id
            ).eq("session_id", session_id).eq("user_id", user_id).execute()
            applied.append({
                "id": operation.get("id"),
                "module_id": local_module_id,
                "title": operation.get("title"),
                "operation_type": operation.get("operation_type"),
                "after_state": {"deleted": True},
                "canvas_response_id": canvas_response.get("id"),
            })
        except httpx.HTTPStatusError as exc:
            failed.append(_module_apply_failure(operation, f"Canvas returned HTTP {exc.response.status_code}"))
        except httpx.HTTPError as exc:
            failed.append(_module_apply_failure(operation, f"Canvas apply failed: {exc}"))

    return {"applied": applied, "failed": failed}


def apply_module_create_operations(
    supabase,
    client,
    *,
    session_id: str,
    user_id: str,
    canvas_course_id: str,
    module_create_operations: list[dict[str, Any]],
    operations: list[dict[str, Any]],
    now: str,
) -> dict[str, list[dict[str, Any]]]:
    applied: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for operation in module_create_operations:
        local_module_id = operation.get("module_id")
        after_state = operation.get("after_state") if isinstance(operation.get("after_state"), dict) else {}
        name_value = after_state.get("name") or operation.get("title")
        if not local_module_id:
            failed.append(_module_apply_failure(operation, "Module operation is missing local module ID"))
            continue
        if not isinstance(name_value, str) or not name_value.strip():
            failed.append(_module_apply_failure(operation, "Module name state is missing"))
            continue

        module_result = supabase.table("course_modules").select(
            "id, canvas_module_id, metadata"
        ).eq("id", local_module_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).limit(1).execute()
        if not module_result.data:
            failed.append(_module_apply_failure(operation, "Local module was not found"))
            continue
        local_module = module_result.data[0]
        current_canvas_module_id = str(local_module.get("canvas_module_id") or "")
        if current_canvas_module_id and not current_canvas_module_id.startswith("local:"):
            supabase.table("module_queue_operations").update({
                "status": "applied",
                "updated_at": now,
            }).eq("id", operation.get("id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            continue

        next_name = compact_whitespace(name_value)
        payload: dict[str, Any] = {"module[name]": next_name}
        if after_state.get("position") is not None:
            payload["module[position]"] = max(1, int(after_state.get("position") or 1))

        try:
            canvas_response = client.post_form(
                f"/courses/{canvas_course_id}/modules",
                payload,
            )
            canvas_module_id = str(canvas_response.get("id")) if canvas_response.get("id") is not None else None
            if not canvas_module_id:
                raise HTTPException(status_code=502, detail="Canvas did not return a module id")
            metadata = local_module.get("metadata") if isinstance(local_module.get("metadata"), dict) else {}
            next_metadata = {
                **metadata,
                "created_in_v2": True,
                "canvas_module_id": canvas_module_id,
            }
            next_metadata.pop("is_new_local", None)
            next_metadata.pop("pending_canvas_push", None)
            supabase.table("course_modules").update({
                "canvas_module_id": canvas_module_id,
                "name": canvas_response.get("name") or next_name,
                "position": canvas_response.get("position") or after_state.get("position"),
                "published": canvas_response.get("published") if canvas_response.get("published") is not None else after_state.get("published"),
                "workflow_state": canvas_response.get("workflow_state"),
                "items_count": canvas_response.get("items_count") or 0,
                "metadata": clean_metadata(next_metadata),
                "updated_at": now,
            }).eq("id", local_module_id).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            supabase.table("course_module_items").update({
                "canvas_module_id": canvas_module_id,
                "updated_at": now,
            }).eq("module_id", local_module_id).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            supabase.table("module_queue_operations").update({
                "canvas_module_id": canvas_module_id,
                "status": "applied",
                "updated_at": now,
            }).eq("id", operation.get("id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()
            supabase.table("module_queue_operations").update({
                "canvas_module_id": canvas_module_id,
                "updated_at": now,
            }).eq("module_id", local_module_id).eq("session_id", session_id).eq(
                "user_id", user_id
            ).neq("id", operation.get("id")).execute()
            for queued_operation in operations:
                if queued_operation.get("module_id") == local_module_id:
                    queued_operation["canvas_module_id"] = canvas_module_id
            applied.append({
                "id": operation.get("id"),
                "module_id": local_module_id,
                "title": operation.get("title"),
                "operation_type": operation.get("operation_type"),
                "after_state": {
                    **after_state,
                    "canvas_module_id": canvas_module_id,
                },
                "canvas_response_id": canvas_module_id,
            })
        except HTTPException as exc:
            failed.append(_module_apply_failure(operation, str(exc.detail)))
        except httpx.HTTPStatusError as exc:
            failed.append(_module_apply_failure(operation, f"Canvas returned HTTP {exc.response.status_code}"))
        except httpx.HTTPError as exc:
            failed.append(_module_apply_failure(operation, f"Canvas apply failed: {exc}"))

    return {"applied": applied, "failed": failed}


def apply_module_position_operations(
    supabase,
    client,
    *,
    session_id: str,
    user_id: str,
    canvas_course_id: str,
    module_position_operations: list[dict[str, Any]],
    module_delete_operations: list[dict[str, Any]],
    now: str,
) -> dict[str, list[dict[str, Any]]]:
    applied: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    if module_position_operations:
        module_result = supabase.table("course_modules").select(
            "id, canvas_module_id, name, position"
        ).eq("session_id", session_id).eq("user_id", user_id).execute()
        modules_by_id = {module.get("id"): module for module in module_result.data or []}
        operations_by_module_id = {
            operation.get("module_id"): operation
            for operation in module_position_operations
            if operation.get("module_id")
        }
        modules_ordered = sorted(
            module_result.data or [],
            key=lambda row: (row.get("position") or 999_999, row.get("name") or ""),
        )

        def effective_module_position(row: dict[str, Any]) -> int:
            operation = operations_by_module_id.get(row.get("id"))
            after_state = operation.get("after_state") if operation and isinstance(operation.get("after_state"), dict) else {}
            return int(after_state.get("position", row.get("position") or 999_999))

        def compare_effective_module_position(a: dict[str, Any], b: dict[str, Any]) -> int:
            a_position = effective_module_position(a)
            b_position = effective_module_position(b)
            if a_position != b_position:
                return a_position - b_position

            a_operation = operations_by_module_id.get(a.get("id"))
            b_operation = operations_by_module_id.get(b.get("id"))
            if a_operation and not b_operation:
                before_state = a_operation.get("before_state") if isinstance(a_operation.get("before_state"), dict) else {}
                before_position = int(before_state.get("position", a.get("position") or a_position))
                return 1 if a_position > before_position else -1
            if not a_operation and b_operation:
                before_state = b_operation.get("before_state") if isinstance(b_operation.get("before_state"), dict) else {}
                before_position = int(before_state.get("position", b.get("position") or b_position))
                return -1 if b_position > before_position else 1

            a_name = (a.get("name") or "").lower()
            b_name = (b.get("name") or "").lower()
            if a_name == b_name:
                return 0
            return -1 if a_name < b_name else 1

        desired_modules = sorted(
            modules_ordered,
            key=cmp_to_key(compare_effective_module_position),
        )
        current_module_ids = [module.get("id") for module in modules_ordered]
        desired_module_ids = [module.get("id") for module in desired_modules]

        for index, desired_module_id in enumerate(desired_module_ids):
            if index < len(current_module_ids) and current_module_ids[index] == desired_module_id:
                continue
            module = modules_by_id.get(desired_module_id)
            operation = operations_by_module_id.get(desired_module_id)
            if not module or not operation or not module.get("canvas_module_id"):
                continue
            after_state = operation.get("after_state") if isinstance(operation.get("after_state"), dict) else {}
            try:
                canvas_response = client.put_form(
                    f"/courses/{canvas_course_id}/modules/{module['canvas_module_id']}",
                    {"module[position]": index + 1},
                )
                current_module_ids.remove(desired_module_id)
                current_module_ids.insert(index, desired_module_id)
                supabase.table("module_queue_operations").update({
                    "status": "applied",
                    "updated_at": now,
                }).eq("id", operation.get("id")).eq("session_id", session_id).eq(
                    "user_id", user_id
                ).execute()
                applied.append({
                    "id": operation.get("id"),
                    "module_id": operation.get("module_id"),
                    "title": operation.get("title"),
                    "operation_type": operation.get("operation_type"),
                    "after_state": after_state,
                    "canvas_response_id": canvas_response.get("id"),
                })
            except httpx.HTTPStatusError as exc:
                failed.append(_module_apply_failure(operation, f"Canvas returned HTTP {exc.response.status_code}"))
                break
            except httpx.HTTPError as exc:
                failed.append(_module_apply_failure(operation, f"Canvas apply failed: {exc}"))
                break

        for index, module_id in enumerate(current_module_ids):
            if module_id:
                supabase.table("course_modules").update({
                    "position": index + 1,
                    "updated_at": now,
                }).eq("id", module_id).eq("session_id", session_id).eq(
                    "user_id", user_id
                ).execute()
    elif module_delete_operations:
        remaining_modules_result = supabase.table("course_modules").select(
            "id, name, position"
        ).eq("session_id", session_id).eq("user_id", user_id).execute()
        remaining_modules = sorted(
            remaining_modules_result.data or [],
            key=lambda row: (row.get("position") or 999_999, row.get("name") or ""),
        )
        for index, module in enumerate(remaining_modules):
            supabase.table("course_modules").update({
                "position": index + 1,
                "updated_at": now,
            }).eq("id", module.get("id")).eq("session_id", session_id).eq(
                "user_id", user_id
            ).execute()

    return {"applied": applied, "failed": failed}


def _write_module_operations_applied_event(
    supabase,
    *,
    session_id: str,
    user_id: str,
    applied: list[dict[str, Any]],
    failed: list[dict[str, Any]],
    now: str,
) -> None:
    supabase.table("platform_events").insert({
        "user_id": user_id,
        "session_id": session_id,
        "event_type": "module_operations_applied",
        "properties": {
            "applied_count": len(applied),
            "failed_count": len(failed),
            "operation_ids": [row["id"] for row in applied],
            "operations": applied,
            "failed": failed,
            "applied_at": now,
        },
    }).execute()


def apply_staged_module_operations_to_canvas(
    supabase,
    *,
    session_id: str,
    user_id: str,
    canvas_base_url: str,
    canvas_course_id: str,
    operation_ids: list[str] | None = None,
) -> dict[str, Any]:
    query = supabase.table("module_queue_operations").select("*").eq(
        "session_id", session_id
    ).eq("user_id", user_id).eq("status", "staged").order("created_at", desc=False)
    if operation_ids:
        query = query.in_("id", operation_ids)
    result = query.execute()
    operations = result.data or []

    token = get_active_pat(supabase, user_id, canvas_base_url)
    client = CanvasClient(canvas_base_url, token)
    applied: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc).isoformat()

    try:
        position_operations = [
            operation for operation in operations
            if operation.get("operation_type") == "item_position"
        ]
        module_position_operations = [
            operation for operation in operations
            if operation.get("operation_type") == "module_position"
        ]
        module_create_operations = [
            operation for operation in operations
            if operation.get("operation_type") == "module_create"
        ]
        module_rename_operations = [
            operation for operation in operations
            if operation.get("operation_type") == "module_rename"
        ]
        module_delete_operations = [
            operation for operation in operations
            if operation.get("operation_type") == "module_delete"
        ]
        position_operation_ids = {
            operation.get("id") for operation in position_operations if operation.get("id")
        }
        module_position_operation_ids = {
            operation.get("id") for operation in module_position_operations if operation.get("id")
        }
        module_create_operation_ids = {
            operation.get("id") for operation in module_create_operations if operation.get("id")
        }
        module_rename_operation_ids = {
            operation.get("id") for operation in module_rename_operations if operation.get("id")
        }
        module_delete_operation_ids = {
            operation.get("id") for operation in module_delete_operations if operation.get("id")
        }

        for operation in operations:
            if (
                operation.get("id") in position_operation_ids
                or operation.get("id") in module_position_operation_ids
                or operation.get("id") in module_create_operation_ids
                or operation.get("id") in module_rename_operation_ids
                or operation.get("id") in module_delete_operation_ids
            ):
                continue

            item_result = apply_module_item_canvas_operation(
                supabase,
                client,
                session_id=session_id,
                user_id=user_id,
                canvas_course_id=canvas_course_id,
                operation=operation,
                now=now,
            )
            if item_result["applied"]:
                applied.append(item_result["applied"])
            if item_result["failed"]:
                failed.append(item_result["failed"])

        position_result = apply_module_item_position_operations(
            supabase,
            client,
            session_id=session_id,
            user_id=user_id,
            canvas_course_id=canvas_course_id,
            position_operations=position_operations,
            now=now,
        )
        applied.extend(position_result["applied"])
        failed.extend(position_result["failed"])

        create_result = apply_module_create_operations(
            supabase,
            client,
            session_id=session_id,
            user_id=user_id,
            canvas_course_id=canvas_course_id,
            module_create_operations=module_create_operations,
            operations=operations,
            now=now,
        )
        applied.extend(create_result["applied"])
        failed.extend(create_result["failed"])

        rename_result = apply_module_rename_operations(
            supabase,
            client,
            session_id=session_id,
            user_id=user_id,
            canvas_course_id=canvas_course_id,
            module_rename_operations=module_rename_operations,
            now=now,
        )
        applied.extend(rename_result["applied"])
        failed.extend(rename_result["failed"])

        delete_result = apply_module_delete_operations(
            supabase,
            client,
            session_id=session_id,
            user_id=user_id,
            canvas_course_id=canvas_course_id,
            module_delete_operations=module_delete_operations,
            now=now,
        )
        applied.extend(delete_result["applied"])
        failed.extend(delete_result["failed"])

        module_position_result = apply_module_position_operations(
            supabase,
            client,
            session_id=session_id,
            user_id=user_id,
            canvas_course_id=canvas_course_id,
            module_position_operations=module_position_operations,
            module_delete_operations=module_delete_operations,
            now=now,
        )
        applied.extend(module_position_result["applied"])
        failed.extend(module_position_result["failed"])
    finally:
        client.close()

    if applied:
        _write_module_operations_applied_event(
            supabase,
            session_id=session_id,
            user_id=user_id,
            applied=applied,
            failed=failed,
            now=now,
        )

    return {
        "applied": applied,
        "failed": failed,
        "counts": {
            "applied": len(applied),
            "failed": len(failed),
            "total": len(operations),
        },
    }


def _operation_base_values(
    *,
    session_id: str,
    user_id: str,
    operation_key: str,
    operation_type: str,
    target_type: str,
    title: str | None,
    action_label: str,
    detail: str,
    before_state: dict[str, Any],
    after_state: dict[str, Any],
    now: str,
    module_id: str | None = None,
    module_item_id: str | None = None,
    content_item_id: str | None = None,
    canvas_module_id: str | None = None,
    canvas_module_item_id: str | None = None,
) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "user_id": user_id,
        "operation_key": operation_key,
        "operation_type": operation_type,
        "target_type": target_type,
        "module_id": module_id,
        "module_item_id": module_item_id,
        "content_item_id": content_item_id,
        "canvas_module_id": canvas_module_id,
        "canvas_module_item_id": canvas_module_item_id,
        "title": title,
        "action_label": action_label,
        "detail": detail,
        "before_state": before_state,
        "after_state": after_state,
        "status": "staged",
        "updated_at": now,
    }


def _upsert_operation(supabase, values: dict[str, Any]) -> dict[str, Any]:
    existing = supabase.table("module_queue_operations").select("id").eq(
        "session_id", values["session_id"]
    ).eq("user_id", values["user_id"]).eq("operation_key", values["operation_key"]).limit(1).execute()
    if existing.data:
        result = supabase.table("module_queue_operations").update(values).eq(
            "id", existing.data[0]["id"]
        ).execute()
    else:
        values = {**values, "created_at": values["updated_at"]}
        result = supabase.table("module_queue_operations").insert(values).execute()
    row = result.data[0] if result.data else values
    return {"staged": True, "operation": module_operation_response(row)}


def _clear_operation(supabase, *, session_id: str, user_id: str, operation_key: str) -> dict[str, Any]:
    supabase.table("module_queue_operations").delete().eq(
        "session_id", session_id
    ).eq("user_id", user_id).eq("operation_key", operation_key).execute()
    return {"staged": False, "operation": None}


def stage_module_item_operation(
    supabase,
    *,
    session_id: str,
    user_id: str,
    body: ModuleOperationRequest,
) -> dict[str, Any]:
    module_item_result = supabase.table("course_module_items").select(
        "id, module_id, content_item_id, canvas_module_id, canvas_module_item_id, "
        "title, module_item_type, content_type, published, indent, position"
    ).eq("id", body.module_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not module_item_result.data:
        raise HTTPException(status_code=404, detail="Module item not found")

    module_item = module_item_result.data[0]
    now = datetime.now(timezone.utc).isoformat()
    item_title = module_item.get("title") or "Untitled item"

    if body.operation_type == "item_publish":
        if "published" not in body.after_state or not isinstance(body.after_state.get("published"), bool):
            raise HTTPException(status_code=422, detail="after_state.published must be a boolean")
        next_published = bool(body.after_state["published"])
        current_published = bool(module_item.get("published"))
        operation_key = f"item_publish:{module_item['id']}"
        if next_published == current_published:
            return _clear_operation(supabase, session_id=session_id, user_id=user_id, operation_key=operation_key)
        return _upsert_operation(supabase, _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module_item",
            module_id=module_item.get("module_id"),
            module_item_id=module_item.get("id"),
            content_item_id=module_item.get("content_item_id"),
            canvas_module_id=module_item.get("canvas_module_id"),
            canvas_module_item_id=module_item.get("canvas_module_item_id"),
            title=module_item.get("title"),
            action_label="Publish Item" if next_published else "Unpublish Item",
            detail=f"{item_title}: {'published' if current_published else 'unpublished'} -> {'published' if next_published else 'unpublished'}",
            before_state={"published": current_published},
            after_state={"published": next_published},
            now=now,
        ))

    if body.operation_type == "item_indent":
        indent_value = body.after_state.get("indent")
        if not isinstance(indent_value, int):
            raise HTTPException(status_code=422, detail="after_state.indent must be an integer")
        next_indent = max(0, min(5, indent_value))
        current_indent = int(module_item.get("indent") or 0)
        operation_key = f"item_indent:{module_item['id']}"
        if next_indent == current_indent:
            return _clear_operation(supabase, session_id=session_id, user_id=user_id, operation_key=operation_key)
        return _upsert_operation(supabase, _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module_item",
            module_id=module_item.get("module_id"),
            module_item_id=module_item.get("id"),
            content_item_id=module_item.get("content_item_id"),
            canvas_module_id=module_item.get("canvas_module_id"),
            canvas_module_item_id=module_item.get("canvas_module_item_id"),
            title=module_item.get("title"),
            action_label="Change Indent",
            detail=f"{item_title}: indent {current_indent} -> {next_indent}",
            before_state={"indent": current_indent},
            after_state={"indent": next_indent},
            now=now,
        ))

    if body.operation_type == "item_rename":
        title_value = body.after_state.get("title")
        if not isinstance(title_value, str):
            raise HTTPException(status_code=422, detail="after_state.title must be a string")
        next_title = compact_whitespace(title_value)
        if not next_title:
            raise HTTPException(status_code=422, detail="Title cannot be empty")
        current_title = item_title
        operation_key = f"item_rename:{module_item['id']}"
        if next_title == current_title:
            return _clear_operation(supabase, session_id=session_id, user_id=user_id, operation_key=operation_key)
        return _upsert_operation(supabase, _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module_item",
            module_id=module_item.get("module_id"),
            module_item_id=module_item.get("id"),
            content_item_id=module_item.get("content_item_id"),
            canvas_module_id=module_item.get("canvas_module_id"),
            canvas_module_item_id=module_item.get("canvas_module_item_id"),
            title=module_item.get("title"),
            action_label="Rename Item",
            detail=f"{current_title} -> {next_title}",
            before_state={"title": current_title},
            after_state={"title": next_title},
            now=now,
        ))

    if body.operation_type == "item_position":
        position_value = body.after_state.get("position")
        if not isinstance(position_value, int):
            raise HTTPException(status_code=422, detail="after_state.position must be an integer")
        next_position = max(1, position_value)
        current_position = int(module_item.get("position") or 1)
        operation_key = f"item_position:{module_item['id']}"
        if next_position == current_position:
            return _clear_operation(supabase, session_id=session_id, user_id=user_id, operation_key=operation_key)
        return _upsert_operation(supabase, _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module_item",
            module_id=module_item.get("module_id"),
            module_item_id=module_item.get("id"),
            content_item_id=module_item.get("content_item_id"),
            canvas_module_id=module_item.get("canvas_module_id"),
            canvas_module_item_id=module_item.get("canvas_module_item_id"),
            title=module_item.get("title"),
            action_label="Move Item",
            detail=f"{item_title}: position {current_position} -> {next_position}",
            before_state={"position": current_position},
            after_state={"position": next_position},
            now=now,
        ))

    if body.operation_type == "item_move":
        position_value = body.after_state.get("position")
        target_module_id = body.after_state.get("module_id")
        if not isinstance(position_value, int):
            raise HTTPException(status_code=422, detail="after_state.position must be an integer")
        if not isinstance(target_module_id, str) or not target_module_id:
            raise HTTPException(status_code=422, detail="after_state.module_id must be a module id")

        target_module_result = supabase.table("course_modules").select(
            "id, canvas_module_id, name"
        ).eq("id", target_module_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).limit(1).execute()
        if not target_module_result.data:
            raise HTTPException(status_code=404, detail="Target module not found")

        target_module = target_module_result.data[0]
        next_position = max(1, position_value)
        current_position = int(module_item.get("position") or 1)
        current_module_id = module_item.get("module_id")
        operation_key = f"item_move:{module_item['id']}"
        if target_module["id"] == current_module_id and next_position == current_position:
            return _clear_operation(supabase, session_id=session_id, user_id=user_id, operation_key=operation_key)

        module_lookup = supabase.table("course_modules").select(
            "id, canvas_module_id, name"
        ).in_("id", [current_module_id, target_module["id"]]).eq(
            "session_id", session_id
        ).eq("user_id", user_id).execute()
        modules_by_id = {row["id"]: row for row in module_lookup.data or []}
        current_module = modules_by_id.get(current_module_id, {})
        current_module_name = current_module.get("name") or "Current module"
        target_module_name = target_module.get("name") or "Target module"

        supabase.table("module_queue_operations").delete().eq(
            "session_id", session_id
        ).eq("user_id", user_id).eq(
            "operation_key", f"item_position:{module_item['id']}"
        ).execute()

        return _upsert_operation(supabase, _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module_item",
            module_id=module_item.get("module_id"),
            module_item_id=module_item.get("id"),
            content_item_id=module_item.get("content_item_id"),
            canvas_module_id=module_item.get("canvas_module_id"),
            canvas_module_item_id=module_item.get("canvas_module_item_id"),
            title=module_item.get("title"),
            action_label="Move Item",
            detail=f"{item_title}: {current_module_name} position {current_position} -> {target_module_name} position {next_position}",
            before_state={
                "module_id": current_module_id,
                "canvas_module_id": module_item.get("canvas_module_id"),
                "module_name": current_module_name,
                "position": current_position,
            },
            after_state={
                "module_id": target_module["id"],
                "canvas_module_id": target_module["canvas_module_id"],
                "module_name": target_module_name,
                "position": next_position,
            },
            now=now,
        ))

    if body.operation_type == "item_remove":
        current_position = int(module_item.get("position") or 1)
        operation_key = f"item_remove:{module_item['id']}"
        module_result = supabase.table("course_modules").select(
            "id, canvas_module_id, name"
        ).eq("id", module_item.get("module_id")).eq(
            "session_id", session_id
        ).eq("user_id", user_id).limit(1).execute()
        module_name = (
            module_result.data[0].get("name")
            if module_result.data else None
        ) or "Module"

        supabase.table("module_queue_operations").delete().eq(
            "session_id", session_id
        ).eq("user_id", user_id).in_(
            "operation_key",
            [
                f"item_publish:{module_item['id']}",
                f"item_indent:{module_item['id']}",
                f"item_position:{module_item['id']}",
                f"item_move:{module_item['id']}",
            ],
        ).execute()

        return _upsert_operation(supabase, _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module_item",
            module_id=module_item.get("module_id"),
            module_item_id=module_item.get("id"),
            content_item_id=module_item.get("content_item_id"),
            canvas_module_id=module_item.get("canvas_module_id"),
            canvas_module_item_id=module_item.get("canvas_module_item_id"),
            title=module_item.get("title"),
            action_label="Remove Item",
            detail=f"{item_title}: remove from {module_name}",
            before_state={
                "module_id": module_item.get("module_id"),
                "canvas_module_id": module_item.get("canvas_module_id"),
                "module_name": module_name,
                "position": current_position,
            },
            after_state={"removed": True},
            now=now,
        ))

    raise HTTPException(status_code=422, detail="Unsupported module operation")


def stage_module_level_operation(
    supabase,
    *,
    session_id: str,
    user_id: str,
    body: ModuleLevelOperationRequest,
) -> dict[str, Any]:
    module_result = supabase.table("course_modules").select(
        "id, canvas_module_id, name, position, items_count"
    ).eq("id", body.module_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not module_result.data:
        raise HTTPException(status_code=404, detail="Module not found")

    module = module_result.data[0]
    now = datetime.now(timezone.utc).isoformat()
    module_name = module.get("name") or "Untitled module"

    if body.operation_type == "module_position":
        position_value = body.after_state.get("position")
        if not isinstance(position_value, int):
            raise HTTPException(status_code=422, detail="after_state.position must be an integer")
        next_position = max(1, position_value)
        current_position = int(module.get("position") or 1)
        operation_key = f"module_position:{module['id']}"
        if next_position == current_position:
            return _clear_operation(supabase, session_id=session_id, user_id=user_id, operation_key=operation_key)
        return _upsert_operation(supabase, _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module",
            module_id=module.get("id"),
            canvas_module_id=module.get("canvas_module_id"),
            title=module.get("name"),
            action_label="Move Module",
            detail=f"{module_name}: position {current_position} -> {next_position}",
            before_state={"position": current_position},
            after_state={"position": next_position},
            now=now,
        ))

    if body.operation_type == "module_rename":
        name_value = body.after_state.get("name")
        if not isinstance(name_value, str):
            raise HTTPException(status_code=422, detail="after_state.name must be a string")
        next_name = compact_whitespace(name_value)
        if not next_name:
            raise HTTPException(status_code=422, detail="Module name cannot be empty")
        current_name = module_name
        operation_key = f"module_rename:{module['id']}"
        if next_name == current_name:
            return _clear_operation(supabase, session_id=session_id, user_id=user_id, operation_key=operation_key)
        return _upsert_operation(supabase, _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module",
            module_id=module.get("id"),
            canvas_module_id=module.get("canvas_module_id"),
            title=module.get("name"),
            action_label="Rename Module",
            detail=f"{current_name} -> {next_name}",
            before_state={"name": current_name},
            after_state={"name": next_name},
            now=now,
        ))

    if body.operation_type == "module_delete":
        current_position = int(module.get("position") or 1)
        operation_key = f"module_delete:{module['id']}"
        supabase.table("module_queue_operations").delete().eq(
            "session_id", session_id
        ).eq("user_id", user_id).eq("module_id", module.get("id")).eq(
            "status", "staged"
        ).execute()

        values = _operation_base_values(
            session_id=session_id,
            user_id=user_id,
            operation_key=operation_key,
            operation_type=body.operation_type,
            target_type="module",
            module_id=module.get("id"),
            canvas_module_id=module.get("canvas_module_id"),
            title=module_name,
            action_label="Delete Module",
            detail=f"{module_name}: remove module shell and module item placements",
            before_state={
                "name": module_name,
                "position": current_position,
                "items_count": module.get("items_count"),
            },
            after_state={"deleted": True},
            now=now,
        )
        values["created_at"] = now
        result = supabase.table("module_queue_operations").insert(values).execute()
        row = result.data[0] if result.data else values
        return {"staged": True, "operation": module_operation_response(row)}

    raise HTTPException(status_code=422, detail="Unsupported module operation")


def delete_staged_module_operation(
    supabase,
    *,
    session_id: str,
    user_id: str,
    operation_id: str,
) -> dict[str, bool]:
    operation_result = supabase.table("module_queue_operations").select("*").eq(
        "id", operation_id
    ).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if operation_result.data:
        discard_local_module_create_operation(
            supabase,
            session_id=session_id,
            user_id=user_id,
            operation=operation_result.data[0],
        )

    supabase.table("module_queue_operations").delete().eq("id", operation_id).eq(
        "session_id", session_id
    ).eq("user_id", user_id).execute()
    return {"deleted": True}


def delete_all_staged_module_operations(
    supabase,
    *,
    session_id: str,
    user_id: str,
) -> dict[str, bool]:
    operation_result = supabase.table("module_queue_operations").select("*").eq(
        "session_id", session_id
    ).eq("user_id", user_id).eq("status", "staged").execute()
    for operation in operation_result.data or []:
        discard_local_module_create_operation(
            supabase,
            session_id=session_id,
            user_id=user_id,
            operation=operation,
        )

    supabase.table("module_queue_operations").delete().eq("session_id", session_id).eq(
        "user_id", user_id
    ).eq("status", "staged").execute()
    return {"deleted": True}
