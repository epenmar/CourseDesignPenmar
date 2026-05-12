from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from auth import get_current_user
from health_scan import run_health_scan_job
from services.job_dispatch import dispatch_background_task
from supabase_client import get_supabase

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health_check():
    return {"status": "ok"}


def get_owned_session(supabase, session_id: str, user_id: str) -> dict:
    result = supabase.table("sessions").select("id, user_id").eq(
        "id", session_id
    ).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return result.data[0]


@router.post("/sessions/{session_id}/run")
async def start_health_run(
    session_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    run_result = supabase.table("health_runs").insert({
        "session_id": session_id,
        "user_id": user_id,
        "status": "queued",
        "summary": {},
    }).execute()
    if not run_result.data:
        raise HTTPException(status_code=500, detail="Failed to create health run")

    health_run_id = run_result.data[0]["id"]
    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": "health_run",
        "status": "queued",
        "payload": {"session_id": session_id, "health_run_id": health_run_id},
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to create health job")

    job_id = job_result.data[0]["id"]
    dispatch_background_task(background_tasks, run_health_scan_job, job_id, health_run_id, session_id, user_id)

    return {"job_id": job_id, "health_run_id": health_run_id, "status": "queued"}


@router.get("/jobs/{job_id}")
async def get_health_job(
    job_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    result = supabase.table("background_jobs").select(
        "id, session_id, job_type, status, attempts, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("id", job_id).eq("user_id", user_id).eq("job_type", "health_run").execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")

    return result.data[0]


@router.get("/sessions/{session_id}/status")
async def get_session_health_status(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    jobs = supabase.table("background_jobs").select(
        "id, status, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", "health_run"
    ).order("queued_at", desc=True).limit(1).execute()

    runs = supabase.table("health_runs").select(
        "id, status, items_scanned, duration_ms, summary, created_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).order(
        "created_at", desc=True
    ).limit(1).execute()

    return {
        "job": jobs.data[0] if jobs.data else None,
        "health_run": runs.data[0] if runs.data else None,
    }
