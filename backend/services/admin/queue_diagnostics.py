"""Read-only queue diagnostics for system administrators."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any


ACTIVE_STATUSES = {"queued", "retrying", "running"}
DISPLAY_STATUSES = ("queued", "retrying", "running", "succeeded", "failed")
WARNING_RANK = {"none": 0, "info": 1, "warning": 2, "critical": 3}

JOB_GROUPS: dict[str, tuple[str, ...]] = {
    "pdf": (
        "document_analysis",
        "document_remediation",
        "document_structure_preview",
        "pdf_export",
    ),
    "ai": (
        "tagflow_ai_suggestions",
        "image_text_generate",
        "image_text_bulk_generate",
        "pdf_figure_text_generate",
        "link_text_bulk_suggest",
        "course_creation_outline",
        "course_creation_draft",
    ),
    "canvas": (
        "canvas_pull",
        "health_run",
        "standalone_document_canvas_deploy",
        "document_replacement_deploy",
        "document_file_archive",
        "transfer_target_backup",
        "reports_course_backup",
    ),
    "transfer": (
        "transfer_target_push",
        "transfer_same_course_push",
        "transfer_course_copy",
        "transfer_target_backup",
    ),
    "course_creation": (
        "course_creation_source_extract",
        "course_creation_outline",
        "course_creation_draft",
    ),
    "reports": (
        "reports_course_backup",
    ),
}

JOB_TYPE_GROUPS: dict[str, list[str]] = {}
for group_name, job_types in JOB_GROUPS.items():
    for job_type in job_types:
        JOB_TYPE_GROUPS.setdefault(job_type, []).append(group_name)


def _string(value: Any) -> str:
    return str(value or "")


def _trim_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    allowed = (
        "session_id",
        "document_id",
        "content_item_id",
        "canvas_file_id",
        "filename",
        "scope",
        "mode",
        "target_course_id",
        "course_id",
    )
    return {key: payload.get(key) for key in allowed if payload.get(key) is not None}


def _job_group(job_type: str) -> str:
    groups = JOB_TYPE_GROUPS.get(job_type)
    if not groups:
        return "other"
    if len(groups) == 1:
        return groups[0]
    if "ai" in groups and "course_creation" in groups:
        return "ai"
    if "canvas" in groups and "transfer" in groups:
        return "transfer"
    if "canvas" in groups and "reports" in groups:
        return "reports"
    return groups[0]


def _new_group_bucket(group_name: str) -> dict[str, Any]:
    return {
        "group": group_name,
        "total": 0,
        "active_total": 0,
        "oldest_active_queued_at": None,
        "latest_queued_at": None,
        "warning_level": "none",
        "warning_message": None,
        **{status_name: 0 for status_name in DISPLAY_STATUSES},
    }


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _apply_group_warning(bucket: dict[str, Any], *, now: datetime) -> None:
    active_total = int(bucket.get("active_total") or 0)
    queued = int(bucket.get("queued") or 0)
    retrying = int(bucket.get("retrying") or 0)
    failed = int(bucket.get("failed") or 0)
    oldest_active = _parse_datetime(bucket.get("oldest_active_queued_at"))
    oldest_active_age_seconds = int((now - oldest_active).total_seconds()) if oldest_active else None
    bucket["oldest_active_age_seconds"] = oldest_active_age_seconds
    if (oldest_active_age_seconds is not None and oldest_active_age_seconds >= 1800) or active_total >= 10 or retrying >= 3:
        bucket["warning_level"] = "critical"
        bucket["warning_message"] = "Worker pool has a significant or aging active backlog."
    elif (oldest_active_age_seconds is not None and oldest_active_age_seconds >= 600) or active_total >= 5:
        bucket["warning_level"] = "warning"
        bucket["warning_message"] = "Worker pool is building or holding a backlog."
    elif failed >= 3 and active_total == 0:
        bucket["warning_level"] = "warning"
        bucket["warning_message"] = "Recent failures may need review before more jobs are queued."
    elif queued > 0:
        bucket["warning_level"] = "info"
        bucket["warning_message"] = "Jobs are waiting for this worker pool."


def _warning_rank(level: str | None) -> int:
    return WARNING_RANK.get(str(level or "none"), 0)


def _chunks(values: list[str], size: int = 50):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def build_queue_diagnostics(supabase, *, limit: int = 500) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    result = supabase.table("background_jobs").select(
        "id, user_id, session_id, job_type, status, attempts, max_attempts, payload, "
        "error_message, queued_at, started_at, finished_at"
    ).order("queued_at", desc=True).limit(limit).execute()
    jobs = result.data or []

    user_ids = sorted({_string(job.get("user_id")) for job in jobs if job.get("user_id")})
    session_ids = sorted({_string(job.get("session_id")) for job in jobs if job.get("session_id")})

    profiles_by_id: dict[str, dict[str, Any]] = {}
    if user_ids:
        for user_id_chunk in _chunks(user_ids):
            profiles_result = supabase.table("user_profiles").select(
                "id, email, full_name, role"
            ).in_("id", user_id_chunk).execute()
            profiles_by_id.update({_string(row.get("id")): row for row in profiles_result.data or []})

    sessions_by_id: dict[str, dict[str, Any]] = {}
    if session_ids:
        for session_id_chunk in _chunks(session_ids):
            sessions_result = supabase.table("sessions").select(
                "id, name, type, status"
            ).in_("id", session_id_chunk).execute()
            sessions_by_id.update({_string(row.get("id")): row for row in sessions_result.data or []})

    total_by_status: dict[str, int] = defaultdict(int)
    by_type: dict[str, dict[str, Any]] = {}
    by_group: dict[str, dict[str, Any]] = {}
    recent_jobs: list[dict[str, Any]] = []
    active_total = 0

    for job in jobs:
        status = _string(job.get("status")) or "unknown"
        job_type = _string(job.get("job_type")) or "unknown"
        group = _job_group(job_type)
        total_by_status[status] += 1
        if status in ACTIVE_STATUSES:
            active_total += 1

        bucket = by_type.setdefault(job_type, {
            "job_type": job_type,
            "total": 0,
            "latest_queued_at": None,
            **{status_name: 0 for status_name in DISPLAY_STATUSES},
        })
        bucket["total"] += 1
        bucket["group"] = group
        if status in DISPLAY_STATUSES:
            bucket[status] += 1
        if not bucket["latest_queued_at"]:
            bucket["latest_queued_at"] = job.get("queued_at")

        group_bucket = by_group.setdefault(group, _new_group_bucket(group))
        group_bucket["total"] += 1
        if status in DISPLAY_STATUSES:
            group_bucket[status] += 1
        if status in ACTIVE_STATUSES:
            group_bucket["active_total"] += 1
            queued_at = job.get("queued_at")
            if queued_at and (
                not group_bucket["oldest_active_queued_at"]
                or str(queued_at) < str(group_bucket["oldest_active_queued_at"])
            ):
                group_bucket["oldest_active_queued_at"] = queued_at
        if not group_bucket["latest_queued_at"]:
            group_bucket["latest_queued_at"] = job.get("queued_at")

        profile = profiles_by_id.get(_string(job.get("user_id")), {})
        session = sessions_by_id.get(_string(job.get("session_id")), {})
        recent_jobs.append({
            "id": job.get("id"),
            "job_type": job_type,
            "group": group,
            "status": status,
            "attempts": job.get("attempts"),
            "max_attempts": job.get("max_attempts"),
            "user_id": job.get("user_id"),
            "user_email": profile.get("email"),
            "user_role": profile.get("role"),
            "session_id": job.get("session_id"),
            "session_name": session.get("name"),
            "session_type": session.get("type"),
            "session_status": session.get("status"),
            "payload": _trim_payload(job.get("payload")),
            "error_message": job.get("error_message"),
            "queued_at": job.get("queued_at"),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
        })

    for group_bucket in by_group.values():
        _apply_group_warning(group_bucket, now=now)

    job_groups = sorted(
        by_group.values(),
        key=lambda row: (-_warning_rank(row.get("warning_level")), -(row["active_total"]), row["group"]),
    )
    warning_groups = [group for group in job_groups if _warning_rank(group.get("warning_level")) >= WARNING_RANK["warning"]]
    info_groups = [group for group in job_groups if group.get("warning_level") == "info"]
    worst_group = job_groups[0] if job_groups else None
    worst_warning_level = str(worst_group.get("warning_level") or "none") if worst_group else "none"
    if warning_groups:
        health_message = f"{len(warning_groups)} worker pool{'s' if len(warning_groups) != 1 else ''} need review."
    elif info_groups:
        health_message = f"{len(info_groups)} worker pool{'s' if len(info_groups) != 1 else ''} have queued work."
    else:
        health_message = "No active worker pool backlog in the sampled jobs."

    return {
        "summary": {
            "limit": limit,
            "sampled_jobs": len(jobs),
            "active_total": active_total,
            "by_status": dict(total_by_status),
            "health": {
                "warning_level": worst_warning_level,
                "message": health_message,
                "warning_group_count": len(warning_groups),
                "info_group_count": len(info_groups),
                "worst_group": worst_group.get("group") if worst_group else None,
            },
        },
        "job_groups": job_groups,
        "job_types": sorted(
            by_type.values(),
            key=lambda row: (-(row["queued"] + row["retrying"] + row["running"]), row["job_type"]),
        ),
        "recent_jobs": recent_jobs[:100],
    }
