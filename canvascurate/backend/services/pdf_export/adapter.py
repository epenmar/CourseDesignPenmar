"""Export model adapter for PDF remediation state.

Converts stored document remediation metadata into a small validation/export
model that can be shared by readiness checks, future jobs, and API routes.
"""

from __future__ import annotations

from typing import Any

from content_inventory import compact_whitespace


HEADING_TAGS = {"H1", "H2", "H3", "H4", "H5", "H6"}
CONTENT_TAGS = {
    *HEADING_TAGS,
    "P",
    "L",
    "LI",
    "Figure",
    "Table",
    "TH",
    "TD",
    "TR",
    "Span",
}


def normalize_tag(value: Any) -> str:
    tag = str(value or "").strip()
    if tag.lower() == "figure":
        return "Figure"
    if tag.lower() == "table":
        return "Table"
    if tag.lower() == "artifact":
        return "Artifact"
    if tag.lower() == "span":
        return "Span"
    return tag.upper() if tag.upper() in CONTENT_TAGS else tag


def zone_has_alt_or_artifact_decision(zone: dict[str, Any]) -> bool:
    tag = normalize_tag(zone.get("tag"))
    if tag == "Artifact":
        return True
    return (
        bool(compact_whitespace(zone.get("alt_text")))
        or bool(zone.get("figure_has_alt_text"))
        or bool(zone.get("figure_is_decorative"))
        or bool(zone.get("is_decorative"))
    )


def flowchart_node_count(flowchart: Any) -> int:
    data = flowchart if isinstance(flowchart, dict) else {}
    return len([node for node in data.get("nodes") or [] if isinstance(node, dict) and compact_whitespace(node.get("label"))])


def flowchart_connection_count(flowchart: Any) -> int:
    data = flowchart if isinstance(flowchart, dict) else {}
    return len([connection for connection in data.get("connections") or [] if isinstance(connection, dict)])


def iter_tagflow_pages(remediation_plan: dict[str, Any]) -> list[dict[str, Any]]:
    tagflow_state = remediation_plan.get("tagflow_state") if isinstance(remediation_plan.get("tagflow_state"), dict) else {}
    return [page for page in tagflow_state.get("pages") or [] if isinstance(page, dict)]


def iter_page_zones(page: dict[str, Any]) -> list[dict[str, Any]]:
    zones = [zone for zone in page.get("zones") or [] if isinstance(zone, dict)]
    return sorted(zones, key=lambda zone: int(zone.get("reading_order") or 0))


def build_export_document(remediation_plan: dict[str, Any] | None) -> dict[str, Any]:
    remediation_plan = remediation_plan if isinstance(remediation_plan, dict) else {}
    metadata = remediation_plan.get("metadata") if isinstance(remediation_plan.get("metadata"), dict) else {}
    metadata_review = remediation_plan.get("metadata_review") if isinstance(remediation_plan.get("metadata_review"), dict) else {}
    tagflow_state = remediation_plan.get("tagflow_state") if isinstance(remediation_plan.get("tagflow_state"), dict) else {}
    tagflow_summary = tagflow_state.get("summary") if isinstance(tagflow_state.get("summary"), dict) else {}
    validation = tagflow_state.get("validation") if isinstance(tagflow_state.get("validation"), dict) else {}
    inventory = remediation_plan.get("figure_inventory") if isinstance(remediation_plan.get("figure_inventory"), dict) else {}

    pages: list[dict[str, Any]] = []
    for page in iter_tagflow_pages(remediation_plan):
        page_number = int(page.get("page_number") or 0) or None
        zones: list[dict[str, Any]] = []
        for zone in iter_page_zones(page):
            tag = normalize_tag(zone.get("tag"))
            zones.append({
                **zone,
                "tag": tag,
                "text": compact_whitespace(zone.get("text")),
                "alt_text": compact_whitespace(zone.get("alt_text")),
                "long_description": compact_whitespace(zone.get("long_description")),
                "reading_order": int(zone.get("reading_order") or 0),
            })
        pages.append({
            **page,
            "page_number": page_number,
            "review_status": page.get("review_status") or "unreviewed",
            "zones": zones,
        })

    return {
        "kind": "pdf_export_document",
        "metadata": {
            "title": compact_whitespace(metadata.get("title") or metadata_review.get("title")),
            "language": compact_whitespace(metadata.get("language") or metadata_review.get("language")),
        },
        "metadata_review": metadata_review,
        "tagflow_summary": tagflow_summary,
        "tagflow_validation": validation,
        "pages": pages,
        "figures": [figure for figure in inventory.get("figures") or [] if isinstance(figure, dict)],
    }

