"""Lightweight PDF metadata and accessibility probes."""

from __future__ import annotations

import re
from typing import Any

from content_inventory import compact_whitespace
from document_pdf_analysis import display_pdf_font_names, normalize_pdf_font_name


def pdf_parser_summary(data: bytes) -> dict[str, Any]:
    try:
        import fitz  # type: ignore
    except ImportError:
        return {"available": False, "error": "PyMuPDF is not installed"}

    try:
        with fitz.open(stream=data, filetype="pdf") as pdf:
            metadata = pdf.metadata if isinstance(pdf.metadata, dict) else {}
            font_names: set[str] = set()
            normalized_font_names: set[str] = set()
            image_count = 0
            text_page_count = 0
            for page in pdf:
                try:
                    if compact_whitespace(page.get_text("text")):
                        text_page_count += 1
                except Exception:
                    pass
                try:
                    image_count += len(page.get_images(full=True))
                except Exception:
                    pass
                try:
                    for font in page.get_fonts(full=True):
                        for value in font:
                            if isinstance(value, str) and value and not value.startswith("/"):
                                font_names.add(value)
                                normalized_font_names.add(normalize_pdf_font_name(value))
                except Exception:
                    pass
            return {
                "available": True,
                "page_count": pdf.page_count or None,
                "metadata": {
                    "title": metadata.get("title") or None,
                    "author": metadata.get("author") or None,
                    "subject": metadata.get("subject") or None,
                    "keywords": metadata.get("keywords") or None,
                    "creator": metadata.get("creator") or None,
                    "producer": metadata.get("producer") or None,
                },
                "font_names": sorted(font_names),
                "font_count": len(font_names),
                "raw_font_count": len(font_names),
                "normalized_font_names": display_pdf_font_names(normalized_font_names),
                "normalized_font_count": len(display_pdf_font_names(normalized_font_names)),
                "image_count": image_count,
                "text_page_count": text_page_count,
            }
    except Exception as exc:
        return {"available": False, "error": str(exc)}


def pdf_accessibility_probe(data: bytes, parser_summary: dict[str, Any] | None = None) -> dict[str, Any]:
    parser_summary = parser_summary if isinstance(parser_summary, dict) else pdf_parser_summary(data)
    page_count = parser_summary.get("page_count") or len(re.findall(rb"/Type\s*/Page\b", data))
    is_encrypted = b"/Encrypt" in data[:4096] or b"/Encrypt" in data
    has_struct_tree = b"/StructTreeRoot" in data
    has_mark_info = b"/MarkInfo" in data and b"/Marked" in data
    has_title = b"/Title" in data
    issues: list[dict[str, str]] = []
    if is_encrypted:
        issues.append({"code": "pdf_encrypted", "message": "PDF appears to be encrypted; automated remediation may be limited."})
    if not has_struct_tree:
        issues.append({"code": "pdf_no_struct_tree", "message": "No PDF structure tree was detected. This may indicate the PDF is untagged."})
    if not has_mark_info:
        issues.append({"code": "pdf_no_mark_info", "message": "PDF marked-content metadata was not detected."})
    if not has_title:
        issues.append({"code": "pdf_no_title", "message": "PDF title metadata was not detected."})
    return {
        "kind": "pdf_initial_accessibility_probe",
        "page_count": page_count or None,
        "is_encrypted": is_encrypted,
        "has_struct_tree": has_struct_tree,
        "has_mark_info": has_mark_info,
        "has_title": has_title,
        "issues": issues,
        "status": "needs_review" if issues else "no_initial_issues_detected",
    }
