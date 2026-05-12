import html
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse


GENERIC_LINK_TEXT = {
    "click here",
    "here",
    "learn more",
    "read more",
    "more",
    "link",
    "this link",
    "view",
}

IMAGE_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz", "quiz_question"}
LINK_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz"}
GENERIC_FILENAME_EXTENSIONS = {
    "doc",
    "docx",
    "jpg",
    "jpeg",
    "pdf",
    "png",
    "ppt",
    "pptx",
    "rtf",
    "txt",
    "xls",
    "xlsx",
    "zip",
}
IMAGE_FILE_EXTENSIONS = {"gif", "jpg", "jpeg", "png", "svg", "webp"}
TEXT_BREAK_TAGS = {
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "td",
    "th",
    "tr",
    "ul",
}

_A_TAG_RE = re.compile(r"<a\b[^>]*>[\s\S]*?</a>", re.IGNORECASE)
_HREF_ATTR_RE = re.compile(r"""\bhref\s*=\s*(['"])(.*?)\1""", re.IGNORECASE | re.DOTALL)
_STYLE_BLOCK_RE = re.compile(r"<(script|style)\b[^>]*>[\s\S]*?</\1>", re.IGNORECASE)
_STYLE_ATTR_RE = re.compile(r"""\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE | re.DOTALL)
_EVENT_ATTR_RE = re.compile(r"""\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE | re.DOTALL)
_CLASS_ATTR_RE = re.compile(r"""\sclass\s*=\s*(['"])(.*?)\1""", re.IGNORECASE | re.DOTALL)
_LIST_BLOCK_RE = re.compile(r"<(ul|ol)\b[^>]*>[\s\S]*?</\1>", re.IGNORECASE)
_CONTEXT_BLOCK_RE = re.compile(
    r"<(p|div|li|td|th|section|article|blockquote|h[1-6])\b[^>]*>[\s\S]*?</\1>",
    re.IGNORECASE,
)
_HEADING_RE = re.compile(r"<(h[1-6])\b[^>]*>[\s\S]*?</\1>", re.IGNORECASE)
_PARA_RE = re.compile(r"<p\b[^>]*>[\s\S]*?</p>", re.IGNORECASE)


def compact_whitespace(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def html_to_plain_text(value: str | None) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value or "")
    return compact_whitespace(html.unescape(without_tags))


def _clean_html_context(value: str) -> str:
    cleaned = _STYLE_BLOCK_RE.sub("", value)
    cleaned = _STYLE_ATTR_RE.sub("", cleaned)
    cleaned = _EVENT_ATTR_RE.sub("", cleaned)

    def keep_only_link_highlight_class(match: re.Match[str]) -> str:
        classes = compact_whitespace(match.group(2)).split()
        kept = [class_name for class_name in classes if class_name == "cc-link-highlight"]
        return f' class="{" ".join(kept)}"' if kept else ""

    cleaned = _CLASS_ATTR_RE.sub(keep_only_link_highlight_class, cleaned)
    cleaned = re.sub(
        r"""href\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)""",
        'href="#"',
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"<span\s*>([\s\S]*?)</span>", r"\1", cleaned, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def _safe_clip(html_body: str, start: int, end: int) -> str:
    if start > 0:
        last_open = html_body.rfind("<", 0, start)
        last_close = html_body.rfind(">", 0, start)
        if last_open > last_close:
            start = last_open
    if end < len(html_body):
        last_open = html_body.rfind("<", 0, end)
        last_close = html_body.rfind(">", 0, end)
        if last_open > last_close:
            next_close = html_body.find(">", end)
            if next_close >= 0:
                end = next_close + 1
    return html_body[start:end]


def _matching_anchor(html_body: str, link_index: int, href: str) -> re.Match[str] | None:
    target_href = canonical_asset_url(href)
    if not target_href:
        return None
    current_index = 0
    for match in _A_TAG_RE.finditer(html_body or ""):
        href_match = _HREF_ATTR_RE.search(match.group(0))
        if not href_match:
            continue
        anchor_href = canonical_asset_url(href_match.group(2))
        if not anchor_href:
            continue
        current_index += 1
        if current_index == link_index and anchor_href == target_href:
            return match
    return None


def _link_context_details(html_body: str | None, link_index: int, href: str) -> dict[str, str]:
    source = html_body or ""
    match = _matching_anchor(source, link_index, href)
    if not match:
        return {}

    full_tag = match.group(0)
    link_text = html_to_plain_text(full_tag)
    link_pos = match.start()
    containing_block = ""

    for list_match in _LIST_BLOCK_RE.finditer(source):
        if list_match.start() <= link_pos < list_match.end():
            containing_block = list_match.group(0)
            break

    if not containing_block:
        candidate_blocks = [
            block_match.group(0)
            for block_match in _CONTEXT_BLOCK_RE.finditer(source)
            if block_match.start() <= link_pos < block_match.end()
        ]
        if candidate_blocks:
            containing_block = min(candidate_blocks, key=len)

    if not containing_block:
        start = max(0, link_pos - 500)
        end = min(len(source), match.end() + 500)
        containing_block = _safe_clip(source, start, end)

    preceding_heading = ""
    for heading_match in _HEADING_RE.finditer(source):
        if heading_match.end() <= link_pos:
            preceding_heading = heading_match.group(0)
        else:
            break

    preceding_para = ""
    for para_match in _PARA_RE.finditer(source):
        if para_match.end() <= link_pos and link_pos - para_match.end() < 300:
            preceding_para = para_match.group(0)
        elif para_match.start() >= link_pos:
            break

    marked_block = containing_block.replace(full_tag, f'<mark class="cc-link-highlight">{full_tag}</mark>', 1)
    context_parts = []
    if preceding_heading and preceding_heading not in marked_block:
        context_parts.append(preceding_heading)
    if preceding_para and preceding_para not in marked_block:
        context_parts.append(preceding_para)
    context_parts.append(marked_block)

    block_plain = html_to_plain_text(containing_block)
    original_before = ""
    original_after = ""
    if link_text:
        text_index = block_plain.find(link_text)
        if text_index >= 0:
            original_before = block_plain[:text_index].strip()
            original_after = block_plain[text_index + len(link_text):].strip()

    suggested_text = ""
    for candidate_source in (original_after, original_before):
        candidate = re.sub(
            r"^(to\s+(access|view|download|open|read|see|get)\s+)",
            "",
            candidate_source,
            flags=re.IGNORECASE,
        ).strip()
        sentence_end = re.search(r"[.!?\n]", candidate)
        if sentence_end:
            candidate = candidate[:sentence_end.start()].strip()
        if len(candidate) > 5 and normalize_link_label(candidate) not in GENERIC_LINK_TEXT:
            suggested_text = candidate[:80]
            break

    return {
        "original_text": link_text,
        "original_before": original_before,
        "original_after": original_after,
        "original_context": (
            f"...{original_before[-160:]} [{link_text}] {original_after[:160]}..."
            if original_before or original_after
            else link_text
        ),
        "suggested_text": suggested_text,
        "html_context": _clean_html_context("".join(context_parts))[:1800],
    }


def canonical_asset_url(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    parsed = urlparse(raw)
    if not parsed.scheme and not parsed.netloc:
        return raw.split("#", 1)[0].split("?", 1)[0]

    path = parsed.path or ""
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def canonical_canvas_file_page_url(value: str | None) -> str:
    raw = canonical_asset_url(value)
    if not raw:
        return ""
    return re.sub(r"/files/(\d+)/(preview|download)$", r"/files/\1", raw)


def extract_canvas_file_id(value: str | None) -> str | None:
    raw = canonical_asset_url(value)
    if not raw:
        return None

    match = re.search(r"/files/(\d+)", raw)
    return match.group(1) if match else None


def parse_dimension(value: str | None) -> int | None:
    if not value:
        return None

    match = re.search(r"\d+", value)
    return int(match.group(0)) if match else None


def normalize_link_label(value: str | None) -> str:
    return compact_whitespace(value).lower().strip(" \t\r\n.,;:!?()[]{}<>\"'")


def canonical_link_label_url(value: str | None) -> str:
    label = normalize_link_label(value)
    if not label:
        return ""
    candidate = label
    if candidate.startswith("www."):
        candidate = f"https://{candidate}"
    parsed = urlparse(candidate)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return canonical_asset_url(candidate).lower().rstrip("/")


def is_url_like_label(value: str | None) -> bool:
    label = normalize_link_label(value)
    if not label:
        return False
    if label.startswith(("http://", "https://", "www.")):
        return True
    parsed = urlparse(label)
    return bool(parsed.scheme and parsed.netloc)


def is_filename_like_label(value: str | None) -> bool:
    label = normalize_link_label(value)
    if not label or " " in label:
        return False
    match = re.search(r"\.([a-z0-9]{2,5})$", label)
    return bool(match and match.group(1) in GENERIC_FILENAME_EXTENSIONS)


def filename_extension(value: str | None) -> str | None:
    label = normalize_link_label(value)
    match = re.search(r"\.([a-z0-9]{2,5})$", label)
    return match.group(1) if match else None


def classify_link_text(text: str | None, href: str | None, accessible_name: str | None = None, has_image: bool = False) -> str | None:
    visible_text = compact_whitespace(text)
    label = visible_text or compact_whitespace(accessible_name)
    normalized_text = normalize_link_label(label)
    normalized_href = canonical_asset_url(href).lower().rstrip("/")
    if not normalized_text:
        if has_image:
            return "linked_image_missing_alt"
        return "empty_link_text"
    if normalized_text in GENERIC_LINK_TEXT:
        return "generic_link_text"
    label_url = canonical_link_label_url(label)
    if is_url_like_label(label) or is_filename_like_label(label) or (normalized_href and label_url == normalized_href):
        return "generic_link_text"
    return None


class HTMLInventoryParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images: list[dict[str, Any]] = []
        self.links: list[dict[str, Any]] = []
        self._link_stack: list[dict[str, Any]] = []
        self._text_parts: list[str] = []

    def _plain_text(self) -> str:
        return "".join(self._text_parts)

    def _append_text(self, text: str):
        if text:
            self._text_parts.append(text)

    def _append_break(self):
        if self._text_parts and not self._text_parts[-1].endswith((" ", "\n")):
            self._text_parts.append(" ")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        attr_map = {name.lower(): value or "" for name, value in attrs}
        lowered = tag.lower()

        if lowered == "img":
            src = canonical_asset_url(attr_map.get("src"))
            if not src:
                return
            if self._link_stack:
                link = self._link_stack[-1]
                link["has_image"] = True
                image_name = compact_whitespace(
                    attr_map.get("alt")
                    or attr_map.get("aria-label")
                    or attr_map.get("title")
                )
                if image_name:
                    link["image_names"].append(image_name)
            self.images.append({
                "src": src,
                "alt": attr_map.get("alt"),
                "width": parse_dimension(attr_map.get("width")),
                "height": parse_dimension(attr_map.get("height")),
            })
            return

        if lowered in TEXT_BREAK_TAGS:
            self._append_break()

        if lowered == "a":
            self._link_stack.append({
                "href": canonical_asset_url(attr_map.get("href")),
                "text": [],
                "aria_label": attr_map.get("aria-label"),
                "title": attr_map.get("title"),
                "has_image": False,
                "image_names": [],
                "start_offset": len(self._plain_text()),
            })

    def handle_data(self, data: str):
        self._append_text(data)
        if self._link_stack:
            self._link_stack[-1]["text"].append(data)

    def handle_endtag(self, tag: str):
        lowered = tag.lower()
        if lowered in TEXT_BREAK_TAGS:
            self._append_break()

        if lowered != "a" or not self._link_stack:
            return

        link = self._link_stack.pop()
        text = compact_whitespace(html.unescape(" ".join(link["text"])))
        accessible_name = compact_whitespace(
            link.get("aria_label")
            or text
            or " ".join(link.get("image_names") or [])
            or link.get("title")
        )
        link["end_offset"] = len(self._plain_text())
        self.links.append({
            "href": link["href"],
            "text": text,
            "accessible_name": accessible_name,
            "has_image": bool(link.get("has_image")),
            "issue_code": classify_link_text(text, link["href"], accessible_name, bool(link.get("has_image"))),
            "start_offset": link["start_offset"],
            "end_offset": link["end_offset"],
        })

    def links_with_context(self, context_chars: int = 320) -> list[dict[str, Any]]:
        plain_text = html.unescape(self._plain_text())
        links = []
        for link in self.links:
            start = max(0, int(link.get("start_offset") or 0) - context_chars)
            end = min(len(plain_text), int(link.get("end_offset") or 0) + context_chars)
            links.append({
                **link,
                "surrounding_text": compact_whitespace(plain_text[start:end]),
            })
        return links


def extract_images(html_body: str | None) -> list[dict[str, Any]]:
    if not html_body:
        return []
    parser = HTMLInventoryParser()
    parser.feed(html_body)
    return parser.images


def extract_links(html_body: str | None) -> list[dict[str, Any]]:
    if not html_body:
        return []
    parser = HTMLInventoryParser()
    parser.feed(html_body)
    parser.close()
    return [link for link in parser.links_with_context() if link.get("href")]


def find_link(html_body: str | None, link_index: int, href: str) -> dict[str, Any] | None:
    target_href = canonical_asset_url(href)
    if not target_href:
        return None
    for index, link in enumerate(extract_links(html_body), start=1):
        if index == link_index and link.get("href") == target_href:
            return link
    return None


def find_link_context(html_body: str | None, link_index: int, href: str) -> str | None:
    link = find_link(html_body, link_index, href)
    return link.get("surrounding_text") if link else None


def build_image_inventory_rows(
    items: list[dict[str, Any]],
    body_by_item_id: dict[str, str],
    canvas_course_id: str | None,
) -> list[dict[str, Any]]:
    images_by_url: dict[str, dict[str, Any]] = {}

    for item in items:
        if item.get("content_type") not in IMAGE_CONTENT_TYPES:
            continue

        html_body = body_by_item_id.get(item["id"], "")
        for image in extract_images(html_body):
            canvas_url = image["src"]
            existing = images_by_url.get(canvas_url)
            alt_text = compact_whitespace(image.get("alt"))
            candidate = {
                "content_item_id": item["id"],
                "source_content_type": item.get("content_type"),
                "canvas_url": canvas_url,
                "canvas_file_id": extract_canvas_file_id(canvas_url),
                "canvas_course_id": canvas_course_id,
                "content_is_orphaned": bool(item.get("is_orphaned")) and item.get("content_type") != "quiz_question",
                "existing_alt_text": alt_text or None,
                "width": image.get("width"),
                "height": image.get("height"),
            }
            if existing is None:
                images_by_url[canvas_url] = candidate
                continue

            if not existing.get("existing_alt_text") and candidate.get("existing_alt_text"):
                existing["existing_alt_text"] = candidate["existing_alt_text"]
            if existing.get("width") is None and candidate.get("width") is not None:
                existing["width"] = candidate["width"]
            if existing.get("height") is None and candidate.get("height") is not None:
                existing["height"] = candidate["height"]

    return list(images_by_url.values())


def build_link_inventory_rows(
    items: list[dict[str, Any]],
    body_by_item_id: dict[str, str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    for item in items:
        if item.get("content_type") not in LINK_CONTENT_TYPES:
            continue

        html_body = body_by_item_id.get(item["id"], "")
        extracted = extract_links(html_body)
        for index, link in enumerate(extracted, start=1):
            context_details = _link_context_details(html_body, index, link.get("href") or "")
            rows.append({
                "content_item_id": item["id"],
                "content_title": item.get("title"),
                "content_type": item.get("content_type"),
                "content_canvas_url": item.get("canvas_url"),
                "module_name": item.get("module_name"),
                "link_index": index,
                "href": link.get("href"),
                "text": link.get("text"),
                "accessible_name": link.get("accessible_name"),
                "link_kind": "image" if link.get("has_image") and not link.get("text") else "text",
                "issue_code": link.get("issue_code"),
                "is_flagged": bool(link.get("issue_code")),
                "surrounding_text": link.get("surrounding_text"),
                "original_text": context_details.get("original_text") or link.get("text"),
                "original_before": context_details.get("original_before") or "",
                "original_after": context_details.get("original_after") or "",
                "original_context": context_details.get("original_context") or link.get("surrounding_text"),
                "suggested_text": context_details.get("suggested_text") or "",
                "html_context": context_details.get("html_context") or "",
            })

    return rows


def build_document_inventory_rows(
    items: list[dict[str, Any]],
    body_by_item_id: dict[str, str],
) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    file_by_id: dict[str, dict[str, Any]] = {}
    file_by_url: dict[str, dict[str, Any]] = {}
    item_by_id = {item.get("id"): item for item in items if item.get("id")}

    for item in items:
        if item.get("content_type") != "file":
            continue
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        filename = metadata.get("filename") or item.get("title") or "Untitled file"
        initial_review = metadata.get("initial_accessibility_review") if isinstance(metadata.get("initial_accessibility_review"), dict) else None
        remediation_plan = metadata.get("document_remediation") if isinstance(metadata.get("document_remediation"), dict) else None
        remediation_probe = remediation_plan.get("initial_probe") if isinstance(remediation_plan, dict) and isinstance(remediation_plan.get("initial_probe"), dict) else None
        accessibility_review = initial_review or remediation_probe
        replacement_candidate = metadata.get("replacement_candidate") if isinstance(metadata.get("replacement_candidate"), dict) else None
        replacement_deployment = replacement_candidate.get("canvas_deployment") if isinstance(replacement_candidate, dict) and isinstance(replacement_candidate.get("canvas_deployment"), dict) else None
        extension = filename_extension(filename)
        mime_type = metadata.get("content_type")
        review_issues = accessibility_review.get("issues") if accessibility_review else None
        source_item_id = metadata.get("source_content_item_id")
        source_item = item_by_id.get(source_item_id) if source_item_id else None
        is_replacement_file = metadata.get("uploaded_via") == "document_replacement_deploy"
        is_image_file = bool((isinstance(mime_type, str) and mime_type.startswith("image/")) or extension in IMAGE_FILE_EXTENSIONS)
        if accessibility_review:
            accessibility_status = "needs_review" if review_issues else "passed_initial_check"
        elif extension == "pdf":
            accessibility_status = "not_checked"
        else:
            accessibility_status = "unsupported_file_type"
        row = {
            "id": item.get("id"),
            "canvas_id": item.get("canvas_id"),
            "title": item.get("title") or filename,
            "filename": filename,
            "extension": extension,
            "mime_type": mime_type,
            "size_bytes": metadata.get("size"),
            "folder_id": metadata.get("folder_id"),
            "folder_name": metadata.get("folder_name"),
            "folder_path": metadata.get("folder_path"),
            "canvas_url": item.get("canvas_url"),
            "published": item.get("published"),
            "module_canvas_id": item.get("module_canvas_id"),
            "module_name": item.get("module_name"),
            "is_orphaned": bool(item.get("is_orphaned")),
            "uploaded_via": metadata.get("uploaded_via"),
            "is_image_file": is_image_file,
            "non_embedded_image_file": False,
            "is_replacement_file": is_replacement_file,
            "source_document_id": metadata.get("source_document_id"),
            "source_canvas_file_id": metadata.get("source_canvas_file_id"),
            "replacement_candidate": replacement_candidate,
            "replacement_status": replacement_candidate.get("status") if replacement_candidate else None,
            "replacement_canvas_file_id": replacement_deployment.get("canvas_file_id") if replacement_deployment else None,
            "replacement_canvas_url": replacement_deployment.get("canvas_url") if replacement_deployment else None,
            "canvas_archive": metadata.get("canvas_archive") if isinstance(metadata.get("canvas_archive"), dict) else None,
            "accessibility_status": accessibility_status,
            "accessibility_issue_count": len(review_issues or []),
            "accessibility_review": accessibility_review,
            "document_remediation": remediation_plan,
            "source_content_item": {
                "id": source_item.get("id"),
                "title": source_item.get("title"),
                "content_type": source_item.get("content_type"),
                "canvas_url": source_item.get("canvas_url"),
                "module_name": source_item.get("module_name"),
            } if source_item else None,
            "linked_from": [],
            "linked_count": 0,
            "filename_link_count": 0,
            "generic_link_count": 0,
        }
        files.append(row)
        if row["canvas_id"]:
            file_by_id[str(row["canvas_id"])] = row
        if row["canvas_url"]:
            file_by_url[canonical_canvas_file_page_url(row["canvas_url"])] = row

    for item in items:
        if item.get("content_type") not in LINK_CONTENT_TYPES:
            continue
        html_body = body_by_item_id.get(item["id"], "")
        for index, link in enumerate(extract_links(html_body), start=1):
            target = None
            file_id = extract_canvas_file_id(link.get("href"))
            if file_id:
                target = file_by_id.get(file_id)
            if target is None:
                target = file_by_url.get(canonical_canvas_file_page_url(link.get("href")))
            if target is None:
                continue

            text = compact_whitespace(link.get("text")) or compact_whitespace(link.get("accessible_name"))
            is_filename_label = is_filename_like_label(text)
            is_generic = bool(link.get("issue_code"))
            target["linked_from"].append({
                "content_item_id": item.get("id"),
                "content_title": item.get("title"),
                "content_type": item.get("content_type"),
                "content_canvas_url": item.get("canvas_url"),
                "module_name": item.get("module_name"),
                "link_index": index,
                "href": link.get("href"),
                "text": text,
                "issue_code": link.get("issue_code"),
                "is_filename_label": is_filename_label,
            })
            target["linked_count"] += 1
            if is_filename_label:
                target["filename_link_count"] += 1
            if is_generic:
                target["generic_link_count"] += 1

    return files
