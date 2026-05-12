"""Read model for the Reports & Downloads workspace."""

from __future__ import annotations

from typing import Any


CONTENT_TYPES = ["page", "assignment", "discussion", "quiz", "file", "module"]
TRANSFER_JOB_TYPES = ["transfer_target_push", "transfer_same_course_push", "transfer_course_copy"]
REPORTS_BACKUP_JOB_TYPES = ["reports_course_backup"]


def _count_query(supabase, table: str, *, session_id: str, user_id: str, **filters: Any) -> int:
    query = supabase.table(table).select("*", count="exact", head=True).eq("session_id", session_id)
    if table != "health_findings":
        query = query.eq("user_id", user_id)
    for key, value in filters.items():
        if isinstance(value, list):
            query = query.in_(key, value)
        else:
            query = query.eq(key, value)
    result = query.execute()
    return result.count or 0


def _latest_health_run(supabase, *, session_id: str, user_id: str) -> dict[str, Any] | None:
    result = supabase.table("health_runs").select(
        "id, status, items_scanned, duration_ms, summary, created_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).order(
        "created_at", desc=True
    ).limit(1).execute()
    return result.data[0] if result.data else None


def _latest_transfer_jobs(supabase, *, session_id: str, user_id: str) -> list[dict[str, Any]]:
    result = supabase.table("background_jobs").select(
        "id, job_type, status, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "job_type", TRANSFER_JOB_TYPES
    ).order("queued_at", desc=True).limit(5).execute()
    return result.data or []


def _latest_backup_job(supabase, *, session_id: str, user_id: str) -> dict[str, Any] | None:
    result = supabase.table("background_jobs").select(
        "id, job_type, status, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "job_type", REPORTS_BACKUP_JOB_TYPES
    ).order("queued_at", desc=True).limit(1).execute()
    return result.data[0] if result.data else None


def _recent_events(supabase, *, session_id: str, user_id: str) -> list[dict[str, Any]]:
    result = supabase.table("platform_events").select(
        "id, event_type, properties, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).order(
        "created_at", desc=True
    ).limit(8).execute()
    return result.data or []


def _course_creation_summary(session: dict[str, Any]) -> dict[str, Any] | None:
    meta = session.get("meta") if isinstance(session.get("meta"), dict) else {}
    project = meta.get("course_creation") if isinstance(meta.get("course_creation"), dict) else None
    if not project:
        return None
    outline = project.get("outline") if isinstance(project.get("outline"), dict) else {}
    drafts = project.get("draft_generation") if isinstance(project.get("draft_generation"), dict) else {}
    return {
        "status": project.get("status"),
        "title": project.get("name") or project.get("course_title") or outline.get("title"),
        "module_count": len(outline.get("modules") or []),
        "draft_status": drafts.get("status"),
        "exported_to_canvas_clean": bool(project.get("exported_to_canvas_clean")),
    }


def _report_history(supabase, *, session_id: str, user_id: str) -> list[dict[str, Any]]:
    result = supabase.table("reports").select(
        "id, report_type, r2_key, file_size_bytes, generated_from, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).order(
        "created_at", desc=True
    ).limit(10).execute()
    return result.data or []


def build_reports_overview(supabase, *, session_id: str, user_id: str, session: dict[str, Any]) -> dict[str, Any]:
    content_counts = {
        content_type: _count_query(
            supabase,
            "course_content_items",
            session_id=session_id,
            user_id=user_id,
            content_type=content_type,
        )
        for content_type in CONTENT_TYPES
    }
    latest_health = _latest_health_run(supabase, session_id=session_id, user_id=user_id)
    latest_health_summary = latest_health.get("summary") if isinstance(latest_health, dict) and isinstance(latest_health.get("summary"), dict) else {}
    transfer_jobs = _latest_transfer_jobs(supabase, session_id=session_id, user_id=user_id)

    summary = {
        "content_items": sum(content_counts.values()),
        "images": _count_query(supabase, "course_images", session_id=session_id, user_id=user_id),
        "issues_found": int(latest_health_summary.get("total_findings") or 0),
        "files": content_counts["file"],
        "content_counts": content_counts,
    }

    return {
        "session": {
            "id": session["id"],
            "name": session.get("name"),
            "type": session.get("type"),
            "status": session.get("status"),
            "source_course_id": session.get("source_course_id"),
            "updated_at": session.get("updated_at"),
        },
        "summary": summary,
        "latest_health_run": latest_health,
        "latest_transfer_jobs": transfer_jobs,
        "latest_backup_job": _latest_backup_job(supabase, session_id=session_id, user_id=user_id),
        "recent_events": _recent_events(supabase, session_id=session_id, user_id=user_id),
        "course_creation": _course_creation_summary(session),
        "report_history": _report_history(supabase, session_id=session_id, user_id=user_id),
        "downloads": [
            {
                "kind": "content_inventory",
                "title": "Content Inventory",
                "description": "Excel workbook with course summary, inventory decisions, WCAG/link issues, image alt-text review, and files.",
                "format": "xlsx",
                "enabled": True,
            },
            {
                "kind": "faculty_review",
                "title": "Faculty Review",
                "description": "Excel workbook with inventory/files tabs plus quiz-question and content-image review sheets.",
                "format": "xlsx",
                "enabled": True,
            },
            {
                "kind": "transfer_report",
                "title": "Latest Transfer Report",
                "description": "Excel workbook for the most recent transfer job, including summary, created, updated, deleted, skipped, protected, warning, and error tabs.",
                "format": "xlsx",
                "enabled": bool(transfer_jobs),
            },
            {
                "kind": "health_summary",
                "title": "Health Summary",
                "description": "Excel workbook with latest health run summary, WCAG findings, image issues, link issues, inventory findings, files, and documents.",
                "format": "xlsx",
                "enabled": bool(latest_health),
            },
            {
                "kind": "edit_history",
                "title": "Edit History",
                "description": "Saved revision history across edited content items.",
                "format": "csv",
                "enabled": True,
            },
        ],
    }
