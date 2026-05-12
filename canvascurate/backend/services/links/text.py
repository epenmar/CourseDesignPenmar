"""Link inventory and link text remediation services."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from html import escape as escape_html
from html.parser import HTMLParser
from typing import Any, Literal

from fastapi import BackgroundTasks, HTTPException

from ai_image_text import generate_link_text_suggestion, is_ai_configured
from api.links.schemas import (
    BulkLinkTextApplyRequest,
    BulkLinkTextSuggestionRequest,
    LinkTextApplyRequest,
    LinkTextSuggestionRequest,
)
from canvas_sync import sha256_payload
from content_inventory import build_link_inventory_rows, canonical_asset_url, compact_whitespace, find_link
from services.content_bodies import fetch_content_html_by_item_id
from services.content_revisions import save_content_revision
from services.document_records import get_owned_session
from services.job_dispatch import dispatch_background_task
from services.job_queue import JobAdmissionError, enqueue_background_job, env_int
from supabase_client import get_supabase


logger = logging.getLogger(__name__)

EDITABLE_CONTENT_TYPES = ["page", "assignment", "discussion", "quiz", "quiz_question"]
HTML_BODY_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz", "quiz_question"}
LINK_TEXT_BULK_JOB_TYPE = "link_text_bulk_suggest"


def fetch_session_items_and_bodies(
    supabase,
    session_id: str,
    user_id: str,
    content_types: list[str] | None = None,
) -> tuple[list[dict], dict[str, str]]:
    query = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, canvas_url, module_canvas_id, module_name, published, is_orphaned, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id)
    if content_types:
        query = query.in_("content_type", content_types)

    item_result = query.execute()
    items = item_result.data or []
    item_ids = [
        item["id"]
        for item in items
        if item.get("id") and item.get("content_type") in HTML_BODY_CONTENT_TYPES
    ]
    body_by_item_id = fetch_content_html_by_item_id(supabase, item_ids)
    return items, body_by_item_id


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


class LinkTextReplaceParser(HTMLParser):
    def __init__(self, *, target_index: int, target_href: str, replacement_text: str):
        super().__init__(convert_charrefs=False)
        self.target_index = target_index
        self.target_href = canonical_asset_url(target_href)
        self.replacement_text = replacement_text
        self.link_index = 0
        self.replacing_depth = 0
        self.parts: list[str] = []
        self.changed = False

    def sync_link_attrs(self, attrs: list[tuple[str, str | None]]) -> list[tuple[str, str | None]]:
        next_attrs = list(attrs)
        attr_names = {name.lower() for name, _ in next_attrs}
        if "aria-label" in attr_names:
            set_attr(next_attrs, "aria-label", self.replacement_text)
        if "title" in attr_names:
            set_attr(next_attrs, "title", self.replacement_text)
        return next_attrs

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if self.replacing_depth:
            self.replacing_depth += 1
            return
        if tag.lower() == "a":
            attr_map = {name.lower(): value or "" for name, value in attrs}
            href = canonical_asset_url(attr_map.get("href"))
            if href:
                self.link_index += 1
            if href and self.link_index == self.target_index and href == self.target_href:
                attrs = self.sync_link_attrs(attrs)
                self.parts.append(f"<{tag}{render_attrs(attrs)}>")
                self.parts.append(escape_html(self.replacement_text))
                self.replacing_depth = 1
                self.changed = True
                return
        self.parts.append(f"<{tag}{render_attrs(attrs)}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if not self.replacing_depth:
            self.parts.append(f"<{tag}{render_attrs(attrs)} />")

    def handle_endtag(self, tag: str):
        if self.replacing_depth:
            self.replacing_depth -= 1
            if self.replacing_depth == 0:
                self.parts.append(f"</{tag}>")
            return
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str):
        if not self.replacing_depth:
            self.parts.append(data)

    def handle_entityref(self, name: str):
        if not self.replacing_depth:
            self.parts.append(f"&{name};")

    def handle_charref(self, name: str):
        if not self.replacing_depth:
            self.parts.append(f"&#{name};")

    def handle_comment(self, data: str):
        if not self.replacing_depth:
            self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str):
        if not self.replacing_depth:
            self.parts.append(f"<!{decl}>")

    def result(self) -> str:
        return "".join(self.parts)


def apply_link_text_to_html(html_body: str, body: LinkTextApplyRequest) -> tuple[str, bool]:
    replacement_text = compact_whitespace(body.replacement_text)
    if not replacement_text:
        raise HTTPException(status_code=422, detail="Replacement link text is required")
    parser = LinkTextReplaceParser(
        target_index=body.link_index,
        target_href=body.href,
        replacement_text=replacement_text,
    )
    parser.feed(html_body or "")
    parser.close()
    return parser.result(), parser.changed


def list_session_links(
    *,
    session_id: str,
    user_id: str,
    limit: int,
    offset: int,
    q: str | None,
    status: Literal["all", "flagged", "good"],
) -> dict[str, Any]:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    items, body_by_item_id = fetch_session_items_and_bodies(
        supabase,
        session_id,
        user_id,
        EDITABLE_CONTENT_TYPES,
    )

    rows = build_link_inventory_rows(items, body_by_item_id)
    normalized_query = q.strip().lower() if q else ""
    filtered = []
    for row in rows:
        if status == "flagged" and not row["is_flagged"]:
            continue
        if status == "good" and row["is_flagged"]:
            continue

        haystack = " ".join([
            row.get("text") or "",
            row.get("href") or "",
            row.get("content_title") or "",
            row.get("module_name") or "",
        ]).lower()
        if normalized_query and normalized_query not in haystack:
            continue
        filtered.append(row)

    filtered.sort(
        key=lambda row: (
            0 if row["is_flagged"] else 1,
            row.get("content_title") or "",
            row.get("link_index") or 0,
        )
    )
    total_count = len(filtered)
    flagged_count = sum(1 for row in filtered if row["is_flagged"])

    return {
        "items": filtered[offset: offset + limit],
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
        "next_offset": offset + limit if offset + limit < total_count else None,
        "counts": {
            "all": total_count,
            "flagged": flagged_count,
            "good": total_count - flagged_count,
        },
    }


def suggest_session_link_text(
    *,
    session_id: str,
    user_id: str,
    body: LinkTextSuggestionRequest,
) -> dict[str, str]:
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="ASU AIML is not configured for this environment")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    item_result = supabase.table("course_content_items").select(
        "id, title, module_name"
    ).eq("id", body.content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")
    item = item_result.data[0]
    body_result = supabase.table("course_content_bodies").select(
        "html_body"
    ).eq("content_item_id", body.content_item_id).limit(1).execute()
    current_html = (body_result.data[0].get("html_body") if body_result.data else "") or ""
    link = find_link(current_html, body.link_index, body.href)
    if link and link.get("has_image") and not compact_whitespace(link.get("text")):
        raise HTTPException(status_code=422, detail="Image links should be fixed by editing the image alt text")
    suggestion = generate_link_text_suggestion(
        current_text=(link.get("accessible_name") if link else None) or body.text,
        href=body.href,
        content_title=item.get("title"),
        module_name=item.get("module_name"),
        surrounding_text=(link.get("surrounding_text") if link else None),
        before_text=body.before_text,
        after_text=body.after_text,
        html_context=body.html_context,
        selected_context=body.selected_context,
    )
    return {"suggested_text": suggestion}


def generate_bulk_link_text_suggestions_for_payload(
    supabase,
    *,
    job_id: str | None,
    session_id: str,
    user_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    body = BulkLinkTextSuggestionRequest(links=payload.get("links") or [])
    get_owned_session(supabase, session_id, user_id)
    content_item_ids = sorted({link.content_item_id for link in body.links})
    item_result = supabase.table("course_content_items").select(
        "id, title, module_name"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "id", content_item_ids
    ).execute()
    item_by_id = {item["id"]: item for item in item_result.data or []}
    html_by_item_id = fetch_content_html_by_item_id(supabase, content_item_ids)

    suggestions: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    requested_count = len(body.links)

    def update_progress(processed_count: int) -> None:
        if not job_id:
            return
        supabase.table("background_jobs").update({
            "result": {
                "status": "running",
                "requested_count": requested_count,
                "processed_count": processed_count,
                "suggestion_count": len(suggestions),
                "error_count": len(errors),
                "message": f"Generated suggestions for {processed_count} of {requested_count} links",
            }
        }).eq("id", job_id).execute()

    update_progress(0)
    for index, link_request in enumerate(body.links, start=1):
        key = {
            "content_item_id": link_request.content_item_id,
            "link_index": link_request.link_index,
            "href": link_request.href,
        }
        item = item_by_id.get(link_request.content_item_id)
        if not item:
            errors.append({**key, "detail": "Content item not found"})
            update_progress(index)
            continue
        current_html = html_by_item_id.get(link_request.content_item_id, "")
        link = find_link(current_html, link_request.link_index, link_request.href)
        if not link:
            errors.append({**key, "detail": "Matching link was not found in content HTML"})
            update_progress(index)
            continue
        if link.get("has_image") and not compact_whitespace(link.get("text")):
            errors.append({**key, "detail": "Image links should be fixed by editing the image alt text"})
            update_progress(index)
            continue
        try:
            suggested_text = generate_link_text_suggestion(
                current_text=link.get("accessible_name") or link_request.text,
                href=link_request.href,
                content_title=item.get("title"),
                module_name=item.get("module_name"),
                surrounding_text=link.get("surrounding_text"),
                before_text=link_request.before_text,
                after_text=link_request.after_text,
                html_context=link_request.html_context,
                selected_context=link_request.selected_context,
            )
        except Exception as exc:
            errors.append({**key, "detail": str(exc) or "Failed to suggest link text"})
            update_progress(index)
            continue
        suggestions.append({**key, "suggested_text": suggested_text})
        update_progress(index)

    return {
        "status": "succeeded",
        "requested_count": requested_count,
        "processed_count": requested_count,
        "suggestion_count": len(suggestions),
        "error_count": len(errors),
        "suggestions": suggestions,
        "errors": errors,
        "message": f"Generated {len(suggestions)} link text suggestion{'s' if len(suggestions) != 1 else ''}",
    }


def run_link_text_bulk_suggest_job(job_id: str, session_id: str, user_id: str) -> None:
    supabase = get_supabase()
    supabase.table("background_jobs").update({
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 1,
    }).eq("id", job_id).execute()
    try:
        payload_result = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        payload = payload_result.data[0].get("payload") if payload_result.data else {}
        result = generate_bulk_link_text_suggestions_for_payload(
            supabase,
            job_id=job_id,
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
        logger.exception("Bulk link text suggestion failed job_id=%s", job_id)
        supabase.table("background_jobs").update({
            "status": "failed",
            "error_message": str(exc),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()


def bulk_suggest_session_link_text(
    *,
    session_id: str,
    user_id: str,
    body: BulkLinkTextSuggestionRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="ASU AIML is not configured for this environment")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    links_payload = [
        link.model_dump() if hasattr(link, "model_dump") else link.dict()
        for link in body.links
    ]
    request_key = sha256_payload({
        "links": sorted(
            links_payload,
            key=lambda link: (
                str(link.get("content_item_id") or ""),
                int(link.get("link_index") or 0),
                str(link.get("href") or ""),
            ),
        )
    })
    try:
        enqueued = enqueue_background_job(
            supabase,
            user_id=user_id,
            session_id=session_id,
            job_type=LINK_TEXT_BULK_JOB_TYPE,
            payload={
                "session_id": session_id,
                "links": links_payload,
                "request_key": request_key,
                "requested_count": len(links_payload),
            },
            duplicate_fields=("request_key",),
            max_active_job_type_per_user=env_int("LINK_TEXT_BULK_MAX_ACTIVE_JOBS_PER_USER", 1),
        )
    except JobAdmissionError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    if enqueued.created:
        dispatch_background_task(background_tasks, run_link_text_bulk_suggest_job, enqueued.job["id"], session_id, user_id)

    return {
        "status": enqueued.job.get("status") or "queued",
        "job_id": enqueued.job["id"],
        "created": enqueued.created,
        "requested_count": len(links_payload),
        "result": enqueued.job.get("result"),
        "message": "Bulk link text suggestions queued. The worker will generate suggestions in the background.",
    }


def apply_session_link_text(
    *,
    session_id: str,
    user_id: str,
    body: LinkTextApplyRequest,
) -> dict[str, Any]:
    replacement_text = compact_whitespace(body.replacement_text)
    if not replacement_text:
        raise HTTPException(status_code=422, detail="Replacement link text is required")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    body_result = supabase.table("course_content_bodies").select(
        "html_body"
    ).eq("content_item_id", body.content_item_id).limit(1).execute()
    current_html = (body_result.data[0].get("html_body") if body_result.data else "") or ""
    link = find_link(current_html, body.link_index, body.href)
    if link and link.get("has_image") and not compact_whitespace(link.get("text")):
        raise HTTPException(status_code=422, detail="Image links should be fixed by editing the image alt text")
    next_html, changed = apply_link_text_to_html(current_html, body)
    if not changed:
        raise HTTPException(status_code=404, detail="Matching link was not found in content HTML")

    result = save_content_revision(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=body.content_item_id,
        next_html=next_html,
        change_summary=f"Applied link text suggestion - {replacement_text}",
    )
    return {
        "content_item_id": body.content_item_id,
        "link_index": body.link_index,
        "href": body.href,
        "replacement_text": replacement_text,
        "saved": result["saved"],
        "revision_number": result["revision_number"],
    }


def bulk_apply_session_link_text(
    *,
    session_id: str,
    user_id: str,
    body: BulkLinkTextApplyRequest,
) -> dict[str, Any]:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    grouped: dict[str, list[LinkTextApplyRequest]] = {}
    for link_request in body.links:
        replacement_text = compact_whitespace(link_request.replacement_text)
        if not replacement_text:
            raise HTTPException(status_code=422, detail="Replacement link text is required")
        grouped.setdefault(link_request.content_item_id, []).append(link_request)

    content_item_ids = sorted(grouped)
    html_by_item_id = fetch_content_html_by_item_id(supabase, content_item_ids)

    applied: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    revisions: list[dict[str, Any]] = []
    for content_item_id, link_requests in grouped.items():
        current_html = html_by_item_id.get(content_item_id, "")
        next_html = current_html
        applied_for_item: list[LinkTextApplyRequest] = []
        for link_request in link_requests:
            key = {
                "content_item_id": link_request.content_item_id,
                "link_index": link_request.link_index,
                "href": link_request.href,
            }
            link = find_link(next_html, link_request.link_index, link_request.href)
            if not link:
                errors.append({**key, "detail": "Matching link was not found in content HTML"})
                continue
            if link.get("has_image") and not compact_whitespace(link.get("text")):
                errors.append({**key, "detail": "Image links should be fixed by editing the image alt text"})
                continue
            next_html, changed = apply_link_text_to_html(next_html, link_request)
            if not changed:
                errors.append({**key, "detail": "Matching link was not found in content HTML"})
                continue
            applied_for_item.append(link_request)
            applied.append({**key, "replacement_text": compact_whitespace(link_request.replacement_text)})

        if not applied_for_item:
            continue

        summary_count = len(applied_for_item)
        result = save_content_revision(
            supabase,
            session_id=session_id,
            user_id=user_id,
            content_item_id=content_item_id,
            next_html=next_html,
            change_summary=f"Applied bulk link text suggestions - {summary_count} link{'s' if summary_count != 1 else ''}",
        )
        revisions.append({
            "content_item_id": content_item_id,
            "saved": result["saved"],
            "revision_number": result["revision_number"],
            "applied_count": summary_count,
        })

    return {
        "applied": applied,
        "errors": errors,
        "revisions": revisions,
    }
