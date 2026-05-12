"""Same-course Transfer push job orchestration."""

from __future__ import annotations

from typing import Any

import httpx

from canvas_sync import CanvasClient, html_to_text, sha256_payload, word_count
from services.canvas_file_references import (
    referenced_canvas_file_ids_for_kept_content,
    referenced_canvas_file_labels_by_id,
)
from services.document_records import write_platform_event
from services.transfer.canvas_target import resolve_source_course_access
from services.transfer.content_remap import page_lookup_keys as _page_lookup_keys
from services.transfer.quiz_transfer import (
    create_canvas_quiz,
    create_quiz_question,
    delete_canvas_quiz,
    delete_quiz_question,
    is_classic_quiz,
    local_quiz_question_canvas_id,
    metadata_with_canvas_question_response,
    quiz_question_payload,
    update_canvas_quiz,
    update_quiz_question,
)
from services.transfer.shared import (
    SAME_COURSE_MODULE_ITEM_OPERATION_TYPES,
    SAME_COURSE_MODULE_OPERATION_TYPES,
    SUPPORTED_SAME_COURSE_DELETE_TYPES,
    SUPPORTED_TRANSFER_CONTENT_TYPES,
    _add_content_to_module,
    _add_event,
    _add_report_item,
    _after_last_sync,
    _assert_no_quiz_submissions,
    _canvas_id_for_created_content,
    _canvas_updated_timestamp,
    _canvas_url_for_created_content,
    _compact_text,
    _content_type_label,
    _create_canvas_assignment,
    _create_canvas_discussion,
    _create_canvas_module,
    _create_canvas_page,
    _delete_canvas_assignment,
    _delete_canvas_discussion,
    _delete_canvas_file,
    _delete_canvas_page,
    _html_values_for_content,
    _is_local_canvas_id,
    _load_transfer_plan,
    _metadata,
    _metadata_for_created_content,
    _normalized_title,
    _quiz_question_rows,
    _report_count,
    _set_progress,
    _source_course_canvas_id,
    _update_canvas_assignment,
    _update_canvas_discussion,
    _update_canvas_page,
    _update_job,
    utc_now_iso,
)
from supabase_client import get_supabase


def _module_lookup(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        module["id"]: module
        for module in plan.get("modules", [])
        if module.get("id")
    }


def _module_item_lookup(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        item["id"]: item
        for items in (plan.get("items_by_module") or {}).values()
        for item in items
        if item.get("id")
    }


def _first_module_item_for_content(plan: dict[str, Any], content_item_id: str) -> dict[str, Any] | None:
    for items in (plan.get("items_by_module") or {}).values():
        for item in items:
            if item.get("content_item_id") == content_item_id:
                return item
    return None


def _same_course_module_item_operations(plan: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        operation
        for operation in plan.get("module_operations", [])
        if operation.get("operation_type") in SAME_COURSE_MODULE_ITEM_OPERATION_TYPES
    ]


def _same_course_module_operations(plan: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        operation
        for operation in plan.get("module_operations", [])
        if operation.get("operation_type") in SAME_COURSE_MODULE_OPERATION_TYPES
    ]


def _same_course_local_modules(plan: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        module
        for module in plan.get("modules", [])
        if _is_local_canvas_id(module.get("canvas_module_id"))
        or bool(_metadata(module).get("is_new_local"))
    ]


def _content_targets_uncreated_local_module(plan: dict[str, Any], content: dict[str, Any]) -> bool:
    module_item = _first_module_item_for_content(plan, str(content.get("id") or ""))
    if not module_item:
        return False
    module_id = module_item.get("module_id")
    module = _module_lookup(plan).get(module_id) if module_id else None
    canvas_module_id = str(
        module_item.get("canvas_module_id")
        or (module or {}).get("canvas_module_id")
        or ""
    )
    return bool(canvas_module_id and _is_local_canvas_id(canvas_module_id))


def _mark_same_course_module_created(
    supabase,
    *,
    session_id: str,
    user_id: str,
    plan: dict[str, Any],
    module: dict[str, Any],
    canvas_module_id: str,
    canvas_response: dict[str, Any],
    now: str,
) -> None:
    module_id = module["id"]
    next_name = canvas_response.get("name") or module.get("name")
    next_metadata = {
        **_metadata(module),
        "created_in_v2": True,
        "canvas_module_id": canvas_module_id,
        "pushed_to_canvas_at": now,
    }
    next_metadata.pop("is_new_local", None)
    next_metadata.pop("pending_canvas_push", None)
    supabase.table("course_modules").update({
        "canvas_module_id": canvas_module_id,
        "name": next_name,
        "position": canvas_response.get("position") or module.get("position"),
        "published": canvas_response.get("published") if canvas_response.get("published") is not None else module.get("published"),
        "workflow_state": canvas_response.get("workflow_state"),
        "items_count": canvas_response.get("items_count") or module.get("items_count") or 0,
        "metadata": next_metadata,
        "updated_at": now,
    }).eq("id", module_id).eq("session_id", session_id).eq("user_id", user_id).execute()
    supabase.table("course_module_items").update({
        "canvas_module_id": canvas_module_id,
        "updated_at": now,
    }).eq("module_id", module_id).eq("session_id", session_id).eq("user_id", user_id).execute()
    supabase.table("module_queue_operations").update({
        "canvas_module_id": canvas_module_id,
        "updated_at": now,
    }).eq("module_id", module_id).eq("session_id", session_id).eq("user_id", user_id).execute()
    supabase.table("module_queue_operations").update({
        "canvas_module_id": canvas_module_id,
        "status": "applied",
        "updated_at": now,
    }).eq("module_id", module_id).eq("session_id", session_id).eq("user_id", user_id).eq(
        "operation_type", "module_create"
    ).eq("status", "staged").execute()

    module["canvas_module_id"] = canvas_module_id
    module["name"] = next_name
    module["metadata"] = next_metadata
    for item in (plan.get("items_by_module") or {}).get(module_id, []):
        item["canvas_module_id"] = canvas_module_id
        content_item_id = item.get("content_item_id")
        content = (plan.get("content_by_id") or {}).get(content_item_id)
        if not content:
            continue
        content_metadata = _metadata(content)
        next_content_metadata = {
            **content_metadata,
            "desired_canvas_module_id": canvas_module_id,
            "desired_module_name": next_name,
        }
        content["metadata"] = next_content_metadata
        content["module_canvas_id"] = canvas_module_id
        content["module_name"] = next_name
        supabase.table("course_content_items").update({
            "module_canvas_id": canvas_module_id,
            "module_name": next_name,
            "metadata": next_content_metadata,
            "updated_at": now,
        }).eq("id", content_item_id).eq("session_id", session_id).eq("user_id", user_id).execute()


def _create_same_course_local_modules(
    supabase,
    *,
    job_id: str,
    state: dict[str, Any],
    session_id: str,
    user_id: str,
    client: CanvasClient,
    course_id: str,
    plan: dict[str, Any],
    now: str,
) -> tuple[int, int]:
    created_count = 0
    error_count = 0
    for module in _same_course_local_modules(plan):
        title = _compact_text(module.get("name"), 255) or "Untitled Module"
        try:
            created = _create_canvas_module(client, course_id=course_id, module=module)
            canvas_module_id = str(created.get("id")) if created.get("id") is not None else ""
            if not canvas_module_id:
                raise ValueError("Canvas did not return a module ID")
            _mark_same_course_module_created(
                supabase,
                session_id=session_id,
                user_id=user_id,
                plan=plan,
                module=module,
                canvas_module_id=canvas_module_id,
                canvas_response=created,
                now=now,
            )
            created_count += 1
            _add_report_item(
                state,
                "created",
                title=title,
                content_type="module",
                action="create",
                status="done",
            )
            _add_event(supabase, job_id, state, f"Created module: {title}", "done")
        except Exception as exc:
            error_count += 1
            _add_report_item(
                state,
                "errors",
                title=title,
                content_type="module",
                action="create",
                status="error",
                reason=exc,
            )
            _add_event(supabase, job_id, state, f"Failed to create module '{title}': {exc}", "error")
    return created_count, error_count


def _place_same_course_created_content(
    supabase,
    *,
    session_id: str,
    user_id: str,
    client: CanvasClient,
    course_id: str,
    plan: dict[str, Any],
    content: dict[str, Any],
    canvas_ref: str,
    canvas_response: dict[str, Any],
    now: str,
) -> tuple[bool, str | None, str | None]:
    module_item = _first_module_item_for_content(plan, str(content["id"]))
    if not module_item:
        return False, None, None

    module_id = module_item.get("module_id")
    module = _module_lookup(plan).get(module_id) if module_id else None
    module_canvas_id = (module or {}).get("canvas_module_id")
    item_canvas_id = module_item.get("canvas_module_id")
    canvas_module_id = str(module_canvas_id if module_canvas_id and not _is_local_canvas_id(module_canvas_id) else item_canvas_id or "")
    if not canvas_module_id or _is_local_canvas_id(canvas_module_id):
        return False, None, "Target module has not been created in Canvas yet."

    content_type = str(content.get("content_type") or "")
    title = _compact_text(module_item.get("title") or content.get("title"), 255) or f"Untitled {_content_type_label(content_type).title()}"
    placed = _add_content_to_module(
        client,
        course_id=course_id,
        canvas_module_id=canvas_module_id,
        content_type=content_type,
        title=title,
        canvas_content_ref=canvas_ref,
        position=module_item.get("position"),
        indent=module_item.get("indent"),
    )
    canvas_module_item_id = placed.get("id")
    if canvas_module_item_id is None:
        return False, None, "Canvas did not return a module item ID."

    module_item_values = {
        "canvas_module_id": canvas_module_id,
        "canvas_module_item_id": str(canvas_module_item_id),
        "canvas_content_id": str(placed.get("content_id")) if placed.get("content_id") is not None else None,
        "page_url": placed.get("page_url") or (canvas_response.get("url") if content_type == "page" else None),
        "title": placed.get("title") or title,
        "module_item_type": placed.get("type") or module_item.get("module_item_type"),
        "position": placed.get("position") or module_item.get("position"),
        "indent": placed.get("indent") or module_item.get("indent") or 0,
        "published": content.get("published"),
        "completion_requirement": placed.get("completion_requirement") or module_item.get("completion_requirement") or {},
        "html_url": placed.get("html_url"),
        "external_url": placed.get("external_url"),
        "new_tab": placed.get("new_tab"),
        "metadata": {
            **_metadata(module_item),
            "created_from_v2_new_content": True,
            "workflow_state": placed.get("workflow_state"),
        },
        "updated_at": now,
    }
    supabase.table("course_module_items").update(module_item_values).eq("id", module_item["id"]).eq(
        "session_id", session_id
    ).eq("user_id", user_id).execute()
    module_item.update(module_item_values)
    supabase.table("module_queue_operations").update({
        "canvas_module_id": canvas_module_id,
        "canvas_module_item_id": str(canvas_module_item_id),
        "updated_at": now,
    }).eq("module_item_id", module_item["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
    for operation in plan.get("module_operations", []):
        if operation.get("module_item_id") == module_item["id"]:
            operation["canvas_module_id"] = canvas_module_id
            operation["canvas_module_item_id"] = str(canvas_module_item_id)
    return True, str(canvas_module_item_id), None


def _resolved_module_canvas_id(plan: dict[str, Any], module_id: Any, canvas_module_id: Any) -> str:
    if canvas_module_id and not _is_local_canvas_id(canvas_module_id):
        return str(canvas_module_id)
    module = _module_lookup(plan).get(module_id)
    value = module.get("canvas_module_id") if module else None
    return str(value) if value and not _is_local_canvas_id(value) else ""


def _resolved_module_item_canvas_id(plan: dict[str, Any], module_item_id: Any, canvas_module_item_id: Any) -> str:
    if canvas_module_item_id and not _is_local_canvas_id(canvas_module_item_id):
        return str(canvas_module_item_id)
    module_item = _module_item_lookup(plan).get(module_item_id)
    value = module_item.get("canvas_module_item_id") if module_item else None
    return str(value) if value and not _is_local_canvas_id(value) else ""


def _module_name(plan: dict[str, Any], module_id: Any) -> str | None:
    module = _module_lookup(plan).get(module_id)
    return str(module.get("name")) if module and module.get("name") else None


def _apply_same_course_module_item_operation(
    supabase,
    *,
    session_id: str,
    user_id: str,
    client: CanvasClient,
    course_id: str,
    plan: dict[str, Any],
    operation: dict[str, Any],
    now: str,
) -> dict[str, Any]:
    operation_type = str(operation.get("operation_type") or "")
    after_state = operation.get("after_state") if isinstance(operation.get("after_state"), dict) else {}
    module_id = operation.get("module_id")
    module_item_id = operation.get("module_item_id")
    canvas_module_id = _resolved_module_canvas_id(plan, module_id, operation.get("canvas_module_id"))
    canvas_module_item_id = _resolved_module_item_canvas_id(plan, module_item_id, operation.get("canvas_module_item_id"))
    if not canvas_module_id or not canvas_module_item_id:
        raise ValueError("Module operation is missing deployed Canvas module item IDs")

    payload: dict[str, Any] = {}
    local_updates: dict[str, Any] = {"updated_at": now}
    content_updates: dict[str, Any] = {}
    if operation_type == "item_publish":
        if "published" not in after_state:
            raise ValueError("Published state is missing")
        next_published = bool(after_state["published"])
        payload["module_item[published]"] = str(next_published).lower()
        local_updates["published"] = next_published
    elif operation_type == "item_indent":
        if "indent" not in after_state:
            raise ValueError("Indent state is missing")
        next_indent = max(0, min(5, int(after_state["indent"])))
        payload["module_item[indent]"] = str(next_indent)
        local_updates["indent"] = next_indent
    elif operation_type == "item_rename":
        title_value = str(after_state.get("title") or "").strip()
        if not title_value:
            raise ValueError("Title state is missing")
        next_title = _compact_text(title_value, 255)
        payload["module_item[title]"] = next_title
        local_updates["title"] = next_title
    elif operation_type == "item_move":
        target_module_id = after_state.get("module_id")
        target_canvas_module_id = _resolved_module_canvas_id(plan, target_module_id, after_state.get("canvas_module_id"))
        if not target_module_id or not target_canvas_module_id:
            raise ValueError("Target module is missing")
        if "position" not in after_state:
            raise ValueError("Position state is missing")
        next_position = max(1, int(after_state["position"]))
        payload["module_item[module_id]"] = target_canvas_module_id
        payload["module_item[position]"] = str(next_position)
        local_updates["module_id"] = target_module_id
        local_updates["canvas_module_id"] = target_canvas_module_id
        local_updates["position"] = next_position
        target_module_name = _module_name(plan, target_module_id)
        content_updates["module_canvas_id"] = target_canvas_module_id
        content_updates["module_name"] = target_module_name
        module_item = _module_item_lookup(plan).get(module_item_id)
        if module_item:
            module_item["module_id"] = target_module_id
            module_item["canvas_module_id"] = target_canvas_module_id
            module_item["position"] = next_position
    elif operation_type == "item_position":
        if "position" not in after_state:
            raise ValueError("Position state is missing")
        next_position = max(1, int(after_state["position"]))
        payload["module_item[position]"] = str(next_position)
        local_updates["position"] = next_position
    elif operation_type == "item_remove":
        response = client.delete(f"/courses/{course_id}/modules/{canvas_module_id}/items/{canvas_module_item_id}")
        supabase.table("module_queue_operations").update({
            "status": "applied",
            "updated_at": now,
        }).eq("id", operation["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
        if module_item_id:
            supabase.table("course_module_items").delete().eq("id", module_item_id).eq(
                "session_id", session_id
            ).eq("user_id", user_id).execute()
        content_item_id = operation.get("content_item_id")
        if content_item_id:
            remaining_result = supabase.table("course_module_items").select("id").eq(
                "session_id", session_id
            ).eq("user_id", user_id).eq("content_item_id", content_item_id).limit(1).execute()
            if not remaining_result.data:
                supabase.table("course_content_items").update({
                    "module_canvas_id": None,
                    "module_name": None,
                    "is_orphaned": True,
                    "updated_at": now,
                }).eq("id", content_item_id).eq("session_id", session_id).eq("user_id", user_id).execute()
        return response
    else:
        raise ValueError(f"Unsupported module operation: {operation_type}")

    response = client.put_form(
        f"/courses/{course_id}/modules/{canvas_module_id}/items/{canvas_module_item_id}",
        payload,
    )
    if module_item_id:
        supabase.table("course_module_items").update(local_updates).eq("id", module_item_id).eq(
            "session_id", session_id
        ).eq("user_id", user_id).execute()
    if content_updates and operation.get("content_item_id"):
        content_updates["updated_at"] = now
        supabase.table("course_content_items").update(content_updates).eq(
            "id", operation["content_item_id"]
        ).eq("session_id", session_id).eq("user_id", user_id).execute()
    supabase.table("module_queue_operations").update({
        "status": "applied",
        "updated_at": now,
    }).eq("id", operation["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
    return response


def _apply_same_course_module_item_operations(
    supabase,
    *,
    job_id: str,
    state: dict[str, Any],
    session_id: str,
    user_id: str,
    client: CanvasClient,
    course_id: str,
    plan: dict[str, Any],
    now: str,
) -> tuple[int, int]:
    applied_count = 0
    error_count = 0
    for operation in _same_course_module_item_operations(plan):
        title = _compact_text(operation.get("title"), 255) or "Module item operation"
        operation_type = str(operation.get("operation_type") or "module_operation")
        try:
            _apply_same_course_module_item_operation(
                supabase,
                session_id=session_id,
                user_id=user_id,
                client=client,
                course_id=course_id,
                plan=plan,
                operation=operation,
                now=now,
            )
            applied_count += 1
            _add_report_item(
                state,
                "updated",
                title=title,
                content_type="module_item",
                action=operation_type,
                status="done",
                reason=operation.get("detail"),
            )
            _add_event(supabase, job_id, state, f"Applied module item operation: {title}", "done")
        except Exception as exc:
            error_count += 1
            _add_report_item(
                state,
                "errors",
                title=title,
                content_type="module_item",
                action=operation_type,
                status="error",
                reason=exc,
            )
            _add_event(supabase, job_id, state, f"Failed module item operation '{title}': {exc}", "error")
    return applied_count, error_count


def _apply_same_course_module_operation(
    supabase,
    *,
    session_id: str,
    user_id: str,
    client: CanvasClient,
    course_id: str,
    plan: dict[str, Any],
    operation: dict[str, Any],
    now: str,
) -> dict[str, Any]:
    operation_type = str(operation.get("operation_type") or "")
    after_state = operation.get("after_state") if isinstance(operation.get("after_state"), dict) else {}
    module_id = operation.get("module_id")
    canvas_module_id = _resolved_module_canvas_id(plan, module_id, operation.get("canvas_module_id"))
    if not canvas_module_id:
        raise ValueError("Module operation is missing deployed Canvas module ID")

    module = _module_lookup(plan).get(module_id)

    if operation_type == "module_rename":
        name_value = str(after_state.get("name") or "").strip()
        if not name_value:
            raise ValueError("Module name state is missing")
        next_name = _compact_text(name_value, 255)
        response = client.put_form(
            f"/courses/{course_id}/modules/{canvas_module_id}",
            {"module[name]": next_name},
        )
        response_name = response.get("name") or next_name
        next_metadata = _metadata(module) if module else {}
        if module:
            module["name"] = response_name
            module["metadata"] = next_metadata
        supabase.table("course_modules").update({
            "name": response_name,
            "metadata": next_metadata,
            "updated_at": now,
        }).eq("id", module_id).eq("session_id", session_id).eq("user_id", user_id).execute()
        supabase.table("course_content_items").update({
            "module_name": response_name,
            "updated_at": now,
        }).eq("module_canvas_id", canvas_module_id).eq("session_id", session_id).eq("user_id", user_id).execute()
        supabase.table("module_queue_operations").update({
            "title": response_name,
            "status": "applied",
            "updated_at": now,
        }).eq("id", operation["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
        return response

    if operation_type == "module_position":
        if "position" not in after_state:
            raise ValueError("Module position state is missing")
        next_position = max(1, int(after_state["position"]))
        response = client.put_form(
            f"/courses/{course_id}/modules/{canvas_module_id}",
            {"module[position]": str(next_position)},
        )

        modules = [row for row in plan.get("modules", []) if row.get("id")]
        current_modules = sorted(
            modules,
            key=lambda row: (row.get("position") or 999_999, row.get("name") or ""),
        )
        current_ids = [row["id"] for row in current_modules]
        if module_id in current_ids:
            current_ids.remove(module_id)
            current_ids.insert(min(next_position - 1, len(current_ids)), module_id)
        for index, current_module_id in enumerate(current_ids, start=1):
            current_module = _module_lookup(plan).get(current_module_id)
            if current_module:
                current_module["position"] = index
            supabase.table("course_modules").update({
                "position": index,
                "updated_at": now,
            }).eq("id", current_module_id).eq("session_id", session_id).eq("user_id", user_id).execute()

        supabase.table("module_queue_operations").update({
            "status": "applied",
            "updated_at": now,
        }).eq("id", operation["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
        return response

    if operation_type == "module_delete":
        if not module_id:
            raise ValueError("Module operation is missing local module ID")
        impacted_content_ids = list(dict.fromkeys(
            item["content_item_id"]
            for item in (plan.get("items_by_module") or {}).get(module_id, [])
            if item.get("content_item_id")
        ))
        response = client.delete(f"/courses/{course_id}/modules/{canvas_module_id}")
        supabase.table("module_queue_operations").update({
            "module_id": None,
            "status": "applied",
            "updated_at": now,
        }).eq("id", operation["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
        supabase.table("course_module_items").delete().eq("module_id", module_id).eq(
            "session_id", session_id
        ).eq("user_id", user_id).execute()
        supabase.table("course_modules").delete().eq("id", module_id).eq(
            "session_id", session_id
        ).eq("user_id", user_id).execute()

        module_lookup = _module_lookup(plan)
        if module_id in module_lookup:
            plan["modules"] = [row for row in plan.get("modules", []) if row.get("id") != module_id]
        (plan.get("items_by_module") or {}).pop(module_id, None)

        if impacted_content_ids:
            remaining_result = supabase.table("course_module_items").select(
                "content_item_id, module_id, canvas_module_id"
            ).eq("session_id", session_id).eq("user_id", user_id).in_(
                "content_item_id", impacted_content_ids
            ).execute()
            remaining_by_content_id: dict[str, dict[str, Any]] = {}
            for row in remaining_result.data or []:
                content_item_id = row.get("content_item_id")
                if content_item_id and content_item_id not in remaining_by_content_id:
                    remaining_by_content_id[content_item_id] = row

            for content_item_id in impacted_content_ids:
                remaining_item = remaining_by_content_id.get(content_item_id)
                if remaining_item:
                    remaining_module_id = remaining_item.get("module_id")
                    supabase.table("course_content_items").update({
                        "module_canvas_id": remaining_item.get("canvas_module_id"),
                        "module_name": _module_name(plan, remaining_module_id),
                        "is_orphaned": False,
                        "updated_at": now,
                    }).eq("id", content_item_id).eq("session_id", session_id).eq("user_id", user_id).execute()
                else:
                    supabase.table("course_content_items").update({
                        "module_canvas_id": None,
                        "module_name": None,
                        "is_orphaned": True,
                        "updated_at": now,
                    }).eq("id", content_item_id).eq("session_id", session_id).eq("user_id", user_id).execute()

        remaining_modules = sorted(
            [row for row in plan.get("modules", []) if row.get("id")],
            key=lambda row: (row.get("position") or 999_999, row.get("name") or ""),
        )
        for index, remaining_module in enumerate(remaining_modules, start=1):
            remaining_module["position"] = index
            supabase.table("course_modules").update({
                "position": index,
                "updated_at": now,
            }).eq("id", remaining_module["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
        return response

    raise ValueError(f"Unsupported module operation: {operation_type}")


def _apply_same_course_module_operations(
    supabase,
    *,
    job_id: str,
    state: dict[str, Any],
    session_id: str,
    user_id: str,
    client: CanvasClient,
    course_id: str,
    plan: dict[str, Any],
    now: str,
) -> tuple[int, int]:
    applied_count = 0
    error_count = 0
    for operation in _same_course_module_operations(plan):
        title = _compact_text(operation.get("title"), 255) or "Module operation"
        operation_type = str(operation.get("operation_type") or "module_operation")
        try:
            _apply_same_course_module_operation(
                supabase,
                session_id=session_id,
                user_id=user_id,
                client=client,
                course_id=course_id,
                plan=plan,
                operation=operation,
                now=now,
            )
            applied_count += 1
            report_category = "deleted" if operation_type == "module_delete" else "updated"
            _add_report_item(
                state,
                report_category,
                title=title,
                content_type="module",
                action=operation_type,
                status="done",
                reason=operation.get("detail"),
            )
            _add_event(supabase, job_id, state, f"Applied module operation: {title}", "done")
        except Exception as exc:
            error_count += 1
            _add_report_item(
                state,
                "errors",
                title=title,
                content_type="module",
                action=operation_type,
                status="error",
                reason=exc,
            )
            _add_event(supabase, job_id, state, f"Failed module operation '{title}': {exc}", "error")
    return applied_count, error_count


def _page_canvas_ref(content: dict[str, Any]) -> str:
    for key in _page_lookup_keys(content):
        if key:
            return key
    return str(content.get("canvas_id") or "")


def _pending_same_course_ids(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_by_id: dict[str, dict[str, Any]],
) -> list[str]:
    supported_ids = [
        content_item_id
        for content_item_id, content in content_by_id.items()
        if content.get("content_type") in SUPPORTED_TRANSFER_CONTENT_TYPES
        and content.get("canvas_id")
    ]
    if not supported_ids:
        return []

    revision_result = supabase.table("content_revisions").select(
        "content_item_id, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", supported_ids
    ).execute()

    pending: set[str] = set()
    for revision in revision_result.data or []:
        content_item_id = revision.get("content_item_id")
        content = content_by_id.get(content_item_id)
        if not content:
            continue
        if _after_last_sync(revision.get("created_at"), content.get("last_synced_at")):
            pending.add(content_item_id)

    question_ids = [
        content_item_id
        for content_item_id, content in content_by_id.items()
        if content.get("content_type") == "quiz_question"
    ]
    if question_ids:
        parent_quiz_by_canvas_id = {
            str(content.get("canvas_id")): content_item_id
            for content_item_id, content in content_by_id.items()
            if content.get("content_type") == "quiz" and content.get("canvas_id")
        }
        question_revision_result = supabase.table("content_revisions").select(
            "content_item_id, created_at"
        ).eq("session_id", session_id).eq("user_id", user_id).in_(
            "content_item_id", question_ids
        ).execute()
        for revision in question_revision_result.data or []:
            question_id = revision.get("content_item_id")
            question = content_by_id.get(question_id)
            if not question:
                continue
            if not _after_last_sync(revision.get("created_at"), question.get("last_synced_at")):
                continue
            parent_quiz_id = _metadata(question).get("parent_quiz_canvas_id")
            parent_content_id = parent_quiz_by_canvas_id.get(str(parent_quiz_id or ""))
            if parent_content_id:
                pending.add(parent_content_id)
    return [content_item_id for content_item_id in supported_ids if content_item_id in pending]


def _same_course_delete_items(
    supabase,
    *,
    session_id: str,
    user_id: str,
) -> list[dict[str, Any]]:
    decisions_result = supabase.table("content_inventory_decisions").select(
        "id, content_item_id, reason"
    ).eq("session_id", session_id).eq("user_id", user_id).eq("action", "delete").eq(
        "applied_to_canvas", False
    ).execute()
    decisions = [row for row in decisions_result.data or [] if row.get("content_item_id")]
    if not decisions:
        return []

    content_ids = list(dict.fromkeys(row["content_item_id"] for row in decisions))
    items_result = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, canvas_url, is_orphaned, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).in_("id", content_ids).execute()
    items_by_id = {row["id"]: row for row in items_result.data or [] if row.get("id")}
    all_items_result = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, is_orphaned, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_type", ["assignment", "discussion", "quiz"]
    ).execute()
    protected_file_ids = referenced_canvas_file_ids_for_kept_content(
        supabase,
        session_id=session_id,
        user_id=user_id,
    )
    protected_file_labels = referenced_canvas_file_labels_by_id(
        supabase,
        session_id=session_id,
        user_id=user_id,
    )
    kept_image_result = supabase.table("course_images").select(
        "canvas_file_id, review_action"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    protected_file_ids.update({
        str(row.get("canvas_file_id"))
        for row in kept_image_result.data or []
        if row.get("canvas_file_id") and row.get("review_action") != "delete"
    })
    decisions_by_item_id = {row["content_item_id"]: row for row in decisions}
    kept_activity_items = [
        row
        for row in all_items_result.data or []
        if row.get("content_type") in {"discussion", "quiz"}
        and row.get("id") not in decisions_by_item_id
    ]

    delete_items: list[dict[str, Any]] = []
    for decision in decisions:
        item = items_by_id.get(decision["content_item_id"])
        if not item:
            continue
        content_type = str(item.get("content_type") or "")
        canvas_id = str(item.get("canvas_id") or "")
        if content_type not in SUPPORTED_SAME_COURSE_DELETE_TYPES:
            continue
        if not canvas_id or canvas_id.startswith("local:"):
            continue
        if content_type == "assignment":
            protected_by = _matching_kept_activity_for_assignment(item, kept_activity_items)
            if protected_by:
                protected_type = str(protected_by.get("content_type") or "content")
                delete_items.append({
                    "decision": decision,
                    "item": item,
                    "skip_reason": f"Matching kept {protected_type} exists: {protected_by.get('title') or protected_by.get('canvas_id')}",
                })
                continue
        if content_type == "file" and canvas_id in protected_file_ids:
            labels = protected_file_labels.get(canvas_id) or []
            label_text = f" Referenced by: {', '.join(labels[:3])}." if labels else ""
            delete_items.append({
                "decision": decision,
                "item": item,
                "skip_reason": f"Canvas file is still referenced by kept course content.{label_text}",
            })
            continue
        delete_items.append({
            "decision": decision,
            "item": item,
        })
    return delete_items


def _discussion_assignment_id(discussion: dict[str, Any]) -> str:
    metadata = _metadata(discussion)
    assignment_id = metadata.get("assignment_id")
    return str(assignment_id) if assignment_id else ""


def _assignment_discussion_id(assignment: dict[str, Any]) -> str:
    metadata = _metadata(assignment)
    discussion_topic_id = metadata.get("discussion_topic_id")
    if discussion_topic_id:
        return str(discussion_topic_id)
    discussion_topic = metadata.get("discussion_topic")
    if isinstance(discussion_topic, dict) and discussion_topic.get("id"):
        return str(discussion_topic["id"])
    return ""


def _quiz_assignment_id(quiz: dict[str, Any]) -> str:
    metadata = _metadata(quiz)
    assignment_id = metadata.get("assignment_id")
    return str(assignment_id) if assignment_id else ""


def _assignment_quiz_id(assignment: dict[str, Any]) -> str:
    metadata = _metadata(assignment)
    quiz_id = metadata.get("quiz_id")
    return str(quiz_id) if quiz_id else ""


def _assignment_is_canvas_activity_shell(assignment: dict[str, Any]) -> bool:
    metadata = _metadata(assignment)
    return bool(
        metadata.get("discussion_topic_id")
        or metadata.get("discussion_topic")
        or metadata.get("quiz_id")
        or metadata.get("is_quiz_assignment")
        or metadata.get("source_content_type") in {"discussion", "quiz", "assignment"}
    )


def _matching_kept_activity_for_assignment(
    assignment: dict[str, Any],
    kept_items: list[dict[str, Any]],
) -> dict[str, Any] | None:
    assignment_id = str(assignment.get("canvas_id") or "")
    discussion_id = _assignment_discussion_id(assignment)
    quiz_id = _assignment_quiz_id(assignment)
    assignment_title = _normalized_title(assignment.get("title"))
    assignment_is_activity_shell = _assignment_is_canvas_activity_shell(assignment)
    for item in kept_items:
        content_type = item.get("content_type")
        if content_type == "discussion":
            if assignment_id and _discussion_assignment_id(item) == assignment_id:
                return item
            if discussion_id and str(item.get("canvas_id") or "") == discussion_id:
                return item
            if (
                assignment_is_activity_shell
                and assignment_title
                and _normalized_title(item.get("title")) == assignment_title
            ):
                return item
        if content_type == "quiz":
            if assignment_id and _quiz_assignment_id(item) == assignment_id:
                return item
            if quiz_id and str(item.get("canvas_id") or "") == quiz_id:
                return item
            if (
                assignment_is_activity_shell
                and assignment_title
                and _normalized_title(item.get("title")) == assignment_title
            ):
                return item
    return None


def _push_same_course_quiz_questions(
    supabase,
    *,
    session_id: str,
    user_id: str,
    client: CanvasClient,
    course_id: str,
    plan: dict[str, Any],
    quiz: dict[str, Any],
    quiz_html_body: str,
    now: str,
    state: dict[str, Any],
    job_id: str,
) -> tuple[int, int, int, int]:
    quiz_id = str(quiz.get("canvas_id") or "")
    questions = _quiz_question_rows(plan, quiz_id)
    if not questions:
        return 0, 0, 0, 0
    question_ids = [row["id"] for row in questions if row.get("id")]
    revision_result = supabase.table("content_revisions").select(
        "content_item_id, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", question_ids
    ).execute() if question_ids else None
    changed_question_ids: set[str] = set()
    for revision in (revision_result.data if revision_result else []) or []:
        question = (plan.get("content_by_id") or {}).get(revision.get("content_item_id"))
        if question and _after_last_sync(revision.get("created_at"), question.get("last_synced_at")):
            changed_question_ids.add(question["id"])

    updated_count = 0
    created_count = 0
    deleted_count = 0
    error_count = 0
    for question in questions:
        metadata = _metadata(question)
        question_id = str(metadata.get("question_id") or "")
        is_new_local = bool(metadata.get("is_new_local")) or not question_id or question_id.startswith("local-")
        pending_delete = bool(metadata.get("pending_delete"))
        if not pending_delete and not is_new_local and question.get("id") not in changed_question_ids:
            continue
        title = _compact_text(question.get("title"), 255) or "Quiz question"
        try:
            if pending_delete:
                if question_id and not is_new_local:
                    delete_quiz_question(client, course_id=course_id, quiz_id=quiz_id, question_id=question_id)
                supabase.table("content_revisions").delete().eq("content_item_id", question["id"]).execute()
                supabase.table("course_content_bodies").delete().eq("content_item_id", question["id"]).execute()
                supabase.table("course_content_items").delete().eq("id", question["id"]).execute()
                deleted_count += 1
                _add_report_item(state, "deleted", title=title, content_type="quiz_question", action="delete", status="done")
                continue

            question_html_body = str((plan.get("bodies_by_id") or {}).get(question["id"], {}).get("html_body") or metadata.get("question_text") or "")
            payload = quiz_question_payload(question, question_html_body)
            if is_new_local:
                response = create_quiz_question(client, course_id=course_id, quiz_id=quiz_id, payload=payload)
                response_question_id = response.get("id") or response.get("question", {}).get("id")
                updated_metadata = metadata_with_canvas_question_response(metadata, response)
                values: dict[str, Any] = {
                    "metadata": updated_metadata,
                    "last_synced_at": now,
                    "updated_at": now,
                }
                if response_question_id:
                    values["canvas_id"] = local_quiz_question_canvas_id(quiz_id, response_question_id)
                supabase.table("course_content_items").update(values).eq("id", question["id"]).eq(
                    "session_id", session_id
                ).eq("user_id", user_id).execute()
                created_count += 1
                _add_report_item(state, "created", title=title, content_type="quiz_question", action="create", status="done")
            else:
                response = update_quiz_question(client, course_id=course_id, quiz_id=quiz_id, question_id=question_id, payload=payload)
                supabase.table("course_content_items").update({
                    "metadata": metadata_with_canvas_question_response(metadata, response),
                    "last_synced_at": now,
                    "updated_at": now,
                }).eq("id", question["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
                updated_count += 1
                _add_report_item(state, "updated", title=title, content_type="quiz_question", action="update", status="done")
        except Exception as exc:
            error_count += 1
            _add_report_item(state, "errors", title=title, content_type="quiz_question", action="push", status="error", reason=exc)
            _add_event(supabase, job_id, state, f"Failed to push quiz question '{title}': {exc}", "error")

    if updated_count or created_count or deleted_count:
        remaining_question_count = len([
            row
            for row in _quiz_question_rows(plan, quiz_id)
            if not _metadata(row).get("pending_delete")
        ])
        update_canvas_quiz(
            client,
            course_id=course_id,
            quiz_id=quiz_id,
            title=quiz.get("title"),
            html_body=quiz_html_body,
            question_count=remaining_question_count,
        )
        _add_event(
            supabase,
            job_id,
            state,
            f"Quiz questions for {quiz.get('title') or quiz_id}: {created_count} created, {updated_count} updated, {deleted_count} deleted",
            "done",
        )
    return created_count, updated_count, deleted_count, error_count


def run_transfer_same_course_job(job_id: str, session_id: str, user_id: str) -> None:
    """Push edited pages, assignments, and discussions back to the source Canvas course."""
    supabase = get_supabase()
    state: dict[str, Any] = {
        "status": "running",
        "progress": 0,
        "events": [],
        "summary": {},
    }
    client: CanvasClient | None = None
    try:
        _update_job(supabase, job_id, {
            "status": "running",
            "attempts": 1,
            "started_at": utc_now_iso(),
            "result": state,
        })

        plan = _load_transfer_plan(supabase, session_id=session_id, user_id=user_id)
        source_course = plan.get("source_course") if isinstance(plan.get("source_course"), dict) else None
        if not source_course:
            raise ValueError("No source Canvas course is connected to this session")

        source_course_info, pat_token = resolve_source_course_access(
            supabase,
            user_id=user_id,
            source_course=source_course,
        )
        source_course_id = str(source_course_info["canvas_course_id"])
        client = CanvasClient(source_course_info["canvas_base_url"], pat_token)

        content_by_id = plan["content_by_id"]
        bodies_by_id = plan["bodies_by_id"]
        pending_ids = _pending_same_course_ids(
            supabase,
            session_id=session_id,
            user_id=user_id,
            content_by_id=content_by_id,
        )
        delete_items = _same_course_delete_items(
            supabase,
            session_id=session_id,
            user_id=user_id,
        )
        delete_ids = {row["item"]["id"] for row in delete_items if row.get("item")}
        pending_ids = [content_item_id for content_item_id in pending_ids if content_item_id not in delete_ids]
        local_modules = _same_course_local_modules(plan)
        module_operations = _same_course_module_operations(plan)
        module_item_operations = _same_course_module_item_operations(plan)
        executable_delete_count = sum(1 for row in delete_items if not row.get("skip_reason"))
        total_steps = len(local_modules) + len(module_operations) + len(pending_ids) + len(module_item_operations) + len(delete_items)
        completed_steps = 0
        error_count = 0
        module_created_count = 0
        module_operation_count = 0
        module_item_operation_count = 0
        updated_counts = {"page": 0, "assignment": 0, "discussion": 0, "quiz": 0, "quiz_question": 0}
        created_counts = {"page": 0, "assignment": 0, "discussion": 0, "quiz": 0, "quiz_question": 0}
        deleted_counts = {"page": 0, "assignment": 0, "discussion": 0, "quiz": 0, "quiz_question": 0, "file": 0}
        placed_count = 0
        now = utc_now_iso()

        _add_event(
            supabase,
            job_id,
            state,
            f"Starting same-course push to {source_course_info['name']}: {len(local_modules)} modules, {len(module_operations)} module operations, {len(pending_ids)} create/update items, {len(module_item_operations)} module item operations, {executable_delete_count} deletions",
        )
        if not local_modules and not module_operations and not pending_ids and not module_item_operations and not delete_items:
            _add_event(supabase, job_id, state, "No modified supported content found for same-course push.", "done")

        module_created_count, module_error_count = _create_same_course_local_modules(
            supabase,
            job_id=job_id,
            state=state,
            session_id=session_id,
            user_id=user_id,
            client=client,
            course_id=source_course_id,
            plan=plan,
            now=now,
        )
        error_count += module_error_count
        completed_steps += len(local_modules)
        _set_progress(supabase, job_id, state, completed_steps, total_steps)

        module_operation_count, module_operation_error_count = _apply_same_course_module_operations(
            supabase,
            job_id=job_id,
            state=state,
            session_id=session_id,
            user_id=user_id,
            client=client,
            course_id=source_course_id,
            plan=plan,
            now=now,
        )
        error_count += module_operation_error_count
        completed_steps += len(module_operations)
        _set_progress(supabase, job_id, state, completed_steps, total_steps)

        for content_item_id in pending_ids:
            content = content_by_id.get(content_item_id) or {}
            body = bodies_by_id.get(content_item_id) or {}
            content_type = str(content.get("content_type") or "")
            title = _compact_text(content.get("title"), 255) or f"Untitled {_content_type_label(content_type).title()}"
            html_body = str(body.get("html_body") or "")
            is_new_local = _is_local_canvas_id(content.get("canvas_id")) or bool(_metadata(content).get("is_new_local"))
            try:
                canvas_response: dict[str, Any] = {}
                if is_new_local:
                    if _content_targets_uncreated_local_module(plan, content):
                        raise ValueError("Target module has not been created in Canvas yet")
                    if content_type == "page":
                        canvas_response = _create_canvas_page(
                            client,
                            course_id=source_course_id,
                            title=title,
                            html_body=html_body,
                            published=bool(content.get("published")),
                        )
                    elif content_type == "assignment":
                        canvas_response = _create_canvas_assignment(
                            client,
                            course_id=source_course_id,
                            title=title,
                            html_body=html_body,
                            published=bool(content.get("published")),
                        )
                    elif content_type == "discussion":
                        canvas_response = _create_canvas_discussion(
                            client,
                            course_id=source_course_id,
                            title=title,
                            html_body=html_body,
                            published=bool(content.get("published")),
                        )
                    elif content_type == "quiz":
                        if not is_classic_quiz(content):
                            raise ValueError("New Quizzes are not supported by this transfer slice")
                        canvas_response = create_canvas_quiz(
                            client,
                            course_id=source_course_id,
                            title=title,
                            html_body=html_body,
                            published=False,
                            metadata=_metadata(content),
                        )
                    else:
                        raise ValueError(f"Unsupported same-course content type: {content_type}")

                    next_metadata = _metadata_for_created_content(content_type, _metadata(content), canvas_response)
                    next_canvas_id = _canvas_id_for_created_content(content_type, canvas_response, content.get("canvas_id"))
                    next_canvas_url = _canvas_url_for_created_content(
                        canvas_base_url=str(source_course_info["canvas_base_url"]),
                        course_id=source_course_id,
                        content_type=content_type,
                        response=canvas_response,
                    )
                    next_published = canvas_response.get("published")
                    if next_published is None:
                        next_published = content.get("published")
                    placed_in_module, _, placement_warning = _place_same_course_created_content(
                        supabase,
                        session_id=session_id,
                        user_id=user_id,
                        client=client,
                        course_id=source_course_id,
                        plan=plan,
                        content=content,
                        canvas_ref=next_canvas_id,
                        canvas_response=canvas_response,
                        now=now,
                    )
                    if placed_in_module:
                        placed_count += 1
                        next_metadata["pending_module_placement"] = False
                    elif placement_warning:
                        next_metadata["pending_module_placement"] = True
                        _add_report_item(
                            state,
                            "warnings",
                            title=title,
                            content_type=content_type,
                            action="place",
                            status="warning",
                            reason=placement_warning,
                            canvas_url=next_canvas_url,
                        )

                    plain_text = html_to_text(html_body)
                    supabase.table("course_content_items").update({
                        "canvas_id": next_canvas_id,
                        "title": canvas_response.get("title") or canvas_response.get("name") or title,
                        "canvas_url": next_canvas_url,
                        "published": next_published,
                        "module_canvas_id": next_metadata.get("desired_canvas_module_id") if placed_in_module else content.get("module_canvas_id"),
                        "module_name": next_metadata.get("desired_module_name") if placed_in_module else content.get("module_name"),
                        "is_orphaned": False if placed_in_module else content.get("is_orphaned"),
                        "metadata": next_metadata,
                        "body_hash": sha256_payload({"title": title, "html_body": html_body, "metadata": next_metadata}),
                        "body_word_count": word_count(plain_text),
                        "last_canvas_edit_at": _canvas_updated_timestamp(content_type, canvas_response),
                        "last_synced_at": now,
                        "updated_at": now,
                    }).eq("id", content_item_id).eq("session_id", session_id).eq("user_id", user_id).execute()
                    created_counts[content_type] = created_counts.get(content_type, 0) + 1
                    _add_report_item(
                        state,
                        "created",
                        title=title,
                        content_type=content_type,
                        action="create",
                        status="done",
                        canvas_url=next_canvas_url,
                    )
                    if placed_in_module:
                        _add_report_item(
                            state,
                            "placed",
                            title=title,
                            content_type=content_type,
                            action="place",
                            status="done",
                            reason="Placed in the selected source Canvas module.",
                            canvas_url=next_canvas_url,
                        )
                else:
                    if content_type == "page":
                        page_ref = _page_canvas_ref(content)
                        if not page_ref:
                            raise ValueError("Canvas page URL is missing")
                        _update_canvas_page(client, course_id=source_course_id, page_url=page_ref, html_body=html_body)
                    elif content_type == "assignment":
                        assignment_id = str(content.get("canvas_id") or "")
                        if not assignment_id:
                            raise ValueError("Canvas assignment ID is missing")
                        _update_canvas_assignment(client, course_id=source_course_id, assignment_id=assignment_id, html_body=html_body)
                    elif content_type == "discussion":
                        discussion_id = str(content.get("canvas_id") or "")
                        if not discussion_id:
                            raise ValueError("Canvas discussion ID is missing")
                        _update_canvas_discussion(client, course_id=source_course_id, discussion_id=discussion_id, html_body=html_body)
                    elif content_type == "quiz":
                        if not is_classic_quiz(content):
                            raise ValueError("New Quizzes are not supported by this transfer slice")
                        quiz_id = str(content.get("canvas_id") or "")
                        if not quiz_id:
                            raise ValueError("Canvas quiz ID is missing")
                        _assert_no_quiz_submissions(client, course_id=source_course_id, quiz=content)
                        canvas_response = update_canvas_quiz(
                            client,
                            course_id=source_course_id,
                            quiz_id=quiz_id,
                            title=title,
                            html_body=html_body,
                            published=bool(content.get("published")),
                        )
                        question_created, question_updated, question_deleted, question_errors = _push_same_course_quiz_questions(
                            supabase,
                            session_id=session_id,
                            user_id=user_id,
                            client=client,
                            course_id=source_course_id,
                            plan=plan,
                            quiz=content,
                            quiz_html_body=html_body,
                            now=now,
                            state=state,
                            job_id=job_id,
                        )
                        created_counts["quiz_question"] += question_created
                        updated_counts["quiz_question"] += question_updated
                        deleted_counts["quiz_question"] += question_deleted
                        error_count += question_errors
                    else:
                        raise ValueError(f"Unsupported same-course content type: {content_type}")

                    updated_counts[content_type] = updated_counts.get(content_type, 0) + 1
                    supabase.table("course_content_items").update({
                        "last_synced_at": now,
                        "updated_at": now,
                    }).eq("id", content_item_id).eq("session_id", session_id).eq("user_id", user_id).execute()
                    _add_report_item(
                        state,
                        "updated",
                        title=title,
                        content_type=content_type,
                        action="update",
                        status="done",
                        canvas_url=content.get("canvas_url"),
                    )
                _add_event(
                    supabase,
                    job_id,
                    state,
                    f"{'Created' if is_new_local else 'Updated'} {_content_type_label(content_type)}: {title}",
                    "done",
                )
            except Exception as exc:
                error_count += 1
                _add_report_item(
                    state,
                    "errors",
                    title=title,
                    content_type=content_type,
                    action="create" if is_new_local else "update",
                    status="error",
                    reason=exc,
                    canvas_url=content.get("canvas_url"),
                )
                _add_event(
                    supabase,
                    job_id,
                    state,
                    f"Failed to {'create' if is_new_local else 'update'} {_content_type_label(content_type)} '{title}': {exc}",
                    "error",
                )
            completed_steps += 1
            _set_progress(supabase, job_id, state, completed_steps, total_steps)

        module_item_operation_count, module_item_operation_error_count = _apply_same_course_module_item_operations(
            supabase,
            job_id=job_id,
            state=state,
            session_id=session_id,
            user_id=user_id,
            client=client,
            course_id=source_course_id,
            plan=plan,
            now=now,
        )
        error_count += module_item_operation_error_count
        completed_steps += len(module_item_operations)
        _set_progress(supabase, job_id, state, completed_steps, total_steps)

        for row in delete_items:
            content = row["item"]
            decision = row["decision"]
            content_type = str(content.get("content_type") or "")
            title = _compact_text(content.get("title"), 255) or f"Untitled {_content_type_label(content_type).title()}"
            if row.get("skip_reason"):
                report_category = "protected" if "referenced" in str(row["skip_reason"]).casefold() or "matching kept" in str(row["skip_reason"]).casefold() else "skipped"
                _add_report_item(
                    state,
                    report_category,
                    title=title,
                    content_type=content_type,
                    action="delete",
                    status="skipped",
                    reason=row["skip_reason"],
                    canvas_url=content.get("canvas_url"),
                )
                _add_event(
                    supabase,
                    job_id,
                    state,
                    f"Skipped deletion for {_content_type_label(content_type)} '{title}': {row['skip_reason']}",
                    "warning",
                )
                completed_steps += 1
                _set_progress(supabase, job_id, state, completed_steps, total_steps)
                continue
            try:
                if content_type == "page":
                    page_ref = _page_canvas_ref(content)
                    if not page_ref:
                        raise ValueError("Canvas page URL is missing")
                    _delete_canvas_page(client, course_id=source_course_id, page_url=page_ref)
                elif content_type == "assignment":
                    assignment_id = str(content.get("canvas_id") or "")
                    if not assignment_id:
                        raise ValueError("Canvas assignment ID is missing")
                    _delete_canvas_assignment(client, course_id=source_course_id, assignment_id=assignment_id)
                elif content_type == "discussion":
                    discussion_id = str(content.get("canvas_id") or "")
                    if not discussion_id:
                        raise ValueError("Canvas discussion ID is missing")
                    _delete_canvas_discussion(client, course_id=source_course_id, discussion_id=discussion_id)
                elif content_type == "quiz":
                    quiz_id = str(content.get("canvas_id") or "")
                    if not quiz_id:
                        raise ValueError("Canvas quiz ID is missing")
                    if not is_classic_quiz(content):
                        raise ValueError("New Quizzes are not supported by this transfer slice")
                    _assert_no_quiz_submissions(client, course_id=source_course_id, quiz=content)
                    delete_canvas_quiz(client, course_id=source_course_id, quiz_id=quiz_id)
                elif content_type == "file":
                    file_id = str(content.get("canvas_id") or "")
                    if not file_id:
                        raise ValueError("Canvas file ID is missing")
                    _delete_canvas_file(client, file_id=file_id)
                else:
                    raise ValueError(f"Unsupported same-course deletion type: {content_type}")

                deleted_counts[content_type] = deleted_counts.get(content_type, 0) + 1
                supabase.table("content_inventory_decisions").update({
                    "applied_to_canvas": True,
                    "applied_at": now,
                    "updated_at": now,
                }).eq("id", decision["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
                supabase.table("course_content_items").update({
                    "is_orphaned": True,
                    "last_synced_at": now,
                    "updated_at": now,
                }).eq("id", content["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()
                _add_report_item(
                    state,
                    "deleted",
                    title=title,
                    content_type=content_type,
                    action="delete",
                    status="done",
                    canvas_url=content.get("canvas_url"),
                )
                _add_event(supabase, job_id, state, f"Deleted {_content_type_label(content_type)}: {title}", "done")
            except Exception as exc:
                error_count += 1
                _add_report_item(
                    state,
                    "errors",
                    title=title,
                    content_type=content_type,
                    action="delete",
                    status="error",
                    reason=exc,
                    canvas_url=content.get("canvas_url"),
                )
                _add_event(supabase, job_id, state, f"Failed to delete {_content_type_label(content_type)} '{title}': {exc}", "error")
            completed_steps += 1
            _set_progress(supabase, job_id, state, completed_steps, total_steps)

        warning_count = _report_count(state, "warnings")
        state["status"] = "succeeded" if error_count == 0 and warning_count == 0 else "succeeded_with_warnings"
        state["progress"] = 1
        state["target_course"] = source_course_info
        state["summary"] = {
            "mode": "same_course",
            "modules_created": module_created_count,
            "module_operations_applied": module_operation_count,
            "module_item_operations_applied": module_item_operation_count,
            "items_updated": sum(updated_counts.values()),
            "pages_updated": updated_counts.get("page", 0),
            "assignments_updated": updated_counts.get("assignment", 0),
            "discussions_updated": updated_counts.get("discussion", 0),
            "quizzes_updated": updated_counts.get("quiz", 0),
            "quiz_questions_updated": updated_counts.get("quiz_question", 0),
            "items_created": sum(created_counts.values()),
            "pages_created": created_counts.get("page", 0),
            "assignments_created": created_counts.get("assignment", 0),
            "discussions_created": created_counts.get("discussion", 0),
            "quizzes_created": created_counts.get("quiz", 0),
            "quiz_questions_created": created_counts.get("quiz_question", 0),
            "placements_created": placed_count,
            "items_deleted": sum(deleted_counts.values()),
            "pages_deleted": deleted_counts.get("page", 0),
            "assignments_deleted": deleted_counts.get("assignment", 0),
            "discussions_deleted": deleted_counts.get("discussion", 0),
            "quizzes_deleted": deleted_counts.get("quiz", 0),
            "quiz_questions_deleted": deleted_counts.get("quiz_question", 0),
            "files_deleted": deleted_counts.get("file", 0),
            "protected_skipped": _report_count(state, "protected"),
            "items_skipped": _report_count(state, "skipped"),
            "warnings": warning_count,
            "errors": error_count,
        }
        _add_event(
            supabase,
            job_id,
            state,
            f"Same-course push complete: {module_created_count} modules, {module_operation_count} module operations, {sum(created_counts.values())} created, {sum(updated_counts.values())} updated, {module_item_operation_count} module item operations, {sum(deleted_counts.values())} deleted",
            "done" if error_count == 0 and warning_count == 0 else "warning",
        )
        _update_job(supabase, job_id, {
            "status": "succeeded",
            "result": state,
            "finished_at": utc_now_iso(),
        })
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="transfer_same_course_push_completed",
            properties={
                "job_id": job_id,
                "source_course": source_course_info,
                "summary": state["summary"],
            },
        )
    except Exception as exc:
        state["status"] = "failed"
        state["error"] = str(exc)
        _add_event(supabase, job_id, state, f"Same-course push failed: {exc}", "error")
        _update_job(supabase, job_id, {
            "status": "failed",
            "result": state,
            "error_message": str(exc),
            "finished_at": utc_now_iso(),
        })
    finally:
        if client is not None:
            try:
                client.close()
            except httpx.HTTPError:
                pass
