"""Canvas payload and metadata helpers for Pending Review content pushes."""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import HTTPException

from canvas_sync import CanvasClient, clean_metadata
from content_inventory import compact_whitespace
from services.editor.canvas_recovery import canvas_page_url
from services.editor.quiz_questions import metadata_marks_new_quiz, quiz_answers_for_canvas
from services.pending_review.content_helpers import EDITABLE_CONTENT_TYPES, parse_iso_datetime


logger = logging.getLogger(__name__)


def unpushed_revision_push_summary(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_item_id: str,
    last_synced_at: str | None,
) -> dict[str, Any]:
    revision_result = supabase.table("content_revisions").select(
        "id, revision_number, change_summary, created_at"
    ).eq("content_item_id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).order("revision_number", desc=False).execute()

    last_synced = parse_iso_datetime(last_synced_at)
    revisions = []
    for revision in revision_result.data or []:
        revision_at = parse_iso_datetime(revision.get("created_at"))
        if last_synced and revision_at and revision_at <= last_synced:
            continue
        revisions.append(revision)

    summaries = [
        compact_whitespace(revision.get("change_summary"))
        for revision in revisions
        if compact_whitespace(revision.get("change_summary"))
    ]
    first_revision = revisions[0] if revisions else {}
    latest_revision = revisions[-1] if revisions else {}
    return {
        "revision_count": len(revisions),
        "first_revision_number": first_revision.get("revision_number"),
        "latest_revision_number": latest_revision.get("revision_number"),
        "first_changed_at": first_revision.get("created_at"),
        "latest_changed_at": latest_revision.get("created_at"),
        "latest_change_summary": summaries[-1] if summaries else None,
        "change_summaries": summaries,
    }


def unpushed_revision_rows(
    supabase,
    *,
    session_id: str,
    user_id: str,
    content_item_ids: list[str],
    last_synced_at: str | None,
) -> list[dict[str, Any]]:
    if not content_item_ids:
        return []
    revision_result = supabase.table("content_revisions").select(
        "id, content_item_id, revision_number, before_title, after_title, before_html, after_html, change_summary, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "content_item_id", content_item_ids
    ).order("created_at", desc=False).execute()
    last_synced = parse_iso_datetime(last_synced_at)
    rows = []
    for revision in revision_result.data or []:
        revision_at = parse_iso_datetime(revision.get("created_at"))
        if last_synced and revision_at and revision_at <= last_synced:
            continue
        rows.append(revision)
    return rows


def quiz_question_text_from_body(html_body: str | None, *, has_answer_list: bool = False) -> str:
    body = html_body or ""
    if not has_answer_list:
        return body
    matches = list(re.finditer(r"<ol(?:\s[^>]*)?>", body, flags=re.IGNORECASE))
    return body[:matches[-1].start()].strip() if matches else body


def canvas_push_payload(item: dict, html_body: str, published: bool | None) -> tuple[str, dict, str]:
    title = item.get("title") or "Untitled content"
    canvas_id = item.get("canvas_id")
    content_type = item.get("content_type")
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    is_new_local = bool(metadata.get("is_new_local"))

    if content_type == "page":
        data = {
            "wiki_page[title]": title,
            "wiki_page[body]": html_body,
        }
        if published is not None:
            data["wiki_page[published]"] = str(published).lower()
        if is_new_local:
            return f"/courses/{item['canvas_course_id']}/pages", data, "post"
        return f"/courses/{item['canvas_course_id']}/pages/{canvas_page_url(item)}", data, "put"

    if content_type == "assignment":
        data = {
            "assignment[name]": title,
            "assignment[description]": html_body,
        }
        if published is not None:
            data["assignment[published]"] = str(published).lower()
        if is_new_local:
            return f"/courses/{item['canvas_course_id']}/assignments", data, "post"
        return f"/courses/{item['canvas_course_id']}/assignments/{canvas_id}", data, "put"

    if content_type == "discussion":
        data = {
            "title": title,
            "message": html_body,
        }
        if published is not None:
            data["published"] = str(published).lower()
        if is_new_local:
            return f"/courses/{item['canvas_course_id']}/discussion_topics", data, "post"
        return f"/courses/{item['canvas_course_id']}/discussion_topics/{canvas_id}", data, "put"

    if content_type == "quiz":
        if metadata_marks_new_quiz(metadata):
            data = {
                "quiz[title]": title,
                "quiz[instructions]": html_body,
            }
            return f"/api/quiz/v1/courses/{item['canvas_course_id']}/quizzes/{canvas_id}", data, "patch"
        data = {
            "quiz[title]": title,
            "quiz[description]": html_body,
        }
        if metadata.get("quiz_type"):
            data["quiz[quiz_type]"] = str(metadata["quiz_type"])
        if published is not None:
            data["quiz[published]"] = str(published).lower()
        return f"/courses/{item['canvas_course_id']}/quizzes/{canvas_id}", data, "put"

    if content_type == "quiz_question":
        quiz_id = metadata.get("parent_quiz_canvas_id")
        question_id = metadata.get("question_id")
        if not quiz_id:
            raise HTTPException(status_code=422, detail="Quiz question is missing Canvas quiz/question identifiers")
        metadata_answers = metadata.get("answers") if isinstance(metadata.get("answers"), list) else []
        payload_question_text = quiz_question_text_from_body(
            html_body,
            has_answer_list=bool(metadata_answers),
        ) or metadata.get("question_text") or ""
        data = {
            "question_text": payload_question_text,
            "question_type": metadata.get("question_type") or "multiple_choice_question",
            "points_possible": 0 if (metadata.get("question_type") or "") == "text_only_question" else metadata.get("points_possible") or 0,
            "answers": quiz_answers_for_canvas(
                metadata.get("question_type") or "multiple_choice_question",
                metadata_answers,
            ),
        }
        if metadata.get("is_new_local"):
            return f"/courses/{item['canvas_course_id']}/quizzes/{quiz_id}/questions", {"question": data}, "post_json"
        if not question_id:
            raise HTTPException(status_code=422, detail="Quiz question is missing Canvas question identifier")
        return f"/courses/{item['canvas_course_id']}/quizzes/{quiz_id}/questions/{question_id}", {"question": data}, "put_json"

    raise HTTPException(status_code=422, detail=f"{content_type} content cannot be pushed to Canvas yet")


def canvas_updated_timestamp(content_type: str, response: dict) -> str | None:
    if content_type == "discussion":
        return response.get("last_reply_at") or response.get("posted_at")
    return response.get("updated_at")


def canvas_id_from_create_response(content_type: str, response: dict, fallback: str | None = None) -> str:
    if content_type == "page":
        value = response.get("page_id") or response.get("url") or fallback
    else:
        value = response.get("id") or fallback
    if value is None:
        raise HTTPException(status_code=502, detail="Canvas did not return an identifier for the created item")
    return str(value)


def metadata_for_created_canvas_item(content_type: str, existing_metadata: dict[str, Any], response: dict) -> dict[str, Any]:
    metadata = {
        **existing_metadata,
        "created_in_v2": True,
    }
    metadata.pop("is_new_local", None)
    if content_type == "page":
        metadata["url"] = response.get("url") or existing_metadata.get("url")
        metadata["editing_roles"] = response.get("editing_roles") or existing_metadata.get("editing_roles")
        metadata["front_page"] = response.get("front_page") or False
    elif content_type == "assignment":
        metadata["due_at"] = response.get("due_at")
        metadata["points_possible"] = response.get("points_possible")
        metadata["submission_types"] = response.get("submission_types")
        metadata["workflow_state"] = response.get("workflow_state")
    elif content_type == "discussion":
        metadata["discussion_type"] = response.get("discussion_type")
        metadata["posted_at"] = response.get("posted_at")
        metadata["workflow_state"] = response.get("workflow_state")
        metadata["locked"] = response.get("locked")
    return clean_metadata(metadata)


def canvas_module_item_type(content_type: str) -> str:
    if content_type == "page":
        return "Page"
    if content_type == "assignment":
        return "Assignment"
    if content_type == "discussion":
        return "Discussion"
    return content_type.title()


def create_canvas_module_item_for_content(
    supabase,
    *,
    session_id: str,
    user_id: str,
    client: CanvasClient,
    canvas_course_id: str,
    item: dict[str, Any],
    canvas_response: dict[str, Any],
    metadata: dict[str, Any],
    now: str,
):
    desired_module_id = metadata.get("desired_module_id")
    desired_canvas_module_id = metadata.get("desired_canvas_module_id")
    if not desired_module_id or not desired_canvas_module_id:
        return False
    if str(desired_canvas_module_id).startswith("local:"):
        module_result = supabase.table("course_modules").select(
            "canvas_module_id, name"
        ).eq("id", desired_module_id).eq("session_id", session_id).eq(
            "user_id", user_id
        ).limit(1).execute()
        if module_result.data:
            current_canvas_module_id = module_result.data[0].get("canvas_module_id")
            if current_canvas_module_id and not str(current_canvas_module_id).startswith("local:"):
                desired_canvas_module_id = str(current_canvas_module_id)
                metadata["desired_canvas_module_id"] = desired_canvas_module_id
                metadata["desired_module_name"] = module_result.data[0].get("name") or metadata.get("desired_module_name")
            else:
                return False
        else:
            return False

    existing_result = supabase.table("course_module_items").select(
        "id, canvas_module_item_id"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "content_item_id", item["id"]
    ).limit(1).execute()
    if existing_result.data:
        existing_module_item = existing_result.data[0]
        if not str(existing_module_item.get("canvas_module_item_id") or "").startswith("local:"):
            return True
    else:
        existing_module_item = None

    content_type = item.get("content_type")
    module_item_type = canvas_module_item_type(str(content_type))
    payload = {
        "module_item[type]": module_item_type,
        "module_item[title]": item.get("title") or "Untitled content",
        "module_item[indent]": "0",
    }
    if content_type == "page":
        page_url = canvas_response.get("url") or metadata.get("url")
        if not page_url:
            return False
        payload["module_item[page_url]"] = str(page_url)
    else:
        canvas_content_id = canvas_response.get("id") or canvas_response.get("page_id")
        if canvas_content_id is None:
            return False
        payload["module_item[content_id]"] = str(canvas_content_id)

    try:
        module_item_response = client.post_form(
            f"/courses/{canvas_course_id}/modules/{desired_canvas_module_id}/items",
            payload,
        )
    except Exception:
        logger.exception(
            "Failed to place new content item %s in Canvas module %s",
            item.get("id"),
            desired_canvas_module_id,
        )
        return False
    canvas_module_item_id = module_item_response.get("id")
    if canvas_module_item_id is None:
        return False

    module_item_values = {
        "session_id": session_id,
        "user_id": user_id,
        "module_id": desired_module_id,
        "content_item_id": item["id"],
        "canvas_module_id": str(desired_canvas_module_id),
        "canvas_module_item_id": str(canvas_module_item_id),
        "canvas_content_id": str(module_item_response.get("content_id")) if module_item_response.get("content_id") is not None else None,
        "page_url": module_item_response.get("page_url") or canvas_response.get("url"),
        "title": module_item_response.get("title") or item.get("title"),
        "module_item_type": module_item_response.get("type") or module_item_type,
        "content_type": content_type,
        "position": module_item_response.get("position"),
        "indent": module_item_response.get("indent") or 0,
        "published": item.get("published"),
        "completion_requirement": module_item_response.get("completion_requirement") or {},
        "html_url": module_item_response.get("html_url"),
        "external_url": module_item_response.get("external_url"),
        "new_tab": module_item_response.get("new_tab"),
        "metadata": {
            "created_from_v2_new_content": True,
            "workflow_state": module_item_response.get("workflow_state"),
        },
        "created_at": now,
        "updated_at": now,
    }
    if existing_module_item:
        update_values = {key: value for key, value in module_item_values.items() if key != "created_at"}
        supabase.table("course_module_items").update(update_values).eq("id", existing_module_item["id"]).execute()
    else:
        supabase.table("course_module_items").insert(module_item_values).execute()
    return True
