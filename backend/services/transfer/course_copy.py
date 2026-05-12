"""Canvas course-copy helpers for Transfer workflows."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from canvas_sync import CanvasClient


def canvas_copy_hosts_compatible(source_base_url: str, target_base_url: str) -> bool:
    source_host = (urlparse(source_base_url).hostname or "").lower()
    target_host = (urlparse(target_base_url).hostname or "").lower()
    if source_host == target_host:
        return True
    asu_hosts = {"canvas.asu.edu", "asu.instructure.com"}
    return source_host in asu_hosts and target_host in asu_hosts


def start_canvas_course_copy(client: CanvasClient, *, target_course_id: str, source_course_id: str) -> dict[str, Any]:
    return client.post_form(
        f"/courses/{target_course_id}/content_migrations",
        {
            "migration_type": "course_copy_importer",
            "settings[source_course_id]": source_course_id,
        },
    )


def canvas_migration_completion(status: dict[str, Any]) -> float:
    raw_completion = status.get("completion")
    if raw_completion is None:
        progress = status.get("progress")
        raw_completion = progress.get("completion") if isinstance(progress, dict) else progress
    try:
        return max(0, min(float(raw_completion or 0), 100))
    except (TypeError, ValueError):
        return 0


def canvas_migration_issues(client: CanvasClient, *, target_course_id: str, migration_id: str) -> list[dict[str, Any]]:
    issues = client.get_paginated(f"/courses/{target_course_id}/content_migrations/{migration_id}/migration_issues")
    return [issue for issue in issues if isinstance(issue, dict)]
