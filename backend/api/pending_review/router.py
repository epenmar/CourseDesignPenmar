"""Session Pending Review routes.

These routes keep the existing `/canvas/sessions/...` API surface while moving
Pending Review ownership out of the legacy Canvas router.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from api.pending_review.schemas import (
    ApplyModuleOperationsRequest,
    ContentPushRequest,
    ModuleLevelOperationRequest,
    ModuleOperationRequest,
)
from services.canvas_uploads import canvas_course_connection
from services.document_records import get_owned_session
from services.pending_review.content_changes import (
    build_content_pending_diff,
    build_session_pending_changes,
)
from services.pending_review.content_push import push_content_item_to_canvas
from services.pending_review.module_operations import (
    apply_staged_module_operations_to_canvas,
    delete_all_staged_module_operations,
    delete_staged_module_operation,
    list_staged_module_operations,
    stage_module_item_operation,
    stage_module_level_operation,
)
from services.pending_review.push_history import (
    list_content_push_history,
    list_module_apply_history,
)
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas", tags=["pending-review"])


@router.get("/sessions/{session_id}/push-history")
async def get_session_push_history(
    session_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=20, ge=1, le=100),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return list_content_push_history(
        supabase,
        session_id=session_id,
        user_id=user_id,
        limit=limit,
    )


@router.get("/sessions/{session_id}/module-apply-history")
async def get_session_module_apply_history(
    session_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=20, ge=1, le=100),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return list_module_apply_history(
        supabase,
        session_id=session_id,
        user_id=user_id,
        limit=limit,
    )


@router.get("/sessions/{session_id}/pending-changes")
async def get_session_pending_changes(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return build_session_pending_changes(
        supabase,
        session_id=session_id,
        user_id=user_id,
    )


@router.get("/sessions/{session_id}/content/{content_item_id}/pending-diff")
async def get_content_pending_diff(
    session_id: str,
    content_item_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return build_content_pending_diff(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
    )


@router.get("/sessions/{session_id}/module-operations")
async def list_session_module_operations(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return list_staged_module_operations(
        supabase,
        session_id=session_id,
        user_id=user_id,
    )


@router.post("/sessions/{session_id}/module-operations")
async def stage_session_module_operation(
    session_id: str,
    body: ModuleOperationRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return stage_module_item_operation(
        supabase,
        session_id=session_id,
        user_id=user_id,
        body=body,
    )


@router.post("/sessions/{session_id}/module-level-operations")
async def stage_session_module_level_operation(
    session_id: str,
    body: ModuleLevelOperationRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return stage_module_level_operation(
        supabase,
        session_id=session_id,
        user_id=user_id,
        body=body,
    )


@router.delete("/sessions/{session_id}/module-operations/{operation_id}")
async def delete_session_module_operation(
    session_id: str,
    operation_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return delete_staged_module_operation(
        supabase,
        session_id=session_id,
        user_id=user_id,
        operation_id=operation_id,
    )


@router.delete("/sessions/{session_id}/module-operations")
async def delete_session_module_operations(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    return delete_all_staged_module_operations(
        supabase,
        session_id=session_id,
        user_id=user_id,
    )


@router.post("/sessions/{session_id}/module-operations/apply")
async def apply_session_module_operations(
    session_id: str,
    body: ApplyModuleOperationsRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    course = canvas_course_connection(supabase, session_id, user_id)
    return apply_staged_module_operations_to_canvas(
        supabase,
        session_id=session_id,
        user_id=user_id,
        canvas_base_url=course["canvas_base_url"],
        canvas_course_id=course["canvas_course_id"],
        operation_ids=body.operation_ids,
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/push")
async def push_session_content_item_to_canvas(
    session_id: str,
    content_item_id: str,
    body: ContentPushRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    course = canvas_course_connection(supabase, session_id, user_id)
    return await push_content_item_to_canvas(
        supabase,
        session_id=session_id,
        content_item_id=content_item_id,
        user_id=user_id,
        user=user,
        body=body,
        canvas_base_url=course["canvas_base_url"],
        canvas_course_id=course["canvas_course_id"],
    )
