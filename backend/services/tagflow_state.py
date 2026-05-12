"""TagFlow remediation state helpers.

Normalizes PDF tag zones, validates editable page state, tracks layout hints
for AI tagging, and returns updated remediation metadata without touching the
legacy Canvas router.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException

from content_inventory import compact_whitespace
from models.pdf import TagFlowZoneRequest
from services.pdf_figures import bind_tagflow_figure_zones
from services.pdf_flowcharts import normalize_flowchart_structure

TAGFLOW_LAYOUT_HINTS = {"auto", "single_column", "two_column", "three_column"}


DEFAULT_TAGFLOW_TAGS = {
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "P",
    "L",
    "LI",
    "Figure",
    "Table",
    "TH",
    "TD",
    "TR",
    "Artifact",
    "Span",
}


def normalize_tagflow_layout_hint(value: Any) -> str:
    normalized = str(value or "auto").strip().lower().replace("-", "_").replace(" ", "_")
    return normalized if normalized in TAGFLOW_LAYOUT_HINTS else "auto"


def tagflow_document_layout_hint(tagflow_state: dict[str, Any]) -> str:
    hint = tagflow_state.get("layout_hint") if isinstance(tagflow_state.get("layout_hint"), dict) else {}
    return normalize_tagflow_layout_hint(hint.get("value"))


def tagflow_page_layout_hint(page: dict[str, Any]) -> str | None:
    hint = page.get("layout_hint") if isinstance(page.get("layout_hint"), dict) else None
    if not hint:
        return None
    normalized = normalize_tagflow_layout_hint(hint.get("value"))
    return normalized if normalized != "auto" else None


def tagflow_effective_layout_hint(tagflow_state: dict[str, Any], page: dict[str, Any]) -> str:
    return tagflow_page_layout_hint(page) or tagflow_document_layout_hint(tagflow_state) or "auto"


def with_effective_layout_hints(tagflow_state: dict[str, Any]) -> dict[str, Any]:
    pages = tagflow_state.get("pages") if isinstance(tagflow_state.get("pages"), list) else []
    next_pages = [
        {**page, "effective_layout_hint": tagflow_effective_layout_hint(tagflow_state, page)}
        for page in pages
        if isinstance(page, dict)
    ]
    return {**tagflow_state, "pages": next_pages}


def tagflow_state_summary(pages: list[dict[str, Any]], structural_tags: dict[str, Any] | None = None) -> dict[str, Any]:
    structural_tags = structural_tags if isinstance(structural_tags, dict) else {}
    normalized_statuses = [
        normalize_tagflow_page_status(page.get("review_status"))
        for page in pages
    ]
    validation_issue_count = sum(
        int((page.get("validation") if isinstance(page.get("validation"), dict) else {}).get("issue_count") or 0)
        for page in pages
    )
    return {
        "page_count": len(pages),
        "reviewed_page_count": sum(1 for status in normalized_statuses if status == "remediated"),
        "edited_page_count": sum(1 for status in normalized_statuses if status in {"edited", "remediated"}),
        "unreviewed_page_count": sum(1 for status in normalized_statuses if status == "unreviewed"),
        "remediated_page_count": sum(1 for status in normalized_statuses if status == "remediated"),
        "zone_count": sum(len(page.get("zones") or []) for page in pages),
        "dirty_page_count": sum(1 for page in pages if page.get("dirty")),
        "validation_issue_count": validation_issue_count,
        "needs_attention_page_count": sum(
            1 for page in pages
            if (page.get("validation") if isinstance(page.get("validation"), dict) else {}).get("status") == "needs_attention"
        ),
        "representative_page_count": sum(1 for page in pages if page.get("is_representative")),
        "has_struct_tree": structural_tags.get("has_struct_tree"),
        "has_mark_info": structural_tags.get("has_mark_info"),
    }


def normalize_tagflow_page_status(status: Any) -> str:
    value = str(status or "").strip().lower()
    if value in {"remediated", "reviewed", "complete", "completed"}:
        return "remediated"
    if value in {"edited", "needs_review", "needs-review", "needs work", "needs_work", "in_review", "in-review"}:
        return "edited"
    return "unreviewed"


def tagflow_zone_overlap_ratio(first: dict[str, Any], second: dict[str, Any]) -> float:
    first_bounds = first.get("bounds") if isinstance(first.get("bounds"), dict) else {}
    second_bounds = second.get("bounds") if isinstance(second.get("bounds"), dict) else {}
    first_left = float(first_bounds.get("x") or 0)
    first_top = float(first_bounds.get("y") or 0)
    first_right = first_left + float(first_bounds.get("width") or 0)
    first_bottom = first_top + float(first_bounds.get("height") or 0)
    second_left = float(second_bounds.get("x") or 0)
    second_top = float(second_bounds.get("y") or 0)
    second_right = second_left + float(second_bounds.get("width") or 0)
    second_bottom = second_top + float(second_bounds.get("height") or 0)
    overlap_width = max(0.0, min(first_right, second_right) - max(first_left, second_left))
    overlap_height = max(0.0, min(first_bottom, second_bottom) - max(first_top, second_top))
    overlap_area = overlap_width * overlap_height
    if overlap_area <= 0:
        return 0.0
    first_area = max(0.0, (first_right - first_left) * (first_bottom - first_top))
    second_area = max(0.0, (second_right - second_left) * (second_bottom - second_top))
    smaller_area = min(first_area, second_area)
    if smaller_area <= 0:
        return 0.0
    return overlap_area / smaller_area


def validate_tagflow_page(page: dict[str, Any], allowed_tags: set[str], *, validated_at: str) -> dict[str, Any]:
    page_number = int(page.get("page_number") or 0)
    zones = [
        zone for zone in (page.get("zones") or [])
        if isinstance(zone, dict)
    ]
    issues: list[dict[str, Any]] = []
    if not zones:
        issues.append({
            "code": "page_has_no_zones",
            "severity": "warning",
            "message": "No zones have been defined for this page.",
            "page_number": page_number,
        })

    content_zones = [zone for zone in zones if str(zone.get("tag") or "") != "Artifact"]
    reading_orders = [int(zone.get("reading_order") or 0) for zone in content_zones]
    expected_orders = list(range(1, len(content_zones) + 1))
    if content_zones and sorted(reading_orders) != expected_orders:
        issues.append({
            "code": "reading_order_sequence",
            "severity": "warning",
            "message": "Content reading order should be a complete sequence starting at 1. Artifacts are skipped.",
            "page_number": page_number,
        })

    def zone_label(zone: dict[str, Any], index: int) -> str:
        reading_order = int(zone.get("reading_order") or 0)
        return f"Zone {reading_order if reading_order > 0 else index + 1}"

    for index, zone in enumerate(zones):
        label = zone_label(zone, index)
        tag = str(zone.get("tag") or "")
        if tag not in allowed_tags:
            issues.append({
                "code": "unsupported_tag",
                "severity": "error",
                "message": f"{label} uses an unsupported tag: {tag or 'missing'}.",
                "page_number": page_number,
                "zone_id": zone.get("id"),
            })
        if tag != "Artifact" and int(zone.get("reading_order") or 0) < 1:
            issues.append({
                "code": "content_zone_missing_reading_order",
                "severity": "error",
                "message": f"{label} must have a reading order unless it is an Artifact.",
                "page_number": page_number,
                "zone_id": zone.get("id"),
            })
        if tag == "Figure":
            _append_figure_zone_issues(issues, zone, label=label, page_number=page_number)

        bounds = zone.get("bounds") if isinstance(zone.get("bounds"), dict) else {}
        width = float(bounds.get("width") or 0)
        height = float(bounds.get("height") or 0)
        x = float(bounds.get("x") or 0)
        y = float(bounds.get("y") or 0)
        if width < 2 or height < 2:
            issues.append({
                "code": "tiny_zone",
                "severity": "warning",
                "message": f"{label} is very small and may be hard to review.",
                "page_number": page_number,
                "zone_id": zone.get("id"),
            })
        if x < 0 or y < 0 or x + width > 100 or y + height > 100:
            issues.append({
                "code": "zone_out_of_bounds",
                "severity": "error",
                "message": f"{label} extends outside the page bounds.",
                "page_number": page_number,
                "zone_id": zone.get("id"),
            })

    for first_index, first_zone in enumerate(zones):
        for second_index, second_zone in enumerate(zones[first_index + 1:], start=first_index + 2):
            if tagflow_zone_overlap_ratio(first_zone, second_zone) >= 0.35:
                issues.append({
                    "code": "overlapping_zones",
                    "severity": "warning",
                    "message": f"{zone_label(first_zone, first_index)} and {zone_label(second_zone, second_index - 1)} overlap substantially.",
                    "page_number": page_number,
                    "zone_ids": [first_zone.get("id"), second_zone.get("id")],
                })
                break

    highest_heading_seen = 0
    original_index_by_id = {
        str(zone.get("id")): index
        for index, zone in enumerate(zones)
        if zone.get("id") is not None
    }
    for zone in sorted(zones, key=lambda item: int(item.get("reading_order") or 0)):
        tag = str(zone.get("tag") or "")
        if not re.fullmatch(r"H[1-6]", tag):
            continue
        level = int(tag[1])
        original_index = original_index_by_id.get(str(zone.get("id")), 0)
        label = zone_label(zone, original_index)
        if level > 1 and highest_heading_seen == 0:
            issues.append({
                "code": "heading_without_parent",
                "severity": "warning",
                "message": f"{label} starts with {tag} before an H1 or parent heading.",
                "page_number": page_number,
                "zone_id": zone.get("id"),
            })
        elif highest_heading_seen and level > highest_heading_seen + 1:
            issues.append({
                "code": "heading_level_jump",
                "severity": "warning",
                "message": f"{label} jumps from H{highest_heading_seen} to {tag}.",
                "page_number": page_number,
                "zone_id": zone.get("id"),
            })
        highest_heading_seen = level if highest_heading_seen == 0 else min(level, highest_heading_seen) if level < highest_heading_seen else level

    return {
        "status": "needs_attention" if issues else "passed",
        "issue_count": len(issues),
        "issues": issues,
        "validated_at": validated_at,
    }


def _append_figure_zone_issues(issues: list[dict[str, Any]], zone: dict[str, Any], *, label: str, page_number: int) -> None:
    has_zone_alt_text = bool(compact_whitespace(zone.get("alt_text")))
    if not zone.get("figure_candidate_id"):
        if not has_zone_alt_text:
            issues.append({
                "code": "figure_zone_unbound",
                "severity": "warning",
                "message": f"{label} is tagged as a Figure but is not linked to a reviewed figure candidate.",
                "page_number": page_number,
                "zone_id": zone.get("id"),
            })
    elif zone.get("figure_review_action") == "ignore":
        issues.append({
            "code": "figure_zone_ignored",
            "severity": "warning",
            "message": f"{label} is linked to a figure that was ignored in the figure panel.",
            "page_number": page_number,
            "zone_id": zone.get("id"),
        })
    elif zone.get("figure_is_decorative"):
        issues.append({
            "code": "decorative_figure_zone",
            "severity": "warning",
            "message": f"{label} is linked to a decorative figure; mark it as an Artifact unless it needs alternate text.",
            "page_number": page_number,
            "zone_id": zone.get("id"),
        })
    elif not zone.get("figure_has_alt_text") and not has_zone_alt_text:
        issues.append({
            "code": "figure_zone_missing_alt_text",
            "severity": "warning",
            "message": f"{label} is linked to a figure that still needs alt text.",
            "page_number": page_number,
            "zone_id": zone.get("id"),
        })


def tagflow_document_validation(pages: list[dict[str, Any]], *, validated_at: str) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    page_statuses: dict[str, str] = {}
    for page in pages:
        validation = page.get("validation") if isinstance(page.get("validation"), dict) else {}
        status = validation.get("status") or "not_run"
        page_statuses[str(page.get("page_number") or "")] = status
        for issue in validation.get("issues") or []:
            if isinstance(issue, dict):
                issues.append(issue)
    return {
        "status": "needs_attention" if issues else "passed",
        "issues": issues,
        "issue_count": len(issues),
        "page_statuses": page_statuses,
        "last_validated_at": validated_at,
    }


def normalize_tagflow_zone(zone: TagFlowZoneRequest, allowed_tags: set[str], fallback_id: str) -> dict[str, Any]:
    tag = str(getattr(zone.tag, "value", zone.tag)).strip()
    if tag not in allowed_tags:
        raise HTTPException(status_code=422, detail=f"Unsupported PDF tag: {tag}")
    evidence_ids = [
        compact_whitespace(str(item))[:120]
        for item in (zone.evidence_ids or [])
        if compact_whitespace(str(item))
    ]
    return {
        "id": zone.id or fallback_id,
        "tag": tag,
        "bounds": {
            "x": round(zone.x, 3),
            "y": round(zone.y, 3),
            "width": round(zone.width, 3),
            "height": round(zone.height, 3),
        },
        "reading_order": zone.reading_order,
        "source": zone.source,
        "confidence": zone.confidence,
        "evidence_type": compact_whitespace(zone.evidence_type)[:80] if zone.evidence_type else None,
        "evidence_ids": evidence_ids[:20],
        "figure_candidate_id": compact_whitespace(zone.figure_candidate_id)[:120] if zone.figure_candidate_id else None,
        "figure_inventory_id": compact_whitespace(zone.figure_inventory_id)[:120] if zone.figure_inventory_id else None,
        "alt_text": compact_whitespace(zone.alt_text)[:1000] if zone.alt_text else None,
        "long_description": str(zone.long_description or "")[:8000] if zone.long_description else None,
        "figure_type": zone.figure_type if zone.figure_type in {"image", "diagram", "flowchart"} else None,
        "flowchart_guidance": str(zone.flowchart_guidance or "")[:4000] if zone.flowchart_guidance else None,
        "flowchart": normalize_flowchart_structure(zone.flowchart) if isinstance(zone.flowchart, dict) else None,
        "note": compact_whitespace(zone.note) if zone.note else None,
    }


def update_tagflow_page_zones(
    *,
    remediation_plan: dict[str, Any],
    page_number: int,
    zones: list[TagFlowZoneRequest],
    updated_at: str,
    review_status: str | None = None,
) -> dict[str, Any]:
    tagflow_state = remediation_plan.get("tagflow_state") if isinstance(remediation_plan.get("tagflow_state"), dict) else None
    if not tagflow_state:
        raise HTTPException(status_code=409, detail="Run PDF review before editing TagFlow zones")
    allowed_tags = {
        str(tag)
        for tag in tagflow_state.get("allowed_tags", [])
        if isinstance(tag, str) and tag
    } or DEFAULT_TAGFLOW_TAGS

    normalized_zones = [
        normalize_tagflow_zone(zone, allowed_tags, f"zone-{page_number}-{index + 1}")
        for index, zone in enumerate(sorted(zones, key=lambda item: item.reading_order))
    ]
    normalized_zones = bind_tagflow_figure_zones(remediation_plan, page_number, normalized_zones)
    next_review_status = "remediated" if review_status == "remediated" else "edited"
    pages = tagflow_state.get("pages") if isinstance(tagflow_state.get("pages"), list) else []
    next_pages: list[dict[str, Any]] = []
    matched = False
    for page in pages:
        if not isinstance(page, dict):
            continue
        if int(page.get("page_number") or 0) == page_number:
            matched = True
            page = {
                **page,
                "review_status": next_review_status,
                "zones": normalized_zones,
                "zone_count": len(normalized_zones),
                "dirty": next_review_status != "remediated",
                "stale_preview": True,
                "stale_analysis": True,
                "analysis_status": "stale",
                "preview_asset_status": "stale",
                "reviewed_at": updated_at if next_review_status == "remediated" else page.get("reviewed_at"),
                "edited_at": updated_at,
                "updated_at": updated_at,
            }
            page["validation"] = validate_tagflow_page(page, allowed_tags, validated_at=updated_at)
        next_pages.append(page)
    if not matched:
        raise HTTPException(status_code=404, detail="TagFlow page not found")

    preview_generation = tagflow_state.get("preview_generation") if isinstance(tagflow_state.get("preview_generation"), dict) else {}
    stale_page_numbers = {
        int(existing)
        for existing in preview_generation.get("stale_page_numbers", [])
        if isinstance(existing, int) or str(existing).isdigit()
    }
    stale_page_numbers.add(page_number)
    structural_tags = remediation_plan.get("structural_tags") if isinstance(remediation_plan.get("structural_tags"), dict) else {}
    next_state = {
        **tagflow_state,
        "version": int(tagflow_state.get("version") or 1) + 1,
        "status": "in_review",
        "updated_at": updated_at,
        "pages": next_pages,
        "summary": tagflow_state_summary(next_pages, structural_tags),
        "preview_generation": {
            **preview_generation,
            "status": "stale",
            "stale_page_numbers": sorted(stale_page_numbers),
            "stale_at": updated_at,
        },
        "validation": tagflow_document_validation(next_pages, validated_at=updated_at),
    }
    return {**remediation_plan, "tagflow_state": next_state}


def _stale_ai_suggestions(suggestions: Any, *, updated_at: str) -> dict[str, Any]:
    current = suggestions if isinstance(suggestions, dict) else {}
    if not current:
        return current
    status = str(current.get("status") or "").lower()
    if status in {"queued", "running", "retrying"}:
        return current
    return {
        **current,
        "status": "stale",
        "stale_reason": "layout_hint_changed",
        "stale_at": updated_at,
    }


def update_tagflow_layout_hint(
    *,
    remediation_plan: dict[str, Any],
    layout: str,
    scope: str,
    updated_at: str,
    page_number: int | None = None,
) -> dict[str, Any]:
    tagflow_state = remediation_plan.get("tagflow_state") if isinstance(remediation_plan.get("tagflow_state"), dict) else None
    if not tagflow_state:
        raise HTTPException(status_code=409, detail="Run PDF review before editing TagFlow layout hints")

    normalized_layout = normalize_tagflow_layout_hint(layout)
    normalized_scope = str(scope or "page").strip().lower()
    if normalized_scope not in {"page", "document"}:
        raise HTTPException(status_code=422, detail="Layout hint scope must be page or document")
    if normalized_scope == "page" and not page_number:
        raise HTTPException(status_code=422, detail="page_number is required when applying a layout hint to one page")

    pages = tagflow_state.get("pages") if isinstance(tagflow_state.get("pages"), list) else []
    next_pages: list[dict[str, Any]] = []
    matched = False
    stale_page_numbers: set[int] = set()
    document_hint = tagflow_state.get("layout_hint") if isinstance(tagflow_state.get("layout_hint"), dict) else {}
    next_document_hint = document_hint

    if normalized_scope == "document":
        next_document_hint = {
            "value": normalized_layout,
            "source": "user",
            "updated_at": updated_at,
        }

    for page in pages:
        if not isinstance(page, dict):
            continue
        page_num = int(page.get("page_number") or 0)
        next_page = dict(page)
        if normalized_scope == "document":
            matched = True
            next_page.pop("layout_hint", None)
            next_page["ai_suggestions"] = _stale_ai_suggestions(next_page.get("ai_suggestions"), updated_at=updated_at)
            stale_page_numbers.add(page_num)
        elif page_num == page_number:
            matched = True
            if normalized_layout == "auto":
                next_page.pop("layout_hint", None)
            else:
                next_page["layout_hint"] = {
                    "value": normalized_layout,
                    "source": "user",
                    "updated_at": updated_at,
                }
            next_page["ai_suggestions"] = _stale_ai_suggestions(next_page.get("ai_suggestions"), updated_at=updated_at)
            stale_page_numbers.add(page_num)
        next_pages.append(next_page)

    if not matched:
        raise HTTPException(status_code=404, detail="TagFlow page not found")

    ai_generation = tagflow_state.get("ai_suggestion_generation") if isinstance(tagflow_state.get("ai_suggestion_generation"), dict) else {}
    existing_stale_pages = {
        int(existing)
        for existing in ai_generation.get("stale_page_numbers", [])
        if isinstance(existing, int) or str(existing).isdigit()
    }
    next_state = with_effective_layout_hints({
        **tagflow_state,
        "version": int(tagflow_state.get("version") or 1) + 1,
        "status": "in_review",
        "updated_at": updated_at,
        "layout_hint": next_document_hint,
        "pages": next_pages,
        "ai_suggestion_generation": {
            **ai_generation,
            "status": "stale",
            "stale_reason": "layout_hint_changed",
            "stale_page_numbers": sorted(existing_stale_pages | stale_page_numbers),
            "stale_at": updated_at,
        },
    })
    return {**remediation_plan, "tagflow_state": next_state}
