"""Inventory-owned Canvas routes.

This router keeps content inventory and keep/remove/defer decision endpoints
under the existing `/canvas/sessions/...` URLs while route ownership moves out
of the legacy Canvas router.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from api.inventory.schemas import BulkInventoryDecisionRequest, InventoryDecisionRequest
from services.inventory.decisions import (
    list_inventory_decisions as list_inventory_decisions_service,
    list_session_inventory as list_session_inventory_service,
    save_bulk_inventory_decisions as save_bulk_inventory_decisions_service,
    save_inventory_decision as save_inventory_decision_service,
)


router = APIRouter(prefix="/canvas", tags=["inventory"])


def user_id_from_token(user: dict) -> str:
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return user_id


@router.get("/sessions/{session_id}/inventory-decisions")
async def list_inventory_decisions(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    return list_inventory_decisions_service(session_id, user_id_from_token(user))


@router.post("/sessions/{session_id}/inventory-decisions")
async def save_inventory_decision(
    session_id: str,
    body: InventoryDecisionRequest,
    user: dict = Depends(get_current_user),
):
    return save_inventory_decision_service(
        session_id=session_id,
        user_id=user_id_from_token(user),
        content_item_id=body.content_item_id,
        action=body.action,
        reason=body.reason,
    )


@router.post("/sessions/{session_id}/inventory-decisions/bulk")
async def save_bulk_inventory_decisions(
    session_id: str,
    body: BulkInventoryDecisionRequest,
    user: dict = Depends(get_current_user),
):
    return save_bulk_inventory_decisions_service(
        session_id=session_id,
        user_id=user_id_from_token(user),
        content_item_ids=body.content_item_ids,
        action=body.action,
        reason=body.reason,
    )


@router.get("/sessions/{session_id}/inventory")
async def list_session_inventory(
    session_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    content_type: str | None = None,
    q: str | None = None,
    sort: str = Query(default="created_at"),
    direction: Literal["asc", "desc"] = "desc",
):
    return list_session_inventory_service(
        session_id=session_id,
        user_id=user_id_from_token(user),
        limit=limit,
        offset=offset,
        content_type=content_type,
        q=q,
        sort=sort,
        direction=direction,
    )
