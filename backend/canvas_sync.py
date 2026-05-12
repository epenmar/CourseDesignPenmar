import hashlib
import html
import json
import logging
import math
import os
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any, Callable
from urllib.parse import unquote, urlparse

import httpx

from canvas_hosts import canvas_base_url_aliases
from content_inventory import build_image_inventory_rows
from encryption import decrypt
from image_proxy import prewarm_image_thumb
from r2_storage import is_r2_configured
from services.content_bodies import fetch_content_html_by_item_id
from supabase_client import get_supabase

logger = logging.getLogger(__name__)

INVALID_TEXT_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


CANVAS_CONTENT_TYPES = {
    "Page": "page",
    "Assignment": "assignment",
    "NewQuiz": "quiz",
    "Discussion": "discussion",
    "Quiz": "quiz",
    "File": "file",
}

TYPE_LABELS = {
    "page": "Page",
    "assignment": "Assignment",
    "discussion": "Discussion",
    "quiz": "Quiz",
    "file": "File",
}


class PlainTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str):
        if data.strip():
            self.parts.append(data.strip())

    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.parts)).strip()


class ReferenceParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.values: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        for name, value in attrs:
            if not value:
                continue
            lowered = name.lower()
            if lowered in {"href", "src", "data-api-endpoint"}:
                self.values.append(value)


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    parser = PlainTextParser()
    parser.feed(value)
    return html.unescape(parser.text())


def word_count(value: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", value))


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_payload(payload: dict[str, Any]) -> str:
    serialized = json.dumps(json_safe(payload), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def clean_text_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return INVALID_TEXT_CHARS.sub("", value)


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(clean_text_value(key)): json_safe(item)
            for key, item in value.items()
            if item is not None
        }
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, set):
        return [json_safe(item) for item in value]
    if isinstance(value, str):
        return clean_text_value(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return str(value)


def clean_metadata(value: dict[str, Any]) -> dict[str, Any]:
    safe_value = json_safe(value)
    return safe_value if isinstance(safe_value, dict) else {}


QUIZ_ANSWER_FIELDS = (
    "id",
    "text",
    "html",
    "weight",
    "blank_id",
    "left",
    "right",
    "match_id",
    "numerical_answer_type",
    "exact",
    "margin",
)


def quiz_question_canvas_id(quiz_id: str | int, question_id: str | int) -> str:
    return f"quiz:{quiz_id}:question:{question_id}"


def quiz_question_html(question: dict[str, Any]) -> str:
    parts = [question.get("question_text") or ""]
    answers = question.get("answers") or []
    if answers:
        parts.append("<ol>")
        for answer in answers:
            if not isinstance(answer, dict):
                continue
            answer_html = answer.get("html") or answer.get("text") or answer.get("left") or answer.get("right")
            if answer_html is None and answer.get("exact") is not None:
                answer_html = str(answer.get("exact"))
            parts.append(f"<li>{answer_html or ''}</li>")
        parts.append("</ol>")
    return "\n".join(parts)


def quiz_answer_metadata(answers: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        {key: answer[key] for key in QUIZ_ANSWER_FIELDS if key in answer}
        for answer in (answers or [])
        if isinstance(answer, dict)
    ]


def chunks(rows: list[dict[str, Any]], size: int = 200):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def reference_keys_from_url(raw_url: str, canvas_course_id: str) -> set[tuple[str, str]]:
    if not raw_url:
        return set()

    parsed = urlparse(raw_url)
    path = unquote(parsed.path or raw_url).strip("/")
    parts = [part for part in path.split("/") if part]
    if not parts:
        return set()

    if "courses" in parts:
        course_index = parts.index("courses")
        if len(parts) <= course_index + 2 or str(parts[course_index + 1]) != str(canvas_course_id):
            return set()
        parts = parts[course_index + 2:]

    if len(parts) < 2:
        return set()

    section, identifier = parts[0], parts[1]
    if section == "pages":
        return {("page", identifier)}
    if section == "assignments":
        return {("assignment", identifier)}
    if section == "discussion_topics":
        return {("discussion", identifier)}
    if section == "quizzes":
        return {("quiz", identifier)}
    if section == "files":
        match = re.match(r"(\d+)", identifier)
        return {("file", match.group(1) if match else identifier)}

    return set()


def reference_keys_from_html(html_body: str, canvas_course_id: str) -> set[tuple[str, str]]:
    if not html_body:
        return set()

    parser = ReferenceParser()
    parser.feed(html_body)
    keys: set[tuple[str, str]] = set()
    for value in parser.values:
        keys.update(reference_keys_from_url(value, canvas_course_id))
    return keys


def add_reference(target_refs: dict[int, set[str]], target_index: int, label: str):
    if label:
        target_refs.setdefault(target_index, set()).add(label)


def reference_label(item: dict[str, Any]) -> str:
    if item.get("module_name"):
        return str(item["module_name"])
    content_type = TYPE_LABELS.get(item.get("content_type"), "Content")
    return f"{content_type}: {item.get('title') or 'Untitled'}"


def build_item_aliases(item: dict[str, Any]) -> set[tuple[str, str]]:
    content_type = str(item.get("content_type"))
    aliases = {(content_type, str(item.get("canvas_id")))}
    metadata = item.get("metadata") or {}
    if content_type == "page" and metadata.get("url"):
        aliases.add(("page", str(metadata["url"])))
    if content_type in {"discussion", "quiz"}:
        assignment_id = metadata.get("assignment_id") or metadata.get("assignment_shell_canvas_id")
        if assignment_id:
            aliases.add(("assignment", str(assignment_id)))
    if content_type == "file":
        filename = metadata.get("filename") or item.get("title")
        if filename:
            aliases.add(("file_name", str(filename).lower()))
    return aliases


def is_quiz_assignment(assignment: dict[str, Any]) -> bool:
    return bool(assignment.get("is_quiz_assignment"))


def assignment_discussion_topic_id(assignment: dict[str, Any]) -> str:
    discussion_topic_id = assignment.get("discussion_topic_id")
    if discussion_topic_id:
        return str(discussion_topic_id)
    discussion_topic = assignment.get("discussion_topic")
    if isinstance(discussion_topic, dict) and discussion_topic.get("id"):
        return str(discussion_topic["id"])
    return ""


def is_discussion_assignment(assignment: dict[str, Any]) -> bool:
    submission_types = assignment.get("submission_types")
    return bool(
        assignment_discussion_topic_id(assignment)
        or assignment.get("discussion_topic")
        or (isinstance(submission_types, list) and "discussion_topic" in submission_types)
    )


def module_item_matches_assignment(module_item: dict[str, Any], canvas_assignment_id: str) -> bool:
    if module_item.get("canvas_content_id") == canvas_assignment_id:
        return True
    html_url = str(module_item.get("html_url") or "")
    external_url = str(module_item.get("external_url") or "")
    return f"/assignments/{canvas_assignment_id}" in html_url or f"/assignments/{canvas_assignment_id}" in external_url


def mark_activity_assignment_module_items(
    module_items: list[dict[str, Any]],
    canvas_assignment_id: str,
    activity_content_type: str,
    activity_canvas_id: str | None = None,
):
    for module_item in module_items:
        if module_item_matches_assignment(module_item, canvas_assignment_id):
            module_item["content_type"] = activity_content_type
            metadata = dict(module_item.get("metadata") or {})
            metadata["source_content_type"] = "assignment"
            metadata["assignment_id"] = canvas_assignment_id
            if activity_content_type == "quiz" and activity_canvas_id:
                metadata["quiz_id"] = activity_canvas_id
            if activity_content_type == "discussion" and activity_canvas_id:
                metadata["discussion_topic_id"] = activity_canvas_id
            module_item["metadata"] = metadata


def apply_references(
    items: list[dict[str, Any]],
    module_references: dict[tuple[str, str], list[str]],
    canvas_course_id: str,
) -> list[dict[str, Any]]:
    alias_to_indexes: dict[tuple[str, str], list[int]] = {}
    for index, item in enumerate(items):
        for alias in build_item_aliases(item):
            alias_to_indexes.setdefault(alias, []).append(index)

    refs_by_index: dict[int, set[str]] = {}
    for key, labels in module_references.items():
        for target_index in alias_to_indexes.get(key, []):
            for label in labels:
                add_reference(refs_by_index, target_index, label)

    source_items = [
        (index, item)
        for index, item in enumerate(items)
        if item.get("module_canvas_id") or (item.get("metadata") or {}).get("front_page")
    ]

    file_aliases = {
        alias: indexes
        for alias, indexes in alias_to_indexes.items()
        if alias[0] == "file_name"
    }
    for source_index, source in source_items:
        html_body = source.get("html_body") or ""
        if not html_body:
            continue
        label = reference_label(source)
        for key in reference_keys_from_html(html_body, canvas_course_id):
            for target_index in alias_to_indexes.get(key, []):
                if target_index != source_index:
                    add_reference(refs_by_index, target_index, label)

        lowered_html = html_body.lower()
        for alias, target_indexes in file_aliases.items():
            filename = alias[1]
            if filename and filename in lowered_html:
                for target_index in target_indexes:
                    if target_index != source_index:
                        add_reference(refs_by_index, target_index, label)

    for index, labels in refs_by_index.items():
        metadata = dict(items[index].get("metadata") or {})
        existing = metadata.get("linked_from") if isinstance(metadata.get("linked_from"), list) else []
        merged = sorted({*(str(value) for value in existing), *labels})
        metadata["linked_from"] = merged
        items[index]["metadata"] = metadata

    return items


def emit_sync_progress(
    supabase,
    job_id: str,
    stage: str,
    message: str,
    progress: int,
    *,
    fetched_count: int = 0,
    changed_count: int = 0,
    sync_run_id: str | None = None,
):
    result: dict[str, Any] = {
        "stage": stage,
        "message": message,
        "progress": max(0, min(progress, 100)),
        "fetched_count": fetched_count,
        "changed_count": changed_count,
    }
    if sync_run_id:
        result["sync_run_id"] = sync_run_id
    supabase.table("background_jobs").update({"result": result}).eq("id", job_id).execute()


class CanvasClient:
    def __init__(self, canvas_base_url: str, token: str):
        self.base_url = canvas_base_url.rstrip("/")
        self.client = httpx.Client(
            base_url=f"{self.base_url}/api/v1",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=30.0,
            follow_redirects=True,
        )

    def close(self):
        self.client.close()

    def get_paginated(self, path: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        next_url: str | None = path
        next_params = {"per_page": 100, **(params or {})}

        while next_url:
            if next_url.startswith("http"):
                response = self.client.get(next_url)
            else:
                response = self.client.get(next_url, params=next_params)
            response.raise_for_status()
            data = response.json()
            if isinstance(data, list):
                rows.extend(data)
            else:
                rows.append(data)
            next_url = response.links.get("next", {}).get("url")
            next_params = None

        return rows

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self.client.get(path, params=params)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError(f"Canvas response for {path} was not an object")
        return data

    def put_form(self, path: str, data: dict[str, Any]) -> dict[str, Any]:
        response = self.client.put(path, data=data)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Canvas response for {path} was not an object")
        return payload

    def post_form(self, path: str, data: dict[str, Any]) -> dict[str, Any]:
        response = self.client.post(path, data=data)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Canvas response for {path} was not an object")
        return payload

    def patch_form(self, path: str, data: dict[str, Any]) -> dict[str, Any]:
        response = self.client.patch(path, data=data)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Canvas response for {path} was not an object")
        return payload

    def post_json(self, path: str, data: dict[str, Any]) -> dict[str, Any]:
        response = self.client.post(path, json=data)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Canvas response for {path} was not an object")
        return payload

    def put_json(self, path: str, data: dict[str, Any]) -> dict[str, Any]:
        response = self.client.put(path, json=data)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Canvas response for {path} was not an object")
        return payload

    def delete(self, path: str) -> dict[str, Any]:
        response = self.client.delete(path)
        response.raise_for_status()
        if not response.content:
            return {}
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Canvas response for {path} was not an object")
        return payload


def module_lookup(
    client: CanvasClient,
    canvas_course_id: str,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[tuple[str, str], dict[str, Any]],
    dict[tuple[str, str], list[str]],
]:
    modules = client.get_paginated(
        f"/courses/{canvas_course_id}/modules",
        {"include[]": "items"},
    )
    module_rows: list[dict[str, Any]] = []
    module_item_rows: list[dict[str, Any]] = []
    lookup: dict[tuple[str, str], dict[str, Any]] = {}
    module_references: dict[tuple[str, str], list[str]] = {}

    for module in modules:
        module_id = str(module.get("id", ""))
        if not module_id:
            continue
        module_rows.append({
            "canvas_module_id": module_id,
            "name": module.get("name") or f"Module {module_id}",
            "position": module.get("position"),
            "published": module.get("published"),
            "workflow_state": module.get("workflow_state"),
            "items_count": module.get("items_count"),
            "unlock_at": module.get("unlock_at"),
            "require_sequential_progress": module.get("require_sequential_progress"),
            "metadata": clean_metadata({
                "prerequisite_module_ids": module.get("prerequisite_module_ids"),
                "publish_final_grade": module.get("publish_final_grade"),
                "requirement_count": module.get("requirement_count"),
            }),
        })
        items = module.get("items")
        if not isinstance(items, list):
            items = client.get_paginated(f"/courses/{canvas_course_id}/modules/{module_id}/items")
        for item in items:
            canvas_type = str(item.get("type") or "")
            content_type = CANVAS_CONTENT_TYPES.get(canvas_type)
            content_id = item.get("content_id") or item.get("page_url")
            module_name = module.get("name") or f"Module {module_id}"
            module_item_id = item.get("id")
            if module_item_id is not None:
                module_item_rows.append({
                    "canvas_module_id": module_id,
                    "canvas_module_item_id": str(module_item_id),
                    "canvas_content_id": str(item.get("content_id")) if item.get("content_id") is not None else None,
                    "page_url": item.get("page_url"),
                    "title": item.get("title"),
                    "module_item_type": canvas_type or None,
                    "content_type": content_type,
                    "position": item.get("position"),
                    "indent": item.get("indent") or 0,
                    "published": item.get("published"),
                    "completion_requirement": item.get("completion_requirement") or {},
                    "html_url": item.get("html_url"),
                    "external_url": item.get("external_url"),
                    "new_tab": item.get("new_tab"),
                    "metadata": clean_metadata({
                        "url": item.get("url"),
                        "content_details": item.get("content_details"),
                        "module_name": module_name,
                    }),
                })
            if not content_type or content_id is None:
                for candidate in [item.get("external_url"), item.get("html_url"), item.get("url")]:
                    for key in reference_keys_from_url(str(candidate or ""), canvas_course_id):
                        labels = module_references.setdefault(key, [])
                        if module_name not in labels:
                            labels.append(module_name)
            else:
                lookup[(content_type, str(content_id))] = {
                    "module_canvas_id": module_id,
                    "module_name": module.get("name"),
                    "position": item.get("position"),
                    "module_item_canvas_id": str(module_item_id) if module_item_id is not None else None,
                    "module_item_type": canvas_type or None,
                    "module_item_indent": item.get("indent") or 0,
                    "module_item_published": item.get("published"),
                    "module_item_completion_requirement": item.get("completion_requirement") or {},
                }

    return module_rows, module_item_rows, lookup, module_references


def normalize_items(
    client: CanvasClient,
    canvas_base_url: str,
    canvas_course_id: str,
    progress_callback: Callable[[str, str, int], None] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    if progress_callback:
        progress_callback("modules", "Reading Canvas modules and placements", 18)
    modules, module_items, modules_by_content, module_references = module_lookup(client, canvas_course_id)
    items: list[dict[str, Any]] = []

    for module in modules:
        module_id = module["canvas_module_id"]
        title = module.get("name") or f"Module {module_id}"
        metadata = clean_metadata({
            "workflow_state": module.get("workflow_state"),
            "items_count": module.get("items_count"),
            "unlock_at": module.get("unlock_at"),
            "require_sequential_progress": module.get("require_sequential_progress"),
        })
        items.append({
            "canvas_id": module_id,
            "content_type": "module",
            "title": title,
            "canvas_url": f"{canvas_base_url}/courses/{canvas_course_id}/modules/{module_id}",
            "published": module.get("published"),
            "position": module.get("position"),
            "html_body": "",
            "metadata": metadata,
            "last_canvas_edit_at": None,
        })

    if progress_callback:
        progress_callback("content", "Fetching Canvas pages", 30)
    pages = client.get_paginated(f"/courses/{canvas_course_id}/pages")
    for page in pages:
        page_url = page.get("url")
        detail = page
        if page_url:
            detail = client.get(f"/courses/{canvas_course_id}/pages/{page_url}")
        canvas_id = str(detail.get("page_id") or detail.get("url"))
        html_body = detail.get("body") or ""
        items.append({
            "canvas_id": canvas_id,
            "content_type": "page",
            "title": detail.get("title") or "Untitled page",
            "canvas_url": detail.get("html_url"),
            "published": detail.get("published"),
            "html_body": html_body,
            "metadata": clean_metadata({
                "url": detail.get("url"),
                "editing_roles": detail.get("editing_roles"),
                "front_page": detail.get("front_page"),
                "todo_date": detail.get("todo_date"),
            }),
            "last_canvas_edit_at": detail.get("updated_at"),
            **modules_by_content.get(("page", str(detail.get("url"))), {}),
        })

    if progress_callback:
        progress_callback("content", "Fetching Canvas assignments", 42)
    assignments = client.get_paginated(f"/courses/{canvas_course_id}/assignments")
    discussion_assignment_shells_by_assignment_id: dict[str, dict[str, Any]] = {}
    discussion_assignment_shells_by_discussion_id: dict[str, dict[str, Any]] = {}
    quiz_assignment_shells_by_quiz_id: dict[str, dict[str, Any]] = {}
    for assignment in assignments:
        canvas_id = str(assignment.get("id"))
        if is_quiz_assignment(assignment):
            quiz_id = str(assignment.get("quiz_id") or "")
            if quiz_id:
                quiz_assignment_shells_by_quiz_id[quiz_id] = assignment
            mark_activity_assignment_module_items(module_items, canvas_id, "quiz", quiz_id or None)
            continue
        discussion_topic_id = assignment_discussion_topic_id(assignment)
        if is_discussion_assignment(assignment):
            discussion_assignment_shells_by_assignment_id[canvas_id] = assignment
            if discussion_topic_id:
                discussion_assignment_shells_by_discussion_id[discussion_topic_id] = assignment
            mark_activity_assignment_module_items(module_items, canvas_id, "discussion", discussion_topic_id or None)
            continue

        html_body = assignment.get("description") or ""
        items.append({
            "canvas_id": canvas_id,
            "content_type": "assignment",
            "title": assignment.get("name") or "Untitled assignment",
            "canvas_url": assignment.get("html_url"),
            "published": assignment.get("published"),
            "html_body": html_body,
            "metadata": clean_metadata({
                "discussion_topic_id": assignment.get("discussion_topic_id"),
                "discussion_topic": assignment.get("discussion_topic"),
                "quiz_id": assignment.get("quiz_id"),
                "is_quiz_assignment": assignment.get("is_quiz_assignment"),
                "due_at": assignment.get("due_at"),
                "points_possible": assignment.get("points_possible"),
                "submission_types": assignment.get("submission_types"),
                "workflow_state": assignment.get("workflow_state"),
            }),
            "last_canvas_edit_at": assignment.get("updated_at"),
            **modules_by_content.get(("assignment", canvas_id), {}),
        })

    if progress_callback:
        progress_callback("content", "Fetching Canvas discussions", 54)
    discussions = client.get_paginated(f"/courses/{canvas_course_id}/discussion_topics")
    for discussion in discussions:
        canvas_id = str(discussion.get("id"))
        discussion_assignment_id = str(discussion.get("assignment_id") or "")
        shell = (
            discussion_assignment_shells_by_discussion_id.get(canvas_id)
            or discussion_assignment_shells_by_assignment_id.get(discussion_assignment_id)
            or {}
        )
        assignment_id = str(discussion_assignment_id or shell.get("id") or "")
        html_body = discussion.get("message") or ""
        module_placement = modules_by_content.get(("discussion", canvas_id)) or (
            modules_by_content.get(("assignment", assignment_id), {}) if assignment_id else {}
        )
        items.append({
            "canvas_id": canvas_id,
            "content_type": "discussion",
            "title": discussion.get("title") or "Untitled discussion",
            "canvas_url": discussion.get("html_url"),
            "published": discussion.get("published"),
            "html_body": html_body,
            "metadata": clean_metadata({
                "assignment_id": assignment_id or None,
                "assignment_shell_canvas_id": assignment_id or None,
                "assignment_shell_html_url": shell.get("html_url"),
                "assignment_shell_updated_at": shell.get("updated_at"),
                "assignment_shell_points_possible": shell.get("points_possible"),
                "assignment_shell_submission_types": shell.get("submission_types"),
                "is_discussion_assignment": bool(shell),
                "discussion_type": discussion.get("discussion_type"),
                "posted_at": discussion.get("posted_at"),
                "workflow_state": discussion.get("workflow_state"),
                "locked": discussion.get("locked"),
            }),
            "last_canvas_edit_at": discussion.get("last_reply_at") or discussion.get("posted_at"),
            **module_placement,
        })

    if progress_callback:
        progress_callback("content", "Fetching Canvas quizzes", 64)
    quizzes = client.get_paginated(f"/courses/{canvas_course_id}/quizzes")
    for quiz in quizzes:
        canvas_id = str(quiz.get("id"))
        shell = quiz_assignment_shells_by_quiz_id.get(canvas_id) or {}
        assignment_id = str(quiz.get("assignment_id") or shell.get("id") or "")
        quiz_title = quiz.get("title") or "Untitled quiz"
        html_body = quiz.get("description") or ""
        module_placement = modules_by_content.get(("quiz", canvas_id)) or (
            modules_by_content.get(("assignment", assignment_id), {}) if assignment_id else {}
        )
        items.append({
            "canvas_id": canvas_id,
            "content_type": "quiz",
            "title": quiz_title,
            "canvas_url": quiz.get("html_url"),
            "published": quiz.get("published"),
            "html_body": html_body,
            "metadata": clean_metadata({
                "assignment_id": assignment_id or None,
                "assignment_shell_canvas_id": assignment_id or None,
                "assignment_shell_html_url": shell.get("html_url"),
                "assignment_shell_updated_at": shell.get("updated_at"),
                "is_quiz_assignment": bool(shell),
                "quiz_type": quiz.get("quiz_type"),
                "due_at": quiz.get("due_at"),
                "points_possible": quiz.get("points_possible"),
                "assignment_shell_points_possible": shell.get("points_possible"),
                "assignment_shell_submission_types": shell.get("submission_types"),
                "workflow_state": quiz.get("workflow_state"),
            }),
            "last_canvas_edit_at": quiz.get("updated_at"),
            **module_placement,
        })
        try:
            questions = client.get_paginated(f"/courses/{canvas_course_id}/quizzes/{canvas_id}/questions")
        except httpx.HTTPError as exc:
            logger.warning("Could not fetch questions for quiz %s: %s", canvas_id, exc)
            continue
        for question in questions:
            question_id = question.get("id")
            if question_id is None:
                continue
            position = question.get("position") or 0
            question_title = f"{quiz_title} - Question {position or question_id}"
            items.append({
                "canvas_id": quiz_question_canvas_id(canvas_id, question_id),
                "content_type": "quiz_question",
                "title": question_title,
                "canvas_url": quiz.get("html_url"),
                "published": quiz.get("published"),
                "html_body": quiz_question_html(question),
                "metadata": clean_metadata({
                    "parent_quiz_canvas_id": canvas_id,
                    "parent_quiz_title": quiz_title,
                    "question_id": str(question_id),
                    "question_text": question.get("question_text") or "",
                    "question_type": question.get("question_type"),
                    "points_possible": question.get("points_possible"),
                    "position": position,
                    "answers": quiz_answer_metadata(question.get("answers")),
                    "canvas_url": quiz.get("html_url"),
                }),
                "last_canvas_edit_at": quiz.get("updated_at"),
                "module_canvas_id": None,
                "module_name": quiz_title,
                "position": position,
            })

    if progress_callback:
        progress_callback("content", "Fetching Canvas files and folders", 72)
    folders_by_id: dict[str, dict[str, Any]] = {}
    try:
        folders = client.get_paginated(f"/courses/{canvas_course_id}/folders")
        for folder in folders:
            folder_id = folder.get("id")
            if folder_id is None:
                continue
            folders_by_id[str(folder_id)] = clean_metadata({
                "folder_name": folder.get("name"),
                "folder_path": folder.get("full_name"),
            })
    except httpx.HTTPError:
        folders_by_id = {}

    files = client.get_paginated(f"/courses/{canvas_course_id}/files")
    for file_row in files:
        canvas_id = str(file_row.get("id"))
        folder_metadata = folders_by_id.get(str(file_row.get("folder_id")), {})
        items.append({
            "canvas_id": canvas_id,
            "content_type": "file",
            "title": file_row.get("display_name") or file_row.get("filename") or "Untitled file",
            "canvas_url": file_row.get("html_url") or file_row.get("url"),
            "published": not bool(file_row.get("hidden")),
            "html_body": "",
            "metadata": clean_metadata({
                "filename": file_row.get("filename"),
                "content_type": file_row.get("content-type"),
                "size": file_row.get("size"),
                "folder_id": file_row.get("folder_id"),
                "locked": file_row.get("locked"),
                "hidden": file_row.get("hidden"),
                **folder_metadata,
            }),
            "last_canvas_edit_at": file_row.get("updated_at") or file_row.get("created_at"),
            **modules_by_content.get(("file", canvas_id), {}),
        })

    if progress_callback:
        progress_callback("references", "Checking links and embedded references", 82)
    return apply_references(items, module_references, canvas_course_id), modules, module_items


def get_session_context(supabase, session_id: str, user_id: str) -> dict[str, Any]:
    result = supabase.table("sessions").select(
        "id, user_id, source_course_id"
    ).eq("id", session_id).eq("user_id", user_id).execute()

    if not result.data:
        raise ValueError("Session not found")

    session = result.data[0]
    source_course_id = session.get("source_course_id")
    if not source_course_id:
        raise ValueError("Session has no source course")

    course_result = supabase.table("courses").select(
        "id, canvas_base_url, canvas_course_id"
    ).eq("id", source_course_id).eq("user_id", user_id).execute()
    course = course_result.data[0] if course_result.data else None
    if not course:
        raise ValueError("Session has no source course")

    return {"session": session, "course": course}


def get_active_pat(supabase, user_id: str, canvas_base_url: str) -> str:
    last_error = "No active Canvas credential found"
    for candidate_base_url in canvas_base_url_aliases(canvas_base_url):
        try:
            return get_active_pat_for_base_url(supabase, user_id, candidate_base_url)
        except ValueError as exc:
            last_error = str(exc)
    raise ValueError(last_error)


def get_active_pat_for_base_url(supabase, user_id: str, canvas_base_url: str) -> str:
    result = supabase.table("user_canvas_credentials").select(
        "pat_token_enc, expires_at"
    ).eq("user_id", user_id).eq("canvas_base_url", canvas_base_url).eq(
        "status", "active"
    ).execute()

    if not result.data:
        raise ValueError("No active Canvas credential found")

    credential = result.data[0]
    expires_at = datetime.fromisoformat(credential["expires_at"].replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        raise ValueError("Canvas credential has expired. Update the Canvas token before syncing again.")

    return decrypt(credential["pat_token_enc"])


def default_inventory_action_for_item_values(item_values: dict[str, Any]) -> str:
    if item_values.get("is_orphaned") and item_values.get("content_type") not in {"module", "module_item"}:
        return "delete"
    return "keep"


def default_inventory_reason(action: str) -> str:
    return "Defaulted to remove because item is orphaned" if action == "delete" else "Defaulted to keep because item is placed or referenced"


def reconcile_default_inventory_decision(
    supabase,
    user_id: str,
    session_id: str,
    content_item_id: str,
    item_values: dict[str, Any],
):
    decision = supabase.table("content_inventory_decisions").select(
        "id, action, reason"
    ).eq("content_item_id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not decision.data:
        return

    row = decision.data[0]
    reason = row.get("reason") or ""
    if not reason.startswith("Defaulted to "):
        return

    expected_action = default_inventory_action_for_item_values(item_values)
    if row.get("action") != expected_action:
        supabase.table("content_inventory_decisions").update({
            "action": expected_action,
            "reason": default_inventory_reason(expected_action),
            "updated_at": utc_now_iso(),
        }).eq("id", row["id"]).execute()


LOCAL_FILE_METADATA_KEYS = {
    "document_analysis",
    "initial_accessibility_review",
    "replacement_candidate",
    "replacement_id",
    "source_canvas_file_id",
    "source_content_item_id",
    "source_document_id",
    "uploaded_via",
    "canvas_archive",
}


def merge_local_file_metadata(existing_metadata: dict[str, Any], incoming_metadata: dict[str, Any]) -> dict[str, Any]:
    merged = {**incoming_metadata}
    for key in LOCAL_FILE_METADATA_KEYS:
        if key in existing_metadata and key not in merged:
            merged[key] = existing_metadata[key]
    return clean_metadata(merged)


def persist_content_item(supabase, user_id: str, session_id: str, row: dict[str, Any]) -> bool:
    html_body = str(clean_text_value(row.get("html_body") or ""))
    plain_text = str(clean_text_value(html_to_text(html_body) or ""))
    metadata = clean_metadata(row.get("metadata") if isinstance(row.get("metadata"), dict) else {})
    body_hash = sha256_payload({
        "title": row.get("title"),
        "html_body": html_body,
        "metadata": metadata,
    })
    now = utc_now_iso()
    linked_from = metadata.get("linked_from") if isinstance(metadata.get("linked_from"), list) else []
    front_page = bool(metadata.get("front_page"))
    is_orphaned = (
        row["content_type"] not in {"module", "module_item"}
        and not row.get("module_canvas_id")
        and not linked_from
        and not front_page
    )

    item_values = {
        "session_id": session_id,
        "user_id": user_id,
        "canvas_id": row["canvas_id"],
        "content_type": row["content_type"],
        "title": clean_text_value(row.get("title")),
        "canvas_url": clean_text_value(row.get("canvas_url")),
        "published": row.get("published"),
        "module_canvas_id": clean_text_value(row.get("module_canvas_id")),
        "module_name": clean_text_value(row.get("module_name")),
        "position": row.get("position"),
        "body_hash": body_hash,
        "body_word_count": word_count(plain_text),
        "last_canvas_edit_at": row.get("last_canvas_edit_at"),
        "last_synced_at": now,
        "is_orphaned": is_orphaned,
        "metadata": metadata,
        "updated_at": now,
    }

    existing = supabase.table("course_content_items").select(
        "id, body_hash, metadata"
    ).eq("session_id", session_id).eq("canvas_id", row["canvas_id"]).eq(
        "content_type", row["content_type"]
    ).execute()

    if not existing.data and row["content_type"] == "quiz" and metadata.get("source_content_type") == "assignment":
        existing = supabase.table("course_content_items").select(
            "id, body_hash"
        ).eq("session_id", session_id).eq("user_id", user_id).eq(
            "canvas_id", row["canvas_id"]
        ).eq("content_type", "assignment").execute()

    changed = True
    if existing.data:
        content_item_id = existing.data[0]["id"]
        existing_metadata = existing.data[0].get("metadata") if isinstance(existing.data[0].get("metadata"), dict) else {}
        if row["content_type"] == "file":
            item_values["metadata"] = merge_local_file_metadata(existing_metadata, metadata)
        changed = existing.data[0].get("body_hash") != body_hash
        supabase.table("course_content_items").update(item_values).eq("id", content_item_id).execute()
    else:
        insert_result = supabase.table("course_content_items").insert(item_values).execute()
        if not insert_result.data:
            raise RuntimeError(f"Failed to insert {row['content_type']} {row['canvas_id']}")
        content_item_id = insert_result.data[0]["id"]

    if row["content_type"] == "quiz" and metadata.get("source_content_type") == "assignment":
        supabase.table("course_content_items").delete().eq("session_id", session_id).eq(
            "user_id", user_id
        ).eq("canvas_id", row["canvas_id"]).eq("content_type", "assignment").execute()

    reconcile_default_inventory_decision(supabase, user_id, session_id, content_item_id, item_values)

    if changed or not existing.data:
        body_values = {
            "content_item_id": content_item_id,
            "html_body": html_body,
            "plain_text": plain_text,
            "extracted_at": now,
            "updated_at": now,
        }
        body_existing = supabase.table("course_content_bodies").select(
            "content_item_id"
        ).eq("content_item_id", content_item_id).execute()
        if body_existing.data:
            supabase.table("course_content_bodies").update(body_values).eq(
                "content_item_id", content_item_id
            ).execute()
        else:
            supabase.table("course_content_bodies").insert(body_values).execute()

    return changed


def cleanup_activity_assignment_shell_items(
    supabase,
    session_id: str,
    user_id: str,
    items: list[dict[str, Any]],
) -> int:
    assignment_shell_ids = list(dict.fromkeys(
        str(metadata.get("assignment_id") or metadata.get("assignment_shell_canvas_id"))
        for item in items
        if item.get("content_type") in {"discussion", "quiz"}
        for metadata in [item.get("metadata") if isinstance(item.get("metadata"), dict) else {}]
        if metadata.get("assignment_id") or metadata.get("assignment_shell_canvas_id")
    ))
    if not assignment_shell_ids:
        return 0

    stale_item_ids: list[str] = []
    for batch in chunks([{"canvas_id": canvas_id} for canvas_id in assignment_shell_ids], 100):
        canvas_ids = [row["canvas_id"] for row in batch]
        result = supabase.table("course_content_items").select(
            "id, canvas_id, content_type, metadata"
        ).eq("session_id", session_id).eq("user_id", user_id).in_(
            "canvas_id", canvas_ids
        ).in_(
            "content_type", ["assignment", "discussion", "quiz"]
        ).execute()

        for row in result.data or []:
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            if row.get("content_type") == "assignment":
                stale_item_ids.append(row["id"])
            elif row.get("content_type") == "quiz" and metadata.get("source_content_type") == "assignment":
                stale_item_ids.append(row["id"])
            elif row.get("content_type") == "discussion" and (
                metadata.get("source_content_type") == "assignment"
                or metadata.get("is_discussion_assignment")
            ):
                stale_item_ids.append(row["id"])

    stale_item_ids = list(dict.fromkeys(stale_item_ids))
    for batch in chunks([{"id": item_id} for item_id in stale_item_ids], 100):
        item_ids = [row["id"] for row in batch]
        supabase.table("course_content_bodies").delete().in_("content_item_id", item_ids).execute()
        supabase.table("content_inventory_decisions").delete().eq("session_id", session_id).eq(
            "user_id", user_id
        ).in_("content_item_id", item_ids).execute()
        supabase.table("course_module_items").delete().eq("session_id", session_id).eq(
            "user_id", user_id
        ).in_("content_item_id", item_ids).execute()
        supabase.table("course_images").delete().eq("session_id", session_id).eq(
            "user_id", user_id
        ).in_("content_item_id", item_ids).execute()
        supabase.table("course_content_items").delete().eq("session_id", session_id).eq(
            "user_id", user_id
        ).in_("id", item_ids).execute()

    return len(stale_item_ids)


def content_item_lookup_for_module_items(supabase, session_id: str, user_id: str) -> dict[tuple[str, str], str]:
    result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    lookup: dict[tuple[str, str], str] = {}
    for row in result.data or []:
        content_type = row.get("content_type")
        canvas_id = row.get("canvas_id")
        if content_type and canvas_id is not None:
            lookup[(str(content_type), str(canvas_id))] = row["id"]
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        page_url = metadata.get("url")
        if content_type == "page" and page_url:
            lookup[("page", str(page_url))] = row["id"]
        if content_type in {"discussion", "quiz"}:
            assignment_id = metadata.get("assignment_id") or metadata.get("assignment_shell_canvas_id")
            if assignment_id:
                lookup[(str(content_type), str(assignment_id))] = row["id"]
                lookup[("assignment", str(assignment_id))] = row["id"]
    return lookup


def sync_session_module_graph(
    supabase,
    session_id: str,
    user_id: str,
    modules: list[dict[str, Any]],
    module_items: list[dict[str, Any]],
):
    now = utc_now_iso()
    logger.info(
        "Refreshing module graph for session_id=%s modules=%s module_items=%s",
        session_id,
        len(modules),
        len(module_items),
    )
    supabase.table("course_module_items").delete().eq("session_id", session_id).eq(
        "user_id", user_id
    ).execute()
    supabase.table("course_modules").delete().eq("session_id", session_id).eq(
        "user_id", user_id
    ).execute()

    module_rows = [
        {
            **module,
            "session_id": session_id,
            "user_id": user_id,
            "metadata": module.get("metadata") or {},
            "created_at": now,
            "updated_at": now,
        }
        for module in modules
    ]
    for batch in chunks(module_rows):
        supabase.table("course_modules").insert(batch).execute()

    module_result = supabase.table("course_modules").select(
        "id, canvas_module_id"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    module_ids = {row["canvas_module_id"]: row["id"] for row in module_result.data or []}
    content_ids = content_item_lookup_for_module_items(supabase, session_id, user_id)

    item_rows: list[dict[str, Any]] = []
    for item in module_items:
        module_id = module_ids.get(item["canvas_module_id"])
        if not module_id:
            continue
        content_item_id = None
        content_type = item.get("content_type")
        if content_type == "page" and item.get("page_url"):
            content_item_id = content_ids.get(("page", str(item["page_url"])))
        if content_item_id is None and content_type and item.get("canvas_content_id"):
            content_item_id = content_ids.get((str(content_type), str(item["canvas_content_id"])))

        item_rows.append({
            **item,
            "session_id": session_id,
            "user_id": user_id,
            "module_id": module_id,
            "content_item_id": content_item_id,
            "completion_requirement": item.get("completion_requirement") or {},
            "metadata": item.get("metadata") or {},
            "created_at": now,
            "updated_at": now,
        })

    for batch in chunks(item_rows):
        supabase.table("course_module_items").insert(batch).execute()
    logger.info(
        "Refreshed module graph for session_id=%s inserted_modules=%s inserted_module_items=%s linked_items=%s",
        session_id,
        len(module_rows),
        len(item_rows),
        sum(1 for row in item_rows if row.get("content_item_id")),
    )


def sync_session_course_images(
    supabase,
    session_id: str,
    user_id: str,
    canvas_course_id: str | None,
) -> dict[str, int]:
    items_result = supabase.table("course_content_items").select(
        "id, title, content_type, canvas_url, module_name, is_orphaned"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    items = items_result.data or []

    item_ids = [item["id"] for item in items if item.get("id")]
    body_by_item_id = fetch_content_html_by_item_id(supabase, item_ids)

    desired_rows = build_image_inventory_rows(items, body_by_item_id, canvas_course_id)
    desired_by_url = {row["canvas_url"]: row for row in desired_rows}

    existing_result = supabase.table("course_images").select(
        "id, canvas_url, status, r2_original_key, r2_thumb_key, existing_alt_text, "
        "edited_alt_text, long_description, is_decorative, width, height, mime_type, "
        "file_size_bytes, is_broken, review_action"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    existing_rows = existing_result.data or []
    existing_by_url = {row["canvas_url"]: row for row in existing_rows}

    now = utc_now_iso()
    inserted = 0
    updated = 0
    deleted = 0

    for canvas_url, desired in desired_by_url.items():
        existing = existing_by_url.get(canvas_url)
        if existing:
            updates = {
                "content_item_id": desired.get("content_item_id"),
                "canvas_file_id": desired.get("canvas_file_id"),
                "canvas_course_id": desired.get("canvas_course_id"),
                "existing_alt_text": desired.get("existing_alt_text"),
                "width": desired.get("width"),
                "height": desired.get("height"),
                "updated_at": now,
            }
            if desired.get("content_is_orphaned") and existing.get("review_action") != "delete":
                updates["review_action"] = "delete"
            elif desired.get("source_content_type") == "quiz_question" and existing.get("review_action") == "delete":
                updates["review_action"] = "keep"
            supabase.table("course_images").update(updates).eq("id", existing["id"]).execute()
            updated += 1
        else:
            supabase.table("course_images").insert({
                "session_id": session_id,
                "user_id": user_id,
                "content_item_id": desired.get("content_item_id"),
                "canvas_url": canvas_url,
                "canvas_file_id": desired.get("canvas_file_id"),
                "canvas_course_id": desired.get("canvas_course_id"),
                "existing_alt_text": desired.get("existing_alt_text"),
                "review_action": "delete" if desired.get("content_is_orphaned") else "keep",
                "width": desired.get("width"),
                "height": desired.get("height"),
                "updated_at": now,
            }).execute()
            inserted += 1

    desired_urls = set(desired_by_url)
    for row in existing_rows:
        if row["canvas_url"] in desired_urls:
            continue
        supabase.table("course_images").delete().eq("id", row["id"]).execute()
        deleted += 1

    return {
        "total": len(desired_rows),
        "inserted": inserted,
        "updated": updated,
        "deleted": deleted,
    }


def prewarm_session_image_thumbs(
    supabase,
    session_id: str,
    user_id: str,
    pat_token: str,
    *,
    limit: int,
) -> dict[str, int]:
    if limit <= 0 or not is_r2_configured():
        return {"requested": 0, "warmed": 0, "failed": 0}

    result = supabase.table("course_images").select(
        "id, canvas_url, r2_thumb_key"
    ).eq("session_id", session_id).eq("user_id", user_id).order(
        "updated_at", desc=True
    ).limit(limit).execute()
    rows = result.data or []
    warmed = 0
    failed = 0
    now = utc_now_iso()

    for row in rows:
        try:
            thumb = prewarm_image_thumb(
                session_id=session_id,
                image_id=row["id"],
                canvas_url=row["canvas_url"],
                pat_token=pat_token,
                existing_thumb_key=row.get("r2_thumb_key"),
            )
            supabase.table("course_images").update({
                "status": thumb["status"],
                "r2_thumb_key": thumb.get("r2_thumb_key") or row.get("r2_thumb_key"),
                "mime_type": thumb.get("content_type"),
                "file_size_bytes": thumb.get("file_size_bytes"),
                "width": thumb.get("width"),
                "height": thumb.get("height"),
                "is_broken": False,
                "updated_at": now,
            }).eq("id", row["id"]).execute()
            warmed += 1
        except Exception:
            logger.exception(
                "Image thumb prewarm failed for session_id=%s image_id=%s canvas_url=%s",
                session_id,
                row.get("id"),
                row.get("canvas_url"),
            )
            supabase.table("course_images").update({
                "is_broken": True,
                "updated_at": now,
            }).eq("id", row["id"]).execute()
            failed += 1

    return {"requested": len(rows), "warmed": warmed, "failed": failed}


def run_canvas_pull_job(job_id: str, session_id: str, user_id: str, sync_kind: str = "full"):
    supabase = get_supabase()
    started = time.monotonic()
    now = utc_now_iso()
    sync_run_id: str | None = None
    current_stage = "initializing"
    current_item: dict[str, Any] | None = None

    try:
        current_stage = "loading_session"
        context = get_session_context(supabase, session_id, user_id)
        course = context["course"]
        canvas_base_url = course["canvas_base_url"]
        canvas_course_id = course["canvas_course_id"]

        supabase.table("background_jobs").update({
            "status": "running",
            "attempts": 1,
            "started_at": now,
            "result": {
                "stage": "connecting",
                "message": "Preparing Canvas sync",
                "progress": 8,
                "fetched_count": 0,
                "changed_count": 0,
            },
            "payload": {
                "session_id": session_id,
                "course_id": course["id"],
                "canvas_course_id": canvas_course_id,
                "sync_kind": sync_kind,
            },
        }).eq("id", job_id).execute()

        current_stage = "creating_sync_run"
        sync_result = supabase.table("course_sync_runs").insert({
            "session_id": session_id,
            "user_id": user_id,
            "course_id": course["id"],
            "sync_kind": sync_kind,
            "status": "running",
            "started_at": now,
        }).execute()
        sync_run_id = sync_result.data[0]["id"] if sync_result.data else None

        current_stage = "fetching_canvas_content"
        token = get_active_pat(supabase, user_id, canvas_base_url)
        client = CanvasClient(canvas_base_url, token)
        try:
            emit_sync_progress(
                supabase,
                job_id,
                "connecting",
                "Validating Canvas course access",
                12,
                sync_run_id=sync_run_id,
            )
            course_detail = client.get(f"/courses/{canvas_course_id}", {"include[]": ["term"]})
            items, modules, module_items = normalize_items(
                client,
                canvas_base_url,
                canvas_course_id,
                lambda stage, message, progress: emit_sync_progress(
                    supabase,
                    job_id,
                    stage,
                    message,
                    progress,
                    sync_run_id=sync_run_id,
                ),
            )
        finally:
            client.close()

        emit_sync_progress(
            supabase,
            job_id,
            "saving",
            "Saving synced content inventory",
            86,
            fetched_count=len(items),
            sync_run_id=sync_run_id,
        )
        current_stage = "saving_content_inventory"
        changed_count = 0
        total_items = len(items)
        for index, item in enumerate(items, start=1):
            current_item = item
            if persist_content_item(supabase, user_id, session_id, item):
                changed_count += 1
            if total_items and (index == total_items or index % 25 == 0):
                emit_sync_progress(
                    supabase,
                    job_id,
                    "saving",
                    f"Saved {index} of {total_items} synced records",
                    86 + min(10, int((index / total_items) * 10)),
                    fetched_count=total_items,
                    changed_count=changed_count,
                    sync_run_id=sync_run_id,
                )

        removed_shell_count = cleanup_activity_assignment_shell_items(supabase, session_id, user_id, items)
        if removed_shell_count:
            logger.info(
                "Removed stale Canvas activity assignment shell inventory rows session_id=%s count=%s",
                session_id,
                removed_shell_count,
            )

        current_item = None
        current_stage = "saving_module_structure"
        emit_sync_progress(
            supabase,
            job_id,
            "saving",
            "Saving Canvas module structure",
            96,
            fetched_count=total_items,
            changed_count=changed_count,
            sync_run_id=sync_run_id,
        )
        sync_session_module_graph(supabase, session_id, user_id, modules, module_items)

        current_stage = "refreshing_image_inventory"
        emit_sync_progress(
            supabase,
            job_id,
            "images",
            "Refreshing extracted image inventory",
            97,
            fetched_count=total_items,
            changed_count=changed_count,
            sync_run_id=sync_run_id,
        )
        sync_session_course_images(supabase, session_id, user_id, canvas_course_id)
        prewarm_limit = int(os.getenv("IMAGE_THUMB_PREWARM_LIMIT", "24") or "24")
        if prewarm_limit > 0:
            current_stage = "prewarming_image_thumbnails"
            emit_sync_progress(
                supabase,
                job_id,
                "images",
                "Prewarming image thumbnails",
                98,
                fetched_count=total_items,
                changed_count=changed_count,
                sync_run_id=sync_run_id,
            )
            prewarm_session_image_thumbs(
                supabase,
                session_id,
                user_id,
                token,
                limit=prewarm_limit,
            )

        duration_ms = int((time.monotonic() - started) * 1000)
        finished = utc_now_iso()
        course_update = {
            "last_synced_at": finished,
            "sync_version": int(time.time()),
            "updated_at": finished,
        }
        if course_detail.get("name"):
            course_update["course_name"] = course_detail.get("name")
        if course_detail.get("workflow_state"):
            course_update["workflow_state"] = course_detail.get("workflow_state")
        if isinstance(course_detail.get("term"), dict):
            course_update["term_name"] = course_detail["term"].get("name")

        current_stage = "finalizing_sync"
        supabase.table("courses").update(course_update).eq("id", course["id"]).execute()
        supabase.table("sessions").update({"updated_at": finished}).eq("id", session_id).execute()

        if sync_run_id:
            supabase.table("course_sync_runs").update({
                "status": "succeeded",
                "finished_at": finished,
                "duration_ms": duration_ms,
                "fetched_count": len(items),
                "changed_count": changed_count,
            }).eq("id", sync_run_id).execute()

        supabase.table("background_jobs").update({
            "status": "succeeded",
            "finished_at": finished,
            "result": {
                "sync_run_id": sync_run_id,
                "stage": "completed",
                "message": "Canvas sync completed",
                "progress": 100,
                "fetched_count": len(items),
                "changed_count": changed_count,
                "duration_ms": duration_ms,
            },
        }).eq("id", job_id).execute()
    except Exception as exc:
        finished = utc_now_iso()
        duration_ms = int((time.monotonic() - started) * 1000)
        item_context = ""
        if current_item:
            item_context = (
                f" item={current_item.get('content_type')}:{current_item.get('canvas_id')} "
                f"title={str(current_item.get('title') or '')[:120]}"
            )
        logger.exception(
            "Canvas pull failed job_id=%s session_id=%s stage=%s sync_run_id=%s%s",
            job_id,
            session_id,
            current_stage,
            sync_run_id,
            item_context,
        )
        message = f"{current_stage}: {exc}"
        if sync_run_id:
            supabase.table("course_sync_runs").update({
                "status": "failed",
                "finished_at": finished,
                "duration_ms": duration_ms,
                "error_message": message,
            }).eq("id", sync_run_id).execute()
        supabase.table("background_jobs").update({
            "status": "failed",
            "finished_at": finished,
            "error_message": message,
            "result": {
                "stage": "failed",
                "message": message,
                "progress": 100,
                "duration_ms": duration_ms,
            },
        }).eq("id", job_id).execute()
