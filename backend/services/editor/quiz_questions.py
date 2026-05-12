"""Classic quiz question editor services."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException

from api.editor.schemas import QuizAnswerRequest, QuizQuestionCreateRequest, QuizQuestionUpdateRequest
from canvas_sync import CanvasClient, get_active_pat, html_to_text, sha256_payload, word_count
from content_inventory import compact_whitespace
from services.content_revisions import next_revision_number
from services.document_records import get_owned_session
from services.editor.content_read import user_id_from_token
from supabase_client import get_supabase


QUIZ_ANSWER_FIELDS = (
    "id",
    "text",
    "html",
    "weight",
    "answer_text",
    "answer_html",
    "answer_weight",
    "blank_id",
    "left",
    "right",
    "answer_match_left",
    "answer_match_right",
    "matching_answer_incorrect_matches",
    "match_id",
    "numerical_answer_type",
    "exact",
    "margin",
    "approximate",
    "precision",
    "start",
    "end",
)


def metadata_marks_new_quiz(metadata: dict[str, Any]) -> bool:
    """Return true only for assignment-backed quiz rows without classic quiz metadata."""
    return metadata.get("source_content_type") == "assignment" and not metadata.get("quiz_type")


def answer_weight_value(answer: dict[str, Any]) -> float:
    value = answer.get("weight") if answer.get("weight") is not None else answer.get("answer_weight", 0)
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def quiz_question_payload_answers(answers: list[QuizAnswerRequest] | None) -> list[dict[str, Any]] | None:
    if answers is None:
        return None
    payload: list[dict[str, Any]] = []
    for answer in answers:
        row = answer.model_dump(exclude_none=True)
        payload.append({key: row[key] for key in QUIZ_ANSWER_FIELDS if key in row})
    return payload


def quiz_answers_for_canvas(question_type: str, answers: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized = [dict(answer) for answer in (answers or []) if isinstance(answer, dict)]
    if question_type == "matching_question":
        matching_answers: list[dict[str, Any]] = []
        for answer in normalized:
            left = answer.get("answer_match_left") or answer.get("left") or answer.get("text") or answer.get("answer_text") or ""
            right = answer.get("answer_match_right") or answer.get("right") or ""
            if not left and not right:
                continue
            payload: dict[str, Any] = {
                "answer_match_left": left,
                "answer_match_right": right,
            }
            if answer.get("id") is not None:
                payload["id"] = answer["id"]
            if answer.get("matching_answer_incorrect_matches"):
                payload["matching_answer_incorrect_matches"] = answer["matching_answer_incorrect_matches"]
            matching_answers.append(payload)
        return matching_answers
    if question_type == "true_false_question":
        true_answer = next((answer for answer in normalized if (answer.get("text") or answer.get("answer_text") or "").lower() == "true"), None)
        false_answer = next((answer for answer in normalized if (answer.get("text") or answer.get("answer_text") or "").lower() == "false"), None)
        selected_true = bool(true_answer and answer_weight_value(true_answer) > 0)
        selected_false = bool(false_answer and answer_weight_value(false_answer) > 0)
        if not selected_true and not selected_false and normalized:
            selected_true = answer_weight_value(normalized[0]) > 0
        return [
            {**({"id": true_answer["id"]} if true_answer and true_answer.get("id") is not None else {}), "text": "True", "weight": 100 if selected_true or not selected_false else 0},
            {**({"id": false_answer["id"]} if false_answer and false_answer.get("id") is not None else {}), "text": "False", "weight": 100 if selected_false else 0},
        ]
    if question_type == "numerical_question":
        numerical_answers: list[dict[str, Any]] = []
        for answer in normalized:
            answer_type = answer.get("numerical_answer_type") or "exact_answer"
            payload: dict[str, Any] = {
                "numerical_answer_type": answer_type,
                "weight": 100,
            }
            if answer.get("id") is not None:
                payload["id"] = answer["id"]
            if answer_type == "range_answer":
                payload["start"] = answer.get("start") if answer.get("start") is not None else answer.get("exact", 0)
                payload["end"] = answer.get("end") if answer.get("end") is not None else answer.get("exact", 0)
            elif answer_type == "precision_answer":
                payload["approximate"] = answer.get("approximate") if answer.get("approximate") is not None else answer.get("exact", 0)
                payload["precision"] = max(1, min(int(answer.get("precision") or 1), 16))
            else:
                payload["exact"] = answer.get("exact") if answer.get("exact") is not None else 0
                payload["margin"] = answer.get("margin") if answer.get("margin") is not None else 0
            numerical_answers.append(payload)
        return numerical_answers or [{"numerical_answer_type": "exact_answer", "exact": 0, "margin": 0, "weight": 100}]
    if question_type == "text_only_question":
        return []
    if question_type in {"multiple_choice_question", "multiple_answers_question", "fill_in_multiple_blanks_question", "multiple_dropdowns_question"}:
        canonical_answers: list[dict[str, Any]] = []
        for answer in normalized:
            text = answer.get("answer_text") or answer.get("text") or ""
            html = answer.get("answer_html") or answer.get("html")
            payload: dict[str, Any] = {
                "text": text,
                "weight": answer.get("weight") if answer.get("weight") is not None else answer.get("answer_weight", 0),
            }
            if answer.get("id") is not None:
                payload["id"] = answer["id"]
            if html:
                payload["html"] = html
            if answer.get("blank_id") is not None:
                payload["blank_id"] = answer["blank_id"]
            canonical_answers.append(payload)
        normalized = canonical_answers
    if question_type == "multiple_choice_question":
        selected = False
        for answer in normalized:
            answer["weight"] = 100 if not selected and answer_weight_value(answer) > 0 else 0
            selected = selected or answer["weight"] == 100
        if normalized and not selected:
            normalized[0]["weight"] = 100
    return normalized


def quiz_question_body_html(question_text: str, answers: list[dict[str, Any]] | None) -> str:
    parts = [question_text or ""]
    if answers:
        parts.append("<ol>")
        for answer in answers:
            answer_html = (
                answer.get("html")
                or answer.get("answer_html")
                or answer.get("text")
                or answer.get("answer_text")
                or (
                    f"{answer.get('answer_match_left') or answer.get('left')} -> {answer.get('answer_match_right') or answer.get('right')}"
                    if (answer.get("answer_match_left") or answer.get("left") or answer.get("answer_match_right") or answer.get("right"))
                    else None
                )
                or answer.get("left")
                or answer.get("right")
                or (str(answer.get("exact")) if answer.get("exact") is not None else "")
            )
            parts.append(f"<li>{answer_html}</li>")
        parts.append("</ol>")
    return "\n".join(parts)


def normalize_quiz_question(question: dict[str, Any], quiz_id: str | int) -> dict[str, Any]:
    return {
        "canvas_id": question.get("id"),
        "quiz_id": int(quiz_id) if str(quiz_id).isdigit() else quiz_id,
        "question_text": question.get("question_text") or "",
        "question_type": question.get("question_type") or "multiple_choice_question",
        "points_possible": question.get("points_possible") or 0,
        "position": question.get("position") or 0,
        "answers": [
            {key: answer[key] for key in QUIZ_ANSWER_FIELDS if key in answer}
            for answer in (question.get("answers") or [])
            if isinstance(answer, dict)
        ],
    }


def normalize_local_quiz_question(item: dict[str, Any]) -> dict[str, Any]:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    question_id = metadata.get("question_id")
    return {
        "content_item_id": item.get("id"),
        "canvas_id": int(question_id) if str(question_id).isdigit() else question_id,
        "quiz_id": int(metadata.get("parent_quiz_canvas_id")) if str(metadata.get("parent_quiz_canvas_id")).isdigit() else metadata.get("parent_quiz_canvas_id"),
        "question_text": metadata.get("question_text") or "",
        "question_type": metadata.get("question_type") or "multiple_choice_question",
        "points_possible": metadata.get("points_possible") or 0,
        "position": metadata.get("position") or 0,
        "answers": metadata.get("answers") if isinstance(metadata.get("answers"), list) else [],
        "pending_delete": bool(metadata.get("pending_delete")),
    }


def quiz_question_summary_label(metadata: dict[str, Any]) -> str:
    question_text = compact_whitespace(html_to_text(metadata.get("question_text") or ""))
    if question_text:
        return f"\"{question_text[:77]}...\"" if len(question_text) > 80 else f"\"{question_text}\""
    question_type = str(metadata.get("question_type") or "question").replace("_", " ")
    question_id = metadata.get("question_id")
    return f"quiz question {question_id}" if question_id else question_type


def quiz_question_pending_summary(item: dict[str, Any], revisions: list[dict[str, Any]]) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    question_type = str(metadata.get("question_type") or "question").replace("_", " ")
    latest_summary = compact_whitespace((revisions[-1] if revisions else {}).get("change_summary"))
    action = "changed"
    if latest_summary:
        lowered = latest_summary.lower()
        if "added" in lowered:
            action = "added"
        elif "deleted" in lowered:
            action = "deleted"
        elif "edited" in lowered:
            action = "edited"
    return f"{action.capitalize()}: {quiz_question_summary_label(metadata)} ({question_type})"


def quiz_question_change_summary(metadata: dict[str, Any], action: str) -> str:
    question_type = str(metadata.get("question_type") or "question").replace("_", " ")
    label = quiz_question_summary_label(metadata)
    return f"{label} {action} ({question_type})"


def combine_pending_summaries(existing_summary: str | None, next_summary: str | None) -> str:
    parts: list[str] = []
    for value in (existing_summary, next_summary):
        if not value:
            continue
        for part in str(value).split("; "):
            clean = compact_whitespace(part)
            if clean and clean not in parts:
                parts.append(clean)
    if len(parts) > 3:
        return "; ".join(parts[:3]) + f"; +{len(parts) - 3} more"
    return "; ".join(parts)


def quiz_question_row_title(parent_title: str | None, position: int | None, question_id: str | int | None) -> str:
    return f"{parent_title or 'Quiz'} - Question {position or question_id or ''}".strip()


def local_quiz_question_canvas_id(quiz_id: str | int, question_id: str | int) -> str:
    return f"quiz:{quiz_id}:question:{question_id}"


def quiz_question_rows_for_parent(
    supabase,
    session_id: str,
    user_id: str,
    quiz_canvas_id: str,
    *,
    include_pending_delete: bool = False,
) -> list[dict[str, Any]]:
    result = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, metadata, position"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "content_type", "quiz_question"
    ).contains("metadata", {"parent_quiz_canvas_id": str(quiz_canvas_id)}).execute()
    rows = result.data or []
    if not include_pending_delete:
        rows = [
            row
            for row in rows
            if not ((row.get("metadata") if isinstance(row.get("metadata"), dict) else {}).get("pending_delete"))
        ]
    return sorted(rows, key=lambda row: (row.get("metadata") or {}).get("position") or 0)


def quiz_question_child_ids_for_parent(
    supabase,
    session_id: str,
    user_id: str,
    quiz_canvas_id: str,
    *,
    include_pending_delete: bool = False,
) -> list[str]:
    return [
        row["id"]
        for row in quiz_question_rows_for_parent(
            supabase,
            session_id,
            user_id,
            quiz_canvas_id,
            include_pending_delete=include_pending_delete,
        )
    ]


def quiz_question_row_matches(row: dict[str, Any], quiz_canvas_id: str | int, question_identifier: str | int) -> bool:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    identifier = str(question_identifier)
    return (
        str(row.get("id")) == identifier
        or str(row.get("canvas_id")) == identifier
        or str(row.get("canvas_id")) == local_quiz_question_canvas_id(quiz_canvas_id, identifier)
        or str(metadata.get("question_id")) == identifier
    )


def metadata_with_canvas_question_response(metadata: dict[str, Any], canvas_response: dict[str, Any]) -> dict[str, Any]:
    response_question_id = canvas_response.get("id") or canvas_response.get("question", {}).get("id")
    updated_metadata = {**metadata}
    if response_question_id:
        updated_metadata["question_id"] = str(response_question_id)
        updated_metadata["is_new_local"] = False
    if canvas_response.get("question_text") is not None:
        updated_metadata["question_text"] = canvas_response.get("question_text")
    response_question_type = canvas_response.get("question_type")
    if response_question_type is not None:
        if metadata.get("question_type") == "true_false_question" and response_question_type == "multiple_choice_question":
            updated_metadata["question_type"] = "true_false_question"
        else:
            updated_metadata["question_type"] = response_question_type
    if canvas_response.get("points_possible") is not None:
        updated_metadata["points_possible"] = canvas_response.get("points_possible")
    if canvas_response.get("position") is not None:
        updated_metadata["position"] = canvas_response.get("position")
    if isinstance(canvas_response.get("answers"), list):
        canvas_answers = [
            {key: answer[key] for key in QUIZ_ANSWER_FIELDS if key in answer}
            for answer in canvas_response.get("answers")
            if isinstance(answer, dict)
        ]
        existing_answers = metadata.get("answers") if isinstance(metadata.get("answers"), list) else []
        if existing_answers:
            merged_answers: list[dict[str, Any]] = []
            for index, existing_answer in enumerate(existing_answers):
                if not isinstance(existing_answer, dict):
                    continue
                canvas_answer = canvas_answers[index] if index < len(canvas_answers) else {}
                merged_answers.append({
                    **canvas_answer,
                    **existing_answer,
                    **({"id": canvas_answer["id"]} if canvas_answer.get("id") is not None else {}),
                })
            updated_metadata["answers"] = merged_answers
        else:
            updated_metadata["answers"] = canvas_answers
    return updated_metadata


def get_owned_quiz_item(supabase, session_id: str, content_item_id: str, user_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    session = get_owned_session(supabase, session_id, user_id)
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, published, last_canvas_edit_at, metadata"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")
    item = item_result.data[0]
    if item.get("content_type") != "quiz":
        raise HTTPException(status_code=422, detail="Content item is not a quiz")
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    if metadata_marks_new_quiz(metadata):
        raise HTTPException(status_code=422, detail="Question editing for New Quizzes is not supported yet")
    return session, item


def get_quiz_canvas_client(supabase, session: dict[str, Any], user_id: str) -> tuple[CanvasClient, str]:
    source_course_id = session.get("source_course_id")
    if not source_course_id:
        raise HTTPException(status_code=422, detail="Session is not linked to a Canvas course")
    course_result = supabase.table("courses").select(
        "canvas_base_url, canvas_course_id"
    ).eq("id", source_course_id).eq("user_id", user_id).limit(1).execute()
    if not course_result.data:
        raise HTTPException(status_code=404, detail="Canvas course not found")
    course = course_result.data[0]
    canvas_base_url = course.get("canvas_base_url")
    canvas_course_id = course.get("canvas_course_id")
    if not canvas_base_url or not canvas_course_id:
        raise HTTPException(status_code=422, detail="Canvas course details are incomplete")
    pat_token = get_active_pat(supabase, user_id, canvas_base_url)
    return CanvasClient(canvas_base_url, pat_token), str(canvas_course_id)


def quiz_submission_check_target(item: dict[str, Any]) -> tuple[str, str] | None:
    content_type = item.get("content_type")
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    if content_type == "quiz_question":
        quiz_id = metadata.get("parent_quiz_canvas_id")
        return ("classic_quiz", str(quiz_id)) if quiz_id else None
    if content_type != "quiz":
        return None
    if metadata_marks_new_quiz(metadata):
        return ("assignment", str(item.get("canvas_id")))
    return ("classic_quiz", str(item.get("canvas_id")))


def assert_no_quiz_submissions(client: CanvasClient, canvas_course_id: str, item: dict[str, Any]) -> None:
    target = quiz_submission_check_target(item)
    if not target:
        return
    target_type, target_id = target
    if not target_id or target_id == "None":
        raise HTTPException(status_code=422, detail="Cannot verify quiz submissions because the Canvas quiz identifier is missing")

    try:
        if target_type == "assignment":
            rows = client.get_paginated(
                f"/courses/{canvas_course_id}/assignments/{target_id}/submissions",
                params={"student_ids[]": "all"},
            )
            has_submissions = any(
                row.get("submitted_at")
                or row.get("workflow_state") in {"submitted", "graded", "pending_review"}
                for row in rows
            )
        else:
            response = client.get(
                f"/courses/{canvas_course_id}/quizzes/{target_id}/submissions",
                params={"per_page": 1},
            )
            has_submissions = bool(response.get("quiz_submissions") or response.get("submissions"))
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not verify whether this quiz has submissions, so Canvas push was blocked.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not verify whether this quiz has submissions, so Canvas push was blocked: {exc}",
        ) from exc

    if has_submissions:
        raise HTTPException(
            status_code=409,
            detail="Canvas push blocked: this quiz already has student submissions. Editing quiz content after submissions can affect student scores and grading.",
        )


def touch_classic_quiz_after_question_push(
    client: CanvasClient,
    canvas_course_id: str,
    quiz_id: str,
    *,
    title: str | None,
    description: str | None,
    question_count: int | None = None,
    quiz_type: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "quiz[notify_of_update]": "false",
    }
    if title:
        payload["quiz[title]"] = title
    if description is not None:
        payload["quiz[description]"] = description
    if question_count is not None:
        payload["quiz[question_count]"] = str(question_count)
    if quiz_type:
        payload["quiz[quiz_type]"] = quiz_type
    return client.put_form(f"/courses/{canvas_course_id}/quizzes/{quiz_id}", payload)


async def list_quiz_questions(
    session_id: str,
    content_item_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    try:
        session, item = get_owned_quiz_item(supabase, session_id, content_item_id, user_id)
    except HTTPException as exc:
        if exc.status_code == 422 and "New Quizzes" in str(exc.detail):
            return {
                "status": "unsupported",
                "questions": [],
                "message": exc.detail,
            }
        raise

    all_local_rows = quiz_question_rows_for_parent(
        supabase,
        session_id,
        user_id,
        item["canvas_id"],
        include_pending_delete=True,
    )
    local_rows = [
        row
        for row in all_local_rows
        if not ((row.get("metadata") if isinstance(row.get("metadata"), dict) else {}).get("pending_delete"))
    ]
    if all_local_rows:
        return {
            "status": "ok",
            "questions": [normalize_local_quiz_question(row) for row in local_rows],
        }

    client, canvas_course_id = get_quiz_canvas_client(supabase, session, user_id)
    try:
        questions = client.get_paginated(
            f"/courses/{canvas_course_id}/quizzes/{item['canvas_id']}/questions"
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return {
                "status": "unsupported",
                "questions": [],
                "message": "No editable classic quiz questions were found. This quiz may use question banks or New Quizzes.",
            }
        raise HTTPException(status_code=502, detail=f"Canvas rejected the quiz question request: {exc.response.text}") from exc
    finally:
        client.close()

    now = datetime.now(timezone.utc).isoformat()
    inserted_rows: list[dict[str, Any]] = []
    for question in questions:
        question_id = question.get("id")
        if question_id is None:
            continue
        normalized = normalize_quiz_question(question, item["canvas_id"])
        answers = normalized["answers"]
        position = normalized["position"]
        question_text = normalized["question_text"]
        quiz_title = item.get("title") or "Quiz"
        row = {
            "session_id": session_id,
            "user_id": user_id,
            "canvas_id": local_quiz_question_canvas_id(item["canvas_id"], question_id),
            "content_type": "quiz_question",
            "title": quiz_question_row_title(quiz_title, position, question_id),
            "canvas_url": item.get("canvas_url"),
            "published": item.get("published"),
            "module_name": quiz_title,
            "position": position,
            "body_hash": sha256_payload({"html_body": quiz_question_body_html(question_text, answers)}),
            "body_word_count": word_count(html_to_text(quiz_question_body_html(question_text, answers))),
            "last_canvas_edit_at": item.get("last_canvas_edit_at"),
            "last_synced_at": now,
            "metadata": {
                "parent_quiz_canvas_id": str(item["canvas_id"]),
                "parent_quiz_title": quiz_title,
                "question_id": str(question_id),
                "question_text": question_text,
                "question_type": normalized["question_type"],
                "points_possible": normalized["points_possible"],
                "position": position,
                "answers": answers,
                "canvas_url": item.get("canvas_url"),
            },
            "updated_at": now,
        }
        existing = supabase.table("course_content_items").select("id").eq(
            "session_id", session_id
        ).eq("canvas_id", row["canvas_id"]).eq("content_type", "quiz_question").limit(1).execute()
        if existing.data:
            content_item_id_for_question = existing.data[0]["id"]
            supabase.table("course_content_items").update(row).eq("id", content_item_id_for_question).execute()
        else:
            insert_result = supabase.table("course_content_items").insert(row).execute()
            content_item_id_for_question = insert_result.data[0]["id"]
        html_body = quiz_question_body_html(question_text, answers)
        body_values = {
            "content_item_id": content_item_id_for_question,
            "html_body": html_body,
            "plain_text": html_to_text(html_body),
            "updated_at": now,
        }
        body_existing = supabase.table("course_content_bodies").select("content_item_id").eq(
            "content_item_id", content_item_id_for_question
        ).execute()
        if body_existing.data:
            supabase.table("course_content_bodies").update(body_values).eq("content_item_id", content_item_id_for_question).execute()
        else:
            body_values["extracted_at"] = now
            supabase.table("course_content_bodies").insert(body_values).execute()
        row["id"] = content_item_id_for_question
        inserted_rows.append(row)

    return {
        "status": "ok",
        "questions": [normalize_local_quiz_question(row) for row in inserted_rows],
    }


async def create_quiz_question(
    session_id: str,
    content_item_id: str,
    body: QuizQuestionCreateRequest,
    user: dict[str, Any],
) -> dict[str, Any]:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    _, item = get_owned_quiz_item(supabase, session_id, content_item_id, user_id)
    answers = quiz_question_payload_answers(body.answers)
    answers = quiz_answers_for_canvas(body.question_type, answers or [])
    question_id = f"local-{uuid.uuid4()}"
    position = len(quiz_question_rows_for_parent(supabase, session_id, user_id, item["canvas_id"])) + 1
    html_body = quiz_question_body_html(body.question_text, answers or [])
    now = datetime.now(timezone.utc).isoformat()
    quiz_title = item.get("title") or "Quiz"
    row = {
        "session_id": session_id,
        "user_id": user_id,
        "canvas_id": local_quiz_question_canvas_id(item["canvas_id"], question_id),
        "content_type": "quiz_question",
        "title": quiz_question_row_title(quiz_title, position, question_id),
        "canvas_url": item.get("canvas_url"),
        "published": item.get("published"),
        "module_name": quiz_title,
        "position": position,
        "body_hash": sha256_payload({"html_body": html_body}),
        "body_word_count": word_count(html_to_text(html_body)),
        "last_synced_at": "1970-01-01T00:00:00+00:00",
        "metadata": {
            "parent_quiz_canvas_id": str(item["canvas_id"]),
            "parent_quiz_title": quiz_title,
            "question_id": question_id,
            "question_text": body.question_text,
            "question_type": body.question_type,
            "points_possible": body.points_possible,
            "position": position,
            "answers": answers,
            "is_new_local": True,
            "canvas_url": item.get("canvas_url"),
        },
        "updated_at": now,
    }
    insert_result = supabase.table("course_content_items").insert(row).execute()
    if not insert_result.data:
        raise HTTPException(status_code=500, detail="Failed to create local quiz question")
    row["id"] = insert_result.data[0]["id"]
    supabase.table("course_content_bodies").insert({
        "content_item_id": row["id"],
        "html_body": html_body,
        "plain_text": html_to_text(html_body),
        "extracted_at": now,
        "updated_at": now,
    }).execute()
    supabase.table("content_revisions").insert({
        "content_item_id": row["id"],
        "session_id": session_id,
        "user_id": user_id,
        "revision_number": 1,
        "before_title": None,
        "after_title": row["title"],
        "before_html": "",
        "after_html": html_body,
        "change_summary": quiz_question_change_summary(row["metadata"], "added"),
    }).execute()
    return {"status": "ok", "question": normalize_local_quiz_question(row)}


async def update_quiz_question(
    session_id: str,
    content_item_id: str,
    question_id: str,
    body: QuizQuestionUpdateRequest,
    user: dict[str, Any],
) -> dict[str, Any]:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    answers = quiz_question_payload_answers(body.answers)
    _, item = get_owned_quiz_item(supabase, session_id, content_item_id, user_id)
    rows = quiz_question_rows_for_parent(supabase, session_id, user_id, item["canvas_id"])
    target = next((row for row in rows if quiz_question_row_matches(row, item["canvas_id"], question_id)), None)
    if not target:
        raise HTTPException(status_code=404, detail="Quiz question not found")
    metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
    current_html_result = supabase.table("course_content_bodies").select("html_body").eq(
        "content_item_id", target["id"]
    ).limit(1).execute()
    current_html = (current_html_result.data[0].get("html_body") if current_html_result.data else "") or ""
    next_metadata = {
        **metadata,
        "question_text": body.question_text if body.question_text is not None else metadata.get("question_text", ""),
        "question_type": body.question_type if body.question_type is not None else metadata.get("question_type", "multiple_choice_question"),
        "points_possible": body.points_possible if body.points_possible is not None else metadata.get("points_possible", 0),
        "answers": answers if answers is not None else (metadata.get("answers") if isinstance(metadata.get("answers"), list) else []),
    }
    if next_metadata["question_type"] == "text_only_question":
        next_metadata["points_possible"] = 0
    next_metadata["answers"] = quiz_answers_for_canvas(next_metadata["question_type"], next_metadata["answers"])
    html_body = quiz_question_body_html(next_metadata["question_text"], next_metadata["answers"])
    now = datetime.now(timezone.utc).isoformat()
    next_title = quiz_question_row_title(metadata.get("parent_quiz_title") or item.get("title"), next_metadata.get("position"), question_id)
    supabase.table("course_content_items").update({
        "title": next_title,
        "body_hash": sha256_payload({"html_body": html_body}),
        "body_word_count": word_count(html_to_text(html_body)),
        "metadata": next_metadata,
        "updated_at": now,
    }).eq("id", target["id"]).execute()
    body_values = {
        "content_item_id": target["id"],
        "html_body": html_body,
        "plain_text": html_to_text(html_body),
        "updated_at": now,
    }
    if current_html_result.data:
        supabase.table("course_content_bodies").update(body_values).eq("content_item_id", target["id"]).execute()
    else:
        body_values["extracted_at"] = now
        supabase.table("course_content_bodies").insert(body_values).execute()
    revision_number = next_revision_number(supabase, target["id"])
    supabase.table("content_revisions").insert({
        "content_item_id": target["id"],
        "session_id": session_id,
        "user_id": user_id,
        "revision_number": revision_number,
        "before_title": target.get("title"),
        "after_title": next_title,
        "before_html": current_html,
        "after_html": html_body,
        "change_summary": quiz_question_change_summary(next_metadata, "edited"),
    }).execute()
    target["metadata"] = next_metadata
    return {"status": "ok", "question": normalize_local_quiz_question(target), "revision_number": revision_number}


async def delete_quiz_question(
    session_id: str,
    content_item_id: str,
    question_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    user_id = user_id_from_token(user)
    supabase = get_supabase()
    _, item = get_owned_quiz_item(supabase, session_id, content_item_id, user_id)
    rows = quiz_question_rows_for_parent(
        supabase,
        session_id,
        user_id,
        item["canvas_id"],
        include_pending_delete=True,
    )
    target = next((row for row in rows if quiz_question_row_matches(row, item["canvas_id"], question_id)), None)
    if not target:
        raise HTTPException(status_code=404, detail="Quiz question not found")
    metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
    if metadata.get("is_new_local"):
        supabase.table("content_revisions").delete().eq("content_item_id", target["id"]).execute()
        supabase.table("course_content_bodies").delete().eq("content_item_id", target["id"]).execute()
        supabase.table("course_content_items").delete().eq("id", target["id"]).execute()
        return {"status": "ok", "deleted": True}

    current_html_result = supabase.table("course_content_bodies").select("html_body").eq(
        "content_item_id", target["id"]
    ).limit(1).execute()
    current_html = (current_html_result.data[0].get("html_body") if current_html_result.data else "") or ""
    next_metadata = {**metadata, "pending_delete": True}
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("course_content_items").update({
        "metadata": next_metadata,
        "updated_at": now,
    }).eq("id", target["id"]).execute()
    revision_number = next_revision_number(supabase, target["id"])
    supabase.table("content_revisions").insert({
        "content_item_id": target["id"],
        "session_id": session_id,
        "user_id": user_id,
        "revision_number": revision_number,
        "before_title": target.get("title"),
        "after_title": target.get("title"),
        "before_html": current_html,
        "after_html": "",
        "change_summary": quiz_question_change_summary(metadata, "deleted"),
    }).execute()
    return {"status": "ok", "pending_delete": True, "revision_number": revision_number}
