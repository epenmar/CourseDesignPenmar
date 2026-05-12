"""Document remediation API routes.

Owns focused document-level remediation endpoints that should stay outside the
large Canvas router as the backend is modularized.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from models.pdf import PdfMetadataReviewRequest, TagFlowLayoutHintRequest
from services.document_records import (
    get_document_file_row,
    get_owned_session,
    update_document_remediation_metadata,
    write_platform_event,
)
from services.pdf_export.readiness import build_pdf_export_readiness
from services.pdf_metadata import (
    compact_text,
    normalize_pdf_language,
    pdf_language_is_valid,
    update_pdf_remediation_metadata,
)
from services.tagflow_state import update_tagflow_layout_hint
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas", tags=["documents"])


@router.put("/sessions/{session_id}/documents/{document_id}/metadata")
async def update_session_document_pdf_metadata(
    session_id: str,
    document_id: str,
    payload: PdfMetadataReviewRequest,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    title = compact_text(payload.title, 500)
    language = normalize_pdf_language(payload.language)
    if not title:
        raise HTTPException(status_code=422, detail="PDF title is required")
    if not language:
        raise HTTPException(status_code=422, detail="PDF language is required")
    if not pdf_language_is_valid(language):
        raise HTTPException(status_code=422, detail="Use a BCP 47-style language code, such as en or en-US")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    row = get_document_file_row(supabase, session_id, user_id, document_id)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    remediation = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else None
    if not remediation:
        raise HTTPException(status_code=409, detail="Run PDF review before editing PDF metadata")

    updated_at = datetime.now(timezone.utc).isoformat()
    next_remediation = update_pdf_remediation_metadata(
        remediation,
        title=title,
        language=language,
        updated_at=updated_at,
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
        event_type="document_pdf_metadata_updated",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "title_set": True,
            "language": language,
            "metadata_status": next_remediation.get("metadata_review", {}).get("status"),
        },
    )

    return {
        "document_id": row["id"],
        "metadata": next_remediation.get("metadata"),
        "metadata_review": next_remediation.get("metadata_review"),
        "export_readiness": next_remediation.get("export_readiness"),
        "document_remediation": next_remediation,
    }


@router.put("/sessions/{session_id}/documents/{document_id}/tagflow/layout-hint")
async def update_session_document_tagflow_layout_hint(
    session_id: str,
    document_id: str,
    payload: TagFlowLayoutHintRequest,
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
        raise HTTPException(status_code=409, detail="Run PDF review before editing TagFlow layout hints")

    updated_at = datetime.now(timezone.utc).isoformat()
    next_remediation = update_tagflow_layout_hint(
        remediation_plan=remediation,
        layout=payload.layout,
        scope=payload.scope,
        page_number=payload.page_number,
        updated_at=updated_at,
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
        event_type="document_tagflow_layout_hint_updated",
        properties={
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "scope": payload.scope,
            "page_number": payload.page_number,
            "layout": payload.layout,
            "tagflow_version": (next_remediation.get("tagflow_state") or {}).get("version"),
        },
    )

    return {
        "document_id": row["id"],
        "tagflow_state": next_remediation.get("tagflow_state"),
        "document_remediation": next_remediation,
    }
