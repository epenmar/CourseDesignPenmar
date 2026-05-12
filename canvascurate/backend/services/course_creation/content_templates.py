"""Reusable Canvas Create content templates.

The AI drafts structured content for these templates; rendering stays
deterministic so generated pages keep a consistent Canvas-ready shape.
"""

from __future__ import annotations

import html
from typing import Any


SECTION_BORDER = "border-bottom:2px solid #8C1D40; padding-bottom:8px; margin-top:28px; font-size:18pt; margin-bottom:8px;"
CALLOUT_STYLE = "background:#8c1d40; color:#fff; padding:14px 16px; border-radius:6px; margin:18px 0;"


def compact_text(value: Any, limit: int = 500) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


def normalize_template_kind(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"overview", "learningmaterials", "assignment", "discussion", "quiz"}:
        return normalized
    return "overview"


def template_schema_for_prompt(template_kind: str) -> dict[str, Any]:
    schemas: dict[str, dict[str, Any]] = {
        "overview": {
            "overview_paragraphs": ["2-3 concise paragraphs"],
            "objectives": ["3-5 measurable objectives"],
            "tasks": ["3-6 concrete learner tasks"],
        },
        "learningmaterials": {
            "overview_paragraphs": ["1-2 concise paragraphs"],
            "required_reading": ["source-backed reading or review tasks"],
            "required_videos": ["source-backed video/media tasks, if supported"],
            "grey_box_content": ["optional activity or study reminder"],
        },
        "assignment": {
            "subtitle": "short assignment subtitle",
            "description_paragraphs": ["1-2 paragraphs"],
            "objectives": ["2-4 measurable objectives"],
            "directions_paragraphs": ["brief setup paragraph"],
            "directions_list": ["4-7 student-facing steps"],
            "evaluation_paragraphs": ["brief grading explanation"],
            "evaluation_list": ["3-5 grading criteria"],
            "points": 100,
        },
        "discussion": {
            "overview": "brief paragraph",
            "discussion_question": "student-facing prompt",
            "original_post": "original post expectations",
            "replies": "reply expectations",
            "instructions": "participation instructions",
            "grading": "brief grading expectations",
        },
        "quiz": {
            "about_paragraphs": ["1-2 paragraphs"],
            "objectives": ["3-5 objectives"],
            "guidance_paragraphs": ["2-3 student-facing guidance paragraphs"],
            "quiz_config": {
                "pick_count": 10,
                "points_per_question": 10,
                "shuffle_answers": True,
                "allowed_attempts": 1,
            },
        },
    }
    return schemas.get(normalize_template_kind(template_kind), schemas["overview"])


def build_template_content(
    *,
    template_kind: str,
    module: dict[str, Any],
    item: dict[str, Any],
    setup: dict[str, Any],
    source_summaries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    kind = normalize_template_kind(template_kind)
    title = compact_text(item.get("title"), 180) or "Draft Item"
    module_title = compact_text(module.get("title"), 180)
    course_title = compact_text(setup.get("course_title"), 180)
    purpose = compact_text(item.get("purpose"), 700)
    overview = compact_text(module.get("overview"), 900)
    objectives = _clean_list(module.get("objectives"), 5, 220)
    topics = _clean_list(module.get("topics"), 6, 140)
    source_ids = _clean_list(item.get("source_chunk_ids"), 10, 140)
    source_notes = [
        compact_text(source.get("summary"), 220)
        for source in (source_summaries or [])
        if compact_text(source.get("summary"), 220)
    ][:4]

    common_intro = " ".join(
        part
        for part in [
            f"This item belongs to {module_title}." if module_title else "",
            purpose,
            overview,
        ]
        if part
    )
    if not common_intro:
        common_intro = f"This draft supports {course_title or 'the course'}."

    if kind == "learningmaterials":
        return {
            "page_title": title,
            "overview_paragraphs": [common_intro],
            "required_reading": _default_materials(source_notes, topics, "Review"),
            "required_videos": [],
            "grey_box_content": ["Use the listed materials to prepare for this module's activities and assessments."],
            "source_chunk_ids": source_ids,
        }
    if kind == "assignment":
        return {
            "page_title": title,
            "module_number": _module_number(module.get("id")),
            "subtitle": title,
            "description_paragraphs": [common_intro],
            "objectives": objectives or [f"Apply concepts from {module_title or 'this module'}."],
            "directions_paragraphs": ["Complete the following steps and submit your work in Canvas."],
            "directions_list": _default_tasks(topics, "Apply"),
            "evaluation_paragraphs": ["Your work will be evaluated for accuracy, use of course concepts, and clarity."],
            "evaluation_list": ["Addresses the prompt completely.", "Uses course vocabulary accurately.", "Explains reasoning clearly."],
            "points": 100,
            "source_chunk_ids": source_ids,
        }
    if kind == "discussion":
        return {
            "page_title": title,
            "module_number": _module_number(module.get("id")),
            "overview": _paragraph(common_intro),
            "discussion_question": _paragraph(purpose or f"Discuss a key idea from {module_title or 'this module'}."),
            "original_post": _paragraph("Post a response that uses specific evidence from the module materials."),
            "replies": _paragraph("Reply to classmates by extending, questioning, or connecting their ideas to the course content."),
            "instructions": _paragraph("Write in complete sentences, cite source material when useful, and maintain professional netiquette."),
            "grading": _paragraph("Credit is based on completion, relevance to the prompt, evidence use, and substantive replies."),
            "source_chunk_ids": source_ids,
        }
    if kind == "quiz":
        return {
            "page_title": title,
            "about_paragraphs": [common_intro],
            "objectives": objectives or [f"Check understanding of {topic}." for topic in topics[:3]],
            "guidance_paragraphs": [
                "Use this quiz to check your understanding of the module's major concepts.",
                "Review the module materials before beginning and note concepts that need additional study.",
            ],
            "quiz_config": {
                "pick_count": 10,
                "points_per_question": 10,
                "shuffle_answers": True,
                "allowed_attempts": 1,
            },
            "source_chunk_ids": source_ids,
        }
    return {
        "page_title": title,
        "overview_paragraphs": [common_intro],
        "objectives": objectives or [f"Summarize key concepts from {module_title or 'this module'}."],
        "tasks": _default_tasks(topics, "Review"),
        "source_chunk_ids": source_ids,
    }


def merge_ai_template_content(
    *,
    template_kind: str,
    fallback_content: dict[str, Any],
    ai_content: dict[str, Any],
) -> dict[str, Any]:
    schema = template_schema_for_prompt(template_kind)
    merged = dict(fallback_content)
    for key in schema:
        if key not in ai_content:
            continue
        value = ai_content.get(key)
        if isinstance(schema[key], list):
            cleaned = _clean_list(value, 10, 700)
            if cleaned:
                merged[key] = cleaned
        elif isinstance(schema[key], dict):
            if isinstance(value, dict):
                merged[key] = {**merged.get(key, {}), **value}
        elif isinstance(schema[key], int):
            if isinstance(value, (int, float)) and value >= 0:
                merged[key] = int(value)
        else:
            cleaned_text = compact_text(value, 1200)
            if cleaned_text:
                merged[key] = cleaned_text
    return merged


def render_template_html(template_kind: str, content: dict[str, Any]) -> str:
    kind = normalize_template_kind(template_kind)
    if kind == "learningmaterials":
        return _render_learning_materials(content)
    if kind == "assignment":
        return _render_assignment(content)
    if kind == "discussion":
        return _render_discussion(content)
    if kind == "quiz":
        return _render_quiz(content)
    return _render_overview(content)


def _render_overview(content: dict[str, Any]) -> str:
    parts = [_callout("About This Module")]
    parts.append(_section("Overview", _paragraphs(content.get("overview_paragraphs"))))
    parts.append(_list_section("Learning Objectives", content.get("objectives"), intro="By the end of the module, students will be able to:"))
    parts.append(_ordered_section("Task List", content.get("tasks"), intro="During this module, please complete the following:"))
    parts.append(_source_references(content))
    return "\n".join(part for part in parts if part)


def _render_learning_materials(content: dict[str, Any]) -> str:
    parts = [_section("Overview", _paragraphs(content.get("overview_paragraphs")))]
    parts.append(_list_section("Required Reading", content.get("required_reading"), intro="Please complete the following required reading:"))
    parts.append(_list_section("Required Videos", content.get("required_videos"), intro="Please watch the following videos:"))
    grey_box = _paragraphs(content.get("grey_box_content"))
    if grey_box:
        parts.append(f'<div style="background-color:#eeeeee; padding:16px; margin:28px 0; border-radius:4px;">{grey_box}</div>')
    parts.append(_source_references(content))
    return "\n".join(part for part in parts if part)


def _render_assignment(content: dict[str, Any]) -> str:
    module_number = compact_text(content.get("module_number"), 20)
    subtitle = compact_text(content.get("subtitle"), 180)
    parts = []
    if module_number:
        parts.append(f'<div style="{CALLOUT_STYLE}"><h2 style="margin:0;">Module {html.escape(module_number)}</h2></div>')
    if subtitle:
        parts.append(f'<div style="background:#000; color:#fff; padding:10px 12px; margin-top:8px; font-size:20px; font-weight:700;">{html.escape(subtitle)}</div>')
    parts.append(_section("Description", _paragraphs(content.get("description_paragraphs"))))
    parts.append(_list_section("Objectives", content.get("objectives"), intro="Students will be able to:"))
    directions = _paragraphs(content.get("directions_paragraphs")) + _ordered_list(content.get("directions_list"))
    parts.append(_section("Directions", directions))
    evaluation = _paragraphs(content.get("evaluation_paragraphs")) + _unordered_list(content.get("evaluation_list"))
    parts.append(_section("Evaluation", evaluation))
    parts.append(_source_references(content))
    return "\n".join(part for part in parts if part)


def _render_discussion(content: dict[str, Any]) -> str:
    parts = []
    parts.append(_section("Overview", _html_text(content.get("overview"))))
    parts.append(_section("Discussion Question", _html_text(content.get("discussion_question"))))
    parts.append(_section("Original Post", _html_text(content.get("original_post"), tag="h3")))
    parts.append(_section("Replies", _html_text(content.get("replies"), tag="h3")))
    parts.append(_section("Instructions", _html_text(content.get("instructions"))))
    parts.append(
        '<div style="margin:28px 0; background-color:#eeeeee; padding:16px; border-radius:4px;">'
        "Please use professional netiquette and follow your course syllabus policies while participating."
        "</div>"
    )
    parts.append(_section("Grading", _html_text(content.get("grading"))))
    parts.append(_source_references(content))
    return "\n".join(part for part in parts if part)


def _render_quiz(content: dict[str, Any]) -> str:
    parts = [_callout("About This Quiz")]
    parts.append(_paragraphs(content.get("about_paragraphs")))
    parts.append(_list_section("Learning Objectives", content.get("objectives")))
    parts.append(_section("Guidance on Taking the Quiz", _paragraphs(content.get("guidance_paragraphs"))))
    config = content.get("quiz_config") if isinstance(content.get("quiz_config"), dict) else {}
    if config:
        config_items = [
            f"{label}: {config.get(key)}"
            for key, label in (
                ("pick_count", "Question count"),
                ("points_per_question", "Points per question"),
                ("allowed_attempts", "Allowed attempts"),
            )
            if config.get(key) is not None
        ]
        parts.append(_list_section("Quiz Setup Notes", config_items))
    parts.append(_source_references(content))
    return "\n".join(part for part in parts if part)


def _callout(title: str) -> str:
    return f'<div style="{CALLOUT_STYLE}"><h2 style="margin:0; font-size:18pt;">{html.escape(title)}</h2></div>'


def _section(title: str, body: str) -> str:
    if not body:
        return ""
    return f'<h2 style="{SECTION_BORDER}">{html.escape(title)}</h2>\n{body}'


def _list_section(title: str, items: Any, *, intro: str | None = None) -> str:
    body = ""
    if intro:
        body += f"<p><strong>{html.escape(intro)}</strong></p>\n"
    body += _unordered_list(items)
    return _section(title, body) if body.strip() else ""


def _ordered_section(title: str, items: Any, *, intro: str | None = None) -> str:
    body = ""
    if intro:
        body += f"<p><strong>{html.escape(intro)}</strong></p>\n"
    body += _ordered_list(items)
    return _section(title, body) if body.strip() else ""


def _paragraphs(values: Any) -> str:
    return "\n".join(_paragraph(value) for value in _clean_list(values, 10, 1000))


def _paragraph(value: Any) -> str:
    text = compact_text(value, 1200)
    return f"<p>{html.escape(text)}</p>" if text else ""


def _html_text(value: Any, *, tag: str = "p") -> str:
    text = compact_text(value, 1600)
    if not text:
        return ""
    safe_tag = tag if tag in {"p", "h3"} else "p"
    return f"<{safe_tag}>{html.escape(text)}</{safe_tag}>"


def _unordered_list(values: Any) -> str:
    items = _clean_list(values, 12, 700)
    if not items:
        return ""
    return "<ul>\n" + "\n".join(f"<li>{html.escape(item)}</li>" for item in items) + "\n</ul>"


def _ordered_list(values: Any) -> str:
    items = _clean_list(values, 12, 700)
    if not items:
        return ""
    return "<ol>\n" + "\n".join(f"<li>{html.escape(item)}</li>" for item in items) + "\n</ol>"


def _source_references(content: dict[str, Any]) -> str:
    source_ids = _clean_list(content.get("source_chunk_ids"), 12, 140)
    if not source_ids:
        return ""
    return _section("Source References", "<ul>\n" + "\n".join(f"<li><code>{html.escape(source_id)}</code></li>" for source_id in source_ids) + "\n</ul>")


def _clean_list(values: Any, limit: int, text_limit: int) -> list[str]:
    if not isinstance(values, list):
        return []
    cleaned = [compact_text(value, text_limit) for value in values]
    return [value for value in cleaned if value][:limit]


def _default_tasks(topics: list[str], verb: str) -> list[str]:
    if not topics:
        return [f"{verb} the assigned module materials.", "Complete the module activity.", "Prepare for the module assessment."]
    return [f"{verb} {topic}." for topic in topics[:5]]


def _default_materials(source_notes: list[str], topics: list[str], verb: str) -> list[str]:
    if source_notes:
        return source_notes
    return _default_tasks(topics, verb)


def _module_number(value: Any) -> int:
    text = compact_text(value, 60)
    digits = "".join(character for character in text if character.isdigit())
    return int(digits) if digits else 0
