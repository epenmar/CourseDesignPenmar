"""PDF figure remediation API routes.

Owns focused figure endpoints that can move out of the legacy Canvas router as
PDF/TagFlow remediation becomes more modular.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import Response

from api.pdf_figures.schemas import PdfFigureFlowchartRequest
from ai_image_text import is_ai_configured
from auth import get_current_user
from canvas_sync import sha256_payload
from content_inventory import compact_whitespace
from models.pdf import PdfFigureGenerateRequest, PdfFigureReviewRequest
from r2_storage import download_bytes, is_r2_configured, upload_bytes
from services.document_records import (
    get_document_file_row,
    get_owned_session,
    update_document_remediation_metadata,
    write_platform_event,
)
from services.documents.assets import document_pdf_figure_asset_storage_key, load_document_pdf_bytes
from services.documents.inventory import get_session_document_row
from services.job_dispatch import dispatch_background_task
from services.job_queue import JobAdmissionError, enqueue_background_job, env_int
from services.pdf_figure_assets import sign_pdf_figure, sign_pdf_figure_inventory
from services.pdf_figures import find_pdf_figure, render_pdf_figure_crop_bytes, update_pdf_figure_asset, update_pdf_figure_review
from services.pdf_figure_text import PDF_FIGURE_TEXT_JOB_TYPE, run_pdf_figure_text_generate_job
from services.pdf_flowcharts import compact_flowchart_guidance, normalize_flowchart_structure
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas", tags=["pdf_figures"])
logger = logging.getLogger(__name__)


@router.get("/sessions/{session_id}/documents/{document_id}/figures/{figure_id}/asset")
async def get_session_document_figure_asset(
    session_id: str,
    document_id: str,
    figure_id: str,
    user: dict = Depends(get_current_user),
):
    request_started = time.perf_counter()
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    session_checked_at = time.perf_counter()
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    row_loaded_at = time.perf_counter()
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
    figure = find_pdf_figure(remediation, figure_id)
    if not figure:
        raise HTTPException(status_code=404, detail="PDF figure not found")
    asset = figure.get("asset") if isinstance(figure.get("asset"), dict) else {}
    asset_located_at = time.perf_counter()
    if asset.get("status") == "generated" and asset.get("r2_key") and is_r2_configured():
        try:
            r2_started = time.perf_counter()
            payload, content_type = download_bytes(str(asset["r2_key"]))
            r2_finished = time.perf_counter()
            response_started = time.perf_counter()
            return Response(
                content=payload,
                media_type=content_type or asset.get("content_type") or "image/webp",
                headers={
                    "Cache-Control": "private, max-age=3600",
                    "X-CanvasCurate-Cache": "r2",
                    "X-CanvasCurate-Figure-Width": str(asset.get("width") or ""),
                    "X-CanvasCurate-Figure-Height": str(asset.get("height") or ""),
                    "X-CanvasCurate-Asset-Bytes": str(len(payload)),
                    "X-CanvasCurate-Backend-Ms": str(round((response_started - request_started) * 1000, 1)),
                    "X-CanvasCurate-Backend-Session-Ms": str(round((session_checked_at - request_started) * 1000, 1)),
                    "X-CanvasCurate-Backend-Document-Ms": str(round((row_loaded_at - session_checked_at) * 1000, 1)),
                    "X-CanvasCurate-Backend-Asset-Lookup-Ms": str(round((asset_located_at - row_loaded_at) * 1000, 1)),
                    "X-CanvasCurate-R2-Ms": str(round((r2_finished - r2_started) * 1000, 1)),
                },
            )
        except Exception:
            logger.exception("Failed to read cached PDF figure asset session_id=%s document_id=%s figure_id=%s", session_id, row["id"], figure_id)

    try:
        render_started = time.perf_counter()
        pdf_data, _ = load_document_pdf_bytes(
            supabase,
            session_id=session_id,
            user_id=user_id,
            row=row,
        )
        payload, width, height = render_pdf_figure_crop_bytes(pdf_data, figure)
        render_finished = time.perf_counter()
    except Exception as exc:
        logger.exception("Failed to render PDF figure crop session_id=%s document_id=%s figure_id=%s", session_id, row["id"], figure_id)
        raise HTTPException(status_code=502, detail=f"PDF figure preview could not be rendered: {exc}")

    if is_r2_configured():
        generated_at = datetime.now(timezone.utc).isoformat()
        try:
            key = document_pdf_figure_asset_storage_key(session_id, row["id"], generated_at, figure_id)
            upload_bytes(
                key,
                payload,
                content_type="image/webp",
                cache_control="private, max-age=31536000, immutable",
                metadata={
                    "source_document_id": row["id"],
                    "source_canvas_file_id": str(row.get("canvas_id") or ""),
                    "figure_id": figure_id,
                    "page_number": str(figure.get("page_number") or ""),
                },
            )
            next_remediation, _ = update_pdf_figure_asset(
                remediation,
                figure_id,
                {
                    "status": "generated",
                    "r2_key": key,
                    "content_type": "image/webp",
                    "width": width,
                    "height": height,
                    "file_size_bytes": len(payload),
                    "generated_at": generated_at,
                    "source": "pdf_figure_crop",
                },
                updated_at=generated_at,
            )
            update_document_remediation_metadata(
                supabase,
                session_id=session_id,
                user_id=user_id,
                document_id=row["id"],
                remediation_plan=next_remediation,
                updated_at=generated_at,
            )
        except Exception:
            logger.exception("Failed to cache PDF figure crop session_id=%s document_id=%s figure_id=%s", session_id, row["id"], figure_id)

    return Response(
        content=payload,
        media_type="image/webp",
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-CanvasCurate-Cache": "rendered",
            "X-CanvasCurate-Figure-Width": str(width),
            "X-CanvasCurate-Figure-Height": str(height),
            "X-CanvasCurate-Asset-Bytes": str(len(payload)),
            "X-CanvasCurate-Backend-Ms": str(round((time.perf_counter() - request_started) * 1000, 1)),
            "X-CanvasCurate-Backend-Session-Ms": str(round((session_checked_at - request_started) * 1000, 1)),
            "X-CanvasCurate-Backend-Document-Ms": str(round((row_loaded_at - session_checked_at) * 1000, 1)),
            "X-CanvasCurate-Backend-Asset-Lookup-Ms": str(round((asset_located_at - row_loaded_at) * 1000, 1)),
            "X-CanvasCurate-Render-Ms": str(round((render_finished - render_started) * 1000, 1)),
        },
    )


@router.put("/sessions/{session_id}/documents/{document_id}/figures/{figure_id}")
async def update_session_document_figure_review(
    session_id: str,
    document_id: str,
    figure_id: str,
    payload: PdfFigureReviewRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
    if not remediation:
        raise HTTPException(status_code=409, detail="Run PDF review before editing figure text")

    updates: dict[str, Any] = {}
    if payload.alt_text is not None:
        updates["alt_text"] = payload.alt_text
    if payload.long_description is not None:
        updates["long_description"] = payload.long_description
    if payload.is_decorative is not None:
        updates["is_decorative"] = payload.is_decorative
    if payload.review_action is not None:
        updates["review_action"] = payload.review_action
    if payload.figure_type is not None:
        updates["figure_type"] = payload.figure_type
    if payload.flowchart_guidance is not None:
        updates["flowchart_guidance"] = compact_flowchart_guidance(payload.flowchart_guidance)
    if not updates:
        raise HTTPException(status_code=422, detail="No figure review updates were provided")

    updated_at = datetime.now(timezone.utc).isoformat()
    try:
        next_remediation, figure = update_pdf_figure_review(remediation, figure_id, updates, updated_at=updated_at)
    except KeyError:
        raise HTTPException(status_code=404, detail="PDF figure not found")

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
        event_type="document_pdf_figure_review_updated",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "figure_id": figure_id,
            "page_number": figure.get("page_number"),
            "is_decorative": figure.get("is_decorative"),
            "has_alt_text": bool(compact_whitespace(figure.get("alt_text"))),
            "has_long_description": bool(compact_whitespace(figure.get("long_description"))),
            "figure_type": figure.get("figure_type"),
            "has_flowchart_guidance": bool(compact_whitespace(figure.get("flowchart_guidance"))),
        },
    )
    return {
        "document_id": row["id"],
        "figure": sign_pdf_figure(figure),
        "figure_inventory": sign_pdf_figure_inventory(next_remediation.get("figure_inventory")),
    }


@router.post("/sessions/{session_id}/documents/{document_id}/figures/{figure_id}/generate")
async def generate_session_document_figure_text(
    session_id: str,
    document_id: str,
    figure_id: str,
    body: PdfFigureGenerateRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="ASU AIML is not configured for this environment")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
    figure = find_pdf_figure(remediation, figure_id)
    if not remediation or not figure:
        raise HTTPException(status_code=404, detail="PDF figure not found")
    if figure.get("review_action") == "ignore":
        raise HTTPException(status_code=409, detail="Ignored figures do not need AI alt text or long descriptions")
    if figure.get("is_decorative"):
        raise HTTPException(status_code=409, detail="Decorative figures do not need AI alt text or long descriptions")

    job_payload = {
        "session_id": session_id,
        "document_id": row["id"],
        "figure_id": figure_id,
        "mode": body.mode,
        "figure_type": body.figure_type,
        "guidance": body.guidance,
        "request_key": sha256_payload({
            "document_id": row["id"],
            "figure_id": figure_id,
            "mode": body.mode,
            "figure_type": body.figure_type,
            "guidance": body.guidance,
        }),
    }
    try:
        enqueued = enqueue_background_job(
            supabase,
            user_id=user_id,
            session_id=session_id,
            job_type=PDF_FIGURE_TEXT_JOB_TYPE,
            payload=job_payload,
            duplicate_fields=("request_key",),
            max_active_job_type_per_user=env_int("PDF_FIGURE_TEXT_MAX_ACTIVE_JOBS_PER_USER", 4),
        )
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    if enqueued.created:
        dispatch_background_task(background_tasks, run_pdf_figure_text_generate_job, enqueued.job["id"], session_id, user_id, row["id"])

    return {
        "status": enqueued.job.get("status") or "queued",
        "job_id": enqueued.job["id"],
        "created": enqueued.created,
        "document_id": row["id"],
        "figure_id": figure_id,
        "message": "PDF figure AI generation queued. The generated text will appear when the worker finishes.",
    }


@router.put("/sessions/{session_id}/documents/{document_id}/figures/{figure_id}/flowchart")
async def update_session_document_figure_flowchart(
    session_id: str,
    document_id: str,
    figure_id: str,
    payload: PdfFigureFlowchartRequest,
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
        raise HTTPException(status_code=409, detail="Run PDF review before editing figure flowcharts")

    updated_at = datetime.now(timezone.utc).isoformat()
    flowchart = normalize_flowchart_structure(payload.model_dump(), updated_at=updated_at)
    try:
        next_remediation, figure = update_pdf_figure_review(
            remediation,
            figure_id,
            {
                "figure_type": "flowchart",
                "flowchart": flowchart,
                "flowchart_guidance": flowchart.get("guidance") or "",
            },
            updated_at=updated_at,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="PDF figure not found")

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
        event_type="document_pdf_figure_flowchart_updated",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "figure_id": figure_id,
            "page_number": figure.get("page_number"),
            "node_count": len(flowchart.get("nodes") or []),
            "connection_count": len(flowchart.get("connections") or []),
        },
    )

    return {
        "document_id": row["id"],
        "figure": sign_pdf_figure(figure),
        "figure_inventory": sign_pdf_figure_inventory(next_remediation.get("figure_inventory")),
    }
