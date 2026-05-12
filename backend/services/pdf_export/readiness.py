"""PDF export readiness checks.

Builds a lightweight status model for tagged-PDF export preparation from the
current remediation metadata, TagFlow state, figure review, and flowchart data.
"""

from __future__ import annotations

from typing import Any

from services.pdf_export.validator import validate_remediation_export


def build_pdf_export_readiness(remediation_plan: dict[str, Any] | None) -> dict[str, Any]:
    validation = validate_remediation_export(remediation_plan)
    return {
        "kind": "pdf_export_readiness",
        "status": validation.get("status"),
        "error_count": validation.get("error_count", 0),
        "warning_count": validation.get("warning_count", 0),
        "issue_count": validation.get("issue_count", 0),
        "issues": validation.get("issues", []),
        "checks": validation.get("checks", {}),
        "validation": validation,
    }

