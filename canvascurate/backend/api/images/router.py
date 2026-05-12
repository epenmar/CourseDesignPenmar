"""Image-owned Canvas routes.

This router keeps image inventory, image accessibility text, editor image
uploads, and image asset endpoints under the existing `/canvas/sessions/...`
URLs while route ownership moves out of the legacy Canvas router.
"""

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile

from auth import get_current_user
from api.images.schemas import (
    BulkImageApplyRequest,
    BulkImageUpdateRequest,
    GenerateBulkImageTextRequest,
    GenerateImageTextRequest,
    ImageUpdateRequest,
)
from services.images.inventory import (
    bulk_update_session_images as bulk_update_session_images_service,
    get_session_image_asset as get_session_image_asset_service,
    list_session_images as list_session_images_service,
    update_session_image as update_session_image_service,
    upload_editor_image as upload_editor_image_service,
)
from services.images.text import (
    apply_session_image_to_content as apply_session_image_to_content_service,
    bulk_apply_session_images_to_content as bulk_apply_session_images_to_content_service,
    generate_session_image_text as generate_session_image_text_service,
    generate_session_image_text_bulk as generate_session_image_text_bulk_service,
    get_session_image as get_session_image_service,
)


router = APIRouter(prefix="/canvas", tags=["images"])


def user_id_from_token(user: dict) -> str:
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return user_id


@router.get("/sessions/{session_id}/images")
async def list_session_images(
    session_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = None,
    alt: Literal["all", "missing", "complete"] = "all",
    status: Literal["all", "deployed", "broken", "orphaned"] = "all",
    refresh: bool = False,
):
    return list_session_images_service(
        session_id=session_id,
        user_id=user_id_from_token(user),
        limit=limit,
        offset=offset,
        q=q,
        alt=alt,
        status=status,
        refresh=refresh,
    )


@router.post("/sessions/{session_id}/images/bulk")
async def bulk_update_session_images(
    session_id: str,
    body: BulkImageUpdateRequest,
    user: dict = Depends(get_current_user),
):
    return bulk_update_session_images_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/content/{content_item_id}/images/upload")
async def upload_editor_image(
    session_id: str,
    content_item_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    return await upload_editor_image_service(
        session_id=session_id,
        content_item_id=content_item_id,
        file=file,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/images/{image_id}/apply-to-content")
async def apply_session_image_to_content(
    session_id: str,
    image_id: str,
    user: dict = Depends(get_current_user),
):
    return apply_session_image_to_content_service(
        session_id=session_id,
        image_id=image_id,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/images/apply-to-content-bulk")
async def bulk_apply_session_images_to_content(
    session_id: str,
    body: BulkImageApplyRequest,
    user: dict = Depends(get_current_user),
):
    return bulk_apply_session_images_to_content_service(
        session_id=session_id,
        body=body,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/images/{image_id}/generate")
async def generate_session_image_text(
    session_id: str,
    image_id: str,
    body: GenerateImageTextRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    return generate_session_image_text_service(
        session_id=session_id,
        image_id=image_id,
        body=body,
        background_tasks=background_tasks,
        user_id=user_id_from_token(user),
    )


@router.get("/sessions/{session_id}/images/{image_id}")
async def get_session_image(
    session_id: str,
    image_id: str,
    user: dict = Depends(get_current_user),
):
    return get_session_image_service(
        session_id=session_id,
        image_id=image_id,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/images/generate-bulk")
async def generate_session_image_text_bulk(
    session_id: str,
    body: GenerateBulkImageTextRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    return generate_session_image_text_bulk_service(
        session_id=session_id,
        body=body,
        background_tasks=background_tasks,
        user_id=user_id_from_token(user),
    )


@router.post("/sessions/{session_id}/images/{image_id}")
async def update_session_image(
    session_id: str,
    image_id: str,
    body: ImageUpdateRequest,
    user: dict = Depends(get_current_user),
):
    return update_session_image_service(
        session_id=session_id,
        image_id=image_id,
        body=body,
        user_id=user_id_from_token(user),
    )


@router.get("/sessions/{session_id}/images/{image_id}/asset")
async def get_session_image_asset(
    session_id: str,
    image_id: str,
    user: dict = Depends(get_current_user),
    variant: Literal["thumb", "original"] = "thumb",
):
    return get_session_image_asset_service(
        session_id=session_id,
        image_id=image_id,
        user_id=user_id_from_token(user),
        variant=variant,
    )
