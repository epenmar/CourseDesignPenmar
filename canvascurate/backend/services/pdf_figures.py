"""PDF figure inventory and review-state helpers.

Builds stable figure records from extracted PDF candidates, updates reviewed
figure metadata, binds TagFlow Figure zones to inventory records, and renders
figure crops for review or AI generation.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from PIL import Image, ImageOps

from services.pdf_flowcharts import normalize_flowchart_structure


FIGURE_INVENTORY_VERSION = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compact_text(value: Any, max_length: int) -> str:
    text = str(value or "").strip()
    return " ".join(text.split())[:max_length]


def _bounds_area(bounds: dict[str, Any]) -> float:
    return max(0.0, float(bounds.get("width") or 0)) * max(0.0, float(bounds.get("height") or 0))


def _normalized_bounds(bounds: Any) -> dict[str, float]:
    if not isinstance(bounds, dict):
        return {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}
    x = max(0.0, min(100.0, float(bounds.get("x") or 0)))
    y = max(0.0, min(100.0, float(bounds.get("y") or 0)))
    width = max(0.0, min(100.0 - x, float(bounds.get("width") or 0)))
    height = max(0.0, min(100.0 - y, float(bounds.get("height") or 0)))
    return {
        "x": round(x, 4),
        "y": round(y, 4),
        "width": round(width, 4),
        "height": round(height, 4),
    }


def _bounds_overlap_ratio(first_bounds: dict[str, Any], second_bounds: dict[str, Any]) -> float:
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


def _existing_figure_maps(existing_inventory: dict[str, Any] | None) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_id: dict[str, dict[str, Any]] = {}
    by_candidate: dict[str, dict[str, Any]] = {}
    if not isinstance(existing_inventory, dict):
        return by_id, by_candidate
    for figure in existing_inventory.get("figures") or []:
        if not isinstance(figure, dict):
            continue
        figure_id = str(figure.get("id") or "")
        candidate_id = str(figure.get("source_candidate_id") or "")
        if figure_id:
            by_id[figure_id] = figure
        if candidate_id:
            by_candidate[candidate_id] = figure
    return by_id, by_candidate


def _figure_status(figure: dict[str, Any]) -> str:
    if figure.get("review_action") == "ignore":
        return "ignored"
    if figure.get("is_decorative"):
        return "decorative"
    if _compact_text(figure.get("alt_text"), 1000) or _compact_text(figure.get("long_description"), 8000):
        return "reviewed"
    return "needs_review"


def _recount_inventory(inventory: dict[str, Any]) -> dict[str, Any]:
    figures = [figure for figure in inventory.get("figures") or [] if isinstance(figure, dict)]
    active_figures = [figure for figure in figures if figure.get("review_action") != "ignore"]
    ignored_count = len(figures) - len(active_figures)
    needs_alt_count = sum(1 for figure in active_figures if not figure.get("is_decorative") and not _compact_text(figure.get("alt_text"), 1000))
    reviewed_count = sum(1 for figure in figures if figure.get("status") in {"reviewed", "decorative"})
    return {
        **inventory,
        "status": "ready" if figures else "empty",
        "figure_count": len(figures),
        "active_figure_count": len(active_figures),
        "ignored_count": ignored_count,
        "needs_alt_count": needs_alt_count,
        "reviewed_count": reviewed_count,
    }


def build_pdf_figure_inventory(
    text_analysis: dict[str, Any] | None,
    *,
    existing_inventory: dict[str, Any] | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build a stable, user-reviewable PDF figure inventory from grouped image candidates."""
    by_id, by_candidate = _existing_figure_maps(existing_inventory)
    created = created_at or _now_iso()
    figures: list[dict[str, Any]] = []

    pages = (text_analysis or {}).get("pages") if isinstance(text_analysis, dict) else []
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        page_number = int(page.get("page_number") or 0)
        if page_number < 1:
            continue
        candidates = page.get("figure_candidates") if isinstance(page.get("figure_candidates"), list) else []
        for index, candidate in enumerate(candidates, start=1):
            if not isinstance(candidate, dict):
                continue
            source_candidate_id = str(candidate.get("id") or f"figure-{page_number}-{index}")
            figure_id = f"pdf-{source_candidate_id}"
            existing = by_id.get(figure_id) or by_candidate.get(source_candidate_id) or {}
            bounds = _normalized_bounds(candidate.get("bounds"))
            area_ratio = float(candidate.get("area_ratio") or (_bounds_area(bounds) / 10_000))
            is_decorative = bool(existing.get("is_decorative")) if "is_decorative" in existing else bool(candidate.get("decorative_likely"))
            figure = {
                "id": figure_id,
                "page_number": page_number,
                "source_page_number": int(candidate.get("source_page_number") or page_number),
                "source_candidate_id": source_candidate_id,
                "bounds": bounds,
                "fragment_count": int(candidate.get("fragment_count") or 1),
                "raw_image_ids": candidate.get("raw_image_ids") or [],
                "raw_xrefs": candidate.get("raw_xrefs") or [],
                "area_ratio": round(area_ratio, 5),
                "decorative_likely": bool(candidate.get("decorative_likely")),
                "full_page_likely": bool(candidate.get("full_page_likely")),
                "is_decorative": is_decorative,
                "needs_alt_text": not is_decorative,
                "review_action": existing.get("review_action") if existing.get("review_action") in {"keep", "ignore"} else "keep",
                "alt_text": _compact_text(existing.get("alt_text"), 1000),
                "long_description": str(existing.get("long_description") or "")[:8000],
                "ai_alt_text": existing.get("ai_alt_text") if isinstance(existing.get("ai_alt_text"), str) else None,
                "ai_long_description": existing.get("ai_long_description") if isinstance(existing.get("ai_long_description"), str) else None,
                "figure_type": existing.get("figure_type") if existing.get("figure_type") in {"image", "diagram", "flowchart"} else "image",
                "flowchart_guidance": str(existing.get("flowchart_guidance") or "")[:4000],
                "flowchart": normalize_flowchart_structure(existing.get("flowchart")) if isinstance(existing.get("flowchart"), dict) else None,
                "asset": existing.get("asset") if isinstance(existing.get("asset"), dict) else None,
                "status": str(existing.get("status") or "needs_review"),
                "reviewed_at": existing.get("reviewed_at"),
                "ignored_at": existing.get("ignored_at"),
                "updated_at": existing.get("updated_at"),
                "created_at": existing.get("created_at") or created,
                "source": "pdf_figure_candidate",
                "confidence": float(candidate.get("confidence") or 0.6),
            }
            figure["status"] = _figure_status(figure)
            figures.append(figure)

    return _recount_inventory({
        "kind": "pdf_figure_inventory",
        "version": FIGURE_INVENTORY_VERSION,
        "created_at": ((existing_inventory or {}).get("created_at") or created) if isinstance(existing_inventory, dict) else created,
        "updated_at": created,
        "figures": figures,
    })


def find_pdf_figure(remediation: dict[str, Any] | None, figure_id: str) -> dict[str, Any] | None:
    inventory = remediation.get("figure_inventory") if isinstance(remediation, dict) else None
    if not isinstance(inventory, dict):
        return None
    for figure in inventory.get("figures") or []:
        if isinstance(figure, dict) and figure.get("id") == figure_id:
            return figure
    return None


def update_pdf_figure_review(
    remediation: dict[str, Any],
    figure_id: str,
    updates: dict[str, Any],
    *,
    updated_at: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    inventory = remediation.get("figure_inventory") if isinstance(remediation.get("figure_inventory"), dict) else {}
    figures = [figure for figure in inventory.get("figures") or [] if isinstance(figure, dict)]
    timestamp = updated_at or _now_iso()
    next_figures: list[dict[str, Any]] = []
    updated_figure: dict[str, Any] | None = None

    for figure in figures:
        if figure.get("id") != figure_id:
            next_figures.append(figure)
            continue
        next_figure = {**figure}
        if "alt_text" in updates:
            next_figure["alt_text"] = _compact_text(updates.get("alt_text"), 1000)
        if "long_description" in updates:
            next_figure["long_description"] = str(updates.get("long_description") or "")[:8000]
        if "is_decorative" in updates:
            next_figure["is_decorative"] = bool(updates.get("is_decorative"))
            next_figure["needs_alt_text"] = not next_figure["is_decorative"]
        if updates.get("review_action") in {"keep", "ignore"}:
            next_figure["review_action"] = updates["review_action"]
            next_figure["ignored_at"] = timestamp if updates["review_action"] == "ignore" else None
        if "ai_alt_text" in updates:
            next_figure["ai_alt_text"] = _compact_text(updates.get("ai_alt_text"), 1000)
        if "ai_long_description" in updates:
            next_figure["ai_long_description"] = str(updates.get("ai_long_description") or "")[:8000]
        if updates.get("figure_type") in {"image", "diagram", "flowchart"}:
            next_figure["figure_type"] = updates["figure_type"]
        if "flowchart_guidance" in updates:
            next_figure["flowchart_guidance"] = str(updates.get("flowchart_guidance") or "")[:4000]
        if "flowchart" in updates:
            next_figure["flowchart"] = normalize_flowchart_structure(updates.get("flowchart"), updated_at=timestamp)
            if next_figure["flowchart"].get("guidance"):
                next_figure["flowchart_guidance"] = str(next_figure["flowchart"]["guidance"])[:4000]
        next_figure["status"] = _figure_status(next_figure)
        next_figure["updated_at"] = timestamp
        if next_figure["status"] in {"reviewed", "decorative"}:
            next_figure["reviewed_at"] = timestamp
        updated_figure = next_figure
        next_figures.append(next_figure)

    if updated_figure is None:
        raise KeyError(f"Figure {figure_id} was not found")

    next_inventory = _recount_inventory({
        **inventory,
        "updated_at": timestamp,
        "figures": next_figures,
    })
    return {**remediation, "figure_inventory": next_inventory}, updated_figure


def update_pdf_figure_asset(
    remediation: dict[str, Any],
    figure_id: str,
    asset: dict[str, Any],
    *,
    updated_at: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    inventory = remediation.get("figure_inventory") if isinstance(remediation.get("figure_inventory"), dict) else {}
    figures = [figure for figure in inventory.get("figures") or [] if isinstance(figure, dict)]
    timestamp = updated_at or _now_iso()
    next_figures: list[dict[str, Any]] = []
    updated_figure: dict[str, Any] | None = None

    for figure in figures:
        if figure.get("id") != figure_id:
            next_figures.append(figure)
            continue
        updated_figure = {
            **figure,
            "asset": asset,
            "updated_at": timestamp,
        }
        next_figures.append(updated_figure)

    if updated_figure is None:
        raise KeyError(f"Figure {figure_id} was not found")

    next_inventory = _recount_inventory({
        **inventory,
        "updated_at": timestamp,
        "figures": next_figures,
    })
    return {**remediation, "figure_inventory": next_inventory}, updated_figure


def enrich_tagflow_figure_candidates(remediation: dict[str, Any]) -> dict[str, Any]:
    """Attach figure review state to matching TagFlow figure candidates."""
    if not isinstance(remediation, dict):
        return remediation
    inventory = remediation.get("figure_inventory") if isinstance(remediation.get("figure_inventory"), dict) else {}
    figures = [figure for figure in inventory.get("figures") or [] if isinstance(figure, dict)]
    figures_by_candidate = {
        str(figure.get("source_candidate_id")): figure
        for figure in figures
        if figure.get("source_candidate_id")
    }
    if not figures_by_candidate:
        return remediation

    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    pages = tagflow_state.get("pages") if isinstance(tagflow_state.get("pages"), list) else []
    if not pages:
        return remediation

    next_pages: list[dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        candidates = page.get("figure_candidates") if isinstance(page.get("figure_candidates"), list) else []
        next_candidates: list[dict[str, Any]] = []
        changed = False
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            figure = figures_by_candidate.get(str(candidate.get("id") or ""))
            if not figure:
                next_candidates.append(candidate)
                continue
            alt_text = _compact_text(figure.get("alt_text"), 1000)
            long_description = str(figure.get("long_description") or "")[:1200]
            next_candidates.append({
                **candidate,
                "figure_inventory_id": figure.get("id"),
                "figure_status": figure.get("status") or _figure_status(figure),
                "review_action": figure.get("review_action"),
                "is_decorative": bool(figure.get("is_decorative")),
                "has_alt_text": bool(alt_text),
                "has_long_description": bool(_compact_text(figure.get("long_description"), 8000)),
                "alt_text": alt_text,
                "long_description": long_description,
                "figure_type": figure.get("figure_type") if figure.get("figure_type") in {"image", "diagram", "flowchart"} else "image",
                "flowchart_guidance": str(figure.get("flowchart_guidance") or "")[:4000],
                "flowchart": normalize_flowchart_structure(figure.get("flowchart")) if isinstance(figure.get("flowchart"), dict) else None,
                "full_page_likely": bool(figure.get("full_page_likely")),
            })
            changed = True
        next_pages.append({**page, "figure_candidates": next_candidates} if changed else page)

    return {
        **remediation,
        "tagflow_state": {
            **tagflow_state,
            "pages": next_pages,
        },
    }


def bind_tagflow_figure_zones(remediation: dict[str, Any], page_number: int, zones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Resolve saved Figure zones to stable figure inventory records when possible."""
    if not isinstance(remediation, dict):
        return zones
    tagflow_state = remediation.get("tagflow_state") if isinstance(remediation.get("tagflow_state"), dict) else {}
    pages = tagflow_state.get("pages") if isinstance(tagflow_state.get("pages"), list) else []
    page = next(
        (
            item for item in pages
            if isinstance(item, dict) and int(item.get("page_number") or 0) == page_number
        ),
        {},
    )
    candidates = [candidate for candidate in page.get("figure_candidates") or [] if isinstance(candidate, dict)]
    if not candidates:
        return zones

    inventory = remediation.get("figure_inventory") if isinstance(remediation.get("figure_inventory"), dict) else {}
    figures_by_candidate = {
        str(figure.get("source_candidate_id")): figure
        for figure in inventory.get("figures") or []
        if isinstance(figure, dict) and figure.get("source_candidate_id")
    }
    candidates_by_id = {
        str(candidate.get("id")): candidate
        for candidate in candidates
        if candidate.get("id")
    }

    bound_zones: list[dict[str, Any]] = []
    for zone in zones:
        if str(zone.get("tag") or "") != "Figure":
            bound_zones.append(zone)
            continue

        existing_candidate_id = str(zone.get("figure_candidate_id") or "")
        evidence_ids = [
            str(item)
            for item in zone.get("evidence_ids") or []
            if item
        ]
        candidate = candidates_by_id.get(existing_candidate_id)
        if not candidate:
            candidate = next((candidates_by_id[item] for item in evidence_ids if item in candidates_by_id), None)
        if not candidate:
            zone_bounds = zone.get("bounds") if isinstance(zone.get("bounds"), dict) else {}
            ranked = sorted(
                (
                    (_bounds_overlap_ratio(zone_bounds, candidate.get("bounds") if isinstance(candidate.get("bounds"), dict) else {}), candidate)
                    for candidate in candidates
                ),
                key=lambda item: item[0],
                reverse=True,
            )
            candidate = ranked[0][1] if ranked and ranked[0][0] >= 0.08 else None
        if not candidate:
            bound_zones.append(zone)
            continue

        candidate_id = str(candidate.get("id") or "")
        figure = figures_by_candidate.get(candidate_id) or {}
        next_evidence_ids = [candidate_id, *[item for item in evidence_ids if item != candidate_id]]
        zone_alt_text = _compact_text(zone.get("alt_text"), 1000)
        zone_long_description = _compact_text(zone.get("long_description"), 8000)
        bound_zones.append({
            **zone,
            "figure_candidate_id": candidate_id,
            "figure_inventory_id": figure.get("id") or zone.get("figure_inventory_id"),
            "figure_status": figure.get("status") or _figure_status(figure) if figure else None,
            "figure_review_action": figure.get("review_action") if figure else None,
            "figure_is_decorative": bool(figure.get("is_decorative")) if figure else None,
            "figure_has_alt_text": bool(zone_alt_text or _compact_text(figure.get("alt_text"), 1000)) if figure else bool(zone_alt_text),
            "figure_has_long_description": bool(zone_long_description or _compact_text(figure.get("long_description"), 8000)) if figure else bool(zone_long_description),
            "evidence_type": "figure_candidate",
            "evidence_ids": next_evidence_ids[:12],
        })
    return bound_zones


def render_pdf_figure_crop_bytes(data: bytes, figure: dict[str, Any], *, max_size: tuple[int, int] = (900, 900)) -> tuple[bytes, int, int]:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required for PDF figure rendering") from exc

    page_number = int(figure.get("page_number") or 0)
    bounds = _normalized_bounds(figure.get("bounds"))
    if page_number < 1:
        raise ValueError("Figure page number is invalid")
    if bounds["width"] <= 0 or bounds["height"] <= 0:
        raise ValueError("Figure bounds are invalid")

    with fitz.open(stream=data, filetype="pdf") as pdf:
        if page_number > pdf.page_count:
            raise ValueError("Figure page number is outside the PDF page range")
        page = pdf.load_page(page_number - 1)
        page_rect = page.rect
        padding_x = max(page_rect.width * 0.008, 3)
        padding_y = max(page_rect.height * 0.008, 3)
        x0 = page_rect.x0 + bounds["x"] / 100 * page_rect.width - padding_x
        y0 = page_rect.y0 + bounds["y"] / 100 * page_rect.height - padding_y
        x1 = page_rect.x0 + (bounds["x"] + bounds["width"]) / 100 * page_rect.width + padding_x
        y1 = page_rect.y0 + (bounds["y"] + bounds["height"]) / 100 * page_rect.height + padding_y
        clip = fitz.Rect(
            max(page_rect.x0, x0),
            max(page_rect.y0, y0),
            min(page_rect.x1, x1),
            min(page_rect.y1, y1),
        )
        if clip.is_empty or clip.width <= 1 or clip.height <= 1:
            raise ValueError("Figure crop is empty")
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)

    image = Image.open(io.BytesIO(pix.tobytes("png")))
    image.load()
    image = ImageOps.contain(image.convert("RGB"), max_size, Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, format="WEBP", quality=86, method=6)
    width, height = image.size
    return output.getvalue(), width, height
