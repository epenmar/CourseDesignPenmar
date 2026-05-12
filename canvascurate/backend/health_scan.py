import html
import logging
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any

from services.content_bodies import fetch_content_html_by_item_id
from services.alt_text_validator import alt_issue_label, classify_alt_text
from supabase_client import get_supabase

logger = logging.getLogger(__name__)


AUDITABLE_TYPES = {"page", "assignment", "discussion", "quiz", "quiz_question"}
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


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_title(value: str | None) -> str:
    if not value:
        return ""
    normalized = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", normalized)


def chunked(rows: list[dict[str, Any]], size: int = 100):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


class HTMLAuditParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images: list[dict[str, Any]] = []
        self.links: list[dict[str, Any]] = []
        self.headings: list[dict[str, Any]] = []
        self.tables: list[dict[str, Any]] = []
        self._link_stack: list[dict[str, Any]] = []
        self._heading_stack: list[dict[str, Any]] = []
        self._table_stack: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        attr_map = {name.lower(): value or "" for name, value in attrs}
        lowered = tag.lower()

        if lowered == "img":
            self.images.append({
                "src": attr_map.get("src", ""),
                "alt": attr_map.get("alt"),
                "display_name": attr_map.get("data-display-name") or attr_map.get("title") or attr_map.get("aria-label"),
                "role": attr_map.get("role"),
                "aria_hidden": attr_map.get("aria-hidden"),
            })
        elif lowered == "a":
            self._link_stack.append({"href": attr_map.get("href", ""), "text": []})
        elif lowered in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._heading_stack.append({"tag": lowered, "level": int(lowered[1]), "text": []})
        elif lowered == "table":
            self._table_stack.append({"has_th": False})
        elif lowered == "th" and self._table_stack:
            self._table_stack[-1]["has_th"] = True

    def handle_data(self, data: str):
        if self._link_stack:
            self._link_stack[-1]["text"].append(data)
        if self._heading_stack:
            self._heading_stack[-1]["text"].append(data)

    def handle_endtag(self, tag: str):
        lowered = tag.lower()
        if lowered == "a" and self._link_stack:
            link = self._link_stack.pop()
            text = html.unescape(" ".join(link["text"]))
            self.links.append({
                "href": link["href"],
                "text": re.sub(r"\s+", " ", text).strip(),
            })
        elif lowered in {"h1", "h2", "h3", "h4", "h5", "h6"} and self._heading_stack:
            heading = self._heading_stack.pop()
            text = html.unescape(" ".join(heading["text"]))
            self.headings.append({
                "tag": heading["tag"],
                "level": heading["level"],
                "text": re.sub(r"\s+", " ", text).strip(),
            })
        elif lowered == "table" and self._table_stack:
            self.tables.append(self._table_stack.pop())


def audit_html(item: dict[str, Any], html_body: str | None) -> list[dict[str, Any]]:
    if not html_body or item.get("content_type") not in AUDITABLE_TYPES:
        return []

    parser = HTMLAuditParser()
    parser.feed(html_body)
    findings: list[dict[str, Any]] = []
    title = item.get("title") or "Untitled"

    for index, image in enumerate(parser.images, start=1):
        alt = image.get("alt")
        if (image.get("role") or "").lower() == "presentation" and not (alt or "").strip():
            continue
        if (image.get("aria_hidden") or "").lower() == "true":
            continue
        alt_issue_code = classify_alt_text(
            alt,
            image.get("display_name"),
            image.get("src"),
        )
        if alt_issue_code:
            findings.append({
                "content_item_id": item["id"],
                "finding_type": "wcag",
                "finding_code": alt_issue_code,
                "severity": "warning",
                "description": f"{title} has an image issue: {alt_issue_label(alt_issue_code) or 'Alt text needs review'}.",
                "context": {
                    "image_index": index,
                    "src": image.get("src", ""),
                    "alt": alt or "",
                    "display_name": image.get("display_name") or "",
                },
            })

    for index, link in enumerate(parser.links, start=1):
        link_text = link.get("text", "").strip()
        href = link.get("href", "")
        normalized = link_text.lower()
        if not link_text:
            findings.append({
                "content_item_id": item["id"],
                "finding_type": "wcag",
                "finding_code": "empty_link_text",
                "severity": "critical",
                "description": f"{title} has a link with no readable text.",
                "context": {"link_index": index, "href": href},
            })
        elif normalized in GENERIC_LINK_TEXT or normalized == href.lower():
            findings.append({
                "content_item_id": item["id"],
                "finding_type": "wcag",
                "finding_code": "generic_link_text",
                "severity": "warning",
                "description": f"{title} has vague link text: \"{link_text}\".",
                "context": {"link_index": index, "href": href, "text": link_text},
            })

    previous_level: int | None = None
    for index, heading in enumerate(parser.headings, start=1):
        level = int(heading["level"])
        text = heading.get("text", "")
        if not text:
            findings.append({
                "content_item_id": item["id"],
                "finding_type": "wcag",
                "finding_code": "empty_heading",
                "severity": "warning",
                "description": f"{title} has an empty {heading['tag'].upper()} heading.",
                "context": {"heading_index": index, "tag": heading["tag"]},
            })
        if previous_level is not None and level > previous_level + 1:
            findings.append({
                "content_item_id": item["id"],
                "finding_type": "wcag",
                "finding_code": "skipped_heading_level",
                "severity": "warning",
                "description": f"{title} skips from H{previous_level} to H{level}.",
                "context": {"heading_index": index, "from": previous_level, "to": level, "text": text},
            })
        previous_level = level

    for index, table in enumerate(parser.tables, start=1):
        if not table.get("has_th"):
            findings.append({
                "content_item_id": item["id"],
                "finding_type": "wcag",
                "finding_code": "table_missing_header",
                "severity": "warning",
                "description": f"{title} has a table without header cells.",
                "context": {"table_index": index},
            })

    return findings


def duplicate_group_updates(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        title_key = normalize_title(item.get("title"))
        body_hash = item.get("body_hash")
        if not title_key or not body_hash:
            continue
        grouped[f"{title_key}:{body_hash}"].append(item)

    next_keys: dict[str, str | None] = {item["id"]: None for item in items}
    duplicate_findings: list[dict[str, Any]] = []
    for group_key, group_items in grouped.items():
        if len(group_items) < 2:
            continue
        for item in group_items:
            next_keys[item["id"]] = group_key
            duplicate_findings.append({
                "content_item_id": item["id"],
                "finding_type": "inventory",
                "finding_code": "duplicate_content",
                "severity": "warning",
                "description": f"{item.get('title') or 'Untitled'} appears to duplicate another content item.",
                "context": {"duplicate_group_key": group_key, "duplicate_count": len(group_items)},
            })

    updates = [
        {"id": item["id"], "duplicate_group_key": next_keys[item["id"]]}
        for item in items
        if item.get("duplicate_group_key") != next_keys[item["id"]]
    ]
    return updates, duplicate_findings


def run_health_scan_job(job_id: str, health_run_id: str, session_id: str, user_id: str):
    supabase = get_supabase()
    started = time.monotonic()
    started_at = utc_now_iso()
    current_stage = "initializing"

    try:
        current_stage = "starting"
        supabase.table("background_jobs").update({
            "status": "running",
            "attempts": 1,
            "started_at": started_at,
        }).eq("id", job_id).execute()
        supabase.table("health_runs").update({
            "status": "running",
        }).eq("id", health_run_id).execute()

        current_stage = "loading_content_items"
        items_result = supabase.table("course_content_items").select(
            "id, canvas_id, content_type, title, canvas_url, published, module_name, "
            "body_hash, is_orphaned, duplicate_group_key, metadata"
        ).eq("session_id", session_id).eq("user_id", user_id).execute()
        items = items_result.data or []

        current_stage = "loading_content_bodies"
        item_ids = [item["id"] for item in items if item.get("id")]
        bodies = fetch_content_html_by_item_id(supabase, item_ids)

        current_stage = "checking_duplicates"
        duplicate_updates, duplicate_findings = duplicate_group_updates(items)
        for update in duplicate_updates:
            supabase.table("course_content_items").update({
                "duplicate_group_key": update["duplicate_group_key"],
                "updated_at": utc_now_iso(),
            }).eq("id", update["id"]).execute()

        findings: list[dict[str, Any]] = []
        findings.extend(duplicate_findings)

        current_stage = "auditing_html"
        for item in items:
            title = item.get("title") or "Untitled"
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            linked_from = metadata.get("linked_from") if isinstance(metadata.get("linked_from"), list) else []
            if item.get("is_orphaned") and not linked_from and item.get("content_type") not in {"module", "module_item", "quiz_question"}:
                findings.append({
                    "content_item_id": item["id"],
                    "finding_type": "inventory",
                    "finding_code": "orphaned_content",
                    "severity": "warning",
                    "description": f"{title} is published in the course inventory but is not linked from a module.",
                    "context": {"content_type": item.get("content_type"), "canvas_url": item.get("canvas_url")},
                })
            if item.get("published") is False:
                findings.append({
                    "content_item_id": item["id"],
                    "finding_type": "inventory",
                    "finding_code": "unpublished_content",
                    "severity": "info",
                    "description": f"{title} is unpublished in Canvas.",
                    "context": {"content_type": item.get("content_type"), "canvas_url": item.get("canvas_url")},
                })
            findings.extend(audit_html(item, bodies.get(item["id"])))

        rows_to_insert = [
            {
                "health_run_id": health_run_id,
                "session_id": session_id,
                "content_item_id": finding.get("content_item_id"),
                "finding_type": finding["finding_type"],
                "finding_code": finding.get("finding_code"),
                "severity": finding["severity"],
                "description": finding.get("description"),
                "context": finding.get("context") or {},
            }
            for finding in findings
        ]

        current_stage = "saving_findings"
        for chunk in chunked(rows_to_insert):
            supabase.table("health_findings").insert(chunk).execute()

        by_severity = Counter(row["severity"] for row in rows_to_insert)
        by_code = Counter(row["finding_code"] for row in rows_to_insert)
        summary = {
            "total_findings": len(rows_to_insert),
            "by_severity": dict(by_severity),
            "by_code": dict(by_code),
            "duplicate_groups_updated": len(duplicate_updates),
        }
        finished_at = utc_now_iso()
        duration_ms = int((time.monotonic() - started) * 1000)

        current_stage = "finalizing"
        supabase.table("health_runs").update({
            "status": "succeeded",
            "items_scanned": len(items),
            "duration_ms": duration_ms,
            "summary": summary,
            "finished_at": finished_at,
        }).eq("id", health_run_id).execute()
        supabase.table("background_jobs").update({
            "status": "succeeded",
            "finished_at": finished_at,
            "result": {
                "health_run_id": health_run_id,
                "items_scanned": len(items),
                "findings_count": len(rows_to_insert),
                "duration_ms": duration_ms,
            },
        }).eq("id", job_id).execute()
    except Exception as exc:
        finished_at = utc_now_iso()
        logger.exception(
            "Health scan failed job_id=%s health_run_id=%s session_id=%s stage=%s",
            job_id,
            health_run_id,
            session_id,
            current_stage,
        )
        message = f"{current_stage}: {exc}"
        duration_ms = int((time.monotonic() - started) * 1000)
        supabase.table("health_runs").update({
            "status": "failed",
            "duration_ms": duration_ms,
            "finished_at": finished_at,
            "summary": {"error": message},
        }).eq("id", health_run_id).execute()
        supabase.table("background_jobs").update({
            "status": "failed",
            "finished_at": finished_at,
            "error_message": message,
            "result": {"health_run_id": health_run_id, "duration_ms": duration_ms},
        }).eq("id", job_id).execute()
