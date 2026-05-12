"""PDF remediation planning and job execution.

Owns PDF metadata/profile extraction, initial TagFlow state seeding, figure crop
asset caching, and the remediation background job orchestration.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

from ai_image_text import is_ai_configured
from document_pdf_analysis import display_pdf_font_names, normalize_pdf_font_name, pdf_existing_structure_evidence, pdf_text_analysis_from_bytes
from r2_storage import is_r2_configured, upload_bytes
from services.document_records import get_owned_session, update_document_remediation_metadata, write_platform_event
from services.documents.assets import document_pdf_figure_asset_storage_key, load_document_pdf_bytes
from services.documents.inventory import get_session_document_row
from services.documents.pdf_probe import pdf_accessibility_probe, pdf_parser_summary
from services.documents.tagflow_jobs import queue_tagflow_ai_suggestion_job
from services.documents.tagflow_previews import queue_document_structure_preview_job
from services.job_dispatch import external_worker_enabled
from services.job_queue import JobAdmissionError, env_int
from services.pdf_figures import build_pdf_figure_inventory, render_pdf_figure_crop_bytes, update_pdf_figure_asset
from supabase_client import get_supabase


logger = logging.getLogger(__name__)


def decode_pdf_metadata_value(value: bytes | None) -> str | None:
    if not value:
        return None
    try:
        raw = value.strip()
        if raw.startswith(b"<") and raw.endswith(b">") and not raw.startswith(b"<<"):
            hex_value = re.sub(rb"\s+", b"", raw[1:-1])
            decoded = bytes.fromhex(hex_value.decode("ascii", errors="ignore"))
            if decoded.startswith(b"\xfe\xff"):
                return decoded[2:].decode("utf-16-be", errors="ignore").strip() or None
            return decoded.decode("utf-8", errors="ignore").strip() or decoded.decode("latin-1", errors="ignore").strip() or None
        text = raw
        if text.startswith(b"(") and text.endswith(b")"):
            text = text[1:-1]
        text = text.replace(rb"\(", b"(").replace(rb"\)", b")").replace(rb"\\", b"\\")
        if text.startswith(b"\xfe\xff"):
            return text[2:].decode("utf-16-be", errors="ignore").strip() or None
        return text.decode("utf-8", errors="ignore").strip() or text.decode("latin-1", errors="ignore").strip() or None
    except Exception:
        return None


def extract_pdf_name_value(data: bytes, key: str) -> str | None:
    pattern = rb"/" + key.encode("ascii") + rb"\s*(\((?:\\.|[^\\)])*\)|<[^<>]+>|/[A-Za-z0-9_.:-]+)"
    match = re.search(pattern, data[:500_000], flags=re.DOTALL)
    if not match:
        return None
    raw = match.group(1)
    if raw.startswith(b"/"):
        return raw[1:].decode("latin-1", errors="ignore").strip() or None
    return decode_pdf_metadata_value(raw)


def pdf_profile_from_bytes(
    data: bytes,
    *,
    probe: dict[str, Any],
    structure_tag_count: int,
    tag_names: list[str],
    parser_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    parser_summary = parser_summary if isinstance(parser_summary, dict) else pdf_parser_summary(data)
    page_count = probe.get("page_count") or parser_summary.get("page_count") or len(re.findall(rb"/Type\s*/Page\b", data)) or 0
    image_count = int(parser_summary.get("image_count") or 0) or len(re.findall(rb"/Subtype\s*/Image\b", data))
    table_count = len(re.findall(rb"/S\s*/Table\b", data[:1_500_000]))
    font_names = {
        decode_pdf_metadata_value(match) or match.decode("latin-1", errors="ignore").strip("/ ")
        for match in re.findall(rb"/(?:BaseFont|FontName)\s*(/[A-Za-z0-9_.+\-]+|\((?:\\.|[^\\)])*\)|<[^<>]+>)", data[:1_500_000])
        if match
    }
    font_names.update(name for name in (parser_summary.get("font_names") or []) if isinstance(name, str) and name)
    normalized_font_names = {
        normalize_pdf_font_name(name)
        for name in font_names
        if name
    }
    sorted_font_names = display_pdf_font_names(normalized_font_names)
    sorted_raw_font_names = sorted(font_names)
    text_object_count = max(
        len(re.findall(rb"\bBT\b", data[:2_000_000])),
        int(parser_summary.get("text_page_count") or 0),
    )
    lower_tags = {tag.lower() for tag in tag_names}
    has_table_tags = bool({"table", "tr", "th", "td"} & lower_tags)
    table_count = max(table_count, 1 if has_table_tags else 0)
    scanned_likely = bool(page_count and image_count >= page_count and not sorted_font_names and text_object_count == 0)
    scanned_page_count = page_count if scanned_likely else 0
    has_column_tags = bool({"sect", "div", "art"} & lower_tags)
    column_signal = "possible_layout_regions" if has_column_tags and structure_tag_count >= max(8, page_count * 3) else "not_detected"
    confidence_notes = [
        "Counts are heuristic until a dedicated PDF parser/OCR/AI pass is added.",
        "Tables are detected from PDF structure tags when available.",
        "Column detection is a weak structural signal and may miss visual multi-column layouts.",
    ]
    if scanned_likely:
        confidence_notes.append("Image-only pages with no visible text/font objects suggest OCR is required.")
    elif image_count:
        confidence_notes.append("Image objects were detected, but OCR need was not confirmed.")

    return {
        "kind": "pdf_profile",
        "page_count": page_count or None,
        "image_count": image_count,
        "table_count": table_count,
        "font_count": len(sorted_font_names),
        "font_names": sorted_font_names[:20],
        "raw_font_count": len(sorted_raw_font_names),
        "raw_font_names": sorted_raw_font_names[:20],
        "normalized_font_count": len(sorted_font_names),
        "normalized_font_names": sorted_font_names[:20],
        "text_object_count": text_object_count,
        "column_signal": column_signal,
        "scanned_page_count": scanned_page_count,
        "ocr_required": scanned_likely,
        "confidence": "low" if column_signal == "not_detected" and not scanned_likely else "medium",
        "notes": confidence_notes,
    }


def pdf_structure_preview_from_profile(pdf_profile: dict[str, Any], structural_tags: dict[str, Any]) -> dict[str, Any]:
    page_count = int(pdf_profile.get("page_count") or 0)
    if page_count <= 0:
        pages: list[dict[str, Any]] = []
    else:
        candidates = [
            (1, "opening_structure", "Opening page"),
            (max(1, page_count // 2), "mid_document_structure", "Mid-document sample"),
            (page_count, "closing_structure", "Closing page"),
        ]
        seen: set[int] = set()
        pages = []
        for page_number, reason_code, label in candidates:
            if page_number in seen:
                continue
            seen.add(page_number)
            pages.append({
                "page_number": page_number,
                "label": label,
                "selection_reason": reason_code,
                "status": "metadata_only",
                "original_asset": {"status": "pending", "url": None},
                "tagged_asset": {"status": "pending", "url": None},
                "tag_signals": {
                    "has_struct_tree": structural_tags.get("has_struct_tree"),
                    "has_mark_info": structural_tags.get("has_mark_info"),
                },
            })

    return {
        "kind": "document_structure_preview",
        "status": "metadata_only",
        "page_count": page_count or None,
        "representative_pages": pages,
        "asset_generation": {
            "status": "pending",
            "job_type": "document_structure_preview",
        },
    }


def pdf_tagflow_state_from_preview(
    row: dict[str, Any],
    *,
    metadata: dict[str, Any],
    pdf_profile: dict[str, Any],
    structural_tags: dict[str, Any],
    structure_preview: dict[str, Any],
    text_analysis: dict[str, Any] | None = None,
    existing_structure_evidence: dict[str, Any] | None = None,
    created_at: str,
) -> dict[str, Any]:
    page_count = int(pdf_profile.get("page_count") or structure_preview.get("page_count") or 0)
    representative_page_numbers = {
        page.get("page_number")
        for page in structure_preview.get("representative_pages") or []
        if isinstance(page, dict)
    }
    text_pages = {
        int(page.get("page_number") or 0): page
        for page in (text_analysis or {}).get("pages", [])
        if isinstance(page, dict) and page.get("page_number")
    }
    pages = [
        {
            "page_number": page_number,
            "source_page_number": page_number,
            "export_order": page_number,
            "omitted": False,
            "review_status": "unreviewed",
            "zones": [],
            "zone_count": 0,
            "text_blocks": (text_pages.get(page_number) or {}).get("text_blocks") or [],
            "text_block_count": (text_pages.get(page_number) or {}).get("text_block_count") or 0,
            "text_sample": (text_pages.get(page_number) or {}).get("text_sample") or "",
            "image_blocks": (text_pages.get(page_number) or {}).get("image_blocks") or [],
            "raw_image_count": (text_pages.get(page_number) or {}).get("raw_image_count") or 0,
            "figure_candidates": (text_pages.get(page_number) or {}).get("figure_candidates") or [],
            "figure_candidate_count": (text_pages.get(page_number) or {}).get("figure_candidate_count") or 0,
            "diagnostics": (text_pages.get(page_number) or {}).get("diagnostics") or {},
            "preview_asset_status": "pending",
            "analysis_status": "baseline_pending",
            "is_representative": page_number in representative_page_numbers,
            "dirty": False,
            "stale_preview": False,
            "stale_analysis": False,
        }
        for page_number in range(1, page_count + 1)
    ]
    return {
        "kind": "document_tagflow_state",
        "version": 1,
        "status": "seeded",
        "source": "document_remediation",
        "document_id": row.get("id"),
        "canvas_file_id": row.get("canvas_id"),
        "created_at": created_at,
        "updated_at": created_at,
        "metadata": {
            "title": metadata.get("title") or "",
            "language": metadata.get("language") or "",
            "author": metadata.get("author"),
            "keywords": metadata.get("keywords"),
            "metadata_dirty": False,
        },
        "allowed_tags": ["H1", "H2", "H3", "H4", "H5", "H6", "P", "L", "LI", "Figure", "Table", "TH", "TD", "TR", "Artifact", "Span"],
        "pages": pages,
        "summary": {
            "page_count": page_count,
            "reviewed_page_count": 0,
            "edited_page_count": 0,
            "zone_count": 0,
            "dirty_page_count": 0,
            "representative_page_count": len(representative_page_numbers),
            "has_struct_tree": structural_tags.get("has_struct_tree"),
            "has_mark_info": structural_tags.get("has_mark_info"),
        },
        "validation": {
            "status": "not_run",
            "issues": [],
            "last_validated_at": None,
        },
        "baseline_analysis": {
            "text_status": (text_analysis or {}).get("status"),
            "text_summary": (text_analysis or {}).get("summary") or {},
            "existing_structure_evidence": existing_structure_evidence or {},
            "ai_suggestion_inputs": {
                "use_existing_structure_tags": bool(structural_tags.get("has_struct_tree")),
                "use_page_text_blocks": bool((text_analysis or {}).get("pages")),
                "prevent_unreviewed_manual_overwrite": True,
            },
            "page_editing_model": {
                "source_page_number": "immutable original PDF page number",
                "export_order": "future tagged-PDF output order",
                "omitted": "future export exclusion flag",
            },
        },
        "preview_generation": {
            "status": "pending",
            "stale_page_numbers": [],
            "last_generated_at": None,
        },
        "audit": {
            "baseline_locked": True,
            "baseline_source": "original_pdf_review",
            "notes": [
                "TagFlow working state is the source of truth after user remediation begins.",
                "Original document analysis remains available as a baseline and should not be mutated by TagFlow edits.",
                "Page previews and remediation analysis should be regenerated from this working state.",
            ],
        },
    }


def pdf_remediation_plan_from_bytes(data: bytes, row: dict[str, Any], *, extracted_at: str) -> dict[str, Any]:
    parser_summary = pdf_parser_summary(data)
    parser_metadata = parser_summary.get("metadata") if isinstance(parser_summary.get("metadata"), dict) else {}
    probe = pdf_accessibility_probe(data, parser_summary=parser_summary)
    tag_names = sorted({
        tag.decode("ascii", errors="ignore")
        for tag in re.findall(rb"/S\s*/([A-Za-z][A-Za-z0-9]*)", data[:1_500_000])
        if tag
    })
    structure_tag_count = len(re.findall(rb"/StructElem\b", data))
    heading_counts = {
        f"H{level}": len(re.findall(rb"/S\s*/H" + str(level).encode("ascii") + rb"\b", data[:2_000_000]))
        for level in range(1, 7)
    }
    heading_tag_count = sum(heading_counts.values())
    metadata = {
        "title": extract_pdf_name_value(data, "Title") or parser_metadata.get("title"),
        "language": extract_pdf_name_value(data, "Lang"),
        "author": extract_pdf_name_value(data, "Author") or parser_metadata.get("author"),
        "keywords": extract_pdf_name_value(data, "Keywords") or parser_metadata.get("keywords"),
        "subject": extract_pdf_name_value(data, "Subject") or parser_metadata.get("subject"),
        "creator": extract_pdf_name_value(data, "Creator") or parser_metadata.get("creator"),
        "producer": extract_pdf_name_value(data, "Producer") or parser_metadata.get("producer"),
    }
    structural_tags = {
        "has_struct_tree": probe["has_struct_tree"],
        "has_mark_info": probe["has_mark_info"],
        "structure_tag_count": structure_tag_count,
        "heading_tag_count": heading_tag_count,
        "heading_counts": heading_counts,
        "tag_names": tag_names[:25],
        "tag_name_count": len(tag_names),
    }
    text_analysis = pdf_text_analysis_from_bytes(data)
    existing_inventory = None
    existing_remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
    if existing_remediation and isinstance(existing_remediation.get("figure_inventory"), dict):
        existing_inventory = existing_remediation["figure_inventory"]
    figure_inventory = build_pdf_figure_inventory(
        text_analysis,
        existing_inventory=existing_inventory,
        created_at=extracted_at,
    )
    existing_structure_evidence = pdf_existing_structure_evidence(data, tag_names, structure_tag_count)
    pdf_profile = pdf_profile_from_bytes(
        data,
        probe=probe,
        structure_tag_count=structure_tag_count,
        tag_names=tag_names,
        parser_summary=parser_summary,
    )
    structure_preview = pdf_structure_preview_from_profile(pdf_profile, structural_tags)
    tagflow_state = pdf_tagflow_state_from_preview(
        row,
        metadata=metadata,
        pdf_profile=pdf_profile,
        structural_tags=structural_tags,
        structure_preview=structure_preview,
        text_analysis=text_analysis,
        existing_structure_evidence=existing_structure_evidence,
        created_at=extracted_at,
    )
    recommendations: list[dict[str, str]] = []
    if not metadata["title"]:
        recommendations.append({"code": "set_pdf_title", "message": "Set a descriptive document title."})
    if not metadata["language"]:
        recommendations.append({"code": "set_pdf_language", "message": "Set the document language."})
    if not structural_tags["has_struct_tree"]:
        recommendations.append({"code": "add_pdf_tags", "message": "Add a PDF structure tree before exporting an accessible replacement."})
    if not structural_tags["has_mark_info"]:
        recommendations.append({"code": "mark_pdf_content", "message": "Mark PDF content so assistive technologies can follow structure."})

    return {
        "kind": "document_remediation_plan",
        "status": "metadata_extracted",
        "document_id": row.get("id"),
        "canvas_file_id": row.get("canvas_id"),
        "filename": row.get("filename"),
        "extracted_at": extracted_at,
        "metadata": metadata,
        "structural_tags": structural_tags,
        "existing_structure_evidence": existing_structure_evidence,
        "text_analysis": text_analysis,
        "figure_inventory": figure_inventory,
        "pdf_profile": pdf_profile,
        "structure_preview": structure_preview,
        "tagflow_state": tagflow_state,
        "initial_probe": probe,
        "recommendations": recommendations,
        "artifact": {
            "status": "not_generated",
            "export_required": True,
        },
    }


def cache_pdf_figure_assets(
    remediation: dict[str, Any],
    *,
    session_id: str,
    document_id: str,
    canvas_file_id: Any,
    pdf_data: bytes,
    extracted_at: str,
) -> dict[str, Any]:
    if not is_r2_configured():
        return remediation
    inventory = remediation.get("figure_inventory") if isinstance(remediation.get("figure_inventory"), dict) else {}
    figures = [figure for figure in inventory.get("figures") or [] if isinstance(figure, dict)]
    next_remediation = remediation
    cached_count = 0
    failed_count = 0
    for figure in figures:
        figure_id = str(figure.get("id") or "")
        if not figure_id:
            continue
        existing_asset = figure.get("asset") if isinstance(figure.get("asset"), dict) else {}
        if existing_asset.get("status") == "generated" and existing_asset.get("r2_key"):
            continue
        try:
            crop_bytes, width, height = render_pdf_figure_crop_bytes(pdf_data, figure)
            key = document_pdf_figure_asset_storage_key(session_id, document_id, extracted_at, figure_id)
            upload_bytes(
                key,
                crop_bytes,
                content_type="image/webp",
                cache_control="private, max-age=31536000, immutable",
                metadata={
                    "source_document_id": document_id,
                    "source_canvas_file_id": str(canvas_file_id or ""),
                    "figure_id": figure_id,
                    "page_number": str(figure.get("page_number") or ""),
                },
            )
            asset = {
                "status": "generated",
                "r2_key": key,
                "content_type": "image/webp",
                "width": width,
                "height": height,
                "file_size_bytes": len(crop_bytes),
                "generated_at": extracted_at,
                "source": "pdf_figure_crop",
            }
            next_remediation, _ = update_pdf_figure_asset(next_remediation, figure_id, asset, updated_at=extracted_at)
            cached_count += 1
        except Exception as exc:
            logger.exception("Failed to cache PDF figure asset document_id=%s figure_id=%s", document_id, figure_id)
            failed_count += 1
            try:
                next_remediation, _ = update_pdf_figure_asset(
                    next_remediation,
                    figure_id,
                    {
                        "status": "failed",
                        "error": str(exc),
                        "generated_at": extracted_at,
                        "source": "pdf_figure_crop",
                    },
                    updated_at=extracted_at,
                )
            except KeyError:
                continue
    next_inventory = next_remediation.get("figure_inventory") if isinstance(next_remediation.get("figure_inventory"), dict) else {}
    return {
        **next_remediation,
        "figure_inventory": {
            **next_inventory,
            "asset_generation": {
                "status": "complete" if failed_count == 0 else "partial",
                "cached_count": cached_count,
                "failed_count": failed_count,
                "generated_at": extracted_at,
                "storage": "r2",
            },
        },
    }


def update_remediation_followup_queue_result(
    supabase,
    *,
    job_id: str,
    job_type: str,
    status: str,
    queued_job_id: str | None = None,
    error: Exception | None = None,
) -> None:
    try:
        result_response = supabase.table("background_jobs").select("result").eq("id", job_id).limit(1).execute()
        result = result_response.data[0].get("result") if result_response.data else {}
        if not isinstance(result, dict):
            result = {}
        followup_queue = result.get("followup_queue") if isinstance(result.get("followup_queue"), dict) else {}
        entry: dict[str, Any] = {
            "job_type": job_type,
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if queued_job_id:
            entry["job_id"] = queued_job_id
        if error is not None:
            entry["error_message"] = str(error) or error.__class__.__name__
            entry["error_type"] = error.__class__.__name__
            if isinstance(error, JobAdmissionError):
                entry["active_count"] = error.active_count
                entry["limit"] = error.limit
        followup_queue[job_type] = entry
        result["followup_queue"] = followup_queue
        statuses = [
            str(value.get("status") or "")
            for value in followup_queue.values()
            if isinstance(value, dict)
        ]
        result["followup_queue_status"] = (
            "failed"
            if statuses and all(item in {"failed", "blocked_by_backpressure"} for item in statuses)
            else "partial"
            if any(item in {"failed", "blocked_by_backpressure"} for item in statuses)
            else "queued"
        )
        supabase.table("background_jobs").update({"result": result}).eq("id", job_id).execute()
    except Exception:
        logger.exception("Failed to update remediation follow-up queue result job_id=%s", job_id)


def run_document_remediation_job(job_id: str, session_id: str, user_id: str, document_id: str):
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
        if (row.get("extension") or "").lower() != "pdf" and row.get("mime_type") != "application/pdf":
            raise ValueError("Document remediation is currently available for PDF files only")
        data, content_type = load_document_pdf_bytes(
            supabase,
            session_id=session_id,
            user_id=user_id,
            row=row,
        )
        extracted_at = datetime.now(timezone.utc).isoformat()
        remediation_plan = pdf_remediation_plan_from_bytes(data, row, extracted_at=extracted_at)
        remediation_plan = cache_pdf_figure_assets(
            remediation_plan,
            session_id=session_id,
            document_id=row["id"],
            canvas_file_id=row.get("canvas_id"),
            pdf_data=data,
            extracted_at=extracted_at,
        )
        update_document_remediation_metadata(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=row["id"],
            remediation_plan=remediation_plan,
            updated_at=extracted_at,
        )
        result = {
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "content_type": content_type,
            "remediation_plan": remediation_plan,
        }
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        metadata = remediation_plan.get("metadata") if isinstance(remediation_plan.get("metadata"), dict) else {}
        structural_tags = remediation_plan.get("structural_tags") if isinstance(remediation_plan.get("structural_tags"), dict) else {}
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="document_remediation_completed",
            properties={
                "document_id": row["id"],
                "canvas_file_id": row.get("canvas_id"),
                "metadata_field_count": sum(1 for key in ("title", "language", "author", "keywords") if metadata.get(key)),
                "has_struct_tree": structural_tags.get("has_struct_tree"),
                "structure_tag_count": structural_tags.get("structure_tag_count"),
            },
        )
        try:
            preview_job_id = queue_document_structure_preview_job(
                supabase,
                session_id=session_id,
                user_id=user_id,
                row={**row, "document_remediation": remediation_plan},
                run_inline=not external_worker_enabled(),
                representative_only=False,
                max_pages_per_job=env_int("TAGFLOW_AUTO_PREVIEW_MAX_PAGES_PER_JOB", 0),
            )
            update_remediation_followup_queue_result(
                supabase,
                job_id=job_id,
                job_type="document_structure_preview",
                status="queued_or_active",
                queued_job_id=preview_job_id,
            )
        except Exception as exc:
            logger.exception(
                "Failed to queue TagFlow preview generation after remediation document_id=%s",
                row["id"],
            )
            update_remediation_followup_queue_result(
                supabase,
                job_id=job_id,
                job_type="document_structure_preview",
                status="blocked_by_backpressure" if isinstance(exc, JobAdmissionError) else "failed",
                error=exc,
            )
        if is_ai_configured():
            try:
                latest_row = get_session_document_row(supabase, session_id, user_id, row["id"])
                suggestion_job_id = queue_tagflow_ai_suggestion_job(
                    supabase,
                    session_id=session_id,
                    user_id=user_id,
                    row=latest_row,
                    max_pages=int(os.getenv("TAGFLOW_AI_AUTO_SUGGESTION_MAX_PAGES", "10") or "10"),
                    skip_manual_pages=True,
                    skip_existing_suggestions=True,
                    auto_apply_to_draft=True,
                    run_inline=not external_worker_enabled(),
                )
                update_remediation_followup_queue_result(
                    supabase,
                    job_id=job_id,
                    job_type="tagflow_ai_suggestions",
                    status="queued_or_active",
                    queued_job_id=suggestion_job_id,
                )
            except Exception as exc:
                logger.exception(
                    "Failed to queue TagFlow AI suggestions after remediation document_id=%s",
                    row["id"],
                )
                update_remediation_followup_queue_result(
                    supabase,
                    job_id=job_id,
                    job_type="tagflow_ai_suggestions",
                    status="blocked_by_backpressure" if isinstance(exc, JobAdmissionError) else "failed",
                    error=exc,
                )
    except Exception as exc:
        logger.exception("Document remediation job failed for document_id=%s", document_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
