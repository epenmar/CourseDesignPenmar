"""Content link discovery and remapping helpers for Transfer workflows."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote, urlparse


def _metadata(row: dict[str, Any] | None) -> dict[str, Any]:
    value = row.get("metadata") if row else None
    return value if isinstance(value, dict) else {}


def page_lookup_keys(row: dict[str, Any]) -> set[str]:
    keys = {str(row.get("canvas_id") or "").strip()}
    metadata = _metadata(row)
    if metadata.get("url"):
        keys.add(str(metadata["url"]).strip())
    canvas_url = str(row.get("canvas_url") or "")
    if canvas_url:
        path = unquote(urlparse(canvas_url).path)
        match = re.search(r"/pages/([^/?#]+)", path)
        if match:
            keys.add(match.group(1).strip())
    return {key for key in keys if key}


def supported_content_lookup(content_by_id: dict[str, dict[str, Any]]) -> dict[tuple[str, str], str]:
    lookup: dict[tuple[str, str], str] = {}
    for content_item_id, row in content_by_id.items():
        content_type = str(row.get("content_type") or "")
        canvas_id = str(row.get("canvas_id") or "").strip()
        if content_type == "page":
            for key in page_lookup_keys(row):
                lookup[("page", key)] = content_item_id
        elif content_type in {"assignment", "discussion", "quiz"} and canvas_id:
            lookup[(content_type, canvas_id)] = content_item_id
    return lookup


def href_paths(html: str) -> list[str]:
    paths: list[str] = []
    for raw_href in re.findall(r"""href=["']([^"']+)["']""", html or "", flags=re.IGNORECASE):
        href = unquote(raw_href.strip())
        parsed = urlparse(href)
        path = parsed.path if parsed.scheme and parsed.netloc else href.split("?", 1)[0].split("#", 1)[0]
        if path:
            paths.append(path)
    return paths


def content_refs_from_html(html: str, *, source_course_id: str | None) -> set[tuple[str, str]]:
    refs: set[tuple[str, str]] = set()
    for path in href_paths(html):
        if "/courses/" in path:
            if source_course_id and f"/courses/{source_course_id}/" not in path:
                continue
        page_match = re.search(r"/pages/([^/?#]+)", path)
        if page_match:
            refs.add(("page", page_match.group(1)))
        for content_type, pattern in (
            ("assignment", r"/assignments/(\d+)"),
            ("discussion", r"/discussion_topics/(\d+)"),
            ("quiz", r"/quizzes/(\d+)"),
        ):
            match = re.search(pattern, path)
            if match:
                refs.add((content_type, match.group(1)))
    return refs


def expand_with_linked_supported_content(
    *,
    initial_ids: list[str],
    supported_content_by_id: dict[str, dict[str, Any]],
    bodies_by_id: dict[str, dict[str, Any]],
    source_course_id: str | None,
    html_values_by_content_id: dict[str, list[str]] | None = None,
) -> tuple[list[str], list[str]]:
    lookup = supported_content_lookup(supported_content_by_id)
    selected = set(initial_ids)
    ordered = list(dict.fromkeys(initial_ids))
    discovered: list[str] = []
    queue = list(ordered)

    while queue and len(ordered) < 500:
        content_item_id = queue.pop(0)
        html_values = (html_values_by_content_id or {}).get(content_item_id)
        if html_values is None:
            html_values = [str((bodies_by_id.get(content_item_id) or {}).get("html_body") or "")]
        for html_body in html_values:
            for ref in content_refs_from_html(html_body, source_course_id=source_course_id):
                linked_id = lookup.get(ref)
                if not linked_id or linked_id in selected:
                    continue
                selected.add(linked_id)
                ordered.append(linked_id)
                discovered.append(linked_id)
                queue.append(linked_id)
    return ordered, discovered


def remap_content_links(
    html: str,
    *,
    source_course_id: str | None,
    target_course_id: str,
    page_url_map: dict[str, str],
    assignment_id_map: dict[str, str],
    discussion_id_map: dict[str, str],
    file_id_map: dict[str, str],
    quiz_id_map: dict[str, str] | None = None,
) -> str:
    if not html:
        return html
    next_html = html
    if source_course_id:
        next_html = next_html.replace(f"/courses/{source_course_id}/", f"/courses/{target_course_id}/")
    for old_url, new_url in page_url_map.items():
        if old_url and new_url and old_url != new_url:
            next_html = next_html.replace(f"/pages/{old_url}", f"/pages/{new_url}")
    for old_id, new_id in assignment_id_map.items():
        if old_id and new_id and old_id != new_id:
            next_html = next_html.replace(f"/assignments/{old_id}", f"/assignments/{new_id}")
    for old_id, new_id in discussion_id_map.items():
        if old_id and new_id and old_id != new_id:
            next_html = next_html.replace(f"/discussion_topics/{old_id}", f"/discussion_topics/{new_id}")
    for old_id, new_id in (quiz_id_map or {}).items():
        if old_id and new_id and old_id != new_id:
            next_html = next_html.replace(f"/quizzes/{old_id}", f"/quizzes/{new_id}")
    for old_id, new_id in file_id_map.items():
        if old_id and new_id and old_id != new_id:
            next_html = re.sub(
                rf"(?P<prefix>/files/){re.escape(old_id)}(?P<suffix>(?:/(?:preview|download))?)(?=[?\"'<> \t\r\n/]|$)",
                rf"\g<prefix>{new_id}\g<suffix>",
                next_html,
            )
    return next_html


def remapped_quiz_question_row(
    question: dict[str, Any],
    *,
    source_course_id: str | None,
    target_course_id: str,
    page_url_map: dict[str, str],
    assignment_id_map: dict[str, str],
    discussion_id_map: dict[str, str],
    quiz_id_map: dict[str, str],
    file_id_map: dict[str, str],
) -> dict[str, Any]:
    metadata = _metadata(question)
    answers = metadata.get("answers") if isinstance(metadata.get("answers"), list) else []
    next_answers: list[dict[str, Any]] = []
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        next_answer = dict(answer)
        for key in ("html", "answer_html", "text", "answer_text", "left", "right", "answer_match_left", "answer_match_right"):
            if isinstance(next_answer.get(key), str):
                next_answer[key] = remap_content_links(
                    next_answer[key],
                    source_course_id=source_course_id,
                    target_course_id=target_course_id,
                    page_url_map=page_url_map,
                    assignment_id_map=assignment_id_map,
                    discussion_id_map=discussion_id_map,
                    file_id_map=file_id_map,
                    quiz_id_map=quiz_id_map,
                )
        next_answers.append(next_answer)
    return {
        **question,
        "metadata": {
            **metadata,
            "answers": next_answers,
        },
    }
