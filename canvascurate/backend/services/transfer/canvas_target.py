"""Canvas target-course validation for Transfer workflows."""

from __future__ import annotations

import httpx
from fastapi import HTTPException

from canvas_hosts import parse_canvas_course_url
from canvas_sync import CanvasClient, get_active_pat

ASU_CANVAS_BASE_URLS = ("https://canvas.asu.edu", "https://asu.instructure.com")


def _active_pat_for_canvas_alias(supabase, *, user_id: str, canvas_base_url: str) -> tuple[str, str]:
    tried = set()
    last_error = "No active Canvas credential found"
    for candidate_base_url in (canvas_base_url, *ASU_CANVAS_BASE_URLS):
        if candidate_base_url in tried:
            continue
        tried.add(candidate_base_url)
        try:
            return get_active_pat(supabase, user_id, candidate_base_url), candidate_base_url
        except ValueError as exc:
            last_error = str(exc)
    raise HTTPException(status_code=400, detail=f"Active Canvas token required. {last_error}")


def validate_transfer_target_course(
    supabase,
    *,
    user_id: str,
    canvas_url: str,
) -> dict:
    target_course, _pat_token = resolve_transfer_target_access(
        supabase,
        user_id=user_id,
        canvas_url=canvas_url,
    )
    return target_course


def resolve_transfer_target_access(
    supabase,
    *,
    user_id: str,
    canvas_url: str,
) -> tuple[dict, str]:
    canvas_base_url, canvas_course_id = parse_canvas_course_url(canvas_url)
    pat_token, credential_base_url = _active_pat_for_canvas_alias(
        supabase,
        user_id=user_id,
        canvas_base_url=canvas_base_url,
    )

    client = CanvasClient(canvas_base_url, pat_token)
    try:
        course = client.get(f"/courses/{canvas_course_id}", params={"include[]": ["term"]})
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=403, detail="Canvas rejected access to the target course")
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Target Canvas course was not found")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while validating target course")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Target Canvas course validation failed: {exc}")
    finally:
        client.close()

    term = course.get("term") if isinstance(course.get("term"), dict) else {}
    return {
        "canvas_base_url": canvas_base_url,
        "credential_base_url": credential_base_url,
        "canvas_course_id": canvas_course_id,
        "name": course.get("name") or course.get("course_code") or f"Canvas course {canvas_course_id}",
        "course_code": course.get("course_code"),
        "workflow_state": course.get("workflow_state"),
        "term_name": term.get("name"),
    }, pat_token


def resolve_source_course_access(
    supabase,
    *,
    user_id: str,
    source_course: dict,
) -> tuple[dict, str]:
    canvas_base_url = str(source_course.get("canvas_base_url") or "")
    canvas_course_id = str(source_course.get("canvas_course_id") or "")
    if not canvas_base_url or not canvas_course_id:
        raise HTTPException(status_code=422, detail="Source Canvas course is missing connection metadata")

    pat_token, credential_base_url = _active_pat_for_canvas_alias(
        supabase,
        user_id=user_id,
        canvas_base_url=canvas_base_url,
    )

    client = CanvasClient(canvas_base_url, pat_token)
    try:
        course = client.get(f"/courses/{canvas_course_id}", params={"include[]": ["term"]})
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=403, detail="Canvas rejected access to the source course")
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Source Canvas course was not found")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while validating source course")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Source Canvas course validation failed: {exc}")
    finally:
        client.close()

    term = course.get("term") if isinstance(course.get("term"), dict) else {}
    return {
        "canvas_base_url": canvas_base_url,
        "credential_base_url": credential_base_url,
        "canvas_course_id": canvas_course_id,
        "name": course.get("name") or source_course.get("course_name") or course.get("course_code") or f"Canvas course {canvas_course_id}",
        "course_code": course.get("course_code"),
        "workflow_state": course.get("workflow_state"),
        "term_name": term.get("name"),
    }, pat_token
