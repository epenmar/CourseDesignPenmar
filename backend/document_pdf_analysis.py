import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def _compact_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_pdf_font_name(value: str) -> str:
    original = (value or "").strip()
    cleaned = original.lstrip("/")
    cleaned = re.sub(r"^[A-Z]{6}\+", "", cleaned)
    cleaned = re.sub(r"(?:PS)?MT$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[-,_]?(Bold|Italic|Oblique|Regular|Medium|Light|Black|Semibold|SemiBold|Demi|Book)$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -,_")
    return cleaned or original


def is_generic_pdf_font_alias(value: str) -> bool:
    return bool(re.fullmatch(r"(TT|T|F|C|CID|Font)\d+", (value or "").strip(), flags=re.IGNORECASE))


def display_pdf_font_names(values: set[str]) -> list[str]:
    real_names = sorted(name for name in values if name and not is_generic_pdf_font_alias(name))
    if real_names:
        return real_names
    return sorted(name for name in values if name)


def _normalized_bounds(rect: Any, width: float, height: float) -> dict[str, float]:
    x0 = float(rect.x0 if hasattr(rect, "x0") else rect[0])
    y0 = float(rect.y0 if hasattr(rect, "y0") else rect[1])
    x1 = float(rect.x1 if hasattr(rect, "x1") else rect[2])
    y1 = float(rect.y1 if hasattr(rect, "y1") else rect[3])
    return {
        "x": round(max(0, min(100, (x0 / width) * 100)), 3),
        "y": round(max(0, min(100, (y0 / height) * 100)), 3),
        "width": round(max(0.1, min(100, ((x1 - x0) / width) * 100)), 3),
        "height": round(max(0.1, min(100, ((y1 - y0) / height) * 100)), 3),
    }


def _bounds_area(bounds: dict[str, float]) -> float:
    return max(0, bounds.get("width", 0)) * max(0, bounds.get("height", 0))


def _bounds_overlap_ratio(first: dict[str, float], second: dict[str, float]) -> float:
    overlap_width = max(0, min(first["x"] + first["width"], second["x"] + second["width"]) - max(first["x"], second["x"]))
    overlap_height = max(0, min(first["y"] + first["height"], second["y"] + second["height"]) - max(first["y"], second["y"]))
    overlap_area = overlap_width * overlap_height
    smaller_area = min(_bounds_area(first), _bounds_area(second))
    if smaller_area <= 0:
        return 0
    return overlap_area / smaller_area


def _bounds_close_or_overlapping(first: dict[str, float], second: dict[str, float], *, gap: float = 1.2) -> bool:
    expanded = {
        "x": max(0, first["x"] - gap),
        "y": max(0, first["y"] - gap),
        "width": min(100, first["width"] + gap * 2),
        "height": min(100, first["height"] + gap * 2),
    }
    return _bounds_overlap_ratio(expanded, second) > 0


def _is_full_page_image(image: dict[str, Any]) -> bool:
    bounds = image.get("bounds") or {}
    return bool(image.get("full_page_likely")) or (_bounds_area(bounds) / 10_000) > 0.92


def _merge_bounds(bounds_list: list[dict[str, float]]) -> dict[str, float]:
    left = min(bounds["x"] for bounds in bounds_list)
    top = min(bounds["y"] for bounds in bounds_list)
    right = max(bounds["x"] + bounds["width"] for bounds in bounds_list)
    bottom = max(bounds["y"] + bounds["height"] for bounds in bounds_list)
    return {
        "x": round(left, 3),
        "y": round(top, 3),
        "width": round(max(0.1, min(100 - left, right - left)), 3),
        "height": round(max(0.1, min(100 - top, bottom - top)), 3),
    }


def _append_text_block_if_new(blocks: list[dict[str, Any]], block: dict[str, Any], *, threshold: float = 0.55) -> bool:
    bounds = block.get("bounds")
    if not bounds:
        return False
    if any(_bounds_overlap_ratio(bounds, existing.get("bounds") or {}) >= threshold for existing in blocks if existing.get("bounds")):
        return False
    block["id"] = f"text-{block['page_number']}-{len(blocks) + 1}"
    block["reading_order"] = len(blocks) + 1
    blocks.append(block)
    return True


def _fallback_blocks_from_text_blocks(page: Any, page_number: int, width: float, height: float) -> list[dict[str, Any]]:
    fallback_blocks: list[dict[str, Any]] = []
    for block_index, raw_block in enumerate(page.get_text("blocks") or []):
        if len(raw_block) < 5:
            continue
        text = _compact_whitespace(str(raw_block[4] or ""))
        if not text:
            continue
        fallback_blocks.append({
            "page_number": page_number,
            "source_page_number": page_number,
            "text": text[:1000],
            "bounds": _normalized_bounds(raw_block[:4], width, height),
            "font_size": None,
            "font_names": [],
            "normalized_font_names": [],
            "bold": None,
            "source": "pymupdf_text_blocks_fallback",
            "confidence": 0.72,
            "raw_block_index": block_index,
        })
    return fallback_blocks


def _fallback_blocks_from_words(page: Any, page_number: int, width: float, height: float) -> list[dict[str, Any]]:
    words = page.get_text("words") or []
    if not words:
        return []
    sorted_words = sorted(words, key=lambda word: (round(float(word[1]), 1), float(word[0])))
    lines: list[list[Any]] = []
    current: list[Any] = []
    current_y: float | None = None
    for word in sorted_words:
        y0 = float(word[1])
        if current_y is None or abs(y0 - current_y) <= 3.5:
            current.append(word)
            current_y = y0 if current_y is None else (current_y + y0) / 2
        else:
            lines.append(current)
            current = [word]
            current_y = y0
    if current:
        lines.append(current)

    fallback_blocks: list[dict[str, Any]] = []
    for line_index, line in enumerate(lines):
        text = _compact_whitespace(" ".join(str(word[4] or "") for word in sorted(line, key=lambda word: float(word[0]))))
        if not text:
            continue
        rect = [
            min(float(word[0]) for word in line),
            min(float(word[1]) for word in line),
            max(float(word[2]) for word in line),
            max(float(word[3]) for word in line),
        ]
        fallback_blocks.append({
            "page_number": page_number,
            "source_page_number": page_number,
            "text": text[:1000],
            "bounds": _normalized_bounds(rect, width, height),
            "font_size": None,
            "font_names": [],
            "normalized_font_names": [],
            "bold": None,
            "source": "pymupdf_words_fallback",
            "confidence": 0.66,
            "raw_block_index": line_index,
        })
    return fallback_blocks


def _image_blocks_from_page(page: Any, page_number: int, width: float, height: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw_images: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()
    for image_index, image_info in enumerate(page.get_images(full=True) or []):
        xref = int(image_info[0])
        smask = int(image_info[1] or 0) if len(image_info) > 1 else 0
        pixel_width = int(image_info[2] or 0) if len(image_info) > 2 else 0
        pixel_height = int(image_info[3] or 0) if len(image_info) > 3 else 0
        colorspace = str(image_info[5] or "") if len(image_info) > 5 else ""
        try:
            rects = page.get_image_rects(xref) or []
        except Exception:
            rects = []
        for rect_index, rect in enumerate(rects):
            key = (xref, rect_index)
            if key in seen:
                continue
            seen.add(key)
            bounds = _normalized_bounds(rect, width, height)
            area_ratio = _bounds_area(bounds) / 10_000
            tiny = bounds["width"] < 1 or bounds["height"] < 1 or area_ratio < 0.0025
            full_page = area_ratio > 0.92
            mask_like = bool((pixel_width <= 4 or pixel_height <= 4) or ("DeviceGray" in colorspace and area_ratio < 0.01))
            # PowerPoint-exported PDFs often use large page-level image XObjects for
            # diagrams or composite slide artwork. Keep those reviewable; only tiny
            # masks/fragments should be filtered before figure grouping.
            decorative_likely = tiny or mask_like
            raw_images.append({
                "id": f"image-{page_number}-{len(raw_images) + 1}",
                "page_number": page_number,
                "source_page_number": page_number,
                "image_index": image_index,
                "xref": xref,
                "smask": smask or None,
                "rect_index": rect_index,
                "pixel_width": pixel_width,
                "pixel_height": pixel_height,
                "bounds": bounds,
                "area_ratio": round(area_ratio, 5),
                "decorative_likely": decorative_likely,
                "full_page_likely": full_page,
                "filter_reason": "tiny_or_mask" if decorative_likely else None,
                "source": "pymupdf_image_xobject",
                "confidence": 0.78 if not decorative_likely else 0.52,
            })

    candidates = _group_figure_candidates(page_number, raw_images)
    return raw_images, candidates


def _cluster_image_groups(images: list[dict[str, Any]], *, overlap_threshold: float = 0.15) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    for image in sorted(
        images,
        key=lambda item: ((item.get("bounds") or {}).get("y", 0), (item.get("bounds") or {}).get("x", 0)),
    ):
        bounds = image.get("bounds") or {}
        matched_group: list[dict[str, Any]] | None = None
        for group in groups:
            group_bounds = _merge_bounds([item["bounds"] for item in group])
            if _bounds_overlap_ratio(group_bounds, bounds) >= overlap_threshold or _bounds_close_or_overlapping(group_bounds, bounds):
                matched_group = group
                break
        if matched_group is None:
            groups.append([image])
        else:
            matched_group.append(image)
    return groups


def _candidate_from_image_group(page_number: int, index: int, group: list[dict[str, Any]]) -> dict[str, Any]:
    bounds = _merge_bounds([item["bounds"] for item in group])
    area_ratio = _bounds_area(bounds) / 10_000
    full_page_likely = area_ratio > 0.92
    if area_ratio < 0.005:
        decorative_likely = True
        needs_alt_text = False
    else:
        decorative_likely = False
        needs_alt_text = True
    return {
        "id": f"figure-{page_number}-{index + 1}",
        "page_number": page_number,
        "source_page_number": page_number,
        "bounds": bounds,
        "fragment_count": len(group),
        "raw_image_ids": [item["id"] for item in group],
        "raw_xrefs": sorted({item["xref"] for item in group}),
        "area_ratio": round(area_ratio, 5),
        "decorative_likely": decorative_likely,
        "needs_alt_text": needs_alt_text,
        "full_page_likely": full_page_likely,
        "source": "grouped_pymupdf_images",
        "confidence": 0.58 if full_page_likely else 0.72 if len(group) > 1 else 0.64,
    }


def _group_figure_candidates(page_number: int, raw_images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    usable_images = [item for item in raw_images if not item.get("decorative_likely")]
    full_page_images = [item for item in usable_images if _is_full_page_image(item)]
    regular_images = [item for item in usable_images if not _is_full_page_image(item)]

    groups = _cluster_image_groups(regular_images)
    candidates: list[dict[str, Any]] = []
    for index, group in enumerate(groups):
        candidates.append(_candidate_from_image_group(page_number, index, group))

    has_reviewable_candidate = any(candidate.get("needs_alt_text") for candidate in candidates)
    if not has_reviewable_candidate and full_page_images:
        start_index = len(candidates)
        for index, group in enumerate(_cluster_image_groups(full_page_images, overlap_threshold=0.95), start=start_index):
            candidates.append(_candidate_from_image_group(page_number, index, group))
    elif full_page_images:
        for image in full_page_images:
            image["suppressed_as_container"] = True
            image["filter_reason"] = "full_page_container_with_smaller_figures"

    return candidates


def pdf_text_analysis_from_bytes(data: bytes) -> dict[str, Any]:
    try:
        import fitz  # type: ignore
    except Exception as exc:
        return {
            "kind": "pdf_text_analysis",
            "status": "unavailable",
            "page_count": None,
            "pages": [],
            "notes": [f"PyMuPDF text extraction unavailable: {exc}"],
        }

    pages: list[dict[str, Any]] = []
    all_font_sizes: list[float] = []
    all_font_names: set[str] = set()
    all_normalized_font_names: set[str] = set()
    try:
        with fitz.open(stream=data, filetype="pdf") as pdf:
            for page_index, page in enumerate(pdf):
                page_number = page_index + 1
                width = float(page.rect.width or 1)
                height = float(page.rect.height or 1)
                blocks: list[dict[str, Any]] = []
                page_text_parts: list[str] = []
                fallback_added = 0
                raw = page.get_text("dict") or {}
                for block_index, block in enumerate(raw.get("blocks") or []):
                    if block.get("type") != 0:
                        continue
                    block_text_parts: list[str] = []
                    font_sizes: list[float] = []
                    font_names: set[str] = set()
                    normalized_font_names: set[str] = set()
                    bold = False
                    for line in block.get("lines") or []:
                        line_parts: list[str] = []
                        for span in line.get("spans") or []:
                            text = _compact_whitespace(span.get("text") or "")
                            if not text:
                                continue
                            line_parts.append(text)
                            size = float(span.get("size") or 0)
                            if size > 0:
                                font_sizes.append(size)
                                all_font_sizes.append(size)
                            font_name = str(span.get("font") or "")
                            if font_name:
                                font_names.add(font_name)
                                all_font_names.add(font_name)
                                normalized_font_name = normalize_pdf_font_name(font_name)
                                if normalized_font_name:
                                    normalized_font_names.add(normalized_font_name)
                                    all_normalized_font_names.add(normalized_font_name)
                                if "bold" in font_name.lower():
                                    bold = True
                        if line_parts:
                            block_text_parts.append(" ".join(line_parts))
                    text = _compact_whitespace(" ".join(block_text_parts))
                    if not text:
                        continue
                    bounds = _normalized_bounds(block.get("bbox") or [0, 0, 0, 0], width, height)
                    page_text_parts.append(text)
                    blocks.append({
                        "id": f"text-{page_number}-{len(blocks) + 1}",
                        "page_number": page_number,
                        "source_page_number": page_number,
                        "reading_order": len(blocks) + 1,
                        "text": text[:1000],
                        "bounds": bounds,
                        "font_size": round(max(font_sizes), 2) if font_sizes else None,
                        "font_names": sorted(font_names)[:5],
                        "normalized_font_names": display_pdf_font_names(normalized_font_names)[:5],
                        "bold": bold,
                        "source": "pymupdf_text_dict",
                        "confidence": 0.86,
                        "raw_block_index": block_index,
                    })
                for fallback_block in _fallback_blocks_from_text_blocks(page, page_number, width, height):
                    if _append_text_block_if_new(blocks, fallback_block, threshold=0.7):
                        fallback_added += 1
                        page_text_parts.append(fallback_block["text"])
                for fallback_block in _fallback_blocks_from_words(page, page_number, width, height):
                    if _append_text_block_if_new(blocks, fallback_block, threshold=0.8):
                        fallback_added += 1
                        page_text_parts.append(fallback_block["text"])
                blocks = sorted(blocks, key=lambda item: ((item.get("bounds") or {}).get("y", 0), (item.get("bounds") or {}).get("x", 0)))
                for index, block in enumerate(blocks):
                    block["id"] = f"text-{page_number}-{index + 1}"
                    block["reading_order"] = index + 1
                raw_images, figure_candidates = _image_blocks_from_page(page, page_number, width, height)
                likely_ocr_gap = bool(raw_images and len(blocks) <= 1)
                pages.append({
                    "page_number": page_number,
                    "source_page_number": page_number,
                    "width": round(width, 3),
                    "height": round(height, 3),
                    "text_blocks": blocks[:200],
                    "text_block_count": len(blocks),
                    "fallback_text_block_count": fallback_added,
                    "image_blocks": raw_images[:300],
                    "raw_image_count": len(raw_images),
                    "figure_candidates": figure_candidates[:100],
                    "figure_candidate_count": len(figure_candidates),
                    "diagnostics": {
                        "likely_ocr_gap": likely_ocr_gap,
                        "text_extraction_modes": ["dict", "blocks", "words"],
                        "decorative_image_count": sum(1 for image in raw_images if image.get("decorative_likely")),
                        "image_fragment_count": len(raw_images),
                    },
                    "text_sample": _compact_whitespace(" ".join(page_text_parts))[:1200],
                })
    except Exception as exc:
        logger.exception("Failed to extract PDF text blocks")
        return {
            "kind": "pdf_text_analysis",
            "status": "failed",
            "page_count": None,
            "pages": [],
            "notes": [f"Text extraction failed: {exc}"],
        }

    doc_median = sorted(all_font_sizes)[len(all_font_sizes) // 2] if all_font_sizes else None
    display_font_names = display_pdf_font_names(all_normalized_font_names)
    return {
        "kind": "pdf_text_analysis",
        "status": "extracted",
        "page_count": len(pages),
        "pages": pages,
        "summary": {
            "text_block_count": sum(page.get("text_block_count") or 0 for page in pages),
            "fallback_text_block_count": sum(page.get("fallback_text_block_count") or 0 for page in pages),
            "raw_image_count": sum(page.get("raw_image_count") or 0 for page in pages),
            "figure_candidate_count": sum(page.get("figure_candidate_count") or 0 for page in pages),
            "likely_ocr_gap_page_count": sum(1 for page in pages if (page.get("diagnostics") or {}).get("likely_ocr_gap")),
            "font_count": len(all_font_names),
            "font_names": sorted(all_font_names)[:20],
            "raw_font_count": len(all_font_names),
            "normalized_font_count": len(display_font_names),
            "normalized_font_names": display_font_names[:20],
            "median_font_size": round(doc_median, 2) if doc_median else None,
        },
        "notes": [
            "Text blocks are baseline PDF analysis input for TagFlow review and AI suggestions.",
            "Bounds are normalized percentages so they can be compared with TagFlow zones.",
            "Image blocks are raw PDF image fragments; figure candidates group likely visual figures for alt-text review.",
        ],
    }


def pdf_existing_structure_evidence(data: bytes, tag_names: list[str], structure_tag_count: int) -> dict[str, Any]:
    heading_counts = {
        f"H{level}": len(re.findall(rb"/S\s*/H" + str(level).encode("ascii") + rb"\b", data[:2_000_000]))
        for level in range(1, 7)
    }
    semantic_counts = {
        tag: len(re.findall(rb"/S\s*/" + tag.encode("ascii") + rb"\b", data[:2_000_000]))
        for tag in ("P", "L", "LI", "Figure", "Table", "TR", "TH", "TD", "Artifact", "Span")
    }
    return {
        "kind": "pdf_existing_structure_evidence",
        "status": "detected" if structure_tag_count else "not_detected",
        "structure_tag_count": structure_tag_count,
        "tag_names": tag_names[:50],
        "heading_counts": heading_counts,
        "semantic_counts": {key: value for key, value in semantic_counts.items() if value},
        "ai_guidance": [
            "Existing structure tags should bias AI suggestions when present.",
            "Do not demote existing H1/H2 evidence to H3 without strong visual and textual evidence.",
            "Flag heading hierarchy jumps instead of silently changing levels.",
        ],
    }
