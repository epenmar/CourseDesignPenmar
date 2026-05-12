"""Lightweight Course Creation source extraction.

This is intentionally modest for the first Course Creation slice: it produces a
reviewable extraction artifact for text-like files and PDFs, while preserving a
clear status for Office files that need the later dedicated extractor pass.
"""

from __future__ import annotations

import csv
import io
import re
from typing import Any

TEXT_EXTENSIONS = {"csv", "htm", "html", "md", "txt"}
MAX_PREVIEW_CHARS = 1200
MAX_CHUNKS = 80


def _extension(filename: str | None) -> str:
    value = filename or ""
    return value.rsplit(".", 1)[-1].lower() if "." in value else ""


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _line_chunks(text: str, *, filename: str) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    current: list[str] = []
    current_start = 1

    def flush(end_line: int) -> None:
        if not current:
            return
        cleaned = _clean_text("\n".join(current))
        if cleaned:
            chunks.append({
                "id": f"chunk-{len(chunks) + 1}",
                "type": "text",
                "title": f"{filename} lines {current_start}-{end_line}",
                "text_preview": cleaned[:MAX_PREVIEW_CHARS],
                "source_locator": {"filename": filename, "start_line": current_start, "end_line": end_line},
                "char_count": len(cleaned),
            })
        current.clear()

    for index, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            flush(index - 1)
            current_start = index + 1
            continue
        if not current:
            current_start = index
        current.append(stripped)
        if sum(len(part) for part in current) >= 1800:
            flush(index)
            current_start = index + 1
        if len(chunks) >= MAX_CHUNKS:
            break
    flush(len(text.splitlines()) or 1)
    return chunks[:MAX_CHUNKS]


def _csv_chunks(data: bytes, *, filename: str) -> list[dict[str, Any]]:
    text = _decode_text(data)
    reader = csv.reader(io.StringIO(text))
    rows = []
    for index, row in enumerate(reader):
        if index >= 20:
            break
        rows.append(row)
    if not rows:
        return []
    preview = "\n".join(", ".join(cell for cell in row) for row in rows)
    return [{
        "id": "chunk-1",
        "type": "table",
        "title": f"{filename} preview rows",
        "text_preview": _clean_text(preview)[:MAX_PREVIEW_CHARS],
        "source_locator": {"filename": filename, "row_start": 1, "row_end": len(rows)},
        "char_count": len(preview),
    }]


def _pdf_chunks(data: bytes, *, filename: str) -> tuple[list[dict[str, Any]], int]:
    import fitz  # type: ignore

    chunks: list[dict[str, Any]] = []
    page_count = 0
    with fitz.open(stream=data, filetype="pdf") as pdf:
        page_count = len(pdf)
        for page_index, page in enumerate(pdf, start=1):
            text = _clean_text(page.get_text("text") or "")
            if not text:
                continue
            chunks.append({
                "id": f"page-{page_index}",
                "type": "page_text",
                "title": f"{filename} page {page_index}",
                "text_preview": text[:MAX_PREVIEW_CHARS],
                "source_locator": {"filename": filename, "page": page_index},
                "char_count": len(text),
            })
            if len(chunks) >= MAX_CHUNKS:
                break
    return chunks, page_count


def extract_course_source(data: bytes, *, filename: str, content_type: str | None) -> dict[str, Any]:
    extension = _extension(filename)
    chunks: list[dict[str, Any]] = []
    page_count: int | None = None
    extractor_status = "succeeded"
    message = "Source text extracted for review."

    if extension == "pdf" or content_type == "application/pdf":
        chunks, page_count = _pdf_chunks(data, filename=filename)
    elif extension == "csv" or content_type == "text/csv":
        chunks = _csv_chunks(data, filename=filename)
    elif extension in TEXT_EXTENSIONS or (content_type or "").startswith("text/"):
        chunks = _line_chunks(_decode_text(data), filename=filename)
    else:
        extractor_status = "needs_extractor"
        message = "The source file is stored. Office document extraction will be handled in the dedicated extractor slice."

    total_chars = sum(int(chunk.get("char_count") or 0) for chunk in chunks)
    return {
        "status": extractor_status,
        "message": message,
        "filename": filename,
        "content_type": content_type,
        "page_count": page_count,
        "chunk_count": len(chunks),
        "text_char_count": total_chars,
        "chunks": chunks,
    }
