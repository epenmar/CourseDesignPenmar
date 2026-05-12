"""Shared document persistence helpers.

Provides session/document ownership checks plus metadata mirroring between
course file rows and R2-backed document rows.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from services.pdf_export.readiness import build_pdf_export_readiness


def get_owned_session(supabase, session_id: str, user_id: str) -> dict[str, Any]:
    result = supabase.table("sessions").select("id, user_id, source_course_id").eq(
        "id", session_id
    ).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return result.data[0]


def get_document_file_row(supabase, session_id: str, user_id: str, document_id: str) -> dict[str, Any]:
    base_select = "id, canvas_id, title, metadata"
    result = supabase.table("course_content_items").select(
        base_select
    ).eq("id", document_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).eq("content_type", "file").limit(1).execute()
    if result.data:
        return result.data[0]

    result = supabase.table("course_content_items").select(
        "id, canvas_id, title, metadata"
    ).eq("canvas_id", document_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).eq("content_type", "file").limit(1).execute()
    if not result.data:
        document_result = supabase.table("documents").select(
            "id, filename, r2_original_key, r2_working_key, r2_export_key, tag_data"
        ).eq("id", document_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).limit(1).execute()
        if not document_result.data:
            raise HTTPException(status_code=404, detail="Document not found")
        document = document_result.data[0]
        tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
        metadata = {
            **tag_data,
            "filename": document.get("filename"),
            "r2_original_key": document.get("r2_original_key") or tag_data.get("r2_original_key"),
            "r2_working_key": document.get("r2_working_key"),
            "r2_export_key": document.get("r2_export_key"),
            "content_type": tag_data.get("mime_type"),
            "size": tag_data.get("size"),
        }
        return {
            "id": document.get("id"),
            "canvas_id": tag_data.get("canvas_file_id"),
            "title": document.get("filename"),
            "metadata": metadata,
        }
    return result.data[0]


def update_document_remediation_metadata(
    supabase,
    *,
    session_id: str,
    user_id: str,
    document_id: str,
    remediation_plan: dict[str, Any],
    updated_at: str,
) -> None:
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, metadata"
    ).eq("id", document_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).eq("content_type", "file").limit(1).execute()
    if not item_result.data:
        document_result = supabase.table("documents").select(
            "id, tag_data"
        ).eq("id", document_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).limit(1).execute()
        if not document_result.data:
            raise HTTPException(status_code=404, detail="Document file row not found")
        document = document_result.data[0]
        tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
        remediation_plan = {
            **remediation_plan,
            "export_readiness": build_pdf_export_readiness(remediation_plan),
        }
        supabase.table("documents").update({
            "tag_data": {**tag_data, "document_remediation": remediation_plan},
            "updated_at": updated_at,
        }).eq("id", document_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).execute()
        return

    item = item_result.data[0]
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    remediation_plan = {
        **remediation_plan,
        "export_readiness": build_pdf_export_readiness(remediation_plan),
    }
    supabase.table("course_content_items").update({
        "metadata": {**metadata, "document_remediation": remediation_plan},
        "updated_at": updated_at,
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
            "tag_data": {**tag_data, "document_remediation": remediation_plan},
            "updated_at": updated_at,
        }).eq("id", document["id"]).execute()


def update_document_metadata_fields(
    supabase,
    *,
    session_id: str,
    user_id: str,
    document_id: str,
    metadata_patch: dict[str, Any],
    updated_at: str,
    r2_working_key: str | None = None,
) -> dict[str, Any]:
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, metadata"
    ).eq("id", document_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).eq("content_type", "file").limit(1).execute()
    if not item_result.data:
        document_result = supabase.table("documents").select(
            "id, tag_data"
        ).eq("id", document_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).limit(1).execute()
        if not document_result.data:
            raise HTTPException(status_code=404, detail="Document file row not found")
        document = document_result.data[0]
        tag_data = document.get("tag_data") if isinstance(document.get("tag_data"), dict) else {}
        next_metadata = {**tag_data, **metadata_patch}
        updates = {
            "tag_data": next_metadata,
            "updated_at": updated_at,
        }
        if r2_working_key:
            updates["r2_working_key"] = r2_working_key
        supabase.table("documents").update(updates).eq("id", document_id).eq(
            "session_id", session_id
        ).eq("user_id", user_id).execute()
        return next_metadata

    item = item_result.data[0]
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    next_metadata = {**metadata, **metadata_patch}
    supabase.table("course_content_items").update({
        "metadata": next_metadata,
        "updated_at": updated_at,
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
        updates = {
            "tag_data": {**tag_data, **metadata_patch},
            "updated_at": updated_at,
        }
        if r2_working_key:
            updates["r2_working_key"] = r2_working_key
        supabase.table("documents").update(updates).eq("id", document["id"]).execute()

    return next_metadata


def write_platform_event(
    supabase,
    *,
    user_id: str,
    session_id: str,
    event_type: str,
    properties: dict[str, Any],
) -> None:
    supabase.table("platform_events").insert({
        "user_id": user_id,
        "session_id": session_id,
        "event_type": event_type,
        "properties": properties,
    }).execute()
