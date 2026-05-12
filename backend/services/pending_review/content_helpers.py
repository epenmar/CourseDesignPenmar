"""Shared Pending Review helpers for content change and push workflows."""

from __future__ import annotations

from datetime import datetime

from canvas_sync import html_to_text
from content_inventory import compact_whitespace


EDITABLE_CONTENT_TYPES = ["page", "assignment", "discussion", "quiz", "quiz_question"]


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def html_word_delta(before_html: str | None, after_html: str | None) -> dict[str, int]:
    before_words = len(compact_whitespace(html_to_text(before_html or "")).split())
    after_words = len(compact_whitespace(html_to_text(after_html or "")).split())
    return {
        "before_word_count": before_words,
        "after_word_count": after_words,
        "word_delta": after_words - before_words,
    }


def content_change_fields(title_changed: bool, body_changed: bool) -> list[str]:
    fields = []
    if title_changed:
        fields.append("title")
    if body_changed:
        fields.append("body")
    return fields or ["metadata"]
