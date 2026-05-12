"""System admin endpoints for operational diagnostics."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from services.admin.authz import get_user_profile, require_system_admin
from services.admin.queue_diagnostics import build_queue_diagnostics
from supabase_client import get_supabase


router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/me")
async def get_admin_profile(user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    profile = get_user_profile(supabase, user)
    return {
        "profile": profile,
        "is_system_admin": str(profile.get("role") or "") in {"system_admin", "super_admin"}
        and bool(profile.get("is_active", True)),
    }


@router.get("/queue-diagnostics")
async def get_queue_diagnostics(
    user: dict = Depends(get_current_user),
    limit: int = Query(default=500, ge=50, le=1000),
):
    supabase = get_supabase()
    require_system_admin(supabase, user)
    return build_queue_diagnostics(supabase, limit=limit)


@router.post("/queue-diagnostics/jobs/{job_id}/retry")
async def retry_queue_job(
    job_id: str,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    require_system_admin(supabase, user)
    result = supabase.table("background_jobs").select(
        "id, user_id, session_id, job_type, status, attempts, max_attempts, payload, error_message, queued_at, started_at, finished_at"
    ).eq("id", job_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Queue job not found")

    job = result.data[0]
    status = str(job.get("status") or "")
    if status not in {"failed", "canceled"}:
        raise HTTPException(status_code=409, detail="Only failed or canceled jobs can be retried")

    now = datetime.now(timezone.utc).isoformat()
    update_result = supabase.table("background_jobs").update({
        "status": "queued",
        "attempts": 0,
        "error_message": None,
        "result": None,
        "queued_at": now,
        "started_at": None,
        "finished_at": None,
        "request_id": None,
    }).eq("id", job_id).in_("status", ["failed", "canceled"]).execute()
    if not update_result.data:
        raise HTTPException(status_code=409, detail="Queue job status changed before it could be retried")

    return {
        "job": update_result.data[0],
        "message": "Job requeued. A matching worker will claim it on the next poll.",
    }
