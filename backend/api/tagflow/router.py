"""TagFlow asset API routes.

Provides focused preview/crop endpoints that support the TagFlow editor and
future OCR-assisted flowchart tools outside the legacy Canvas router.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response

from ai_image_text import is_ai_configured
from auth import get_current_user
from models.pdf import TagFlowPageZonesRequest, TagFlowPreviewRequest, TagFlowSuggestionRequest, TagFlowZoneFigureGenerateRequest
from r2_storage import download_bytes, is_r2_configured
from services.document_records import get_document_file_row, get_owned_session, update_document_remediation_metadata, write_platform_event
from services.documents.assets import load_document_pdf_bytes
from services.documents.inventory import get_session_document_row
from services.documents.tagflow_jobs import queue_tagflow_ai_suggestion_job
from services.documents.tagflow_previews import queue_document_structure_preview_job
from services.job_queue import JobAdmissionError
from services.pdf_export.readiness import build_pdf_export_readiness
from services.tagflow_assets import attach_tagflow_preview_signed_urls, crop_preview_asset_to_webp, find_tagflow_page_asset
from services.tagflow_figures import generate_tagflow_zone_figure_text
from services.tagflow_state import update_tagflow_page_zones
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas", tags=["tagflow"])
logger = logging.getLogger(__name__)


@router.get("/sessions/{session_id}/documents/{document_id}/tagflow")
async def get_session_document_tagflow(
    session_id: str,
    document_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_document_file_row(supabase, session_id, user_id, document_id)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    remediation = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else None
    if not remediation:
        raise HTTPException(status_code=404, detail="Run PDF review before opening TagFlow")
    export_readiness = build_pdf_export_readiness(remediation)
    remediation = attach_tagflow_preview_signed_urls({
        **remediation,
        "export_readiness": export_readiness,
    })
    return {
        "document": {
            "id": row.get("id"),
            "canvas_id": row.get("canvas_id"),
            "title": row.get("title") or metadata.get("filename"),
            "filename": metadata.get("filename") or row.get("title"),
            "mime_type": metadata.get("mime_type") or metadata.get("content_type"),
        },
        "metadata": remediation.get("metadata"),
        "metadata_review": remediation.get("metadata_review"),
        "export_readiness": remediation.get("export_readiness") or export_readiness,
        "structure_preview": remediation.get("structure_preview"),
        "tagflow_state": remediation.get("tagflow_state"),
        "updated_at": remediation.get("extracted_at"),
    }


@router.post("/sessions/{session_id}/documents/{document_id}/tagflow/previews")
async def start_session_document_tagflow_previews(
    session_id: str,
    document_id: str,
    background_tasks: BackgroundTasks,
    payload: TagFlowPreviewRequest | None = None,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    if (row.get("extension") or "").lower() != "pdf" and row.get("mime_type") != "application/pdf":
        raise HTTPException(status_code=422, detail="TagFlow previews are currently available for PDF files only")
    try:
        job_id = queue_document_structure_preview_job(
            supabase,
            session_id=session_id,
            user_id=user_id,
            row=row,
            page_numbers=payload.page_numbers if payload else None,
            background_tasks=background_tasks,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    return {"job_id": job_id, "document_id": row["id"], "status": "queued"}


@router.post("/sessions/{session_id}/documents/{document_id}/tagflow/suggestions")
async def start_session_document_tagflow_suggestions(
    session_id: str,
    document_id: str,
    background_tasks: BackgroundTasks,
    payload: TagFlowSuggestionRequest | None = None,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    if (row.get("extension") or "").lower() != "pdf" and row.get("mime_type") != "application/pdf":
        raise HTTPException(status_code=422, detail="TagFlow suggestions are currently available for PDF files only")
    try:
        job_id = queue_tagflow_ai_suggestion_job(
            supabase,
            session_id=session_id,
            user_id=user_id,
            row=row,
            page_numbers=payload.page_numbers if payload else None,
            background_tasks=background_tasks,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    return {"job_id": job_id, "document_id": row["id"], "status": "queued"}


@router.put("/sessions/{session_id}/documents/{document_id}/tagflow/pages/{page_number}/zones")
async def update_session_document_tagflow_page_zones(
    session_id: str,
    document_id: str,
    page_number: int,
    payload: TagFlowPageZonesRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if page_number < 1:
        raise HTTPException(status_code=422, detail="Page number must be 1 or greater")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_document_file_row(supabase, session_id, user_id, document_id)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    remediation = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else None
    if not remediation:
        raise HTTPException(status_code=409, detail="Run PDF review before editing TagFlow zones")

    updated_at = datetime.now(timezone.utc).isoformat()
    next_remediation = update_tagflow_page_zones(
        remediation_plan=remediation,
        page_number=page_number,
        zones=payload.zones,
        updated_at=updated_at,
        review_status=payload.review_status,
    )
    next_remediation = {
        **next_remediation,
        "export_readiness": build_pdf_export_readiness(next_remediation),
    }
    update_document_remediation_metadata(
        supabase,
        session_id=session_id,
        user_id=user_id,
        document_id=row["id"],
        remediation_plan=next_remediation,
        updated_at=updated_at,
    )
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="document_tagflow_zones_updated",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "page_number": page_number,
            "zone_count": len(payload.zones),
            "review_status": payload.review_status or "edited",
            "tagflow_version": (next_remediation.get("tagflow_state") or {}).get("version"),
        },
    )
    return {
        "document_id": row["id"],
        "page_number": page_number,
        "zone_count": len(payload.zones),
        "tagflow_state": next_remediation.get("tagflow_state"),
        "export_readiness": next_remediation.get("export_readiness"),
    }


@router.get("/sessions/{session_id}/documents/{document_id}/tagflow/pages/{page_number}/asset")
async def get_session_document_tagflow_page_asset(
    session_id: str,
    document_id: str,
    page_number: int,
    user: dict = Depends(get_current_user),
    variant: Literal["original", "tagged"] = "original",
):
    request_started = time.perf_counter()
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if page_number < 1:
        raise HTTPException(status_code=422, detail="Page number must be 1 or greater")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    session_checked_at = time.perf_counter()
    row = get_document_file_row(supabase, session_id, user_id, document_id)
    row_loaded_at = time.perf_counter()
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    remediation = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else None
    if not remediation:
        raise HTTPException(status_code=404, detail="Run PDF review before opening TagFlow")

    asset = find_tagflow_page_asset(remediation, page_number=page_number, variant=variant)
    asset_located_at = time.perf_counter()
    if not asset or asset.get("status") != "generated" or not asset.get("r2_key"):
        raise HTTPException(status_code=404, detail=f"{variant.title()} preview asset is not available")
    if not is_r2_configured():
        raise HTTPException(status_code=503, detail="R2 storage is not configured")

    try:
        r2_started = time.perf_counter()
        payload, content_type = download_bytes(str(asset["r2_key"]))
        r2_finished = time.perf_counter()
    except Exception as exc:
        logger.exception(
            "Failed to read TagFlow preview asset session_id=%s document_id=%s page_number=%s variant=%s",
            session_id,
            row["id"],
            page_number,
            variant,
        )
        raise HTTPException(status_code=502, detail=f"Preview asset could not be loaded: {exc}")

    response_started = time.perf_counter()
    return Response(
        content=payload,
        media_type=content_type or asset.get("content_type") or "image/webp",
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-CanvasCurate-Cache": "r2",
            "X-CanvasCurate-R2-Key": "present",
            "X-CanvasCurate-Preview-Variant": variant,
            "X-CanvasCurate-Backend-Ms": str(round((response_started - request_started) * 1000, 1)),
            "X-CanvasCurate-Backend-Session-Ms": str(round((session_checked_at - request_started) * 1000, 1)),
            "X-CanvasCurate-Backend-Document-Ms": str(round((row_loaded_at - session_checked_at) * 1000, 1)),
            "X-CanvasCurate-Backend-Asset-Lookup-Ms": str(round((asset_located_at - row_loaded_at) * 1000, 1)),
            "X-CanvasCurate-R2-Ms": str(round((r2_finished - r2_started) * 1000, 1)),
            "X-CanvasCurate-Asset-Bytes": str(len(payload)),
        },
    )


@router.get("/sessions/{session_id}/documents/{document_id}/tagflow/pages/{page_number}/zone-image")
async def get_session_document_tagflow_zone_image(
    session_id: str,
    document_id: str,
    page_number: int,
    x: float = Query(ge=0, le=100),
    y: float = Query(ge=0, le=100),
    width: float = Query(gt=0, le=100),
    height: float = Query(gt=0, le=100),
    user: dict = Depends(get_current_user),
):
    request_started = time.perf_counter()
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if page_number < 1:
        raise HTTPException(status_code=422, detail="Page number must be 1 or greater")
    if not is_r2_configured():
        raise HTTPException(status_code=503, detail="R2 storage is not configured")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    session_checked_at = time.perf_counter()
    row = get_document_file_row(supabase, session_id, user_id, document_id)
    row_loaded_at = time.perf_counter()
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    remediation = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else None
    if not remediation:
        raise HTTPException(status_code=404, detail="Run PDF review before opening TagFlow")

    asset = find_tagflow_page_asset(remediation, page_number=page_number, variant="original")
    asset_located_at = time.perf_counter()
    if not asset:
        raise HTTPException(status_code=404, detail="Original preview asset is not available")

    try:
        crop_started = time.perf_counter()
        payload, crop_width, crop_height = crop_preview_asset_to_webp(
            asset,
            {"x": x, "y": y, "width": width, "height": height},
        )
        crop_finished = time.perf_counter()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Zone image could not be created: {exc}")

    response_started = time.perf_counter()
    return Response(
        content=payload,
        media_type="image/webp",
        headers={
            "Cache-Control": "private, max-age=900",
            "X-CanvasCurate-Cache": "r2-crop",
            "X-CanvasCurate-Zone-Width": str(crop_width),
            "X-CanvasCurate-Zone-Height": str(crop_height),
            "X-CanvasCurate-Asset-Bytes": str(len(payload)),
            "X-CanvasCurate-Backend-Ms": str(round((response_started - request_started) * 1000, 1)),
            "X-CanvasCurate-Backend-Session-Ms": str(round((session_checked_at - request_started) * 1000, 1)),
            "X-CanvasCurate-Backend-Document-Ms": str(round((row_loaded_at - session_checked_at) * 1000, 1)),
            "X-CanvasCurate-Backend-Asset-Lookup-Ms": str(round((asset_located_at - row_loaded_at) * 1000, 1)),
            "X-CanvasCurate-Crop-Ms": str(round((crop_finished - crop_started) * 1000, 1)),
        },
    )


@router.post("/sessions/{session_id}/documents/{document_id}/tagflow/pages/{page_number}/figure-text/generate")
async def generate_session_document_tagflow_zone_figure_text(
    session_id: str,
    document_id: str,
    page_number: int,
    body: TagFlowZoneFigureGenerateRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="ASU AIML is not configured for this environment")
    if page_number < 1:
        raise HTTPException(status_code=422, detail="Page number is invalid")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else {}
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    pages = tagflow_state.get("pages") if isinstance(tagflow_state.get("pages"), list) else []
    if not any(isinstance(page, dict) and int(page.get("page_number") or 0) == page_number for page in pages):
        raise HTTPException(status_code=404, detail="TagFlow page not found")

    bounds = {
        "x": body.x,
        "y": body.y,
        "width": body.width,
        "height": body.height,
    }
    try:
        pdf_data, _ = load_document_pdf_bytes(
            supabase,
            session_id=session_id,
            user_id=user_id,
            row=row,
        )
        result = generate_tagflow_zone_figure_text(
            pdf_data=pdf_data,
            document_name=str(row.get("filename") or row.get("title") or row["id"]),
            page_number=page_number,
            bounds=bounds,
            mode=body.mode,
            figure_type=body.figure_type,
            guidance=body.guidance,
        )
    except Exception as exc:
        logger.exception(
            "Failed to generate TagFlow zone figure text session_id=%s document_id=%s page_number=%s",
            session_id,
            row["id"],
            page_number,
        )
        raise HTTPException(status_code=502, detail=f"TagFlow zone figure text could not be generated: {exc}")
    result = {
        **result,
        "document_id": row["id"],
        "zone_id": body.zone_id,
    }
    requested_figure_type = str(result.get("figure_type") or "image")
    requested_guidance = str(result.get("flowchart_guidance") or "")

    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="document_tagflow_zone_figure_text_generated",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "page_number": page_number,
            "zone_id": body.zone_id,
            "mode": body.mode,
            "figure_type": requested_figure_type,
            "has_flowchart_guidance": bool(requested_guidance),
        },
    )
    return result
