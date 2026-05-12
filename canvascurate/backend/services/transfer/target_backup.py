"""Canvas target-course backup helpers and job runner for Transfer workflows."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any, Callable

import httpx

from canvas_sync import CanvasClient
from services.document_records import write_platform_event
from services.transfer.canvas_target import resolve_transfer_target_access
from supabase_client import get_supabase


TERMINAL_EXPORT_STATES = {"exported", "failed"}
DEFAULT_BACKUP_POLL_SECONDS = 20 * 60
DEFAULT_BACKUP_POLL_INTERVAL_SECONDS = 2.0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def backup_poll_settings() -> tuple[int, float, float]:
    timeout_seconds = max(
        DEFAULT_BACKUP_POLL_INTERVAL_SECONDS,
        _env_float("TRANSFER_BACKUP_MAX_POLL_SECONDS", DEFAULT_BACKUP_POLL_SECONDS),
    )
    interval_seconds = max(
        0.5,
        _env_float("TRANSFER_BACKUP_POLL_INTERVAL_SECONDS", DEFAULT_BACKUP_POLL_INTERVAL_SECONDS),
    )
    max_attempts = max(1, int(timeout_seconds / interval_seconds))
    return max_attempts, interval_seconds, timeout_seconds


def backup_timeout_message(workflow_state: str, timeout_seconds: float) -> str:
    minutes = max(1, round(timeout_seconds / 60))
    state = workflow_state or "unknown"
    return (
        f"Canvas IMSCC export did not complete within {minutes} minutes; latest Canvas state: {state}. "
        "Large Canvas courses can take longer to export. Generate the backup again to continue polling, "
        "or use Canvas directly if the export finishes there first."
    )


def _update_job(supabase, job_id: str, values: dict[str, Any]) -> None:
    supabase.table("background_jobs").update(values).eq("id", job_id).execute()


def _set_job_result(supabase, job_id: str, state: dict[str, Any]) -> None:
    _update_job(supabase, job_id, {"result": state})


def _add_event(
    supabase,
    job_id: str,
    state: dict[str, Any],
    message: str,
    status: str = "info",
) -> None:
    events = state.setdefault("events", [])
    events.append({
        "message": message,
        "status": status,
        "at": utc_now_iso(),
    })
    _set_job_result(supabase, job_id, state)


def start_course_imscc_export(client: CanvasClient, *, course_id: str) -> dict[str, Any]:
    """Start a Canvas common cartridge export for a course."""
    return client.post_form(
        f"/courses/{course_id}/content_exports",
        {"export_type": "common_cartridge"},
    )


def get_course_imscc_export(client: CanvasClient, *, course_id: str, export_id: str) -> dict[str, Any]:
    """Fetch a Canvas content export status payload."""
    return client.get(f"/courses/{course_id}/content_exports/{export_id}")


def content_export_download_url(export: dict[str, Any]) -> str:
    attachment = export.get("attachment") if isinstance(export.get("attachment"), dict) else {}
    return str(attachment.get("url") or "")


def content_export_filename(export: dict[str, Any]) -> str:
    attachment = export.get("attachment") if isinstance(export.get("attachment"), dict) else {}
    return str(attachment.get("filename") or attachment.get("display_name") or "")


def poll_course_imscc_export(
    client: CanvasClient,
    *,
    course_id: str,
    export_id: str,
    max_attempts: int | None = None,
    interval_seconds: float | None = None,
    on_status: Callable[[dict[str, Any], int, int], None] | None = None,
) -> dict[str, Any]:
    """Poll Canvas until an IMSCC export reaches a terminal state."""
    if max_attempts is None or interval_seconds is None:
        default_attempts, default_interval, _timeout_seconds = backup_poll_settings()
        max_attempts = max_attempts or default_attempts
        interval_seconds = interval_seconds or default_interval
    last_status: dict[str, Any] = {}
    for attempt in range(1, max_attempts + 1):
        if attempt > 1:
            time.sleep(interval_seconds)
        last_status = get_course_imscc_export(client, course_id=course_id, export_id=export_id)
        if on_status:
            on_status(last_status, attempt, max_attempts)
        state = str(last_status.get("workflow_state") or "").lower()
        if state in TERMINAL_EXPORT_STATES:
            return last_status
    return last_status


def run_transfer_target_backup_job(job_id: str, session_id: str, user_id: str) -> None:
    """Create a Canvas IMSCC export for a target course before erase-first transfer."""
    supabase = get_supabase()
    state: dict[str, Any] = {
        "status": "running",
        "progress": 0,
        "events": [],
        "summary": {},
    }
    client: CanvasClient | None = None
    try:
        _update_job(supabase, job_id, {
            "status": "running",
            "attempts": 1,
            "started_at": utc_now_iso(),
            "result": state,
        })
        job_result = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        payload = job_result.data[0].get("payload") if job_result.data else {}
        if not isinstance(payload, dict):
            payload = {}
        canvas_url = str(payload.get("canvas_url") or "")
        target_course, pat_token = resolve_transfer_target_access(
            supabase,
            user_id=user_id,
            canvas_url=canvas_url,
        )
        target_course_id = str(target_course["canvas_course_id"])
        client = CanvasClient(target_course["canvas_base_url"], pat_token)
        state["target_course"] = target_course
        _add_event(supabase, job_id, state, f"Starting IMSCC backup export for {target_course['name']}.")

        export = start_course_imscc_export(client, course_id=target_course_id)
        export_id = str(export.get("id") or "")
        if not export_id:
            raise ValueError("Canvas did not return a content export ID")
        _add_event(supabase, job_id, state, f"Canvas content export queued: {export_id}", "done")
        max_attempts, interval_seconds, timeout_seconds = backup_poll_settings()

        def on_status(status: dict[str, Any], attempt: int, max_attempts: int) -> None:
            state["progress"] = min(0.95, attempt / max_attempts)
            workflow_state = status.get("workflow_state") or "running"
            state["summary"] = {
                "export_id": export_id,
                "workflow_state": workflow_state,
            }
            _set_job_result(supabase, job_id, state)

        status = poll_course_imscc_export(
            client,
            course_id=target_course_id,
            export_id=export_id,
            max_attempts=max_attempts,
            interval_seconds=interval_seconds,
            on_status=on_status,
        )
        workflow_state = str(status.get("workflow_state") or "").lower()
        if workflow_state != "exported":
            raise ValueError(backup_timeout_message(workflow_state, timeout_seconds))
        download_url = content_export_download_url(status)
        if not download_url:
            raise ValueError("Canvas IMSCC export completed without a download URL")

        filename = content_export_filename(status) or f"{target_course['name']}.imscc"
        state["status"] = "succeeded"
        state["progress"] = 1
        state["summary"] = {
            "export_id": export_id,
            "workflow_state": workflow_state,
            "backup_download_url": download_url,
            "backup_filename": filename,
            "target_canvas_course_id": target_course_id,
        }
        _add_event(supabase, job_id, state, f"IMSCC backup is ready: {filename}", "done")
        _update_job(supabase, job_id, {
            "status": "succeeded",
            "result": state,
            "finished_at": utc_now_iso(),
        })
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="transfer_target_backup_completed",
            properties={
                "job_id": job_id,
                "target_course": target_course,
                "export_id": export_id,
            },
        )
    except Exception as exc:
        state["status"] = "failed"
        state["error"] = str(exc)
        _add_event(supabase, job_id, state, f"IMSCC backup failed: {exc}", "error")
        _update_job(supabase, job_id, {
            "status": "failed",
            "result": state,
            "error_message": str(exc),
            "finished_at": utc_now_iso(),
        })
    finally:
        if client is not None:
            try:
                client.close()
            except httpx.HTTPError:
                pass
