"""Link-owned Canvas routes.

This router keeps link inventory, AI link text suggestions, and link text
apply-to-review endpoints under the existing `/canvas/sessions/...` URLs while
route ownership moves out of the legacy Canvas router.
"""

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from auth import get_current_user
from api.links.schemas import (
    BulkLinkTextApplyRequest,
    BulkLinkTextSuggestionRequest,
    LinkTextApplyRequest,
    LinkTextSuggestionRequest,
)
from services.links.text import (
    apply_session_link_text as apply_session_link_text_service,
    bulk_apply_session_link_text as bulk_apply_session_link_text_service,
    bulk_suggest_session_link_text as bulk_suggest_session_link_text_service,
    list_session_links as list_session_links_service,
    suggest_session_link_text as suggest_session_link_text_service,
)


router = APIRouter(prefix="/canvas", tags=["links"])


def user_id_from_token(user: dict) -> str:
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return user_id


@router.get("/sessions/{session_id}/links")
async def list_session_links(
    session_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = None,
    status: Literal["all", "flagged", "good"] = "all",
):
    return list_session_links_service(
        session_id=session_id,
        user_id=user_id_from_token(user),
        limit=limit,
        offset=offset,
        q=q,
        status=status,
    )


@router.post("/sessions/{session_id}/links/suggest-text")
async def suggest_session_link_text(
    session_id: str,
    body: LinkTextSuggestionRequest,
    user: dict = Depends(get_current_user),
):
    return suggest_session_link_text_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/links/suggest-text/bulk")
async def bulk_suggest_session_link_text(
    session_id: str,
    body: BulkLinkTextSuggestionRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    return bulk_suggest_session_link_text_service(
        session_id=session_id,
        body=body,
        background_tasks=background_tasks,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/links/apply-text")
async def apply_session_link_text(
    session_id: str,
    body: LinkTextApplyRequest,
    user: dict = Depends(get_current_user),
):
    return apply_session_link_text_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/links/apply-text/bulk")
async def bulk_apply_session_link_text(
    session_id: str,
    body: BulkLinkTextApplyRequest,
    user: dict = Depends(get_current_user),
):
    return bulk_apply_session_link_text_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )
