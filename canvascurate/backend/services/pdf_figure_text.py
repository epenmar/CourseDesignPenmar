"""PDF figure AI text generation jobs.

Keeps figure crop loading, alt-text/long-description generation, remediation
updates, and background job status handling out of the legacy Canvas router.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ai_image_text import generate_alt_text_from_bytes, generate_long_description_from_bytes
from content_inventory import compact_whitespace
from models.pdf import PdfFigureGenerateRequest
from r2_storage import download_bytes, is_r2_configured
from services.document_records import get_owned_session, update_document_remediation_metadata, write_platform_event
from services.documents.assets import load_document_pdf_bytes
from services.documents.inventory import get_session_document_row
from services.pdf_figure_assets import sign_pdf_figure, sign_pdf_figure_inventory
from services.pdf_figures import find_pdf_figure, render_pdf_figure_crop_bytes, update_pdf_figure_review
from services.pdf_flowcharts import build_figure_generation_context, compact_flowchart_guidance, normalize_figure_type
from supabase_client import get_supabase


logger = logging.getLogger(__name__)

PDF_FIGURE_TEXT_JOB_TYPE = "pdf_figure_text_generate"


def generate_pdf_figure_text_for_payload(
    supabase,
    *,
    session_id: str,
    user_id: str,
    document_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    figure_id = str(payload.get("figure_id") or "")
    if not figure_id:
        raise ValueError("figure_id is required")
    body = PdfFigureGenerateRequest(
        mode=payload.get("mode") or "alt",
        figure_type=payload.get("figure_type"),
        guidance=payload.get("guidance"),
    )

    get_owned_session(supabase, session_id, user_id)
    row = get_session_document_row(supabase, session_id, user_id, document_id)
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
    figure = find_pdf_figure(remediation, figure_id)
    if not remediation or not figure:
        raise ValueError("PDF figure not found")
    if figure.get("review_action") == "ignore":
        raise ValueError("Ignored figures do not need AI alt text or long descriptions")
    if figure.get("is_decorative"):
        raise ValueError("Decorative figures do not need AI alt text or long descriptions")

    asset = figure.get("asset") if isinstance(figure.get("asset"), dict) else {}
    if asset.get("status") == "generated" and asset.get("r2_key") and is_r2_configured():
        try:
            crop_bytes, content_type = download_bytes(str(asset["r2_key"]))
        except Exception as exc:
            logger.exception("Failed to load cached PDF figure for AI session_id=%s document_id=%s figure_id=%s", session_id, row["id"], figure_id)
            raise RuntimeError(f"PDF figure image could not be prepared: {exc}") from exc
    else:
        try:
            pdf_data, _ = load_document_pdf_bytes(
                supabase,
                session_id=session_id,
                user_id=user_id,
                row=row,
            )
            crop_bytes, _, _ = render_pdf_figure_crop_bytes(pdf_data, figure)
            content_type = "image/webp"
        except Exception as exc:
            logger.exception("Failed to render PDF figure for AI session_id=%s document_id=%s figure_id=%s", session_id, row["id"], figure_id)
            raise RuntimeError(f"PDF figure image could not be prepared: {exc}") from exc

    requested_figure_type = normalize_figure_type(body.figure_type or figure.get("figure_type"))
    requested_guidance = compact_flowchart_guidance(body.guidance if body.guidance is not None else figure.get("flowchart_guidance"))
    context = build_figure_generation_context(
        document_name=str(row.get("filename") or row.get("title") or row["id"]),
        figure=figure,
        figure_type=requested_figure_type,
        guidance=requested_guidance,
    )
    updates: dict[str, Any] = {
        "figure_type": requested_figure_type,
        "flowchart_guidance": requested_guidance,
    }
    if body.mode in {"alt", "both"}:
        alt_text = generate_alt_text_from_bytes(crop_bytes, content_type or "image/webp", context)
        updates["alt_text"] = alt_text
        updates["ai_alt_text"] = alt_text
    if body.mode in {"long_desc", "both"}:
        long_description = generate_long_description_from_bytes(crop_bytes, content_type or "image/webp", context)
        updates["long_description"] = long_description
        updates["ai_long_description"] = long_description

    updated_at = datetime.now(timezone.utc).isoformat()
    try:
        next_remediation, updated_figure = update_pdf_figure_review(remediation, figure_id, updates, updated_at=updated_at)
    except KeyError:
        raise ValueError("PDF figure not found")

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
        event_type="document_pdf_figure_text_generated",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "figure_id": figure_id,
            "page_number": figure.get("page_number"),
            "mode": body.mode,
            "figure_type": requested_figure_type,
            "has_flowchart_guidance": bool(requested_guidance),
        },
    )
    return {
        "document_id": row["id"],
        "figure": sign_pdf_figure(updated_figure),
        "figure_inventory": sign_pdf_figure_inventory(next_remediation.get("figure_inventory")),
    }


def run_pdf_figure_text_generate_job(job_id: str, session_id: str, user_id: str, document_id: str) -> None:
    supabase = get_supabase()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 1,
    }).eq("id", job_id).execute()
    try:
        payload_result = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        payload = payload_result.data[0].get("payload") if payload_result.data else {}
        payload_dict = payload if isinstance(payload, dict) else {}
        result = generate_pdf_figure_text_for_payload(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=document_id or str(payload_dict.get("document_id") or ""),
            payload=payload_dict,
        )
        figure = result.get("figure") if isinstance(result.get("figure"), dict) else {}
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": {
                "document_id": result.get("document_id"),
                "figure_id": figure.get("id") or payload_dict.get("figure_id"),
                "mode": payload_dict.get("mode"),
                "has_alt_text": bool(compact_whitespace(figure.get("alt_text"))),
                "has_long_description": bool(compact_whitespace(figure.get("long_description"))),
            },
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
    except Exception as exc:
        logger.exception("PDF figure AI generation failed job_id=%s", job_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
