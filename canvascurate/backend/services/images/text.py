"""Image accessibility text generation and apply-to-content services."""

from __future__ import annotations

import io
import logging
from datetime import datetime, timezone
from html import escape as escape_html
from html.parser import HTMLParser
from typing import Any

from fastapi import BackgroundTasks, HTTPException
from PIL import Image, ImageOps

from ai_image_text import generate_alt_text_from_bytes, generate_long_description_from_bytes, is_ai_configured
from api.images.schemas import BulkImageApplyRequest, GenerateBulkImageTextRequest, GenerateImageTextRequest
from canvas_sync import get_active_pat, sha256_payload
from content_inventory import canonical_asset_url, compact_whitespace, extract_canvas_file_id
from image_proxy import cache_image_assets, fetch_canvas_image_bytes, read_cached_variant
from r2_storage import is_r2_configured
from services.alt_text_validator import alt_issue_label, classify_alt_text
from services.content_bodies import fetch_content_html_by_item_id
from services.content_revisions import save_content_revision
from services.document_records import get_owned_session
from services.job_dispatch import dispatch_background_task
from services.job_queue import JobAdmissionError, enqueue_background_job, env_int
from supabase_client import get_supabase


logger = logging.getLogger(__name__)

EDITABLE_CONTENT_TYPES = ["page", "assignment", "discussion", "quiz", "quiz_question"]
CONTENT_TYPE_LABELS = {
    "page": "Page",
    "assignment": "Assignment",
    "discussion": "Discussion",
    "quiz": "Quiz",
    "quiz_question": "Quiz question",
    "file": "File",
    "module": "Module",
}
COURSE_IMAGES_BASE_SELECT = (
    "id, content_item_id, canvas_url, canvas_file_id, canvas_course_id, status, "
    "r2_original_key, r2_thumb_key, existing_alt_text, edited_alt_text, long_description, "
    "is_decorative, width, height, mime_type, file_size_bytes, is_broken, created_at, updated_at"
)
COURSE_IMAGES_SELECT = f"{COURSE_IMAGES_BASE_SELECT}, review_action"
IMAGE_TEXT_BULK_JOB_TYPE = "image_text_bulk_generate"
IMAGE_TEXT_JOB_TYPE = "image_text_generate"
MAX_AI_IMAGE_BYTES = 2_500_000


def get_session_canvas_course_id(supabase, source_course_id: str | None, user_id: str) -> str | None:
    if not source_course_id:
        return None

    result = supabase.table("courses").select(
        "canvas_course_id"
    ).eq("id", source_course_id).eq("user_id", user_id).limit(1).execute()
    if not result.data:
        return None
    return result.data[0].get("canvas_course_id")


def fetch_session_item_map(
    supabase,
    session_id: str,
    user_id: str,
    content_item_ids: list[str] | None = None,
) -> dict[str, dict]:
    query = supabase.table("course_content_items").select(
        "id, title, content_type, canvas_url, module_name, is_orphaned, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id)
    if content_item_ids:
        query = query.in_("id", list(dict.fromkeys(content_item_ids)))
    result = query.execute()
    rows = result.data or []
    return {row["id"]: row for row in rows}


def course_id_from_canvas_url(value: str | None) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    marker = "/courses/"
    if marker not in raw:
        return None
    remainder = raw.split(marker, 1)[1]
    return remainder.split("/", 1)[0] or None


def image_status_for_row(row: dict, source_canvas_course_id: str | None) -> str:
    linked_course_id = course_id_from_canvas_url(row.get("canvas_url"))
    if row.get("is_broken"):
        return "broken"
    if linked_course_id and source_canvas_course_id and linked_course_id != source_canvas_course_id:
        return "broken"
    if row.get("content_is_orphaned"):
        return "orphaned"
    return "deployed"


def annotate_image_rows(rows: list[dict], item_map: dict[str, dict], source_canvas_course_id: str | None):
    for row in rows:
        item = item_map.get(row.get("content_item_id") or "")
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        linked_from = metadata.get("linked_from") if isinstance(metadata.get("linked_from"), list) else []
        is_child_question = item.get("content_type") == "quiz_question" if item else False
        row["content_title"] = item.get("title") if item else None
        row["content_type"] = item.get("content_type") if item else None
        row["content_canvas_url"] = item.get("canvas_url") if item else None
        row["module_name"] = item.get("module_name") if item else None
        row["content_is_orphaned"] = False if is_child_question else (bool(item.get("is_orphaned")) if item else False)
        row["linked_from"] = linked_from
        row["preview_available"] = bool(item and item.get("content_type") in EDITABLE_CONTENT_TYPES)
        row["deployment_label"] = CONTENT_TYPE_LABELS.get(item.get("content_type"), "Content") if item else "Image"
        row["status_label"] = image_status_for_row(row, source_canvas_course_id)
    return rows


def fetch_canvas_file_item_map(supabase, session_id: str, user_id: str, file_ids: list[str]) -> dict[str, dict]:
    normalized_ids = [str(file_id) for file_id in dict.fromkeys(file_ids) if file_id]
    if not normalized_ids:
        return {}
    result = supabase.table("course_content_items").select(
        "canvas_id, title, canvas_url, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "content_type", "file"
    ).in_("canvas_id", normalized_ids).execute()
    return {str(row.get("canvas_id")): row for row in result.data or [] if row.get("canvas_id") is not None}


def filename_from_image_url(value: str | None) -> str | None:
    raw = (value or "").split("?", 1)[0].split("#", 1)[0].rstrip("/")
    if not raw:
        return None
    tail = raw.rsplit("/", 1)[-1]
    if not tail or tail.lower() in {"preview", "download"} or tail.isdigit():
        return None
    return tail


def annotate_image_file_names(supabase, rows: list[dict], session_id: str, user_id: str):
    file_map = fetch_canvas_file_item_map(
        supabase,
        session_id,
        user_id,
        [row.get("canvas_file_id") for row in rows if row.get("canvas_file_id")],
    )
    for row in rows:
        file_item = file_map.get(str(row.get("canvas_file_id"))) if row.get("canvas_file_id") else None
        metadata = file_item.get("metadata") if isinstance(file_item, dict) and isinstance(file_item.get("metadata"), dict) else {}
        row["image_file_name"] = (
            metadata.get("filename")
            or (file_item.get("title") if isinstance(file_item, dict) else None)
            or filename_from_image_url(row.get("canvas_url"))
        )
        row["image_file_url"] = file_item.get("canvas_url") if isinstance(file_item, dict) else None
    return rows


class ImageContentStateParser(HTMLParser):
    def __init__(
        self,
        *,
        target_url: str,
        target_file_id: str | None,
        alt_text: str | None,
        is_decorative: bool,
    ):
        super().__init__(convert_charrefs=True)
        self.target_url = canonical_asset_url(target_url)
        self.target_file_id = target_file_id
        self.alt_text = compact_whitespace(alt_text)
        self.is_decorative = is_decorative
        self.applied = False

    def image_matches(self, attrs: list[tuple[str, str | None]]) -> bool:
        attr_map = {name.lower(): value or "" for name, value in attrs}
        src = attr_map.get("src")
        if src and canonical_asset_url(src) == self.target_url:
            return True
        if self.target_file_id and extract_canvas_file_id(src) == self.target_file_id:
            return True
        return False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        self.inspect_tag(tag, attrs)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]):
        self.inspect_tag(tag, attrs)

    def inspect_tag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if tag.lower() != "img" or not self.image_matches(attrs):
            return
        attr_map = {name.lower(): value or "" for name, value in attrs}
        if self.is_decorative:
            self.applied = (
                attr_map.get("alt", "") == ""
                and (
                    attr_map.get("role") == "presentation"
                    or attr_map.get("data-decorative") == "true"
                )
            )
            return
        self.applied = bool(self.alt_text) and compact_whitespace(attr_map.get("alt")) == self.alt_text


def image_accessibility_applied_to_html(html_body: str, image: dict[str, Any]) -> bool:
    alt_text = compact_whitespace(image.get("edited_alt_text")) or compact_whitespace(image.get("existing_alt_text"))
    parser = ImageContentStateParser(
        target_url=image.get("canvas_url") or "",
        target_file_id=image.get("canvas_file_id"),
        alt_text=alt_text,
        is_decorative=bool(image.get("is_decorative")),
    )
    parser.feed(html_body or "")
    parser.close()
    return parser.applied


def annotate_image_content_apply_state(supabase, rows: list[dict]):
    content_item_ids = list(dict.fromkeys([
        row["content_item_id"]
        for row in rows
        if row.get("content_item_id")
    ]))
    if not content_item_ids:
        for row in rows:
            row["content_accessibility_applied"] = False
        return

    html_by_content_id = fetch_content_html_by_item_id(supabase, content_item_ids)
    for row in rows:
        html_body = html_by_content_id.get(row.get("content_item_id") or "")
        row["content_accessibility_applied"] = image_accessibility_applied_to_html(html_body or "", row)


def hydrate_image_row(
    supabase,
    session: dict,
    user_id: str,
    row: dict,
):
    row["proxy_available"] = True
    row["review_action"] = row.get("review_action") or "keep"
    effective_alt = compact_whitespace(row.get("edited_alt_text") or row.get("existing_alt_text"))
    row["effective_alt_text"] = "Decorative" if row.get("is_decorative") else (effective_alt or None)
    source_canvas_course_id = get_session_canvas_course_id(supabase, session.get("source_course_id"), user_id)
    item_map = fetch_session_item_map(
        supabase,
        session["id"],
        user_id,
        [row["content_item_id"]] if row.get("content_item_id") else None,
    )
    annotate_image_rows([row], item_map, source_canvas_course_id)
    annotate_image_file_names(supabase, [row], session["id"], user_id)
    alt_issue_code = None if row.get("is_decorative") else classify_alt_text(
        row.get("effective_alt_text"),
        row.get("image_file_name"),
        row.get("canvas_url"),
    )
    row["alt_issue_code"] = alt_issue_code
    row["alt_issue_label"] = alt_issue_label(alt_issue_code)
    if not row.get("review_action"):
        row["review_action"] = "delete" if row.get("content_is_orphaned") else "keep"
    annotate_image_content_apply_state(supabase, [row])
    return row


def build_image_ai_context(row: dict) -> str:
    context_parts: list[str] = []
    if row.get("content_title"):
        context_parts.append(f"Embedded in {row['content_title']}.")
    if row.get("content_type"):
        context_parts.append(f"Content type: {CONTENT_TYPE_LABELS.get(row['content_type'], row['content_type'])}.")
    if row.get("module_name"):
        context_parts.append(f"Module: {row['module_name']}.")
    if row.get("existing_alt_text"):
        context_parts.append(f"Existing alt text: {row['existing_alt_text']}.")
    return " ".join(context_parts)


def image_to_rgb(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def encode_jpeg_under_limit(image: Image.Image, target_bytes: int = MAX_AI_IMAGE_BYTES) -> tuple[bytes, int, int]:
    rgb = image_to_rgb(image)
    longest_edge_steps = [2400, 2000, 1600, 1400, 1200, 1000, 800, 640, 480, 320]
    quality_steps = [86, 80, 74, 68, 62, 56, 50, 44, 38]
    best_payload: bytes | None = None
    best_size = rgb.size

    for longest_edge in longest_edge_steps:
        candidate = rgb.copy()
        current_longest_edge = max(candidate.size)
        if current_longest_edge > longest_edge:
            scale = longest_edge / current_longest_edge
            next_size = (
                max(1, int(candidate.width * scale)),
                max(1, int(candidate.height * scale)),
            )
            candidate = candidate.resize(next_size, Image.Resampling.LANCZOS)

        for quality in quality_steps:
            output = io.BytesIO()
            candidate.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)
            payload = output.getvalue()
            if best_payload is None or len(payload) < len(best_payload):
                best_payload = payload
                best_size = candidate.size
            if len(payload) <= target_bytes:
                return payload, candidate.width, candidate.height

    if best_payload is None:
        raise HTTPException(status_code=422, detail="Image could not be processed")
    if len(best_payload) > target_bytes:
        raise HTTPException(
            status_code=422,
            detail="Image could not be compressed below the AI generation size limit",
        )
    return best_payload, best_size[0], best_size[1]


def prepare_image_bytes_for_ai(data: bytes, content_type: str | None) -> tuple[bytes, str]:
    normalized_content_type = (content_type or "application/octet-stream").split(";")[0].strip().lower()
    if len(data) <= MAX_AI_IMAGE_BYTES:
        return data, normalized_content_type
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            processed, _, _ = encode_jpeg_under_limit(image)
            return processed, "image/jpeg"
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Image is too large for AI generation and could not be compressed: {exc}")


def load_image_bytes_for_ai(
    *,
    supabase,
    session: dict,
    user_id: str,
    image: dict,
    session_id: str,
    image_id: str,
) -> tuple[bytes, str]:
    if image.get("r2_original_key") and is_r2_configured():
        image_bytes, content_type = read_cached_variant(
            image["r2_original_key"],
            image.get("mime_type") or "application/octet-stream",
        )
        return prepare_image_bytes_for_ai(image_bytes, content_type)

    source_course_id = session.get("source_course_id")
    if not source_course_id:
        raise HTTPException(status_code=400, detail="Session has no source course")

    course_result = supabase.table("courses").select(
        "canvas_base_url"
    ).eq("id", source_course_id).eq("user_id", user_id).limit(1).execute()
    if not course_result.data:
        raise HTTPException(status_code=404, detail="Source course not found")

    canvas_base_url = course_result.data[0].get("canvas_base_url")
    pat_token = get_active_pat(supabase, user_id, canvas_base_url)

    try:
        cached = cache_image_assets(
            session_id=session_id,
            image_id=image_id,
            canvas_url=image["canvas_url"],
            pat_token=pat_token,
            existing_original_key=image.get("r2_original_key"),
            existing_thumb_key=image.get("r2_thumb_key"),
        )
        if cached.get("original_bytes") is not None:
            return prepare_image_bytes_for_ai(
                cached["original_bytes"],
                cached.get("original_content_type") or "application/octet-stream",
            )
    except Exception:
        pass

    try:
        image_bytes, content_type = fetch_canvas_image_bytes(image["canvas_url"], pat_token)
        return prepare_image_bytes_for_ai(image_bytes, content_type)
    except Exception as exc:
        supabase.table("course_images").update({
            "is_broken": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", image_id).execute()
        raise HTTPException(status_code=502, detail=f"Image could not be loaded from Canvas: {exc}")


def should_generate_for_bulk(row: dict, body: GenerateBulkImageTextRequest) -> bool:
    if body.skip_decorative and row.get("is_decorative"):
        return False
    if body.overwrite_existing:
        return True
    needs_alt = body.mode in {"alt", "both"} and not compact_whitespace(row.get("edited_alt_text"))
    needs_long_desc = body.mode in {"long_desc", "both"} and not compact_whitespace(row.get("long_description"))
    return needs_alt or needs_long_desc


def render_attrs(attrs: list[tuple[str, str | None]]) -> str:
    if not attrs:
        return ""
    rendered = []
    for name, value in attrs:
        if value is None:
            rendered.append(name)
        else:
            rendered.append(f'{name}="{escape_html(str(value), quote=True)}"')
    return " " + " ".join(rendered)


def set_attr(attrs: list[tuple[str, str | None]], name: str, value: str | None):
    lowered = name.lower()
    for index, (existing_name, _) in enumerate(attrs):
        if existing_name.lower() == lowered:
            attrs[index] = (existing_name, value)
            return
    attrs.append((name, value))


def remove_attr(attrs: list[tuple[str, str | None]], name: str):
    lowered = name.lower()
    attrs[:] = [(existing_name, value) for existing_name, value in attrs if existing_name.lower() != lowered]


class ImageAltSyncParser(HTMLParser):
    def __init__(
        self,
        *,
        target_url: str,
        target_file_id: str | None,
        alt_text: str | None,
        is_decorative: bool,
    ):
        super().__init__(convert_charrefs=False)
        self.target_url = canonical_asset_url(target_url)
        self.target_file_id = target_file_id
        self.alt_text = alt_text or ""
        self.is_decorative = is_decorative
        self.parts: list[str] = []
        self.changed_count = 0

    def image_matches(self, attrs: list[tuple[str, str | None]]) -> bool:
        attr_map = {name.lower(): value or "" for name, value in attrs}
        src = attr_map.get("src")
        if src and canonical_asset_url(src) == self.target_url:
            return True
        if self.target_file_id and extract_canvas_file_id(src) == self.target_file_id:
            return True
        return False

    def sync_image_attrs(self, attrs: list[tuple[str, str | None]]) -> list[tuple[str, str | None]]:
        next_attrs = list(attrs)
        if self.is_decorative:
            set_attr(next_attrs, "alt", "")
            set_attr(next_attrs, "role", "presentation")
            set_attr(next_attrs, "data-decorative", "true")
            remove_attr(next_attrs, "aria-label")
        else:
            set_attr(next_attrs, "alt", self.alt_text)
            set_attr(next_attrs, "data-ally-user-updated-alt", "true")
            remove_attr(next_attrs, "data-decorative")
            role_value = next((value for name, value in next_attrs if name.lower() == "role"), None)
            if role_value == "presentation":
                remove_attr(next_attrs, "role")
        return next_attrs

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if tag.lower() == "img" and self.image_matches(attrs):
            attrs = self.sync_image_attrs(attrs)
            self.changed_count += 1
        self.parts.append(f"<{tag}{render_attrs(attrs)}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if tag.lower() == "img" and self.image_matches(attrs):
            attrs = self.sync_image_attrs(attrs)
            self.changed_count += 1
        self.parts.append(f"<{tag}{render_attrs(attrs)} />")

    def handle_endtag(self, tag: str):
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str):
        self.parts.append(data)

    def handle_entityref(self, name: str):
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str):
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str):
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str):
        self.parts.append(f"<!{decl}>")

    def result(self) -> str:
        return "".join(self.parts)


def apply_image_accessibility_to_html(html_body: str, image: dict[str, Any]) -> tuple[str, int]:
    alt_text = compact_whitespace(image.get("edited_alt_text")) or compact_whitespace(image.get("existing_alt_text"))
    is_decorative = bool(image.get("is_decorative"))
    if not is_decorative and not alt_text:
        raise HTTPException(status_code=422, detail="Image needs alt text or decorative status before applying to content")
    if not is_decorative and classify_alt_text(alt_text, image.get("canvas_url")):
        raise HTTPException(status_code=422, detail="Image alt text still looks generic or filename-derived")

    parser = ImageAltSyncParser(
        target_url=image.get("canvas_url") or "",
        target_file_id=image.get("canvas_file_id"),
        alt_text=alt_text,
        is_decorative=is_decorative,
    )
    parser.feed(html_body or "")
    parser.close()
    return parser.result(), parser.changed_count


def apply_image_accessibility_to_quiz_question_metadata(
    metadata: dict[str, Any],
    image: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    next_metadata = {**metadata}
    changed_count = 0

    question_text, question_changed = apply_image_accessibility_to_html(
        next_metadata.get("question_text") or "",
        image,
    )
    if question_changed:
        next_metadata["question_text"] = question_text
        changed_count += question_changed

    answers = next_metadata.get("answers") if isinstance(next_metadata.get("answers"), list) else []
    next_answers: list[dict[str, Any]] = []
    answer_fields = (
        "answer_html",
        "html",
        "answer_text",
        "text",
        "answer_match_left",
        "answer_match_right",
        "left",
        "right",
    )
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        next_answer = {**answer}
        for field in answer_fields:
            value = next_answer.get(field)
            if not isinstance(value, str) or "<img" not in value.lower():
                continue
            next_value, field_changed = apply_image_accessibility_to_html(value, image)
            if field_changed:
                next_answer[field] = next_value
                changed_count += field_changed
        next_answers.append(next_answer)
    if changed_count:
        next_metadata["answers"] = next_answers

    return next_metadata, changed_count


def sync_quiz_question_image_metadata(
    supabase,
    *,
    content_item_id: str,
    images: list[dict[str, Any]],
):
    item_result = supabase.table("course_content_items").select(
        "id, content_type, metadata"
    ).eq("id", content_item_id).limit(1).execute()
    if not item_result.data:
        return
    item = item_result.data[0]
    if item.get("content_type") != "quiz_question":
        return

    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    next_metadata = metadata
    changed_count = 0
    for image in images:
        next_metadata, image_changed_count = apply_image_accessibility_to_quiz_question_metadata(next_metadata, image)
        changed_count += image_changed_count
    if changed_count:
        supabase.table("course_content_items").update({
            "metadata": next_metadata,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", content_item_id).execute()


def image_accessibility_change_label(image: dict[str, Any]) -> str:
    if image.get("is_decorative"):
        return "Applied image accessibility - marked decorative"
    return "Applied image accessibility - added alt text"


def apply_session_image_to_content(
    *,
    session_id: str,
    image_id: str,
    user_id: str,
) -> dict[str, Any]:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    image_result = supabase.table("course_images").select(
        "id, content_item_id, canvas_url, canvas_file_id, existing_alt_text, edited_alt_text, is_decorative"
    ).eq("id", image_id).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not image_result.data:
        raise HTTPException(status_code=404, detail="Image not found")

    image = image_result.data[0]
    content_item_id = image.get("content_item_id")
    if not content_item_id:
        raise HTTPException(status_code=422, detail="Image is not linked to a content item")

    body_result = supabase.table("course_content_bodies").select(
        "html_body"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    current_html = (body_result.data[0].get("html_body") if body_result.data else "") or ""
    next_html, changed_count = apply_image_accessibility_to_html(current_html, image)
    if changed_count == 0:
        raise HTTPException(status_code=404, detail="Matching image tag was not found in content HTML")

    result = save_content_revision(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
        next_html=next_html,
        change_summary=image_accessibility_change_label(image),
    )
    sync_quiz_question_image_metadata(
        supabase,
        content_item_id=content_item_id,
        images=[image],
    )
    now = datetime.now(timezone.utc).isoformat()
    updates = {"updated_at": now}
    if image.get("is_decorative"):
        updates["existing_alt_text"] = None
    else:
        updates["existing_alt_text"] = compact_whitespace(image.get("edited_alt_text")) or image.get("existing_alt_text")
    supabase.table("course_images").update(updates).eq("id", image_id).execute()

    return {
        "image_id": image_id,
        "content_item_id": content_item_id,
        "matched_count": changed_count,
        "saved": result["saved"],
        "revision_number": result["revision_number"],
    }


def apply_session_images_to_content_bulk(
    supabase,
    *,
    session_id: str,
    user_id: str,
    image_ids: list[str],
) -> dict[str, Any]:
    image_ids = list(dict.fromkeys(image_ids))
    get_owned_session(supabase, session_id, user_id)
    image_result = supabase.table("course_images").select(
        "id, content_item_id, canvas_url, canvas_file_id, existing_alt_text, edited_alt_text, is_decorative"
    ).eq("session_id", session_id).eq("user_id", user_id).in_("id", image_ids).execute()
    images = image_result.data or []
    found_ids = {row["id"] for row in images}
    missing_ids = [image_id for image_id in image_ids if image_id not in found_ids]

    by_content: dict[str, list[dict[str, Any]]] = {}
    skipped = []
    for image in images:
        content_item_id = image.get("content_item_id")
        if not content_item_id:
            skipped.append({"image_id": image["id"], "detail": "Image is not linked to a content item"})
            continue
        by_content.setdefault(content_item_id, []).append(image)

    applied = []
    errors = [{"image_id": image_id, "detail": "Image not found"} for image_id in missing_ids]
    now = datetime.now(timezone.utc).isoformat()

    for content_item_id, content_images in by_content.items():
        try:
            body_result = supabase.table("course_content_bodies").select(
                "html_body"
            ).eq("content_item_id", content_item_id).limit(1).execute()
            current_html = (body_result.data[0].get("html_body") if body_result.data else "") or ""
            next_html = current_html
            matched_total = 0
            applied_image_ids = []
            for image in content_images:
                try:
                    next_html, matched_count = apply_image_accessibility_to_html(next_html, image)
                except HTTPException as exc:
                    errors.append({"image_id": image["id"], "detail": str(exc.detail)})
                    continue
                if matched_count == 0:
                    skipped.append({"image_id": image["id"], "detail": "Matching image tag was not found in content HTML"})
                    continue
                matched_total += matched_count
                applied_image_ids.append(image["id"])

            if not applied_image_ids:
                continue

            decorative_count = sum(1 for image in content_images if image["id"] in applied_image_ids and image.get("is_decorative"))
            alt_count = len(applied_image_ids) - decorative_count
            summary_parts = []
            if alt_count:
                summary_parts.append(f"added alt text for {alt_count} image{'s' if alt_count != 1 else ''}")
            if decorative_count:
                summary_parts.append(f"marked {decorative_count} image{'s' if decorative_count != 1 else ''} decorative")
            change_summary = "Applied image accessibility - " + " and ".join(summary_parts)

            result = save_content_revision(
                supabase,
                session_id=session_id,
                user_id=user_id,
                content_item_id=content_item_id,
                next_html=next_html,
                change_summary=change_summary,
            )
            sync_quiz_question_image_metadata(
                supabase,
                content_item_id=content_item_id,
                images=[image for image in content_images if image["id"] in applied_image_ids],
            )
            for image in content_images:
                if image["id"] not in applied_image_ids:
                    continue
                updates = {"updated_at": now}
                if image.get("is_decorative"):
                    updates["existing_alt_text"] = None
                else:
                    updates["existing_alt_text"] = compact_whitespace(image.get("edited_alt_text")) or image.get("existing_alt_text")
                supabase.table("course_images").update(updates).eq("id", image["id"]).execute()
            applied.append({
                "content_item_id": content_item_id,
                "image_ids": applied_image_ids,
                "matched_count": matched_total,
                "saved": result["saved"],
                "revision_number": result["revision_number"],
            })
        except Exception as exc:
            for image in content_images:
                errors.append({"image_id": image["id"], "detail": str(exc)})

    return {
        "applied": applied,
        "skipped": skipped,
        "errors": errors,
        "counts": {
            "requested": len(image_ids),
            "applied": sum(len(row["image_ids"]) for row in applied),
            "skipped": len(skipped),
            "errors": len(errors),
        },
    }


def bulk_apply_session_images_to_content(
    *,
    session_id: str,
    user_id: str,
    body: BulkImageApplyRequest,
) -> dict[str, Any]:
    supabase = get_supabase()
    return apply_session_images_to_content_bulk(
        supabase,
        session_id=session_id,
        user_id=user_id,
        image_ids=body.image_ids,
    )


def generate_session_image_text(
    *,
    session_id: str,
    image_id: str,
    user_id: str,
    body: GenerateImageTextRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="ASU AIML is not configured for this environment")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    result = supabase.table("course_images").select(COURSE_IMAGES_SELECT).eq(
        "id", image_id
    ).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Image not found")

    row = result.data[0]
    if row.get("is_decorative"):
        raise HTTPException(status_code=409, detail="Decorative images do not need AI alt text or long descriptions")

    job_payload = {
        "session_id": session_id,
        "image_id": image_id,
        "canvas_file_id": row.get("canvas_file_id"),
        "content_item_id": row.get("content_item_id"),
        "mode": body.mode,
        "overwrite_existing": body.overwrite_existing,
        "apply_to_content": body.mode != "long_desc",
        "request_key": sha256_payload({
            "image_id": image_id,
            "mode": body.mode,
            "overwrite_existing": body.overwrite_existing,
        }),
    }
    try:
        enqueued = enqueue_background_job(
            supabase,
            user_id=user_id,
            session_id=session_id,
            job_type=IMAGE_TEXT_JOB_TYPE,
            payload=job_payload,
            duplicate_fields=("request_key",),
            max_active_job_type_per_user=env_int("IMAGE_TEXT_MAX_ACTIVE_JOBS_PER_USER", 4),
        )
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    if enqueued.created:
        dispatch_background_task(background_tasks, run_image_text_generate_job, enqueued.job["id"], session_id, user_id)

    return {
        "status": enqueued.job.get("status") or "queued",
        "job_id": enqueued.job["id"],
        "created": enqueued.created,
        "image_id": image_id,
        "message": "Image AI generation queued. The generated text will appear when the worker finishes.",
    }


def generate_image_text_for_payload(
    supabase,
    *,
    session_id: str,
    user_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    image_id = str(payload.get("image_id") or "")
    if not image_id:
        raise ValueError("image_id is required")
    body = GenerateImageTextRequest(
        mode=payload.get("mode") or "alt",
        overwrite_existing=bool(payload.get("overwrite_existing", False)),
    )
    session = get_owned_session(supabase, session_id, user_id)
    result = supabase.table("course_images").select(COURSE_IMAGES_SELECT).eq(
        "id", image_id
    ).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not result.data:
        raise ValueError("Image not found")

    row = result.data[0]
    if row.get("is_decorative"):
        raise ValueError("Decorative images do not need AI alt text or long descriptions")

    image_bytes, content_type = load_image_bytes_for_ai(
        supabase=supabase,
        session=session,
        user_id=user_id,
        image=row,
        session_id=session_id,
        image_id=row["id"],
    )
    context = build_image_ai_context(hydrate_image_row(supabase, session, user_id, row.copy()))

    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.mode in {"alt", "both"} and (body.overwrite_existing or not compact_whitespace(row.get("edited_alt_text"))):
        updates["edited_alt_text"] = generate_alt_text_from_bytes(image_bytes, content_type, context)
    if body.mode in {"long_desc", "both"} and (body.overwrite_existing or not compact_whitespace(row.get("long_description"))):
        updates["long_description"] = generate_long_description_from_bytes(image_bytes, content_type, context)

    supabase.table("course_images").update(updates).eq("id", image_id).execute()
    refreshed = supabase.table("course_images").select(COURSE_IMAGES_SELECT).eq(
        "id", image_id
    ).limit(1).execute()
    if not refreshed.data:
        raise ValueError("Failed to reload generated image text")
    return hydrate_image_row(supabase, session, user_id, refreshed.data[0])


def run_image_text_generate_job(job_id: str, session_id: str, user_id: str) -> None:
    supabase = get_supabase()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 1,
    }).eq("id", job_id).execute()
    try:
        payload_result = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        payload = payload_result.data[0].get("payload") if payload_result.data else {}
        image = generate_image_text_for_payload(
            supabase,
            session_id=session_id,
            user_id=user_id,
            payload=payload if isinstance(payload, dict) else {},
        )
        apply_result = None
        if isinstance(payload, dict) and payload.get("apply_to_content") and payload.get("mode") != "long_desc":
            apply_result = apply_session_images_to_content_bulk(
                supabase,
                session_id=session_id,
                user_id=user_id,
                image_ids=[str(image["id"])],
            )
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": {
                "image_id": image.get("id"),
                "mode": (payload or {}).get("mode") if isinstance(payload, dict) else None,
                "has_alt_text": bool(compact_whitespace(image.get("edited_alt_text"))),
                "has_long_description": bool(compact_whitespace(image.get("long_description"))),
                "apply_result": apply_result,
            },
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
    except Exception as exc:
        logger.exception("Image AI generation failed job_id=%s", job_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()


def get_session_image(
    *,
    session_id: str,
    image_id: str,
    user_id: str,
) -> dict[str, Any]:
    supabase = get_supabase()
    session = get_owned_session(supabase, session_id, user_id)
    result = supabase.table("course_images").select(COURSE_IMAGES_SELECT).eq(
        "id", image_id
    ).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Image not found")
    return hydrate_image_row(supabase, session, user_id, result.data[0])


def generate_image_text_bulk_for_payload(
    supabase,
    *,
    session_id: str,
    user_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    body = GenerateBulkImageTextRequest(
        image_ids=payload.get("image_ids") or [],
        mode=payload.get("mode") or "alt",
        overwrite_existing=bool(payload.get("overwrite_existing", False)),
        skip_decorative=bool(payload.get("skip_decorative", True)),
    )
    image_ids = list(dict.fromkeys(body.image_ids))
    session = get_owned_session(supabase, session_id, user_id)
    source_canvas_course_id = get_session_canvas_course_id(supabase, session.get("source_course_id"), user_id)
    result = supabase.table("course_images").select(COURSE_IMAGES_SELECT).eq(
        "session_id", session_id
    ).eq("user_id", user_id).in_("id", image_ids).execute()
    rows = result.data or []
    if len(rows) != len(image_ids):
        missing_ids = sorted(set(image_ids) - {row["id"] for row in rows})
    else:
        missing_ids = []

    item_map = fetch_session_item_map(
        supabase,
        session_id,
        user_id,
        [row["content_item_id"] for row in rows if row.get("content_item_id")],
    )
    annotate_image_rows(rows, item_map, source_canvas_course_id)

    processed = 0
    skipped: list[dict[str, Any]] = []
    processed_image_ids = []
    errors: list[dict[str, Any]] = [{"image_id": image_id, "detail": "Image not found"} for image_id in missing_ids]
    for row in rows:
        if not should_generate_for_bulk(row, body):
            if body.skip_decorative and row.get("is_decorative"):
                detail = "Skipped because the image is marked decorative"
            else:
                detail = "Skipped because the requested text already exists"
            skipped.append({"image_id": row["id"], "detail": detail})
            continue

        try:
            image_bytes, content_type = load_image_bytes_for_ai(
                supabase=supabase,
                session=session,
                user_id=user_id,
                image=row,
                session_id=session_id,
                image_id=row["id"],
            )
            context = build_image_ai_context(row)
            updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
            if body.mode in {"alt", "both"} and (body.overwrite_existing or not compact_whitespace(row.get("edited_alt_text"))):
                updates["edited_alt_text"] = generate_alt_text_from_bytes(image_bytes, content_type, context)
            if body.mode in {"long_desc", "both"} and (body.overwrite_existing or not compact_whitespace(row.get("long_description"))):
                updates["long_description"] = generate_long_description_from_bytes(image_bytes, content_type, context)
            supabase.table("course_images").update(updates).eq("id", row["id"]).execute()
            processed += 1
            processed_image_ids.append(row["id"])
        except Exception as exc:
            errors.append({"image_id": row["id"], "detail": str(exc)})

    apply_result = None
    if payload.get("apply_to_content") and body.mode != "long_desc" and processed_image_ids:
        apply_result = apply_session_images_to_content_bulk(
            supabase,
            session_id=session_id,
            user_id=user_id,
            image_ids=processed_image_ids,
        )

    return {
        "requested_count": len(image_ids),
        "processed_count": processed,
        "processed_image_ids": processed_image_ids,
        "skipped_count": len(skipped),
        "skipped": skipped,
        "error_count": len(errors),
        "errors": errors,
        "apply_result": apply_result,
    }


def run_image_text_bulk_generate_job(job_id: str, session_id: str, user_id: str) -> None:
    supabase = get_supabase()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 1,
    }).eq("id", job_id).execute()
    try:
        payload_result = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        payload = payload_result.data[0].get("payload") if payload_result.data else {}
        result = generate_image_text_bulk_for_payload(
            supabase,
            session_id=session_id,
            user_id=user_id,
            payload=payload if isinstance(payload, dict) else {},
        )
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "result": result,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
    except Exception as exc:
        logger.exception("Bulk image AI generation failed job_id=%s", job_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()


def generate_session_image_text_bulk(
    *,
    session_id: str,
    user_id: str,
    body: GenerateBulkImageTextRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="ASU AIML is not configured for this environment")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    image_ids = list(dict.fromkeys(body.image_ids))
    found_result = supabase.table("course_images").select("id").eq(
        "session_id", session_id
    ).eq("user_id", user_id).in_("id", image_ids).execute()
    if len(found_result.data or []) != len(image_ids):
        raise HTTPException(status_code=404, detail="One or more images were not found")

    job_payload = {
        "session_id": session_id,
        "image_ids": image_ids,
        "mode": body.mode,
        "overwrite_existing": body.overwrite_existing,
        "skip_decorative": body.skip_decorative,
        "apply_to_content": body.mode != "long_desc",
        "request_key": sha256_payload({
            "image_ids": sorted(image_ids),
            "mode": body.mode,
            "overwrite_existing": body.overwrite_existing,
            "skip_decorative": body.skip_decorative,
        }),
    }
    try:
        enqueued = enqueue_background_job(
            supabase,
            user_id=user_id,
            session_id=session_id,
            job_type=IMAGE_TEXT_BULK_JOB_TYPE,
            payload=job_payload,
            duplicate_fields=("request_key",),
            max_active_job_type_per_user=env_int("IMAGE_TEXT_BULK_MAX_ACTIVE_JOBS_PER_USER", 1),
        )
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    if enqueued.created:
        dispatch_background_task(background_tasks, run_image_text_bulk_generate_job, enqueued.job["id"], session_id, user_id)

    return {
        "status": enqueued.job.get("status") or "queued",
        "job_id": enqueued.job["id"],
        "created": enqueued.created,
        "requested_count": len(image_ids),
        "message": "Bulk image AI generation queued. The worker will generate text and apply alt text to content when applicable.",
    }
