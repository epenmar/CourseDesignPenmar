"""Durable background job worker.

Run with:
    python -m jobs.worker

The API only creates rows in ``background_jobs`` when
``CANVASCURATE_USE_WORKER=1``. This worker claims queued rows and invokes the
same runner functions that FastAPI previously ran through BackgroundTasks.
"""

from __future__ import annotations

import logging
import os
import signal
import time
import uuid
from collections.abc import Callable
from typing import Any

from canvas_sync import run_canvas_pull_job
from health_scan import run_health_scan_job
from jobs.course_creation import (
    COURSE_CREATION_DRAFT_JOB_TYPE,
    COURSE_CREATION_EXTRACT_JOB_TYPE,
    COURSE_CREATION_OUTLINE_JOB_TYPE,
    run_course_creation_draft_job,
    run_course_creation_outline_job,
    run_course_creation_source_extraction_job,
)
from jobs.pdf_export import PDF_EXPORT_JOB_TYPE, run_pdf_export_job
from jobs.reports import REPORTS_COURSE_BACKUP_JOB_TYPE, run_reports_course_backup_job
from jobs.transfer import (
    TRANSFER_COPY_COURSE_JOB_TYPE,
    TRANSFER_SAME_COURSE_JOB_TYPE,
    TRANSFER_TARGET_BACKUP_JOB_TYPE,
    TRANSFER_TARGET_JOB_TYPE,
    run_transfer_copy_course_job,
    run_transfer_same_course_job,
    run_transfer_target_backup_job,
    run_transfer_target_job,
)
from services.documents.analysis import run_document_analysis_job
from services.documents.canvas_deploy import STANDALONE_CANVAS_DEPLOY_JOB_TYPE, run_standalone_canvas_deploy_job
from services.documents.remediation import run_document_remediation_job
from services.documents.replacements import run_document_file_archive_job, run_document_replacement_deploy_job
from services.documents.tagflow_jobs import run_tagflow_ai_suggestion_job
from services.documents.tagflow_previews import run_document_structure_preview_job
from services.images.text import (
    IMAGE_TEXT_BULK_JOB_TYPE,
    IMAGE_TEXT_JOB_TYPE,
    run_image_text_bulk_generate_job,
    run_image_text_generate_job,
)
from services.job_queue import recover_stale_running_jobs
from services.links.text import LINK_TEXT_BULK_JOB_TYPE, run_link_text_bulk_suggest_job
from services.pdf_figure_text import PDF_FIGURE_TEXT_JOB_TYPE, run_pdf_figure_text_generate_job
from supabase_client import get_supabase


logger = logging.getLogger("canvas_curator.worker")
logging.basicConfig(level=os.getenv("WORKER_LOG_LEVEL", "INFO"))

STOP_REQUESTED = False
ACTIVE_STATUSES = ["queued", "retrying"]


def _stop(_signum: int, _frame: Any) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True


signal.signal(signal.SIGINT, _stop)
signal.signal(signal.SIGTERM, _stop)


def _payload(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload")
    return payload if isinstance(payload, dict) else {}


def _session_id(job: dict[str, Any]) -> str:
    return str(job.get("session_id") or _payload(job).get("session_id") or "")


def _user_id(job: dict[str, Any]) -> str:
    return str(job.get("user_id") or "")


def _document_id(job: dict[str, Any]) -> str:
    return str(_payload(job).get("document_id") or "")


def _run_document_analysis(job: dict[str, Any]) -> None:
    run_document_analysis_job(job["id"], _session_id(job), _user_id(job), _document_id(job))


def _run_document_remediation(job: dict[str, Any]) -> None:
    run_document_remediation_job(job["id"], _session_id(job), _user_id(job), _document_id(job))


def _run_document_structure_preview(job: dict[str, Any]) -> None:
    run_document_structure_preview_job(job["id"], _session_id(job), _user_id(job), _document_id(job))


def _run_tagflow_ai_suggestions(job: dict[str, Any]) -> None:
    run_tagflow_ai_suggestion_job(job["id"], _session_id(job), _user_id(job), _document_id(job))


def _run_pdf_export(job: dict[str, Any]) -> None:
    run_pdf_export_job(job["id"], _session_id(job), _user_id(job), _document_id(job))


def _run_standalone_canvas_deploy(job: dict[str, Any]) -> None:
    run_standalone_canvas_deploy_job(job["id"], _session_id(job), _user_id(job), _document_id(job))


def _run_document_replacement_deploy(job: dict[str, Any]) -> None:
    payload = _payload(job)
    references = payload.get("selected_references") if isinstance(payload.get("selected_references"), list) else []
    run_document_replacement_deploy_job(job["id"], _session_id(job), _user_id(job), _document_id(job), references)


def _run_document_file_archive(job: dict[str, Any]) -> None:
    run_document_file_archive_job(job["id"], _session_id(job), _user_id(job), _document_id(job))


def _run_canvas_pull(job: dict[str, Any]) -> None:
    sync_kind = str(_payload(job).get("sync_kind") or "full")
    run_canvas_pull_job(job["id"], _session_id(job), _user_id(job), sync_kind)


def _run_health(job: dict[str, Any]) -> None:
    health_run_id = str(_payload(job).get("health_run_id") or "")
    run_health_scan_job(job["id"], health_run_id, _session_id(job), _user_id(job))


def _run_course_creation_extract(job: dict[str, Any]) -> None:
    source_id = str(_payload(job).get("source_id") or "")
    run_course_creation_source_extraction_job(job["id"], _session_id(job), _user_id(job), source_id)


def _run_course_creation_outline(job: dict[str, Any]) -> None:
    run_course_creation_outline_job(job["id"], _session_id(job), _user_id(job))


def _run_course_creation_draft(job: dict[str, Any]) -> None:
    use_ai = bool(_payload(job).get("use_ai_body_generation", True))
    run_course_creation_draft_job(job["id"], _session_id(job), _user_id(job), use_ai_body_generation=use_ai)


RUNNERS: dict[str, Callable[[dict[str, Any]], None]] = {
    "document_analysis": _run_document_analysis,
    "document_remediation": _run_document_remediation,
    "document_structure_preview": _run_document_structure_preview,
    "tagflow_ai_suggestions": _run_tagflow_ai_suggestions,
    PDF_EXPORT_JOB_TYPE: _run_pdf_export,
    STANDALONE_CANVAS_DEPLOY_JOB_TYPE: _run_standalone_canvas_deploy,
    "document_replacement_deploy": _run_document_replacement_deploy,
    "document_file_archive": _run_document_file_archive,
    "canvas_pull": _run_canvas_pull,
    "health_run": _run_health,
    IMAGE_TEXT_JOB_TYPE: lambda job: run_image_text_generate_job(job["id"], _session_id(job), _user_id(job)),
    IMAGE_TEXT_BULK_JOB_TYPE: lambda job: run_image_text_bulk_generate_job(job["id"], _session_id(job), _user_id(job)),
    PDF_FIGURE_TEXT_JOB_TYPE: lambda job: run_pdf_figure_text_generate_job(job["id"], _session_id(job), _user_id(job), _document_id(job)),
    LINK_TEXT_BULK_JOB_TYPE: lambda job: run_link_text_bulk_suggest_job(job["id"], _session_id(job), _user_id(job)),
    REPORTS_COURSE_BACKUP_JOB_TYPE: lambda job: run_reports_course_backup_job(job["id"], _session_id(job), _user_id(job)),
    TRANSFER_TARGET_BACKUP_JOB_TYPE: lambda job: run_transfer_target_backup_job(job["id"], _session_id(job), _user_id(job)),
    TRANSFER_SAME_COURSE_JOB_TYPE: lambda job: run_transfer_same_course_job(job["id"], _session_id(job), _user_id(job)),
    TRANSFER_COPY_COURSE_JOB_TYPE: lambda job: run_transfer_copy_course_job(job["id"], _session_id(job), _user_id(job)),
    TRANSFER_TARGET_JOB_TYPE: lambda job: run_transfer_target_job(job["id"], _session_id(job), _user_id(job)),
    COURSE_CREATION_EXTRACT_JOB_TYPE: _run_course_creation_extract,
    COURSE_CREATION_OUTLINE_JOB_TYPE: _run_course_creation_outline,
    COURSE_CREATION_DRAFT_JOB_TYPE: _run_course_creation_draft,
}


WORKER_JOB_GROUPS: dict[str, list[str]] = {
    "pdf": [
        "document_analysis",
        "document_remediation",
        "document_structure_preview",
        PDF_EXPORT_JOB_TYPE,
    ],
    "ai": [
        "tagflow_ai_suggestions",
        IMAGE_TEXT_JOB_TYPE,
        IMAGE_TEXT_BULK_JOB_TYPE,
        PDF_FIGURE_TEXT_JOB_TYPE,
        LINK_TEXT_BULK_JOB_TYPE,
        COURSE_CREATION_OUTLINE_JOB_TYPE,
        COURSE_CREATION_DRAFT_JOB_TYPE,
    ],
    "canvas": [
        "canvas_pull",
        "health_run",
        STANDALONE_CANVAS_DEPLOY_JOB_TYPE,
        "document_replacement_deploy",
        "document_file_archive",
        TRANSFER_TARGET_BACKUP_JOB_TYPE,
        REPORTS_COURSE_BACKUP_JOB_TYPE,
    ],
    "transfer": [
        TRANSFER_TARGET_JOB_TYPE,
        TRANSFER_SAME_COURSE_JOB_TYPE,
        TRANSFER_COPY_COURSE_JOB_TYPE,
        TRANSFER_TARGET_BACKUP_JOB_TYPE,
    ],
    "course_creation": [
        COURSE_CREATION_EXTRACT_JOB_TYPE,
        COURSE_CREATION_OUTLINE_JOB_TYPE,
        COURSE_CREATION_DRAFT_JOB_TYPE,
    ],
    "reports": [
        REPORTS_COURSE_BACKUP_JOB_TYPE,
    ],
}
WORKER_JOB_GROUPS["course-creation"] = WORKER_JOB_GROUPS["course_creation"]


def _allowed_job_types() -> list[str]:
    configured = os.getenv("WORKER_JOB_TYPES", "").strip()
    if not configured:
        return sorted(RUNNERS)
    job_types: list[str] = []
    for item in [item.strip() for item in configured.split(",") if item.strip()]:
        if item == "all":
            job_types.extend(sorted(RUNNERS))
        elif item in WORKER_JOB_GROUPS:
            job_types.extend(WORKER_JOB_GROUPS[item])
        else:
            job_types.append(item)
    return list(dict.fromkeys(job_types))


def _fetch_next_job(supabase, job_types: list[str]) -> dict[str, Any] | None:
    result = supabase.table("background_jobs").select(
        "id, user_id, session_id, job_type, status, attempts, max_attempts, payload"
    ).in_("status", ACTIVE_STATUSES).in_("job_type", job_types).order(
        "priority", desc=False
    ).order("queued_at", desc=False).limit(1).execute()
    if not result.data:
        return None

    job = result.data[0]
    claim_id = f"worker:{uuid.uuid4()}"
    supabase.table("background_jobs").update({
        "status": "running",
        "request_id": claim_id,
    }).eq("id", job["id"]).in_("status", ACTIVE_STATUSES).execute()
    claim = supabase.table("background_jobs").select(
        "id, user_id, session_id, job_type, status, attempts, max_attempts, payload"
    ).eq("id", job["id"]).eq("request_id", claim_id).limit(1).execute()
    if not claim.data:
        return None
    return claim.data[0]


def run_forever() -> None:
    poll_interval = float(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "5") or "5")
    stale_check_interval = float(os.getenv("WORKER_STALE_CHECK_INTERVAL_SECONDS", "60") or "60")
    job_types = _allowed_job_types()
    unknown = [job_type for job_type in job_types if job_type not in RUNNERS]
    if unknown:
        logger.warning("Ignoring unsupported WORKER_JOB_TYPES: %s", ", ".join(unknown))
        job_types = [job_type for job_type in job_types if job_type in RUNNERS]
    if not job_types:
        raise RuntimeError("No supported worker job types configured")

    logger.info(
        "Worker started for job types: %s; poll_interval=%ss stale_check_interval=%ss",
        ", ".join(job_types),
        poll_interval,
        stale_check_interval,
    )
    supabase = get_supabase()
    last_stale_check = 0.0
    while not STOP_REQUESTED:
        now = time.monotonic()
        if stale_check_interval > 0 and now - last_stale_check >= stale_check_interval:
            recovered = recover_stale_running_jobs(supabase, job_types=job_types)
            if recovered:
                logger.warning("Recovered %s stale running job(s)", recovered)
            last_stale_check = now

        job = _fetch_next_job(supabase, job_types)
        if not job:
            time.sleep(poll_interval)
            continue

        job_type = str(job.get("job_type") or "")
        runner = RUNNERS.get(job_type)
        if not runner:
            logger.error("No runner for job_type=%s id=%s", job_type, job.get("id"))
            supabase.table("background_jobs").update({
                "status": "failed",
                "error_message": f"No worker runner registered for {job_type}",
            }).eq("id", job["id"]).execute()
            continue

        logger.info("Running job id=%s type=%s", job.get("id"), job_type)
        runner(job)

    logger.info("Worker stopped")


if __name__ == "__main__":
    run_forever()
