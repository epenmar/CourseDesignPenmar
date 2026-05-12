"""Canvas course-copy Transfer job orchestration."""

from __future__ import annotations

import time
from typing import Any

import httpx

from canvas_sync import CanvasClient
from services.document_records import write_platform_event
from services.transfer.canvas_target import resolve_source_course_access, resolve_transfer_target_access
from services.transfer.course_copy import (
    canvas_copy_hosts_compatible as _canvas_copy_hosts_compatible,
    canvas_migration_completion as _canvas_migration_completion,
    canvas_migration_issues as _canvas_migration_issues,
    start_canvas_course_copy as _start_canvas_course_copy,
)
from services.transfer.shared import (
    _add_event,
    _add_report_item,
    _erase_target_course_contents,
    _load_transfer_plan,
    _set_job_result,
    _update_job,
    utc_now_iso,
)
from supabase_client import get_supabase


def run_transfer_copy_course_job(job_id: str, session_id: str, user_id: str) -> None:
    """Copy the connected source Canvas course into a target course using Canvas content migrations."""
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
        erase_first = bool(payload.get("erase_first"))

        plan = _load_transfer_plan(supabase, session_id=session_id, user_id=user_id)
        source_course = plan.get("source_course") if isinstance(plan.get("source_course"), dict) else None
        if not source_course:
            raise ValueError("Copy to target requires a connected source Canvas course")
        source_course_info, _source_pat = resolve_source_course_access(
            supabase,
            user_id=user_id,
            source_course=source_course,
        )
        source_course_id = str(source_course_info["canvas_course_id"])

        target_course, pat_token = resolve_transfer_target_access(
            supabase,
            user_id=user_id,
            canvas_url=canvas_url,
        )
        target_course_id = str(target_course["canvas_course_id"])
        if not _canvas_copy_hosts_compatible(str(source_course_info.get("canvas_base_url") or ""), str(target_course.get("canvas_base_url") or "")):
            raise ValueError("Canvas course copy requires the source and target courses to be on the same Canvas instance")

        client = CanvasClient(target_course["canvas_base_url"], pat_token)
        state["target_course"] = target_course
        _add_event(supabase, job_id, state, f"Validated target course: {target_course['name']}", "done")
        _add_event(supabase, job_id, state, f"Source course: {source_course_info['name']} ({source_course_id})", "done")

        erase_counts = {"module": 0, "page": 0, "discussion": 0, "quiz": 0, "assignment": 0, "file": 0}
        erase_error_count = 0
        if erase_first:
            erase_counts, erase_error_count = _erase_target_course_contents(
                supabase,
                job_id=job_id,
                state=state,
                client=client,
                course_id=target_course_id,
                course_name=str(target_course.get("name") or target_course_id),
            )
            state["progress"] = 0.1
            _set_job_result(supabase, job_id, state)

        _add_event(supabase, job_id, state, "Starting Canvas course copy migration...")
        migration = _start_canvas_course_copy(
            client,
            target_course_id=target_course_id,
            source_course_id=source_course_id,
        )
        migration_id = str(migration.get("id") or "")
        if not migration_id:
            raise ValueError(f"Canvas did not return a migration ID: {migration}")
        _add_event(supabase, job_id, state, f"Canvas content migration queued: {migration_id}", "done")

        final_status: dict[str, Any] = migration
        last_reported_bucket = -1
        for attempt in range(300):
            time.sleep(2)
            final_status = client.get(f"/courses/{target_course_id}/content_migrations/{migration_id}")
            workflow_state = str(final_status.get("workflow_state") or "").lower()
            completion = _canvas_migration_completion(final_status)
            state["progress"] = min(0.98, 0.1 + (completion / 100) * 0.88)
            state["summary"] = {
                "mode": "copy_course",
                "migration_id": migration_id,
                "workflow_state": workflow_state,
                "source_canvas_course_id": source_course_id,
                "target_canvas_course_id": target_course_id,
                "target_items_erased": sum(erase_counts.values()),
                "target_modules_erased": erase_counts.get("module", 0),
                "target_pages_erased": erase_counts.get("page", 0),
                "target_assignments_erased": erase_counts.get("assignment", 0),
                "target_discussions_erased": erase_counts.get("discussion", 0),
                "target_quizzes_erased": erase_counts.get("quiz", 0),
                "target_files_erased": erase_counts.get("file", 0),
            }
            _set_job_result(supabase, job_id, state)

            bucket = int(completion // 25)
            if completion > 0 and bucket > last_reported_bucket and completion < 100:
                last_reported_bucket = bucket
                _add_event(supabase, job_id, state, f"Canvas course copy progress: {int(completion)}%")

            if workflow_state == "completed":
                break
            if workflow_state in {"failed", "failed_with_messages"}:
                raise ValueError(f"Canvas course copy failed with state: {workflow_state}")
        else:
            raise ValueError("Canvas course copy timed out after 10 minutes")

        warning_count = 0
        try:
            issues = _canvas_migration_issues(client, target_course_id=target_course_id, migration_id=migration_id)
        except Exception as exc:
            issues = []
            warning_count += 1
            _add_report_item(
                state,
                "warnings",
                title="Canvas migration issues",
                content_type="course",
                action="copy",
                status="warning",
                reason=f"Could not load Canvas migration issues: {exc}",
            )
        for issue in issues:
            warning_count += 1
            description = issue.get("description") or issue.get("message") or issue.get("issue") or "Canvas migration warning"
            _add_report_item(
                state,
                "warnings",
                title=issue.get("fix_issue_html_url") or "Canvas migration issue",
                content_type="course",
                action="copy",
                status="warning",
                reason=description,
            )
            if warning_count <= 10:
                _add_event(supabase, job_id, state, f"Canvas migration warning: {description}", "warning")

        state["status"] = "succeeded" if erase_error_count == 0 and warning_count == 0 else "succeeded_with_warnings"
        state["progress"] = 1
        state["target_course"] = target_course
        state["summary"] = {
            **state.get("summary", {}),
            "mode": "copy_course",
            "migration_id": migration_id,
            "workflow_state": str(final_status.get("workflow_state") or "").lower(),
            "target_items_erased": sum(erase_counts.values()),
            "target_modules_erased": erase_counts.get("module", 0),
            "target_pages_erased": erase_counts.get("page", 0),
            "target_assignments_erased": erase_counts.get("assignment", 0),
            "target_discussions_erased": erase_counts.get("discussion", 0),
            "target_quizzes_erased": erase_counts.get("quiz", 0),
            "target_files_erased": erase_counts.get("file", 0),
            "warnings": warning_count,
            "errors": erase_error_count,
        }
        _add_event(
            supabase,
            job_id,
            state,
            f"Canvas course copy complete: {source_course_info['name']} copied to {target_course['name']}",
            "done" if warning_count == 0 and erase_error_count == 0 else "warning",
        )
        _update_job(supabase, job_id, {
            "status": "succeeded",
            "result": state,
            "finished_at": utc_now_iso(),
        })
        write_platform_event(
            supabase,
            user_id=user_id,
            session_id=session_id,
            event_type="transfer_course_copy_completed",
            properties={
                "job_id": job_id,
                "source_course": source_course_info,
                "target_course": target_course,
                "summary": state["summary"],
            },
        )
    except Exception as exc:
        state["status"] = "failed"
        state["error"] = str(exc)
        _add_event(supabase, job_id, state, f"Course copy failed: {exc}", "error")
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
