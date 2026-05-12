"""AI-assisted TagFlow zone suggestion pipeline.

Builds page-level tagging context, queues ASU AIML suggestion jobs, normalizes
returned zones, and keeps generated suggestions separate from manual TagFlow
edits until users apply them.
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable

from ai_image_text import generate_tagflow_zone_suggestions, is_ai_configured
from services.job_dispatch import dispatch_background_task
from services.job_queue import enqueue_background_job, env_int
from content_inventory import compact_whitespace
from services.pdf_figures import bind_tagflow_figure_zones
from services.tagflow_state import (
    tagflow_document_validation,
    tagflow_effective_layout_hint,
    tagflow_state_summary,
    validate_tagflow_page,
)
from supabase_client import get_supabase

logger = logging.getLogger(__name__)

ALLOWED_EVIDENCE_TYPES = {"text_block", "font_signal", "existing_tag", "figure_candidate", "table_signal", "layout_signal"}


def page_has_manual_tagflow_work(page: dict[str, Any]) -> bool:
    zones = page.get("zones") if isinstance(page.get("zones"), list) else []
    has_manual_zones = any(
        isinstance(zone, dict) and str(zone.get("source") or "manual").lower() != "ai"
        for zone in zones
    )
    return has_manual_zones or str(page.get("review_status") or "").lower() in {"edited", "remediated"}


def allowed_tagflow_tags(tagflow_state: dict[str, Any]) -> set[str]:
    allowed_tags = {
        str(tag)
        for tag in tagflow_state.get("allowed_tags", [])
        if isinstance(tag, str) and tag
    }
    if not allowed_tags:
        allowed_tags = {"H1", "H2", "H3", "H4", "H5", "H6", "P", "L", "LI", "Figure", "Table", "TH", "TD", "TR", "Artifact", "Span"}
    return allowed_tags


def normalize_ai_tagflow_zone(zone: dict[str, Any], allowed_tags: set[str], fallback_id: str, reading_order: int) -> dict[str, Any] | None:
    tag = str(zone.get("tag") or "P").strip()
    if tag not in allowed_tags:
        tag = "P"
    try:
        x = max(0.0, min(100.0, float(zone.get("x"))))
        y = max(0.0, min(100.0, float(zone.get("y"))))
        width = max(1.0, min(100.0 - x, float(zone.get("width"))))
        height = max(1.0, min(100.0 - y, float(zone.get("height"))))
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    confidence = zone.get("confidence")
    try:
        confidence = max(0.0, min(1.0, float(confidence))) if confidence is not None else None
    except (TypeError, ValueError):
        confidence = None
    evidence_type = compact_whitespace(str(zone.get("evidence_type") or "layout_signal"))
    if evidence_type not in ALLOWED_EVIDENCE_TYPES:
        evidence_type = "layout_signal"
    raw_evidence_ids = zone.get("evidence_ids")
    if isinstance(raw_evidence_ids, list):
        evidence_ids = [
            compact_whitespace(str(item))[:80]
            for item in raw_evidence_ids[:12]
            if compact_whitespace(str(item))
        ]
    elif raw_evidence_ids:
        evidence_ids = [compact_whitespace(str(raw_evidence_ids))[:80]]
    else:
        evidence_ids = []
    figure_candidate_id = None
    if tag == "Figure":
        explicit_candidate_id = compact_whitespace(str(zone.get("figure_candidate_id") or ""))
        figure_candidate_id = explicit_candidate_id[:120] or next(
            (item for item in evidence_ids if item.startswith("figure-")),
            None,
        )
    return {
        "id": fallback_id,
        "tag": tag,
        "bounds": {
            "x": round(x, 3),
            "y": round(y, 3),
            "width": round(width, 3),
            "height": round(height, 3),
        },
        "reading_order": reading_order,
        "source": "ai",
        "confidence": confidence,
        "evidence_type": evidence_type,
        "evidence_ids": evidence_ids,
        "figure_candidate_id": figure_candidate_id,
        "note": compact_whitespace(str(zone.get("note") or ""))[:500] or None,
    }


def _layout_column_count(layout_hint: str | None) -> int:
    if layout_hint == "two_column":
        return 2
    if layout_hint == "three_column":
        return 3
    return 1


def _zone_column(zone: dict[str, Any], column_count: int) -> int:
    bounds = zone.get("bounds") if isinstance(zone.get("bounds"), dict) else {}
    x = float(bounds.get("x") or 0)
    width = float(bounds.get("width") or 0)
    center_x = x + (width / 2)
    return min(column_count - 1, max(0, int(center_x / (100 / column_count))))


def reorder_ai_tagflow_zones_for_layout(zones: list[dict[str, Any]], layout_hint: str | None) -> list[dict[str, Any]]:
    column_count = _layout_column_count(layout_hint)
    if column_count <= 1:
        return sorted(zones, key=lambda item: int(item.get("reading_order") or 0))

    top_full_width: list[dict[str, Any]] = []
    column_zones: list[dict[str, Any]] = []
    bottom_full_width: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    for zone in zones:
        if str(zone.get("tag") or "") == "Artifact":
            artifacts.append(zone)
            continue
        bounds = zone.get("bounds") if isinstance(zone.get("bounds"), dict) else {}
        y = float(bounds.get("y") or 0)
        width = float(bounds.get("width") or 0)
        full_width_threshold = 62 if column_count == 2 else 50
        if width >= full_width_threshold and y <= 18:
            top_full_width.append(zone)
        elif width >= full_width_threshold and y >= 82:
            bottom_full_width.append(zone)
        else:
            column_zones.append(zone)

    ordered = [
        *sorted(top_full_width, key=lambda item: ((item.get("bounds") or {}).get("y") or 0, (item.get("bounds") or {}).get("x") or 0)),
        *sorted(
            column_zones,
            key=lambda item: (
                _zone_column(item, column_count),
                (item.get("bounds") or {}).get("y") or 0,
                (item.get("bounds") or {}).get("x") or 0,
            ),
        ),
        *sorted(bottom_full_width, key=lambda item: ((item.get("bounds") or {}).get("y") or 0, (item.get("bounds") or {}).get("x") or 0)),
    ]
    return [
        *[
            {**zone, "reading_order": index}
            for index, zone in enumerate(ordered, start=1)
        ],
        *[
            {**zone, "reading_order": 0}
            for zone in sorted(artifacts, key=lambda item: ((item.get("bounds") or {}).get("y") or 0, (item.get("bounds") or {}).get("x") or 0))
        ],
    ]


def parse_tagflow_ai_suggestion_response(raw: str, *, page_number: int, allowed_tags: set[str]) -> list[dict[str, Any]]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise ValueError("AI response did not include JSON")
        payload = json.loads(match.group(0))
    zones = payload.get("zones") if isinstance(payload, dict) else payload
    if not isinstance(zones, list):
        raise ValueError("AI response JSON must include a zones array")
    normalized: list[dict[str, Any]] = []
    for index, zone in enumerate(zones[:150], start=1):
        if not isinstance(zone, dict):
            continue
        suggestion = normalize_ai_tagflow_zone(
            zone,
            allowed_tags,
            f"ai-zone-{page_number}-{index}",
            int(zone.get("reading_order") or index),
        )
        if suggestion:
            normalized.append(suggestion)
    return sorted(normalized, key=lambda item: int(item.get("reading_order") or 0))


def tagflow_ai_page_payload(remediation: dict[str, Any], page: dict[str, Any]) -> dict[str, Any]:
    metadata = remediation.get("metadata") if isinstance(remediation.get("metadata"), dict) else {}
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    structural_tags = remediation.get("structural_tags") if isinstance(remediation.get("structural_tags"), dict) else {}
    evidence = remediation.get("existing_structure_evidence") if isinstance(remediation.get("existing_structure_evidence"), dict) else {}
    document_layout_hint = tagflow_state.get("layout_hint") if isinstance(tagflow_state.get("layout_hint"), dict) else {}
    page_layout_hint = page.get("layout_hint") if isinstance(page.get("layout_hint"), dict) else {}
    effective_layout_hint = tagflow_effective_layout_hint(tagflow_state, page)
    text_blocks = []
    for block in (page.get("text_blocks") or [])[:80]:
        if not isinstance(block, dict):
            continue
        text_blocks.append({
            "id": block.get("id"),
            "text": compact_whitespace(block.get("text"))[:1000],
            "bounds": block.get("bounds"),
            "reading_order": block.get("reading_order"),
            "font_size": block.get("font_size"),
            "bold": block.get("bold"),
            "font_names": block.get("font_names"),
            "normalized_font_names": block.get("normalized_font_names"),
        })
    figure_candidates = []
    for figure in (page.get("figure_candidates") or [])[:30]:
        if not isinstance(figure, dict):
            continue
        figure_candidates.append({
            "id": figure.get("id"),
            "bounds": figure.get("bounds"),
            "fragment_count": figure.get("fragment_count"),
            "decorative_likely": figure.get("decorative_likely"),
            "needs_alt_text": figure.get("needs_alt_text"),
            "confidence": figure.get("confidence"),
        })
    return {
        "document": {
            "title": metadata.get("title"),
            "language": metadata.get("language"),
        },
        "page_number": page.get("page_number"),
        "layout_hint": {
            "effective": effective_layout_hint,
            "page_override": page_layout_hint.get("value"),
            "document_default": document_layout_hint.get("value") or "auto",
            "instruction": "Use this as a reading-order and column-flow hint. Auto means infer layout from text and visual evidence.",
        },
        "existing_zones": page.get("zones") or [],
        "text_blocks": text_blocks,
        "figure_candidates": figure_candidates,
        "diagnostics": page.get("diagnostics") or {},
        "text_analysis_summary": remediation.get("text_analysis", {}).get("summary") if isinstance(remediation.get("text_analysis"), dict) else None,
        "existing_structure_evidence": evidence,
        "structural_tags": structural_tags,
    }


def tagflow_pages_for_ai_suggestions(
    remediation: dict[str, Any],
    *,
    requested_page_numbers: set[int] | None = None,
    max_pages: int | None = 10,
    skip_manual_pages: bool = False,
    skip_existing_suggestions: bool = False,
) -> list[dict[str, Any]]:
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    pages = [
        page for page in (tagflow_state.get("pages") or [])
        if isinstance(page, dict) and (isinstance(page.get("page_number"), int) or str(page.get("page_number")).isdigit())
    ]
    page_count = int((tagflow_state.get("summary") or {}).get("page_count") or len(pages) or 0)
    if requested_page_numbers:
        invalid_pages = [page_number for page_number in requested_page_numbers if page_number < 1 or (page_count and page_number > page_count)]
        if invalid_pages:
            raise ValueError(f"Requested TagFlow suggestion page is outside the document range: {invalid_pages[0]}")
    selected = []
    for page in pages:
        if requested_page_numbers and int(page.get("page_number") or 0) not in requested_page_numbers:
            continue
        if skip_manual_pages:
            if page_has_manual_tagflow_work(page):
                continue
        if skip_existing_suggestions:
            suggestions = page.get("ai_suggestions") if isinstance(page.get("ai_suggestions"), dict) else {}
            if str(suggestions.get("status") or "").lower() in {"queued", "running", "generated", "partial"}:
                continue
        selected.append(page)
    if requested_page_numbers:
        return selected
    if max_pages is None:
        return selected
    return selected[:max(0, int(max_pages))]


def mark_tagflow_ai_suggestion_status(
    remediation: dict[str, Any],
    *,
    pages: list[dict[str, Any]],
    job_id: str,
    status: str,
    timestamp: str,
) -> dict[str, Any]:
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    page_numbers = {int(page.get("page_number") or 0) for page in pages}
    next_pages: list[dict[str, Any]] = []
    for page in tagflow_state.get("pages") or []:
        if not isinstance(page, dict):
            continue
        page_number = int(page.get("page_number") or 0)
        if page_number in page_numbers:
            current = page.get("ai_suggestions") if isinstance(page.get("ai_suggestions"), dict) else {}
            page = {
                **page,
                "ai_suggestions": {
                    **current,
                    "status": status,
                    "job_id": job_id,
                    f"{status}_at": timestamp,
                },
            }
        next_pages.append(page)
    suggestion_state = tagflow_state.get("ai_suggestion_generation") if isinstance(tagflow_state.get("ai_suggestion_generation"), dict) else {}
    return {
        **remediation,
        "tagflow_state": {
            **tagflow_state,
            "pages": next_pages,
            "ai_suggestion_generation": {
                **suggestion_state,
                "status": status,
                "job_id": job_id,
                "page_numbers": sorted(page_numbers),
                f"{status}_at": timestamp,
            },
        },
    }


def apply_tagflow_ai_suggestions(
    remediation: dict[str, Any],
    *,
    job_id: str,
    generated_suggestions: dict[int, list[dict[str, Any]]],
    failed_pages: list[dict[str, Any]],
    generated_at: str,
    auto_apply_to_draft: bool = False,
) -> dict[str, Any]:
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    allowed_tags = allowed_tagflow_tags(tagflow_state)
    structural_tags = remediation.get("structural_tags") if isinstance(remediation.get("structural_tags"), dict) else {}
    preview_generation = tagflow_state.get("preview_generation") if isinstance(tagflow_state.get("preview_generation"), dict) else {}
    stale_page_numbers = {
        int(existing)
        for existing in preview_generation.get("stale_page_numbers", [])
        if isinstance(existing, int) or str(existing).isdigit()
    }
    failed_page_numbers = {int(page.get("page_number") or 0) for page in failed_pages}
    next_pages: list[dict[str, Any]] = []
    auto_applied_page_numbers: list[int] = []
    for page in tagflow_state.get("pages") or []:
        if not isinstance(page, dict):
            continue
        page_number = int(page.get("page_number") or 0)
        if page_number in generated_suggestions:
            suggestions = generated_suggestions[page_number]
            page = {
                **page,
                "ai_suggestions": {
                    "status": "generated",
                    "job_id": job_id,
                    "generated_at": generated_at,
                    "zones": suggestions,
                    "zone_count": len(suggestions),
                    "source": "asu_aiml",
                },
            }
            if auto_apply_to_draft and suggestions and not page_has_manual_tagflow_work(page):
                draft_zones = bind_tagflow_figure_zones(remediation, page_number, suggestions)
                page = {
                    **page,
                    "zones": draft_zones,
                    "zone_count": len(draft_zones),
                    "review_status": "unreviewed",
                    "dirty": False,
                    "stale_preview": True,
                    "stale_analysis": True,
                    "analysis_status": "ai_draft",
                    "preview_asset_status": "stale",
                    "ai_draft_applied": {
                        "status": "applied",
                        "source": "asu_aiml",
                        "job_id": job_id,
                        "applied_at": generated_at,
                        "zone_count": len(draft_zones),
                    },
                    "updated_at": generated_at,
                }
                page["validation"] = validate_tagflow_page(page, allowed_tags, validated_at=generated_at)
                stale_page_numbers.add(page_number)
                auto_applied_page_numbers.append(page_number)
        elif page_number in failed_page_numbers:
            error = next((item.get("error") for item in failed_pages if int(item.get("page_number") or 0) == page_number), "AI suggestion failed")
            current = page.get("ai_suggestions") if isinstance(page.get("ai_suggestions"), dict) else {}
            page = {
                **page,
                "ai_suggestions": {
                    **current,
                    "status": "failed",
                    "job_id": job_id,
                    "failed_at": generated_at,
                    "error_message": error,
                },
            }
        next_pages.append(page)
    status = "generated"
    if failed_pages and generated_suggestions:
        status = "partial"
    elif failed_pages and not generated_suggestions:
        status = "failed"
    suggestion_state = tagflow_state.get("ai_suggestion_generation") if isinstance(tagflow_state.get("ai_suggestion_generation"), dict) else {}
    next_tagflow_state = {
        **tagflow_state,
        "pages": next_pages,
        "ai_suggestion_generation": {
            **suggestion_state,
            "status": status,
            "job_id": job_id,
            "generated_page_numbers": sorted(generated_suggestions),
            "failed_pages": failed_pages,
            "generated_at": generated_at,
            "auto_applied_page_numbers": sorted(auto_applied_page_numbers),
        },
    }
    if auto_applied_page_numbers:
        next_tagflow_state = {
            **next_tagflow_state,
            "version": int(tagflow_state.get("version") or 1) + 1,
            "status": "in_review",
            "updated_at": generated_at,
            "summary": tagflow_state_summary(next_pages, structural_tags),
            "preview_generation": {
                **preview_generation,
                "status": "stale",
                "stale_page_numbers": sorted(stale_page_numbers),
                "stale_at": generated_at,
            },
            "validation": tagflow_document_validation(next_pages, validated_at=generated_at),
        }
    return {
        **remediation,
        "tagflow_state": next_tagflow_state,
    }


def queue_tagflow_ai_suggestion_job(
    supabase,
    *,
    session_id: str,
    user_id: str,
    row: dict[str, Any],
    update_document_remediation_metadata: Callable[..., Any],
    run_job: Callable[[str, str, str, str], Any],
    page_numbers: list[int] | None = None,
    max_pages: int | None = 10,
    skip_manual_pages: bool = False,
    skip_existing_suggestions: bool = False,
    auto_apply_to_draft: bool = False,
    background_tasks: Any | None = None,
    run_inline: bool = False,
) -> str:
    if not is_ai_configured():
        raise ValueError("ASU AIML is not configured for this environment")
    remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
    if not remediation:
        raise ValueError("Run PDF review before generating TagFlow AI suggestions")
    requested_page_numbers = {
        int(page_number)
        for page_number in page_numbers or []
        if isinstance(page_number, int) or str(page_number).isdigit()
    } or None
    pages = tagflow_pages_for_ai_suggestions(
        remediation,
        requested_page_numbers=requested_page_numbers,
        max_pages=max_pages,
        skip_manual_pages=skip_manual_pages,
        skip_existing_suggestions=skip_existing_suggestions,
    )
    if not pages:
        raise ValueError("No TagFlow pages are available for AI suggestions")

    job_payload = {
        "session_id": session_id,
        "document_id": row["id"],
        "canvas_file_id": row.get("canvas_id"),
        "filename": row.get("filename"),
        "page_numbers": [page["page_number"] for page in pages],
        "auto_apply_to_draft": auto_apply_to_draft,
    }
    enqueued = enqueue_background_job(
        supabase,
        user_id=user_id,
        session_id=session_id,
        job_type="tagflow_ai_suggestions",
        payload=job_payload,
        duplicate_fields=("document_id",),
        max_active_job_type_per_user=env_int("TAGFLOW_AI_MAX_ACTIVE_JOBS_PER_USER", 2),
    )
    job_id = enqueued.job["id"]
    if not enqueued.created:
        return job_id
    queued_at = datetime.now(timezone.utc).isoformat()
    queued_remediation = mark_tagflow_ai_suggestion_status(
        remediation,
        pages=pages,
        job_id=job_id,
        status="queued",
        timestamp=queued_at,
    )
    update_document_remediation_metadata(
        supabase,
        session_id=session_id,
        user_id=user_id,
        document_id=row["id"],
        remediation_plan=queued_remediation,
        updated_at=queued_at,
    )
    if run_inline:
        run_job(job_id, session_id, user_id, row["id"])
    elif background_tasks is not None:
        dispatch_background_task(background_tasks, run_job, job_id, session_id, user_id, row["id"])
    return job_id


def run_tagflow_ai_suggestion_job(
    job_id: str,
    session_id: str,
    user_id: str,
    document_id: str,
    *,
    get_owned_session: Callable[..., Any],
    get_session_document_row: Callable[..., dict[str, Any]],
    update_document_remediation_metadata: Callable[..., Any],
):
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
        remediation = row.get("document_remediation") if isinstance(row.get("document_remediation"), dict) else None
        if not remediation:
            raise ValueError("Run PDF review before generating TagFlow AI suggestions")
        payload_result = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        payload = payload_result.data[0].get("payload") if payload_result.data else {}
        requested_page_numbers = {
            int(page_number)
            for page_number in (payload.get("page_numbers") if isinstance(payload, dict) else []) or []
            if isinstance(page_number, int) or str(page_number).isdigit()
        } or None
        auto_apply_to_draft = bool(payload.get("auto_apply_to_draft")) if isinstance(payload, dict) else False
        pages = tagflow_pages_for_ai_suggestions(remediation, requested_page_numbers=requested_page_numbers)
        if not pages:
            raise ValueError("No TagFlow pages are available for AI suggestions")
        running_remediation = mark_tagflow_ai_suggestion_status(
            remediation,
            pages=pages,
            job_id=job_id,
            status="running",
            timestamp=started_at,
        )
        update_document_remediation_metadata(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=row["id"],
            remediation_plan=running_remediation,
            updated_at=started_at,
        )
        remediation = running_remediation
        tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
        allowed_tags = allowed_tagflow_tags(tagflow_state)
        generated_at = datetime.now(timezone.utc).isoformat()
        generated_suggestions: dict[int, list[dict[str, Any]]] = {}
        failed_pages: list[dict[str, Any]] = []
        for page in pages:
            page_number = int(page.get("page_number") or 0)
            try:
                prompt_payload = tagflow_ai_page_payload(remediation, page)
                raw = generate_tagflow_zone_suggestions(page_payload=prompt_payload)
                suggestions = parse_tagflow_ai_suggestion_response(raw, page_number=page_number, allowed_tags=allowed_tags)
                layout_hint = prompt_payload.get("layout_hint") if isinstance(prompt_payload.get("layout_hint"), dict) else {}
                suggestions = reorder_ai_tagflow_zones_for_layout(suggestions, str(layout_hint.get("effective") or "auto"))
                generated_suggestions[page_number] = suggestions
            except Exception as exc:
                logger.exception("Failed to generate TagFlow AI suggestions document_id=%s page_number=%s", row["id"], page_number)
                failed_pages.append({"page_number": page_number, "error": str(exc)})

        next_remediation = apply_tagflow_ai_suggestions(
            remediation,
            job_id=job_id,
            generated_suggestions=generated_suggestions,
            failed_pages=failed_pages,
            generated_at=generated_at,
            auto_apply_to_draft=auto_apply_to_draft,
        )
        update_document_remediation_metadata(
            supabase,
            session_id=session_id,
            user_id=user_id,
            document_id=row["id"],
            remediation_plan=next_remediation,
            updated_at=generated_at,
        )
        result = {
            "document_id": row["id"],
            "canvas_file_id": row.get("canvas_id"),
            "generated_page_count": len(generated_suggestions),
            "failed_page_count": len(failed_pages),
            "generated_page_numbers": sorted(generated_suggestions),
            "failed_pages": failed_pages,
        }
        if not generated_suggestions:
            raise ValueError(f"TagFlow AI suggestions failed for all {len(failed_pages)} page(s)")
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
    except Exception as exc:
        logger.exception("TagFlow AI suggestion job failed for document_id=%s", document_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
