"""Background job queue admission and recovery helpers."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


ACTIVE_JOB_STATUSES = ["queued", "retrying", "running"]


@dataclass(frozen=True)
class EnqueuedJob:
    job: dict[str, Any]
    created: bool


class JobAdmissionError(RuntimeError):
    def __init__(self, message: str, *, active_count: int | None = None, limit: int | None = None):
        super().__init__(message)
        self.active_count = active_count
        self.limit = limit


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _payload(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload")
    return payload if isinstance(payload, dict) else {}


def _payload_matches(job: dict[str, Any], payload: dict[str, Any], fields: tuple[str, ...]) -> bool:
    current = _payload(job)
    return all(str(current.get(field) or "") == str(payload.get(field) or "") for field in fields)


def _select_active_jobs(
    supabase,
    *,
    user_id: str,
    session_id: str | None = None,
    job_type: str | None = None,
    job_types: list[str] | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = supabase.table("background_jobs").select(
        "id, user_id, session_id, job_type, status, payload, queued_at, started_at"
    ).eq("user_id", user_id).in_("status", ACTIVE_JOB_STATUSES)
    if session_id:
        query = query.eq("session_id", session_id)
    if job_type:
        query = query.eq("job_type", job_type)
    elif job_types:
        query = query.in_("job_type", job_types)
    result = query.order("queued_at", desc=True).limit(limit).execute()
    return result.data or []


def find_active_duplicate_job(
    supabase,
    *,
    user_id: str,
    session_id: str,
    job_type: str,
    payload: dict[str, Any],
    duplicate_fields: tuple[str, ...] = ("document_id",),
) -> dict[str, Any] | None:
    if not duplicate_fields:
        return None
    jobs = _select_active_jobs(
        supabase,
        user_id=user_id,
        session_id=session_id,
        job_type=job_type,
        limit=50,
    )
    for job in jobs:
        if _payload_matches(job, payload, duplicate_fields):
            return job
    return None


def count_active_jobs_for_user(
    supabase,
    *,
    user_id: str,
    job_types: list[str] | None = None,
    limit: int = 1000,
) -> int:
    return len(_select_active_jobs(supabase, user_id=user_id, job_types=job_types, limit=limit))


def enqueue_background_job(
    supabase,
    *,
    user_id: str,
    session_id: str,
    job_type: str,
    payload: dict[str, Any],
    duplicate_fields: tuple[str, ...] = ("document_id",),
    max_active_per_user: int | None = None,
    max_active_job_type_per_user: int | None = None,
    priority: int | None = None,
) -> EnqueuedJob:
    duplicate = find_active_duplicate_job(
        supabase,
        user_id=user_id,
        session_id=session_id,
        job_type=job_type,
        payload=payload,
        duplicate_fields=duplicate_fields,
    )
    if duplicate:
        return EnqueuedJob(job=duplicate, created=False)

    user_limit = max_active_per_user
    if user_limit is None:
        user_limit = env_int("CANVASCURATE_MAX_ACTIVE_JOBS_PER_USER", 12)
    if user_limit > 0:
        active_count = count_active_jobs_for_user(supabase, user_id=user_id)
        if active_count >= user_limit:
            raise JobAdmissionError(
                "Too many active jobs are already queued or running for this user",
                active_count=active_count,
                limit=user_limit,
            )

    type_limit = max_active_job_type_per_user
    if type_limit is not None and type_limit > 0:
        active_count = count_active_jobs_for_user(supabase, user_id=user_id, job_types=[job_type])
        if active_count >= type_limit:
            raise JobAdmissionError(
                f"Too many active {job_type} jobs are already queued or running for this user",
                active_count=active_count,
                limit=type_limit,
            )

    values: dict[str, Any] = {
        "user_id": user_id,
        "session_id": session_id,
        "job_type": job_type,
        "status": "queued",
        "payload": payload,
    }
    if priority is not None:
        values["priority"] = priority
    result = supabase.table("background_jobs").insert(values).execute()
    if not result.data:
        raise ValueError(f"Failed to create {job_type} job")
    return EnqueuedJob(job=result.data[0], created=True)


def stale_timeout_seconds(job_type: str) -> int:
    specific = f"WORKER_STALE_TIMEOUT_{job_type.upper()}_SECONDS"
    value = env_int(specific, 0)
    if value > 0:
        return value
    if job_type in {"document_structure_preview"}:
        return env_int("WORKER_STALE_PREVIEW_TIMEOUT_SECONDS", 20 * 60)
    if job_type in {"tagflow_ai_suggestions", "image_text_bulk_generate", "link_text_bulk_suggest"}:
        return env_int("WORKER_STALE_AI_TIMEOUT_SECONDS", 30 * 60)
    if job_type in {"document_remediation", "pdf_export"}:
        return env_int("WORKER_STALE_PDF_TIMEOUT_SECONDS", 45 * 60)
    if job_type.startswith("transfer_") or job_type in {"canvas_pull", "document_replacement_deploy"}:
        return env_int("WORKER_STALE_CANVAS_TIMEOUT_SECONDS", 90 * 60)
    return env_int("WORKER_STALE_JOB_TIMEOUT_SECONDS", 60 * 60)


def recover_stale_running_jobs(supabase, *, job_types: list[str], now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    max_recoveries = env_int("WORKER_STALE_MAX_RECOVERIES", 2)
    result = supabase.table("background_jobs").select(
        "id, job_type, status, payload, started_at"
    ).eq("status", "running").in_("job_type", job_types).order("started_at", desc=False).limit(100).execute()
    recovered = 0
    for job in result.data or []:
        job_type = str(job.get("job_type") or "")
        started_raw = str(job.get("started_at") or "")
        if not job_type or not started_raw:
            continue
        try:
            started_at = datetime.fromisoformat(started_raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        if (now - started_at).total_seconds() < stale_timeout_seconds(job_type):
            continue

        payload = _payload(job)
        recovery_count = int(payload.get("stale_recovery_count") or 0) + 1
        next_payload = {
            **payload,
            "stale_recovery_count": recovery_count,
            "last_stale_recovered_at": now.isoformat(),
        }
        if recovery_count > max_recoveries:
            values = {
                "status": "failed",
                "payload": next_payload,
                "error_message": "Job exceeded stale recovery limit",
                "finished_at": now.isoformat(),
                "request_id": None,
            }
        else:
            values = {
                "status": "retrying",
                "payload": next_payload,
                "error_message": "Recovered stale running job for retry",
                "started_at": None,
                "request_id": None,
            }
        supabase.table("background_jobs").update(values).eq("id", job["id"]).eq("status", "running").execute()
        recovered += 1
    return recovered
