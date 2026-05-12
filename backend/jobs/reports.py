"""Reports background jobs for Canvas export workflows."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from canvas_sync import CanvasClient
from services.document_records import write_platform_event
from services.transfer.canvas_target import resolve_source_course_access
from services.transfer.target_backup import (
    backup_poll_settings,
    backup_timeout_message,
    content_export_download_url,
    content_export_filename,
    poll_course_imscc_export,
    start_course_imscc_export,
)
from supabase_client import get_supabase


REPORTS_COURSE_BACKUP_JOB_TYPE = "reports_course_backup"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update_job(supabase, job_id: str, values: dict[str, Any]) -> None:
    supabase.table("background_jobs").update(values).eq("id", job_id).execute()


def _set_job_result(supabase, job_id: str, state: dict[str, Any]) -> None:
    _update_job(supabase, job_id, {"result": state})


def _add_event(supabase, job_id: str, state: dict[str, Any], message: str, status: str = "info") -> None:
    events = state.setdefault("events", [])
    events.append({
        "message": message,
        "status": status,
        "at": _now_iso(),
    })
    _set_job_result(supabase, job_id, state)


def _source_course_for_session(supabase, *, session_id: str, user_id: str) -> dict[str, Any]:
    session_result = supabase.table("sessions").select(
        "id, source_course_id"
    ).eq("id", session_id).eq("user_id", user_id).limit(1).execute()
    session = session_result.data[0] if session_result.data else None
    if not session:
        raise ValueError("Session not found")
    if not session.get("source_course_id"):
        raise ValueError("No source Canvas course is connected to this session")

    course_result = supabase.table("courses").select(
        "id, course_name, canvas_course_id, canvas_base_url"
    ).eq("id", session["source_course_id"]).eq("user_id", user_id).limit(1).execute()
    course = course_result.data[0] if course_result.data else None
    if not course:
        raise ValueError("Connected source Canvas course was not found")
    return course


def run_reports_course_backup_job(job_id: str, session_id: str, user_id: str) -> None:
    """Create an IMSCC export for the active session's connected source course."""
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
            "started_at": _now_iso(),
            "result": state,
        })

        source_course = _source_course_for_session(supabase, session_id=session_id, user_id=user_id)
        canvas_course, pat_token = resolve_source_course_access(
            supabase,
            user_id=user_id,
            source_course=source_course,
        )
        course_id = str(canvas_course["canvas_course_id"])
        client = CanvasClient(canvas_course["canvas_base_url"], pat_token)
        state["source_course"] = canvas_course
        _add_event(supabase, job_id, state, f"Starting IMSCC backup export for {canvas_course['name']}.")

        export = start_course_imscc_export(client, course_id=course_id)
        export_id = str(export.get("id") or "")
        if not export_id:
            raise ValueError("Canvas did not return a content export ID")
        _add_event(supabase, job_id, state, f"Canvas content export queued: {export_id}", "done")
        max_attempts, interval_seconds, timeout_seconds = backup_poll_settings()

        def on_status(status: dict[str, Any], attempt: int, max_attempts: int) -> None:
            workflow_state = status.get("workflow_state") or "running"
            state["progress"] = min(0.95, attempt / max_attempts)
            state["summary"] = {
                "export_id": export_id,
                "workflow_state": workflow_state,
                "source_canvas_course_id": course_id,
            }
            _set_job_result(supabase, job_id, state)

        status = poll_course_imscc_export(
            client,
            course_id=course_id,
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

        filename = content_export_filename(status) or f"{canvas_course['name']}.imscc"
        state["status"] = "succeeded"
        state["progress"] = 1
        state["summary"] = {
            "export_id": export_id,
            "workflow_state": workflow_state,
            "backup_download_url": download_url,
            "backup_filename": filename,
            "source_canvas_course_id": course_id,
        }
        _add_event(supabase, job_id, state, f"IMSCC backup is ready: {filename}", "done")
        _update_job(supabase, job_id, {
            "status": "succeeded",
            "result": state,
            "finished_at": _now_iso(),
        })
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="reports_course_backup_completed",
            properties={
                "job_id": job_id,
                "source_course": canvas_course,
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
            "finished_at": _now_iso(),
        })
    finally:
        if client is not None:
            try:
                client.close()
            except httpx.HTTPError:
                pass
