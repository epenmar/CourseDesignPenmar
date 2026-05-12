"""Course module graph and local module staging routes."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from content_inventory import compact_whitespace
from services.document_records import get_owned_session, write_platform_event
from services.pending_review.module_operations import module_operation_response
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas", tags=["modules"])

MODULE_ITEM_SELECT = (
    "id, module_id, content_item_id, canvas_module_id, canvas_module_item_id, "
    "canvas_content_id, page_url, title, module_item_type, content_type, position, "
    "indent, published, completion_requirement, html_url, external_url, new_tab, "
    "metadata, created_at, updated_at"
)


class ModuleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    position: int | None = None
    published: bool = True


def canvas_position_sort(row: dict[str, Any]):
    position = row.get("position")
    return (position is None, position if position is not None else 10**9, row.get("created_at") or "")


@router.get("/sessions/{session_id}/module-graph")
async def get_session_module_graph(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    modules_result = supabase.table("course_modules").select(
        "id, canvas_module_id, name, position, published, workflow_state, items_count, "
        "unlock_at, require_sequential_progress, metadata, created_at, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    item_result = supabase.table("course_module_items").select(MODULE_ITEM_SELECT).eq(
        "session_id", session_id
    ).eq("user_id", user_id).execute()

    modules = sorted(modules_result.data or [], key=canvas_position_sort)
    items_by_module: dict[str, list[dict[str, Any]]] = {}
    for item in item_result.data or []:
        items_by_module.setdefault(item["canvas_module_id"], []).append(item)

    for module in modules:
        module["items"] = sorted(
            items_by_module.get(module["canvas_module_id"], []),
            key=canvas_position_sort,
        )

    return {
        "modules": modules,
        "module_count": len(modules),
        "item_count": sum(len(module["items"]) for module in modules),
    }


@router.post("/sessions/{session_id}/modules")
async def create_session_module(
    session_id: str,
    body: ModuleCreateRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    name = compact_whitespace(body.name)
    if not name:
        raise HTTPException(status_code=422, detail="Module name is required")

    position_result = supabase.table("course_modules").select(
        "position"
    ).eq("session_id", session_id).eq("user_id", user_id).order(
        "position", desc=True
    ).limit(1).execute()
    last_position = (position_result.data or [{}])[0].get("position") if position_result.data else 0
    position = max(1, int(body.position or 0)) if body.position else int(last_position or 0) + 1
    now = datetime.now(timezone.utc).isoformat()
    module_id = str(uuid.uuid4())
    local_canvas_module_id = f"local:{module_id}"

    module_values = {
        "id": module_id,
        "session_id": session_id,
        "user_id": user_id,
        "canvas_module_id": local_canvas_module_id,
        "name": name,
        "position": position,
        "published": body.published,
        "workflow_state": "unpublished" if not body.published else "active",
        "items_count": 0,
        "metadata": {
            "is_new_local": True,
            "created_in_v2": True,
            "pending_canvas_push": True,
        },
        "created_at": now,
        "updated_at": now,
    }
    module_result = supabase.table("course_modules").insert(module_values).execute()
    module = module_result.data[0] if module_result.data else module_values

    operation_values = {
        "session_id": session_id,
        "user_id": user_id,
        "operation_key": f"module_create:{module_id}",
        "operation_type": "module_create",
        "target_type": "module",
        "module_id": module_id,
        "module_item_id": None,
        "content_item_id": None,
        "canvas_module_id": local_canvas_module_id,
        "canvas_module_item_id": None,
        "title": name,
        "action_label": "Create Module",
        "detail": f"{name}: create module at position {position}",
        "before_state": {},
        "after_state": {
            "name": name,
            "position": position,
            "published": body.published,
        },
        "status": "staged",
        "created_at": now,
        "updated_at": now,
    }
    operation_result = supabase.table("module_queue_operations").insert(operation_values).execute()
    operation = operation_result.data[0] if operation_result.data else operation_values

    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="module_created_locally",
        properties={
            "module_id": module_id,
            "module_name": name,
            "position": position,
            "created_at": now,
        },
    )

    return {
        "module": module,
        "operation": module_operation_response(operation),
    }
