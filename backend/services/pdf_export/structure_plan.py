"""PDF export structure planning.

Builds the ordered structure-node plan from reviewed TagFlow zones. The current
export artifact stores this plan summary so the future PDF structure writer can
consume a stable service-level contract instead of re-reading UI state.
"""

from __future__ import annotations

from typing import Any


PDF_ROLE_BY_TAG = {
    "H1": "H1",
    "H2": "H2",
    "H3": "H3",
    "H4": "H4",
    "H5": "H5",
    "H6": "H6",
    "P": "P",
    "L": "L",
    "LI": "LI",
    "Figure": "Figure",
    "Table": "Table",
    "TH": "TH",
    "TD": "TD",
    "TR": "TR",
    "Span": "Span",
    "Artifact": None,
}


def _text(value: Any, limit: int = 500) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit].rstrip()


def _bounds(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    try:
        return {
            "x": float(value.get("x") or 0),
            "y": float(value.get("y") or 0),
            "width": float(value.get("width") or 0),
            "height": float(value.get("height") or 0),
        }
    except (TypeError, ValueError):
        return None


def build_structure_plan(export_document: dict[str, Any]) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    role_counts: dict[str, int] = {}
    node_count = 0
    figure_node_count = 0
    artifact_count = 0

    for page in export_document.get("pages") or []:
        if not isinstance(page, dict):
            continue
        page_number = page.get("page_number")
        page_nodes: list[dict[str, Any]] = []
        for zone in page.get("zones") or []:
            if not isinstance(zone, dict):
                continue
            source_tag = str(zone.get("tag") or "").strip() or "P"
            pdf_role = PDF_ROLE_BY_TAG.get(source_tag, "Span")
            if pdf_role is None:
                artifact_count += 1
                continue
            actual_text = _text(zone.get("alt_text") if pdf_role == "Figure" else zone.get("text"))
            node = {
                "id": zone.get("id"),
                "page_number": page_number,
                "source_tag": source_tag,
                "pdf_role": pdf_role,
                "reading_order": int(zone.get("reading_order") or len(page_nodes) + 1),
                "bounds": _bounds(zone.get("bounds")),
                "text": _text(zone.get("text")),
                "alt_text": _text(zone.get("alt_text")),
                "long_description": _text(zone.get("long_description"), limit=1200),
                "actual_text": actual_text,
                "figure_type": zone.get("figure_type"),
                "figure_id": zone.get("figure_id") or zone.get("bound_figure_id"),
            }
            page_nodes.append(node)
            node_count += 1
            role_counts[pdf_role] = role_counts.get(pdf_role, 0) + 1
            if pdf_role == "Figure":
                figure_node_count += 1
        pages.append({
            "page_number": page_number,
            "node_count": len(page_nodes),
            "nodes": page_nodes,
        })

    return {
        "kind": "pdf_export_structure_plan",
        "status": "ready" if node_count else "empty",
        "page_count": len(pages),
        "node_count": node_count,
        "figure_node_count": figure_node_count,
        "artifact_count": artifact_count,
        "role_counts": role_counts,
        "pages": pages,
    }
