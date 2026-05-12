"""Tagged-PDF export validation.

Validates reviewed metadata, TagFlow zones, figure decisions, and flowchart
structures before a tagged-PDF export job is allowed to run.
"""

from __future__ import annotations

from typing import Any

from content_inventory import compact_whitespace
from services.pdf_metadata import pdf_language_is_valid
from services.pdf_export.adapter import (
    CONTENT_TAGS,
    HEADING_TAGS,
    build_export_document,
    flowchart_connection_count,
    flowchart_node_count,
    normalize_tag,
    zone_has_alt_or_artifact_decision,
)


def validation_issue(
    code: str,
    message: str,
    *,
    severity: str = "warning",
    page_number: int | None = None,
    zone_id: str | None = None,
    figure_id: str | None = None,
    rule: str | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "rule": rule or code.replace("_", "-"),
        "severity": severity,
        "message": message,
        **({"page_number": page_number} if page_number is not None else {}),
        **({"zone_id": zone_id} if zone_id else {}),
        **({"figure_id": figure_id} if figure_id else {}),
    }


def _validate_metadata(export_document: dict[str, Any]) -> list[dict[str, Any]]:
    metadata = export_document.get("metadata") if isinstance(export_document.get("metadata"), dict) else {}
    issues: list[dict[str, Any]] = []
    title = compact_whitespace(metadata.get("title"))
    language = compact_whitespace(metadata.get("language"))
    if not title:
        issues.append(validation_issue("pdf_title_missing", "PDF title must be set before export.", severity="error", rule="doc-title"))
    if not language:
        issues.append(validation_issue("pdf_language_missing", "PDF language must be set before export.", severity="error", rule="doc-language"))
    elif not pdf_language_is_valid(language):
        issues.append(validation_issue(
            "pdf_language_invalid",
            "PDF language must use a BCP 47-style value such as en or en-US.",
            severity="error",
            rule="doc-language",
        ))
    return issues


def _validate_headings(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate the document-level heading outline.

    Heading hierarchy is intentionally advisory for export. A single H1 on the
    first page followed by H2/H3 sections on later pages is correct for a
    continuous PDF, and even skipped levels should prompt review rather than
    block tagged-PDF generation.
    """
    headings: list[tuple[int | None, dict[str, Any]]] = []
    for page in pages:
        page_number = page.get("page_number")
        for zone in page.get("zones") or []:
            if normalize_tag(zone.get("tag")) in HEADING_TAGS:
                headings.append((page_number, zone))

    if not headings:
        return [validation_issue(
            "heading_missing",
            "Review document outline: no heading zones are present.",
            rule="has-headings",
        )]

    issues: list[dict[str, Any]] = []
    levels = sorted({int(str(zone.get("tag"))[1]) for _, zone in headings if str(zone.get("tag"))[1:].isdigit()})
    if levels:
        for level in range(1, max(levels) + 1):
            if level not in levels:
                issues.append(validation_issue(
                    "heading_level_skipped",
                    f"Review heading outline: H{level} is not used before a deeper heading level.",
                    rule="heading-hierarchy",
                ))
    h1_count = sum(1 for _, zone in headings if zone.get("tag") == "H1")
    if h1_count == 0:
        issues.append(validation_issue(
            "h1_missing",
            "Review document outline: headings are present but no H1 zone is set.",
            rule="heading-hierarchy",
        ))
    elif h1_count > 1:
        issues.append(validation_issue(
            "h1_multiple",
            f"Review document outline: {h1_count} H1 zones are set.",
            rule="heading-hierarchy",
        ))
    return issues


def _validate_pages(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not pages:
        return [validation_issue("tagflow_missing_pages", "Run PDF review and prepare TagFlow pages before export.", severity="error", rule="page-has-tags")]

    issues: list[dict[str, Any]] = []
    for page in pages:
        page_number = page.get("page_number")
        zones = page.get("zones") or []
        if page.get("review_status") not in {"edited", "remediated"}:
            issues.append(validation_issue(
                "tagflow_page_unreviewed",
                "TagFlow page still needs review before export.",
                page_number=page_number,
                rule="page-reviewed",
            ))
        if not zones:
            issues.append(validation_issue(
                "page_has_no_zones",
                "Page has no tagged content zones.",
                page_number=page_number,
                rule="page-has-tags",
            ))
            continue

        content_zones = [zone for zone in zones if normalize_tag(zone.get("tag")) != "Artifact"]
        if not content_zones:
            issues.append(validation_issue(
                "page_has_no_content_zones",
                "Page has only artifact/decorative zones; verify whether it needs tagged content.",
                page_number=page_number,
                rule="page-has-tags",
            ))
            continue

        reading_orders = [int(zone.get("reading_order") or 0) for zone in content_zones]
        if any(order < 1 for order in reading_orders):
            issues.append(validation_issue(
                "reading_order_missing",
                "One or more zones are missing a positive reading order.",
                page_number=page_number,
                rule="reading-order",
            ))
        if len(set(reading_orders)) != len(reading_orders):
            issues.append(validation_issue(
                "reading_order_duplicate",
                "One or more zones share the same reading order.",
                page_number=page_number,
                rule="reading-order",
            ))

        for zone in zones:
            tag = normalize_tag(zone.get("tag"))
            zone_id = zone.get("id")
            if tag not in CONTENT_TAGS and tag != "Artifact":
                issues.append(validation_issue(
                    "tag_unknown",
                    f"Zone uses unsupported tag {tag or 'Unknown'}.",
                    severity="error",
                    page_number=page_number,
                    zone_id=zone_id,
                    rule="tag-type",
                ))
            if tag == "Figure" and not zone_has_alt_or_artifact_decision(zone):
                issues.append(validation_issue(
                    "figure_zone_missing_alt_text",
                    "Figure zone needs alt text or should be marked decorative/artifact.",
                    severity="error",
                    page_number=page_number,
                    zone_id=zone_id,
                    rule="figure-alt-text",
                ))
            if tag == "Figure" and zone.get("figure_type") == "flowchart":
                node_count = flowchart_node_count(zone.get("flowchart"))
                connection_count = flowchart_connection_count(zone.get("flowchart"))
                if node_count < 1:
                    issues.append(validation_issue(
                        "flowchart_zone_missing_nodes",
                        "Flowchart zone needs at least one reviewed node.",
                        severity="error",
                        page_number=page_number,
                        zone_id=zone_id,
                        rule="flowchart-structure",
                    ))
                elif node_count > 1 and connection_count < 1:
                    issues.append(validation_issue(
                        "flowchart_zone_missing_connections",
                        "Flowchart zone has multiple nodes but no connections.",
                        severity="error",
                        page_number=page_number,
                        zone_id=zone_id,
                        rule="flowchart-structure",
                    ))
    return issues


def _validate_figures(figures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for figure in figures:
        if figure.get("review_action") == "ignore" or figure.get("status") == "ignored" or figure.get("is_decorative"):
            continue
        figure_id = figure.get("id")
        page_number = figure.get("page_number")
        if not compact_whitespace(figure.get("alt_text")):
            issues.append(validation_issue(
                "pdf_figure_missing_alt_text",
                "Reviewed PDF figure needs alt text or a decorative/ignore decision.",
                severity="error",
                page_number=page_number,
                figure_id=figure_id,
                rule="figure-alt-text",
            ))
        if figure.get("figure_type") == "flowchart":
            node_count = flowchart_node_count(figure.get("flowchart"))
            connection_count = flowchart_connection_count(figure.get("flowchart"))
            if node_count < 1:
                issues.append(validation_issue(
                    "pdf_flowchart_missing_nodes",
                    "Flowchart figure needs at least one reviewed node.",
                    severity="error",
                    page_number=page_number,
                    figure_id=figure_id,
                    rule="flowchart-structure",
                ))
            elif node_count > 1 and connection_count < 1:
                issues.append(validation_issue(
                    "pdf_flowchart_missing_connections",
                    "Flowchart figure has multiple nodes but no connections.",
                    severity="error",
                    page_number=page_number,
                    figure_id=figure_id,
                    rule="flowchart-structure",
                ))
    return issues


def validate_export_document(export_document: dict[str, Any]) -> dict[str, Any]:
    pages = [page for page in export_document.get("pages") or [] if isinstance(page, dict)]
    figures = [figure for figure in export_document.get("figures") or [] if isinstance(figure, dict)]
    tagflow_validation = export_document.get("tagflow_validation") if isinstance(export_document.get("tagflow_validation"), dict) else {}
    tagflow_summary = export_document.get("tagflow_summary") if isinstance(export_document.get("tagflow_summary"), dict) else {}

    issues = [
        *_validate_metadata(export_document),
        *_validate_pages(pages),
        *_validate_headings(pages),
        *_validate_figures(figures),
    ]

    validation_issue_count = int(tagflow_validation.get("issue_count") or tagflow_summary.get("validation_issue_count") or len(tagflow_validation.get("issues") or []) or 0)
    if validation_issue_count > 0:
        issues.append(validation_issue(
            "tagflow_validation_issues",
            f"{validation_issue_count} TagFlow validation issue{'s' if validation_issue_count != 1 else ''} need review.",
            rule="tagflow-validation",
        ))

    error_count = sum(1 for issue in issues if issue.get("severity") == "error")
    warning_count = len(issues) - error_count
    return {
        "kind": "pdf_export_validation",
        "status": "ready" if not issues else "not_ready" if error_count else "needs_attention",
        "is_valid": error_count == 0,
        "error_count": error_count,
        "warning_count": warning_count,
        "issue_count": len(issues),
        "issues": issues,
        "checks": {
            "metadata": "ready" if not any(issue.get("rule") == "doc-title" or issue.get("rule") == "doc-language" for issue in issues) else "needs_attention",
            "tagflow_pages": "ready" if not any(str(issue.get("rule") or "").startswith("page-") for issue in issues) else "needs_attention",
            "headings": "ready" if not any(str(issue.get("rule") or "").startswith("heading") or issue.get("rule") == "has-headings" for issue in issues) else "needs_attention",
            "figures": "ready" if not any("figure" in str(issue.get("rule") or issue.get("code") or "") for issue in issues) else "needs_attention",
            "flowcharts": "ready" if not any("flowchart" in str(issue.get("rule") or issue.get("code") or "") for issue in issues) else "needs_attention",
        },
    }


def validate_remediation_export(remediation_plan: dict[str, Any] | None) -> dict[str, Any]:
    return validate_export_document(build_export_document(remediation_plan))
