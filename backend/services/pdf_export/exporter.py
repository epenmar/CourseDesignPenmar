"""PDF export artifact generation.

Creates the first generated PDF artifact for the export flow. This pass writes
reviewed metadata and stores a durable artifact; full structure-tree tagging is
reserved for a later worker slice.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from r2_storage import upload_bytes
from services.pdf_export.structure_plan import build_structure_plan
from services.pdf_export.tagged_writer import inspect_pdf_structure, write_planned_structure_pdf


def safe_pdf_filename(value: str | None, fallback: str = "accessible-document.pdf") -> str:
    raw = re.sub(r"\s+", " ", value or "").strip() or fallback
    raw = re.sub(r"[^A-Za-z0-9._ -]+", "", raw).strip(" .-_") or fallback
    if not raw.lower().endswith(".pdf"):
        raw = f"{raw}.pdf"
    if len(raw) <= 180:
        return raw
    return f"{raw[:-4][:176].rstrip(' .-_')}.pdf"


def pdf_export_storage_key(session_id: str, document_id: str, export_id: str, filename: str) -> str:
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "pdf"
    if suffix != "pdf":
        suffix = "pdf"
    return f"documents/pdf-exports/{session_id}/{document_id}/{export_id}/accessible.{suffix}"


def accessible_pdf_filename(value: str | None) -> str:
    filename = safe_pdf_filename(value, "document.pdf")
    return re.sub(r"\.pdf$", " accessible.pdf", filename, flags=re.IGNORECASE)


def apply_pdf_metadata(source_pdf: bytes, export_document: dict[str, Any]) -> bytes:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required for PDF export generation") from exc

    metadata = export_document.get("metadata") if isinstance(export_document.get("metadata"), dict) else {}
    title = str(metadata.get("title") or "").strip()

    with fitz.open(stream=source_pdf, filetype="pdf") as pdf:
        current = pdf.metadata or {}
        next_metadata = {**current}
        if title:
            next_metadata["title"] = title
        pdf.set_metadata(next_metadata)
        return pdf.tobytes(garbage=4, deflate=True)


def create_pdf_export_artifact(
    *,
    session_id: str,
    document: dict[str, Any],
    source_pdf: bytes,
    export_document: dict[str, Any],
    validation: dict[str, Any],
) -> tuple[dict[str, Any], bytes]:
    structure_plan = build_structure_plan(export_document)
    generated_pdf = write_planned_structure_pdf(
        source_pdf,
        export_document=export_document,
        structure_plan=structure_plan,
    )
    export_checks = inspect_pdf_structure(
        generated_pdf,
        expected_structure_plan=structure_plan,
    )
    document_metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
    title = str(document_metadata.get("filename") or document.get("filename") or document.get("title") or "document").strip()
    export_id = str(uuid.uuid4())
    filename = accessible_pdf_filename(title)
    key = pdf_export_storage_key(session_id, str(document["id"]), export_id, filename)
    generated_at = datetime.now(timezone.utc).isoformat()

    upload_bytes(
        key,
        generated_pdf,
        content_type="application/pdf",
        cache_control="private, max-age=31536000, immutable",
        metadata={
            "source_document_id": str(document["id"]),
            "source_canvas_file_id": str(document.get("canvas_id") or ""),
            "export_id": export_id,
        },
    )

    pages = export_document.get("pages") or []
    zone_count = sum(len(page.get("zones") or []) for page in pages if isinstance(page, dict))
    artifact = {
        "id": export_id,
        "status": "structure_tree_exported",
        "export_status": "structure_tree_exported",
        "filename": filename,
        "content_type": "application/pdf",
        "size_bytes": len(generated_pdf),
        "r2_key": key,
        "generated_at": generated_at,
        "source": "pdf_export_job",
        "generation_mode": "planned_structure_tree",
        "structure_tree_status": "unbound_tree_written",
        "tagged_pdf_status": "marked_content_pending",
        "export_checks": export_checks,
        "structure_plan": {
            "kind": structure_plan["kind"],
            "status": structure_plan["status"],
            "page_count": structure_plan["page_count"],
            "node_count": structure_plan["node_count"],
            "figure_node_count": structure_plan["figure_node_count"],
            "artifact_count": structure_plan["artifact_count"],
            "role_counts": structure_plan["role_counts"],
        },
        "source_document_id": document["id"],
        "source_canvas_file_id": document.get("canvas_id"),
        "page_count": len(pages),
        "zone_count": zone_count,
        "validation_snapshot": validation,
        "export_note": "PDF export includes metadata, language, marked-document flag, and a planned structure tree from TagFlow zones. Marked-content MCID binding remains pending before final PDF/UA output.",
    }
    return artifact, generated_pdf


def replacement_candidate_from_export_artifact(artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": artifact.get("id"),
        "status": "uploaded",
        "filename": artifact.get("filename"),
        "content_type": artifact.get("content_type") or "application/pdf",
        "size_bytes": artifact.get("size_bytes"),
        "r2_key": artifact.get("r2_key"),
        "uploaded_at": artifact.get("generated_at"),
        "source": "generated_pdf_export",
        "export_artifact_id": artifact.get("id"),
        "export_generation_mode": artifact.get("generation_mode"),
        "tagged_pdf_status": artifact.get("tagged_pdf_status"),
        "structure_tree_status": artifact.get("structure_tree_status"),
        "export_checks": artifact.get("export_checks"),
        "initial_accessibility_review": {
            "status": "not_checked",
            "issues": [],
            "source": "pdf_export_planned_structure_tree",
            "note": artifact.get("export_note"),
        },
        "canvas_deployment": {
            "status": "not_deployed",
            "canvas_file_id": None,
            "canvas_url": None,
            "job_id": None,
        },
    }
