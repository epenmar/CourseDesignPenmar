"""Document analysis job services."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from services.document_records import get_owned_session, write_platform_event
from services.documents.inventory import build_document_analysis, get_session_document_row
from supabase_client import get_supabase


logger = logging.getLogger(__name__)


def update_document_analysis_metadata(
    supabase,
    *,
    session_id: str,
    user_id: str,
    document_id: str,
    analysis: dict[str, Any],
    analyzed_at: str,
) -> None:
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, metadata"
    ).eq("id", document_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).eq("content_type", "file").limit(1).execute()
    if item_result.data:
        item = item_result.data[0]
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        next_metadata = {**metadata, "document_analysis": analysis}
        supabase.table("course_content_items").update({
            "metadata": next_metadata,
            "updated_at": analyzed_at,
        }).eq("id", document_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).execute()

        document_result = supabase.table("documents").select(
            "id, tag_data"
        ).eq("session_id", session_id).eq("user_id", user_id).execute()
        canvas_file_id = str(item.get("canvas_id")) if item.get("canvas_id") is not None else None
        for document in document_result.data or []:
            tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
            matches_content_item = tag_data.get("content_item_id") == document_id
            matches_canvas_file = bool(canvas_file_id) and str(tag_data.get("canvas_file_id") or "") == canvas_file_id
            if not matches_content_item and not matches_canvas_file:
                continue
            supabase.table("documents").update({
                "tag_data": {**tag_data, "document_analysis": analysis},
                "updated_at": analyzed_at,
            }).eq("id", document["id"]).execute()
        return

    document_result = supabase.table("documents").select(
        "id, tag_data"
    ).eq("id", document_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if document_result.data:
        document = document_result.data[0]
        tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
        supabase.table("documents").update({
            "tag_data": {**tag_data, "document_analysis": analysis},
            "updated_at": analyzed_at,
        }).eq("id", document_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).execute()


def run_document_analysis_job(job_id: str, session_id: str, user_id: str, document_id: str) -> None:
    supabase = get_supabase()
    started_at = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    try:
        get_owned_session(supabase, session_id, user_id)
        row = get_session_document_row(supabase, session_id, user_id, document_id)
        analyzed_at = datetime.now(timezone.utc).isoformat()
        analysis = build_document_analysis(row, analyzed_at=analyzed_at)
        update_document_analysis_metadata(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=row["id"],
            analysis=analysis,
            analyzed_at=analyzed_at,
        )
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": {
                "document_id": row["id"],
                "canvas_file_id": row.get("canvas_id"),
                "analysis": analysis,
            },
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_analysis_completed",
            properties={
                "document_id": row["id"],
                "canvas_file_id": row.get("canvas_id"),
                "finding_count": analysis["summary"]["finding_count"],
                "complexity_score": analysis["complexity"]["score"],
            },
        )
    except Exception as exc:
        logger.exception("Document analysis job failed for document_id=%s", document_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
