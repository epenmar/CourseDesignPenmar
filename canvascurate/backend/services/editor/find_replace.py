"""Session-wide find and replace services for editable content."""

from __future__ import annotations

import re
from html import escape as escape_html
from html.parser import HTMLParser
from typing import Any

from fastapi import HTTPException

from api.editor.schemas import FindReplaceApplyRequest, FindReplaceSearchRequest
from content_inventory import compact_whitespace
from services.content_bodies import fetch_content_html_by_item_id
from services.content_revisions import save_content_revision
from services.document_records import get_owned_session
from supabase_client import get_supabase


def compile_find_replace_pattern(query: str, *, case_sensitive: bool) -> re.Pattern:
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(re.escape(query), flags)


def visible_text_contexts(html_body: str, pattern: re.Pattern, *, limit: int = 10) -> list[dict[str, str]]:
    class VisibleTextParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.skip_depth = 0
            self.parts: list[str] = []

        def handle_starttag(self, tag: str, attrs):
            if tag.lower() in {"script", "style", "noscript"}:
                self.skip_depth += 1

        def handle_endtag(self, tag: str):
            if tag.lower() in {"script", "style", "noscript"} and self.skip_depth:
                self.skip_depth -= 1

        def handle_data(self, data: str):
            if not self.skip_depth:
                self.parts.append(data)

    parser = VisibleTextParser()
    parser.feed(html_body or "")
    parser.close()
    text = compact_whitespace(" ".join(parser.parts))
    contexts: list[dict[str, str]] = []
    for match in pattern.finditer(text):
        start = max(0, match.start() - 60)
        end = min(len(text), match.end() + 60)
        contexts.append({
            "text": match.group(0),
            "context": f"{'...' if start > 0 else ''}{text[start:end]}{'...' if end < len(text) else ''}",
        })
        if len(contexts) >= limit:
            break
    return contexts


def replace_visible_text_in_html(html_body: str, pattern: re.Pattern, replacement: str) -> tuple[str, int]:
    class VisibleTextReplaceParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.skip_depth = 0
            self.replacement_count = 0
            self.parts: list[str] = []

        def handle_starttag(self, tag: str, attrs):
            if tag.lower() in {"script", "style", "noscript"}:
                self.skip_depth += 1
            self.parts.append(self.get_starttag_text() or f"<{tag}>")

        def handle_startendtag(self, tag: str, attrs):
            self.parts.append(self.get_starttag_text() or f"<{tag} />")

        def handle_endtag(self, tag: str):
            self.parts.append(f"</{tag}>")
            if tag.lower() in {"script", "style", "noscript"} and self.skip_depth:
                self.skip_depth -= 1

        def handle_data(self, data: str):
            if self.skip_depth:
                self.parts.append(data)
                return
            next_text, count = pattern.subn(lambda _match: replacement, data)
            self.replacement_count += count
            self.parts.append(escape_html(next_text, quote=False))

        def handle_entityref(self, name: str):
            self.parts.append(f"&{name};")

        def handle_charref(self, name: str):
            self.parts.append(f"&#{name};")

        def handle_comment(self, data: str):
            self.parts.append(f"<!--{data}-->")

        def handle_decl(self, decl: str):
            self.parts.append(f"<!{decl}>")

        def handle_pi(self, data: str):
            self.parts.append(f"<?{data}>")

        def result(self) -> str:
            return "".join(self.parts)

    parser = VisibleTextReplaceParser()
    parser.feed(html_body or "")
    parser.close()
    return parser.result(), parser.replacement_count


def search_session_find_replace(
    *,
    session_id: str,
    user_id: str,
    body: FindReplaceSearchRequest,
) -> dict[str, Any]:
    query_text = body.query.strip()
    if not query_text:
        raise HTTPException(status_code=422, detail="Find text is required")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    items_query = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, module_name, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).order("created_at", desc=False)
    if body.content_types:
        items_query = items_query.in_("content_type", body.content_types)
    items_result = items_query.limit(10000).execute()
    items = items_result.data or []
    if not items:
        return {"items": [], "total_items": 0, "total_matches": 0}

    item_ids = [item["id"] for item in items]
    html_by_item_id = fetch_content_html_by_item_id(supabase, item_ids)

    pattern = compile_find_replace_pattern(query_text, case_sensitive=body.case_sensitive)
    results: list[dict[str, Any]] = []
    total_matches = 0
    for item in items:
        html_body = html_by_item_id.get(item["id"], "")
        contexts = visible_text_contexts(html_body, pattern, limit=10)
        if not contexts:
            continue
        all_contexts = visible_text_contexts(html_body, pattern, limit=10000)
        match_count = len(all_contexts)
        total_matches += match_count
        results.append({
            "content_item_id": item["id"],
            "canvas_id": item.get("canvas_id"),
            "content_type": item.get("content_type"),
            "title": item.get("title"),
            "canvas_url": item.get("canvas_url"),
            "module_name": item.get("module_name"),
            "match_count": match_count,
            "matches": contexts,
        })

    return {
        "items": results,
        "total_items": len(results),
        "total_matches": total_matches,
    }


def apply_session_find_replace(
    *,
    session_id: str,
    user_id: str,
    body: FindReplaceApplyRequest,
) -> dict[str, Any]:
    query_text = body.query.strip()
    if not query_text:
        raise HTTPException(status_code=422, detail="Find text is required")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)
    item_ids = sorted(set(body.content_item_ids))
    items_result = supabase.table("course_content_items").select(
        "id, title"
    ).eq("session_id", session_id).eq("user_id", user_id).in_("id", item_ids).execute()
    found_items = {row["id"]: row for row in items_result.data or []}
    if len(found_items) != len(item_ids):
        raise HTTPException(status_code=404, detail="One or more selected content items were not found")

    html_by_item_id = fetch_content_html_by_item_id(supabase, item_ids)

    pattern = compile_find_replace_pattern(query_text, case_sensitive=body.case_sensitive)
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    total_replacements = 0
    for content_item_id in item_ids:
        current_html = html_by_item_id.get(content_item_id, "")
        next_html, replacement_count = replace_visible_text_in_html(current_html, pattern, body.replacement)
        if replacement_count <= 0:
            skipped.append({
                "content_item_id": content_item_id,
                "detail": "No matching visible text found",
            })
            continue

        summary = f"Global find & replace - {replacement_count} match{'es' if replacement_count != 1 else ''}: {query_text}"
        result = save_content_revision(
            supabase,
            session_id=session_id,
            user_id=user_id,
            content_item_id=content_item_id,
            next_html=next_html,
            change_summary=summary,
        )
        applied.append({
            "content_item_id": content_item_id,
            "title": found_items[content_item_id].get("title"),
            "replacement_count": replacement_count,
            "saved": result["saved"],
            "revision_number": result["revision_number"],
        })
        total_replacements += replacement_count

    return {
        "applied": applied,
        "skipped": skipped,
        "items_modified": len([item for item in applied if item.get("saved")]),
        "total_replacements": total_replacements,
    }
