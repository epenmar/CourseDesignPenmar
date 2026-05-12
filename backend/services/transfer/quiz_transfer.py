"""Classic Canvas quiz helpers for Transfer jobs."""

from __future__ import annotations

import re
from typing import Any

from canvas_sync import CanvasClient


QUIZ_ANSWER_FIELDS = (
    "id",
    "text",
    "html",
    "answer_text",
    "answer_html",
    "weight",
    "answer_weight",
    "blank_id",
    "left",
    "right",
    "match_id",
    "answer_match_left",
    "answer_match_right",
    "matching_answer_incorrect_matches",
    "numerical_answer_type",
    "exact",
    "margin",
    "approximate",
    "precision",
    "start",
    "end",
)


def is_classic_quiz(row: dict[str, Any]) -> bool:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return not (metadata.get("source_content_type") == "assignment" and not metadata.get("quiz_type"))


def local_quiz_question_canvas_id(quiz_id: str | int, question_id: str | int) -> str:
    return f"quiz:{quiz_id}:question:{question_id}"


def answer_weight_value(answer: dict[str, Any]) -> float:
    value = answer.get("weight") if answer.get("weight") is not None else answer.get("answer_weight", 0)
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


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


def quiz_question_text_from_body(html_body: str | None, *, has_answer_list: bool = False) -> str:
    if not html_body:
        return ""
    if not has_answer_list:
        return html_body
    parts = re.split(r"<\s*ol\b", html_body, maxsplit=1, flags=re.IGNORECASE)
    return parts[0].strip() or html_body


def quiz_question_payload(row: dict[str, Any], html_body: str | None, *, target_quiz_id: str | None = None) -> dict[str, Any]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    answers = metadata.get("answers") if isinstance(metadata.get("answers"), list) else []
    question_type = metadata.get("question_type") or "multiple_choice_question"
    question_text = quiz_question_text_from_body(
        html_body,
        has_answer_list=bool(answers),
    ) or metadata.get("question_text") or ""
    return {
        "question_text": question_text,
        "question_type": question_type,
        "points_possible": 0 if question_type == "text_only_question" else metadata.get("points_possible") or 0,
        "position": metadata.get("position") or row.get("position") or 1,
        "answers": quiz_answers_for_canvas(question_type, answers),
    }


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
        updated_metadata["question_type"] = (
            "true_false_question"
            if metadata.get("question_type") == "true_false_question" and response_question_type == "multiple_choice_question"
            else response_question_type
        )
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


def create_canvas_quiz(
    client: CanvasClient,
    *,
    course_id: str,
    title: str,
    html_body: str,
    published: bool = False,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = metadata or {}
    payload: dict[str, Any] = {
        "quiz[title]": title,
        "quiz[description]": html_body,
        "quiz[published]": str(published).lower(),
    }
    if metadata.get("quiz_type"):
        payload["quiz[quiz_type]"] = str(metadata["quiz_type"])
    if metadata.get("points_possible") is not None:
        payload["quiz[points_possible]"] = str(metadata["points_possible"])
    return client.post_form(f"/courses/{course_id}/quizzes", payload)


def update_canvas_quiz(
    client: CanvasClient,
    *,
    course_id: str,
    quiz_id: str,
    title: str | None = None,
    html_body: str | None = None,
    published: bool | None = None,
    question_count: int | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"quiz[notify_of_update]": "false"}
    if title:
        payload["quiz[title]"] = title
    if html_body is not None:
        payload["quiz[description]"] = html_body
    if published is not None:
        payload["quiz[published]"] = str(published).lower()
    if question_count is not None:
        payload["quiz[question_count]"] = str(question_count)
    return client.put_form(f"/courses/{course_id}/quizzes/{quiz_id}", payload)


def create_quiz_question(client: CanvasClient, *, course_id: str, quiz_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return client.post_json(f"/courses/{course_id}/quizzes/{quiz_id}/questions", {"question": payload})


def update_quiz_question(client: CanvasClient, *, course_id: str, quiz_id: str, question_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return client.put_json(f"/courses/{course_id}/quizzes/{quiz_id}/questions/{question_id}", {"question": payload})


def delete_quiz_question(client: CanvasClient, *, course_id: str, quiz_id: str, question_id: str) -> dict[str, Any]:
    return client.delete(f"/courses/{course_id}/quizzes/{quiz_id}/questions/{question_id}")


def delete_canvas_quiz(client: CanvasClient, *, course_id: str, quiz_id: str) -> dict[str, Any]:
    return client.delete(f"/courses/{course_id}/quizzes/{quiz_id}")
