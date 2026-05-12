"""Tagged-PDF export background job.

Loads reviewed PDF remediation data, generates the current export artifact, and
stores replacement-candidate metadata without doing work in request handlers.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from r2_storage import is_r2_configured
from services.document_records import (
    get_document_file_row,
    get_owned_session,
    update_document_metadata_fields,
    update_document_remediation_metadata,
    write_platform_event,
)
from services.pdf_export.adapter import build_export_document
from services.pdf_export.exporter import create_pdf_export_artifact, replacement_candidate_from_export_artifact
from services.pdf_export.source import load_source_pdf_bytes
from services.pdf_export.validator import validate_remediation_export
from supabase_client import get_supabase


PDF_EXPORT_JOB_TYPE = "pdf_export"


def build_pdf_export_job_payload(*, session_id: str, document: dict[str, Any]) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "document_id": document.get("id"),
        "canvas_file_id": document.get("canvas_id"),
        "filename": document.get("filename") or document.get("title"),
    }


def run_pdf_export_job(job_id: str, session_id: str, user_id: str, document_id: str) -> None:
    supabase = get_supabase()
    started_at = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": started_at,
        "attempts": 1,
    }).eq("id", job_id).execute()

    try:
        get_owned_session(supabase, session_id, user_id)
        document = get_document_file_row(supabase, session_id, user_id, document_id)
        metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
        remediation = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else {}
        validation = validate_remediation_export(remediation)
        if validation.get("error_count", 0):
            raise ValueError("PDF export is blocked by validation errors")
        if not is_r2_configured():
            raise ValueError("R2 storage is required for PDF export artifacts")

        source_pdf, content_type = load_source_pdf_bytes(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document=document,
        )
        export_document = build_export_document(remediation)
        artifact, generated_pdf = create_pdf_export_artifact(
            session_id=session_id,
            document=document,
            source_pdf=source_pdf,
            export_document=export_document,
            validation=validation,
        )
        replacement_candidate = replacement_candidate_from_export_artifact(artifact)
        pages = export_document.get("pages") or []
        zone_count = sum(len(page.get("zones") or []) for page in pages if isinstance(page, dict))
        finished_at = datetime.now(timezone.utc).isoformat()
        next_remediation = {
            **remediation,
            "export_artifact": artifact,
            "export_artifacts": [
                artifact,
                *(
                    remediation.get("export_artifacts")
                    if isinstance(remediation.get("export_artifacts"), list)
                    else []
                ),
            ],
        }
        update_document_remediation_metadata(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=document["id"],
            remediation_plan=next_remediation,
            updated_at=finished_at,
        )
        update_document_metadata_fields(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=document["id"],
            metadata_patch={"replacement_candidate": replacement_candidate},
            updated_at=finished_at,
            r2_working_key=str(artifact["r2_key"]),
        )
        result = {
            "document_id": document["id"],
            "canvas_file_id": document.get("canvas_id"),
            "export_status": "metadata_exported",
            "source_content_type": content_type,
            "source_pdf_bytes": len(source_pdf),
            "generated_pdf_bytes": len(generated_pdf),
            "page_count": len(pages),
            "zone_count": zone_count,
            "validation": validation,
            "artifact": artifact,
            "replacement_candidate": replacement_candidate,
            "message": "PDF export with planned structure tree generated and registered as the replacement candidate. Marked-content binding remains pending.",
        }
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": finished_at,
        }).eq("id", job_id).execute()
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_pdf_export_prepared",
            properties={
                "job_id": job_id,
                "document_id": document["id"],
                "canvas_file_id": document.get("canvas_id"),
                "page_count": len(pages),
                "zone_count": zone_count,
                "export_status": "metadata_exported",
                "export_id": artifact.get("id"),
                "export_r2_key": artifact.get("r2_key"),
                "export_size_bytes": artifact.get("size_bytes"),
            },
        )
    except Exception as exc:
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
