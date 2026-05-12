"""Shared helpers for Transfer Canvas write-operation services."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import httpx

from canvas_sync import CanvasClient
from services.content_bodies import fetch_content_body_rows
from services.transfer.quiz_transfer import is_classic_quiz


TRANSFER_TARGET_JOB_TYPE = "transfer_target_push"
TRANSFER_SAME_COURSE_JOB_TYPE = "transfer_same_course_push"
TRANSFER_TARGET_BACKUP_JOB_TYPE = "transfer_target_backup"
TRANSFER_COPY_COURSE_JOB_TYPE = "transfer_course_copy"
SUPPORTED_TRANSFER_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz"}
SUPPORTED_SAME_COURSE_DELETE_TYPES = {"page", "assignment", "discussion", "quiz", "file"}
SAME_COURSE_MODULE_ITEM_OPERATION_TYPES = {
    "item_publish",
    "item_indent",
    "item_rename",
    "item_move",
    "item_remove",
    "item_position",
}
SAME_COURSE_MODULE_OPERATION_TYPES = {"module_rename", "module_position", "module_delete"}
MAX_TRANSFER_REPORT_ITEMS_PER_SECTION = 100


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compact_text(value: Any, limit: int = 240) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _after_last_sync(created_at: str | None, last_synced_at: str | None) -> bool:
    revision_time = _parse_datetime(created_at)
    synced_time = _parse_datetime(last_synced_at)
    if not synced_time:
        return True
    if not revision_time:
        return False
    return revision_time > synced_time


def _metadata(row: dict[str, Any] | None) -> dict[str, Any]:
    value = row.get("metadata") if row else None
    return value if isinstance(value, dict) else {}


def _normalized_title(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _update_job(supabase, job_id: str, values: dict[str, Any]) -> None:
    supabase.table("background_jobs").update(values).eq("id", job_id).execute()


def _set_job_result(supabase, job_id: str, state: dict[str, Any]) -> None:
    _update_job(supabase, job_id, {"result": state})


def _add_event(
    supabase,
    job_id: str,
    state: dict[str, Any],
    message: str,
    status: str = "info",
) -> None:
    events = state.setdefault("events", [])
    events.append({
        "message": message,
        "status": status,
        "at": utc_now_iso(),
    })
    _set_job_result(supabase, job_id, state)


def _add_report_item(
    state: dict[str, Any],
    category: str,
    *,
    title: Any,
    content_type: str | None = None,
    action: str | None = None,
    status: str | None = None,
    reason: Any = None,
    canvas_url: Any = None,
) -> None:
    report = state.setdefault("report", {})
    if not isinstance(report, dict):
        report = {}
        state["report"] = report
    items = report.setdefault(category, [])
    if not isinstance(items, list):
        items = []
        report[category] = items
    if len(items) >= MAX_TRANSFER_REPORT_ITEMS_PER_SECTION:
        return
    item: dict[str, Any] = {
        "title": _compact_text(title, 255) or "Untitled item",
    }
    if content_type:
        item["content_type"] = content_type
    if action:
        item["action"] = action
    if status:
        item["status"] = status
    if reason:
        item["reason"] = _compact_text(reason, 500)
    if canvas_url:
        item["canvas_url"] = _compact_text(canvas_url, 500)
    items.append(item)


def _report_count(state: dict[str, Any], category: str) -> int:
    report = state.get("report")
    if not isinstance(report, dict):
        return 0
    items = report.get(category)
    return len(items) if isinstance(items, list) else 0


def _set_progress(supabase, job_id: str, state: dict[str, Any], completed: int, total: int) -> None:
    state["progress"] = 1 if total <= 0 else min(1, completed / total)
    _set_job_result(supabase, job_id, state)


def _content_type_label(content_type: str) -> str:
    return {
        "page": "page",
        "assignment": "assignment",
        "discussion": "discussion",
        "quiz": "quiz",
        "quiz_question": "quiz question",
        "module": "module",
        "file": "file",
    }.get(content_type, content_type or "item")


def _is_local_canvas_id(value: Any) -> bool:
    return str(value or "").startswith("local:")


def _load_transfer_plan(supabase, *, session_id: str, user_id: str) -> dict[str, Any]:
    session_result = supabase.table("sessions").select(
        "id, name, type, source_course_id, meta"
    ).eq("id", session_id).eq("user_id", user_id).limit(1).execute()
    if not session_result.data:
        raise ValueError("Session not found")
    session = session_result.data[0]

    source_course = None
    if session.get("source_course_id"):
        course_result = supabase.table("courses").select(
            "id, course_name, canvas_course_id, canvas_base_url"
        ).eq("id", session["source_course_id"]).eq("user_id", user_id).limit(1).execute()
        source_course = course_result.data[0] if course_result.data else None

    modules_result = supabase.table("course_modules").select(
        "id, name, canvas_module_id, position, published, workflow_state, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).order("position").execute()
    modules = modules_result.data or []
    module_ids = [module["id"] for module in modules if module.get("id")]

    module_items = []
    if module_ids:
        module_items_result = supabase.table("course_module_items").select(
            "id, module_id, content_item_id, canvas_module_id, canvas_module_item_id, title, module_item_type, content_type, position, indent, published, metadata"
        ).eq("session_id", session_id).eq("user_id", user_id).in_("module_id", module_ids).order("position").execute()
        module_items = module_items_result.data or []

    module_content_item_ids = list({
        item.get("content_item_id")
        for item in module_items
        if item.get("content_item_id")
    })
    content_by_id: dict[str, dict[str, Any]] = {}
    bodies_by_id: dict[str, dict[str, Any]] = {}
    if module_content_item_ids:
        content_result = supabase.table("course_content_items").select(
            "id, canvas_id, title, content_type, canvas_url, published, module_canvas_id, module_name, last_synced_at, metadata"
        ).eq("session_id", session_id).eq("user_id", user_id).in_("id", module_content_item_ids).execute()
        content_by_id = {row["id"]: row for row in content_result.data or [] if row.get("id")}

    supported_result = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, canvas_url, published, module_canvas_id, module_name, last_synced_at, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_type", list(SUPPORTED_TRANSFER_CONTENT_TYPES)
    ).execute()
    supported_content_by_id = {
        row["id"]: row
        for row in supported_result.data or []
        if row.get("id")
    }
    content_by_id.update(supported_content_by_id)

    quiz_question_result = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, canvas_url, published, module_canvas_id, module_name, last_synced_at, metadata, position"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "content_type", "quiz_question"
    ).execute()
    quiz_questions_by_quiz_id: dict[str, list[dict[str, Any]]] = {}
    for row in quiz_question_result.data or []:
        if not row.get("id"):
            continue
        metadata = _metadata(row)
        parent_quiz_id = str(metadata.get("parent_quiz_canvas_id") or "")
        if not parent_quiz_id:
            continue
        content_by_id[row["id"]] = row
        quiz_questions_by_quiz_id.setdefault(parent_quiz_id, []).append(row)
    for rows in quiz_questions_by_quiz_id.values():
        rows.sort(key=lambda row: (_metadata(row).get("position") or row.get("position") or 999_999, row.get("title") or ""))

    body_content_item_ids = list(supported_content_by_id) + [
        row["id"]
        for rows in quiz_questions_by_quiz_id.values()
        for row in rows
        if row.get("id")
    ]
    if body_content_item_ids:
        bodies_by_id = {
            row["content_item_id"]: row
            for row in fetch_content_body_rows(supabase, body_content_item_ids)
            if row.get("content_item_id")
        }

    items_by_module: dict[str, list[dict[str, Any]]] = {}
    for item in module_items:
        if item.get("module_id"):
            items_by_module.setdefault(item["module_id"], []).append(item)

    operations_result = supabase.table("module_queue_operations").select(
        "*"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "status", "staged"
    ).order("created_at", desc=False).execute()
    module_operations = operations_result.data or []

    return {
        "session": session,
        "source_course": source_course,
        "modules": modules,
        "items_by_module": items_by_module,
        "content_by_id": content_by_id,
        "supported_content_by_id": supported_content_by_id,
        "bodies_by_id": bodies_by_id,
        "quiz_questions_by_quiz_id": quiz_questions_by_quiz_id,
        "module_operations": module_operations,
    }


def _source_course_canvas_id(plan: dict[str, Any]) -> str | None:
    source_course = plan.get("source_course") if isinstance(plan.get("source_course"), dict) else None
    canvas_id = source_course.get("canvas_course_id") if source_course else None
    return str(canvas_id) if canvas_id else None


def _quiz_question_rows(plan: dict[str, Any], quiz_canvas_id: Any) -> list[dict[str, Any]]:
    return (plan.get("quiz_questions_by_quiz_id") or {}).get(str(quiz_canvas_id or ""), [])


def _html_values_for_content(plan: dict[str, Any], content_item_id: str) -> list[str]:
    bodies_by_id = plan.get("bodies_by_id") or {}
    content_by_id = plan.get("content_by_id") or {}
    content = content_by_id.get(content_item_id) or {}
    values = [str((bodies_by_id.get(content_item_id) or {}).get("html_body") or "")]
    if content.get("content_type") == "quiz":
        for question in _quiz_question_rows(plan, content.get("canvas_id")):
            values.append(str((bodies_by_id.get(question["id"]) or {}).get("html_body") or ""))
    return [value for value in values if value]


def _create_canvas_module(client: CanvasClient, *, course_id: str, module: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "module[name]": module.get("name") or "Untitled Module",
    }
    if module.get("position") is not None:
        payload["module[position]"] = str(module.get("position"))
    if module.get("published") is not None:
        payload["module[published]"] = str(bool(module.get("published"))).lower()
    return client.post_form(f"/courses/{course_id}/modules", payload)


def _create_canvas_page(
    client: CanvasClient,
    *,
    course_id: str,
    title: str,
    html_body: str,
    published: bool,
) -> dict[str, Any]:
    return client.post_form(
        f"/courses/{course_id}/pages",
        {
            "wiki_page[title]": title,
            "wiki_page[body]": html_body,
            "wiki_page[published]": str(published).lower(),
        },
    )


def _update_canvas_page(client: CanvasClient, *, course_id: str, page_url: str, html_body: str) -> dict[str, Any]:
    return client.put_form(
        f"/courses/{course_id}/pages/{page_url}",
        {"wiki_page[body]": html_body},
    )


def _delete_canvas_page(client: CanvasClient, *, course_id: str, page_url: str) -> dict[str, Any]:
    return client.delete(f"/courses/{course_id}/pages/{page_url}")


def _create_canvas_assignment(
    client: CanvasClient,
    *,
    course_id: str,
    title: str,
    html_body: str,
    published: bool,
) -> dict[str, Any]:
    return client.post_form(
        f"/courses/{course_id}/assignments",
        {
            "assignment[name]": title,
            "assignment[description]": html_body,
            "assignment[published]": str(published).lower(),
        },
    )


def _update_canvas_assignment(client: CanvasClient, *, course_id: str, assignment_id: str, html_body: str) -> dict[str, Any]:
    return client.put_form(
        f"/courses/{course_id}/assignments/{assignment_id}",
        {"assignment[description]": html_body},
    )


def _delete_canvas_assignment(client: CanvasClient, *, course_id: str, assignment_id: str) -> dict[str, Any]:
    return client.delete(f"/courses/{course_id}/assignments/{assignment_id}")


def _create_canvas_discussion(
    client: CanvasClient,
    *,
    course_id: str,
    title: str,
    html_body: str,
    published: bool,
) -> dict[str, Any]:
    return client.post_form(
        f"/courses/{course_id}/discussion_topics",
        {
            "title": title,
            "message": html_body,
            "published": str(published).lower(),
        },
    )


def _update_canvas_discussion(client: CanvasClient, *, course_id: str, discussion_id: str, html_body: str) -> dict[str, Any]:
    return client.put_form(
        f"/courses/{course_id}/discussion_topics/{discussion_id}",
        {"message": html_body},
    )


def _delete_canvas_discussion(client: CanvasClient, *, course_id: str, discussion_id: str) -> dict[str, Any]:
    return client.delete(f"/courses/{course_id}/discussion_topics/{discussion_id}")


def _delete_canvas_file(client: CanvasClient, *, file_id: str) -> dict[str, Any]:
    return client.delete(f"/files/{file_id}")


def _erase_target_course_contents(
    supabase,
    *,
    job_id: str,
    state: dict[str, Any],
    client: CanvasClient,
    course_id: str,
    course_name: str,
) -> tuple[dict[str, int], int]:
    counts = {"module": 0, "page": 0, "discussion": 0, "quiz": 0, "assignment": 0, "file": 0}
    error_count = 0
    _add_event(supabase, job_id, state, f"Erasing target course content from {course_name}...")

    erase_targets = [
        ("module", "modules", f"/courses/{course_id}/modules", lambda row: f"/courses/{course_id}/modules/{row.get('id')}"),
        ("page", "pages", f"/courses/{course_id}/pages", lambda row: f"/courses/{course_id}/pages/{row.get('url')}"),
        ("discussion", "discussions", f"/courses/{course_id}/discussion_topics", lambda row: f"/courses/{course_id}/discussion_topics/{row.get('id')}"),
        ("quiz", "quizzes", f"/courses/{course_id}/quizzes", lambda row: f"/courses/{course_id}/quizzes/{row.get('id')}"),
        ("assignment", "assignments", f"/courses/{course_id}/assignments", lambda row: f"/courses/{course_id}/assignments/{row.get('id')}"),
        ("file", "files", f"/courses/{course_id}/files", lambda row: f"/files/{row.get('id')}"),
    ]

    for content_type, label, list_path, delete_path in erase_targets:
        try:
            rows = client.get_paginated(list_path)
            if content_type == "page" and any(row.get("front_page") for row in rows):
                try:
                    client.put_form(f"/courses/{course_id}", {"course[default_view]": "modules"})
                except Exception as exc:
                    _add_report_item(
                        state,
                        "warnings",
                        title="Front page default view",
                        content_type="course",
                        action="erase",
                        status="warning",
                        reason=exc,
                    )
                    _add_event(supabase, job_id, state, f"Could not unset target front page before erase: {exc}", "warning")
            for row in rows:
                row_id = row.get("url") if content_type == "page" else row.get("id")
                if not row_id:
                    continue
                title = row.get("title") or row.get("name") or row.get("display_name") or f"{content_type} {row_id}"
                try:
                    client.delete(delete_path(row))
                    counts[content_type] += 1
                    _add_report_item(
                        state,
                        "deleted",
                        title=title,
                        content_type=content_type,
                        action="erase",
                        status="done",
                    )
                except Exception as exc:
                    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 404:
                        continue
                    error_count += 1
                    _add_report_item(
                        state,
                        "errors",
                        title=title,
                        content_type=content_type,
                        action="erase",
                        status="error",
                        reason=exc,
                    )
            if rows:
                _add_event(supabase, job_id, state, f"Erased {counts[content_type]} target {label}.", "done")
        except Exception as exc:
            error_count += 1
            _add_report_item(
                state,
                "errors",
                title=f"Target {label}",
                content_type=content_type,
                action="erase",
                status="error",
                reason=exc,
            )
            _add_event(supabase, job_id, state, f"Target {label} erase failed: {exc}", "error")

    _add_event(
        supabase,
        job_id,
        state,
        f"Target erase complete: {sum(counts.values())} items removed.",
        "done" if error_count == 0 else "warning",
    )
    return counts, error_count


def _canvas_url_for_created_content(
    *,
    canvas_base_url: str,
    course_id: str,
    content_type: str,
    response: dict[str, Any],
) -> str | None:
    if response.get("html_url"):
        return str(response["html_url"])
    if content_type == "page":
        page_ref = response.get("url") or response.get("page_id")
        return f"{canvas_base_url.rstrip('/')}/courses/{course_id}/pages/{page_ref}" if page_ref else None
    if content_type == "assignment" and response.get("id") is not None:
        return f"{canvas_base_url.rstrip('/')}/courses/{course_id}/assignments/{response['id']}"
    if content_type == "discussion" and response.get("id") is not None:
        return f"{canvas_base_url.rstrip('/')}/courses/{course_id}/discussion_topics/{response['id']}"
    if content_type == "quiz" and response.get("id") is not None:
        return f"{canvas_base_url.rstrip('/')}/courses/{course_id}/quizzes/{response['id']}"
    return None


def _canvas_id_for_created_content(content_type: str, response: dict[str, Any], fallback: Any = None) -> str:
    value = response.get("url") or response.get("page_id") if content_type == "page" else response.get("id")
    if value is None:
        value = fallback
    if value is None:
        raise ValueError("Canvas did not return an identifier for the created item")
    return str(value)


def _metadata_for_created_content(content_type: str, metadata: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    next_metadata = dict(metadata)
    for key in ("is_new_local", "created_pending_canvas_push", "pending_canvas_push"):
        next_metadata.pop(key, None)
    next_metadata["created_in_v2"] = True
    next_metadata["pushed_to_canvas_at"] = utc_now_iso()
    if content_type == "page":
        next_metadata["url"] = response.get("url") or next_metadata.get("url")
        next_metadata["editing_roles"] = response.get("editing_roles") or next_metadata.get("editing_roles")
        next_metadata["front_page"] = bool(response.get("front_page"))
    elif content_type == "assignment":
        next_metadata["due_at"] = response.get("due_at")
        next_metadata["points_possible"] = response.get("points_possible")
        next_metadata["submission_types"] = response.get("submission_types")
        next_metadata["workflow_state"] = response.get("workflow_state")
    elif content_type == "discussion":
        next_metadata["discussion_type"] = response.get("discussion_type")
        next_metadata["posted_at"] = response.get("posted_at")
        next_metadata["workflow_state"] = response.get("workflow_state")
        next_metadata["locked"] = response.get("locked")
    elif content_type == "quiz":
        next_metadata["assignment_id"] = response.get("assignment_id")
        next_metadata["quiz_type"] = response.get("quiz_type") or next_metadata.get("quiz_type")
        next_metadata["points_possible"] = response.get("points_possible")
        next_metadata["workflow_state"] = response.get("workflow_state")
    return next_metadata


def _canvas_updated_timestamp(content_type: str, response: dict[str, Any]) -> str | None:
    if content_type == "page":
        return response.get("updated_at")
    if content_type == "assignment":
        return response.get("updated_at") or response.get("modified_at")
    if content_type == "discussion":
        return response.get("updated_at") or response.get("posted_at")
    return response.get("updated_at")


def _assert_no_quiz_submissions(client: CanvasClient, *, course_id: str, quiz: dict[str, Any]) -> None:
    if not is_classic_quiz(quiz):
        raise ValueError("New Quizzes are not supported by this transfer slice")
    quiz_id = str(quiz.get("canvas_id") or "")
    if not quiz_id or _is_local_canvas_id(quiz_id):
        return
    try:
        response = client.get(
            f"/courses/{course_id}/quizzes/{quiz_id}/submissions",
            params={"per_page": 1},
        )
    except httpx.HTTPStatusError as exc:
        raise ValueError("Could not verify whether this quiz has submissions, so Canvas push was blocked.") from exc
    if response.get("quiz_submissions") or response.get("submissions"):
        raise ValueError(
            "Canvas push blocked: this quiz already has student submissions. Editing quiz content after submissions can affect student scores and grading."
        )

def _add_content_to_module(
    client: CanvasClient,
    *,
    course_id: str,
    canvas_module_id: str | int,
    content_type: str,
    title: str,
    canvas_content_ref: str,
    position: int | None,
    indent: int | None,
) -> dict[str, Any]:
    module_item_type = {
        "page": "Page",
        "assignment": "Assignment",
        "discussion": "Discussion",
        "quiz": "Quiz",
    }.get(content_type)
    if not module_item_type:
        raise ValueError(f"Unsupported module placement type: {content_type}")
    payload: dict[str, Any] = {
        "module_item[type]": module_item_type,
        "module_item[title]": title,
    }
    if content_type == "page":
        payload["module_item[page_url]"] = canvas_content_ref
    else:
        payload["module_item[content_id]"] = canvas_content_ref
    if position is not None:
        payload["module_item[position]"] = str(position)
    if indent is not None:
        payload["module_item[indent]"] = str(indent)
    return client.post_form(
        f"/courses/{course_id}/modules/{canvas_module_id}/items",
        payload,
    )
