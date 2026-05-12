"""Canvas course sync and background job API routes."""

from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from canvas_hosts import canvas_base_url_aliases, parse_canvas_course_url
from canvas_sync import CanvasClient, get_active_pat, run_canvas_pull_job
from services.document_records import get_owned_session
from services.job_dispatch import dispatch_background_task
from supabase_client import get_supabase


router = APIRouter(prefix="/canvas", tags=["sync"])


class PullRequest(BaseModel):
    session_id: str
    sync_kind: Literal["full", "delta"] = "full"


class SessionPullRequest(BaseModel):
    sync_kind: Literal["full", "delta"] = "full"


class CoursePreviewRequest(BaseModel):
    canvas_url: str


def create_canvas_pull_job(
    session_id: str,
    sync_kind: Literal["full", "delta"],
    background_tasks: BackgroundTasks,
    user_id: str,
) -> dict:
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": "canvas_pull",
        "status": "queued",
        "payload": {"session_id": session_id, "sync_kind": sync_kind},
        "result": {
            "stage": "queued",
            "message": "Queued Canvas pull job",
            "progress": 8,
            "fetched_count": 0,
            "changed_count": 0,
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to create sync job")

    job_id = job_result.data[0]["id"]
    dispatch_background_task(background_tasks, run_canvas_pull_job, job_id, session_id, user_id, sync_kind)

    return {"job_id": job_id, "status": "queued"}


@router.post("/course-preview")
async def preview_canvas_course(
    body: CoursePreviewRequest,
    x_canvas_pat: str = Header(default=""),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    canvas_base_url, canvas_course_id = parse_canvas_course_url(body.canvas_url)
    pat_token = x_canvas_pat.strip()
    if not pat_token:
        supabase = get_supabase()
        try:
            pat_token = get_active_pat(supabase, user_id, canvas_base_url)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Canvas personal access token required. {exc}",
            )

    course = None
    validated_canvas_base_url = canvas_base_url
    rejected = False
    for candidate_base_url in canvas_base_url_aliases(canvas_base_url):
        client = CanvasClient(candidate_base_url, pat_token)
        try:
            course = client.get(f"/courses/{canvas_course_id}", {"include[]": "term"})
            validated_canvas_base_url = candidate_base_url
            break
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            if status_code in {401, 403}:
                rejected = True
                continue
            if status_code == 404:
                raise HTTPException(status_code=404, detail="Canvas course not found")
            raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {status_code}")
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Canvas request failed: {exc}")
        finally:
            client.close()

    if course is None:
        if rejected:
            raise HTTPException(status_code=403, detail="Canvas rejected the token for this course")
        raise HTTPException(status_code=502, detail="Canvas course preview failed")

    term = course.get("term") if isinstance(course.get("term"), dict) else {}

    return {
        "canvas_base_url": validated_canvas_base_url,
        "canvas_course_id": canvas_course_id,
        "course_name": course.get("name") or course.get("course_code") or f"Canvas course {canvas_course_id}",
        "course_code": course.get("course_code"),
        "workflow_state": course.get("workflow_state"),
        "term_name": term.get("name"),
        "start_at": course.get("start_at"),
        "end_at": course.get("end_at"),
    }


@router.post("/pull")
async def start_canvas_pull(
    body: PullRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    return create_canvas_pull_job(body.session_id, body.sync_kind, background_tasks, user_id)


@router.post("/sessions/{session_id}/pull")
async def start_session_canvas_pull(
    session_id: str,
    body: SessionPullRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    return create_canvas_pull_job(session_id, body.sync_kind, background_tasks, user_id)


@router.get("/jobs/{job_id}")
async def get_canvas_job(
    job_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()

    result = supabase.table("background_jobs").select(
        "id, session_id, job_type, status, attempts, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("id", job_id).eq("user_id", user_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")

    return result.data[0]


@router.get("/sessions/{session_id}/sync-status")
async def get_session_sync_status(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    jobs = supabase.table("background_jobs").select(
        "id, status, result, error_message, queued_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq(
        "job_type", "canvas_pull"
    ).order("queued_at", desc=True).limit(1).execute()

    runs = supabase.table("course_sync_runs").select(
        "id, sync_kind, status, fetched_count, changed_count, error_message, created_at, started_at, finished_at"
    ).eq("session_id", session_id).eq("user_id", user_id).order(
        "created_at", desc=True
    ).limit(1).execute()

    return {
        "job": jobs.data[0] if jobs.data else None,
        "sync_run": runs.data[0] if runs.data else None,
    }
