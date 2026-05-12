"""PDF metadata review helpers for document remediation.

Normalizes reviewed PDF title and language values and records export-readiness
metadata used by the tagged-PDF export workflow.
"""

from __future__ import annotations

import re
from typing import Any


LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$")


def compact_text(value: str | None, max_length: int) -> str | None:
    if value is None:
        return None
    compacted = re.sub(r"\s+", " ", value).strip()
    if not compacted:
        return None
    return compacted[:max_length]


def normalize_pdf_language(value: str | None) -> str | None:
    compacted = compact_text(value, 40)
    if not compacted:
        return None
    normalized = compacted.replace("_", "-")
    parts = normalized.split("-")
    if not parts:
        return None
    language = parts[0].lower()
    suffixes = [part.upper() if len(part) == 2 and part.isalpha() else part for part in parts[1:]]
    return "-".join([language, *suffixes])


def pdf_language_is_valid(value: str | None) -> bool:
    if not value:
        return False
    return bool(LANGUAGE_RE.match(value))


def update_pdf_remediation_metadata(
    remediation_plan: dict[str, Any],
    *,
    title: str | None,
    language: str | None,
    updated_at: str,
) -> dict[str, Any]:
    normalized_title = compact_text(title, 500)
    normalized_language = normalize_pdf_language(language)
    metadata = remediation_plan.get("metadata") if isinstance(remediation_plan.get("metadata"), dict) else {}
    metadata_review = remediation_plan.get("metadata_review") if isinstance(remediation_plan.get("metadata_review"), dict) else {}
    title_set = bool(normalized_title)
    language_set = bool(normalized_language)
    language_valid = pdf_language_is_valid(normalized_language)
    status = "ready" if title_set and language_valid else "needs_attention"

    return {
        **remediation_plan,
        "metadata": {
            **metadata,
            "title": normalized_title,
            "language": normalized_language,
        },
        "metadata_review": {
            **metadata_review,
            "title": normalized_title,
            "language": normalized_language,
            "title_set": title_set,
            "language_set": language_set,
            "language_valid": language_valid,
            "status": status,
            "updated_at": updated_at,
            "source": "user_review",
        },
        "export_readiness": {
            **(remediation_plan.get("export_readiness") if isinstance(remediation_plan.get("export_readiness"), dict) else {}),
            "metadata_status": status,
            "metadata_required": ["title", "language"],
            "metadata_updated_at": updated_at,
        },
    }
