"""Course Creation API routes."""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile

from ai_image_text import is_ai_configured
from auth import get_current_user
from jobs.course_creation import (
    run_course_creation_draft_job,
    run_course_creation_outline_job,
    run_course_creation_source_extraction_job,
)
from services.course_creation.projects import (
    COURSE_CREATION_DRAFT_JOB_TYPE,
    COURSE_CREATION_EXTRACT_JOB_TYPE,
    COURSE_CREATION_OUTLINE_JOB_TYPE,
    create_course_creation_source,
    get_course_creation_source,
    get_owned_course_creation_session,
    list_course_creation_sources,
    mark_source_deleted,
    mark_source_extraction_queued,
    normalize_source_content_type,
    project_response,
    safe_upload_filename,
    source_row,
    update_course_creation_project_data,
    update_course_creation_setup,
    validate_source_upload,
    course_creation_meta,
    utc_now_iso,
)
from r2_storage import download_bytes
from services.content_bodies import fetch_content_body_rows
from services.document_records import write_platform_event
from services.job_dispatch import dispatch_background_task
from supabase_client import get_supabase

from .schemas import CourseCreationOutlineRequest, CourseCreationSetupRequest

router = APIRouter(prefix="/canvas", tags=["course-creation"])


def current_user_id(user: dict) -> str:
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return user_id


def compact_string(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def normalize_string_list(value, *, limit: int, item_limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        text = compact_string(item, item_limit)
        if text:
            result.append(text)
        if len(result) >= limit:
            break
    return result


def normalize_course_creation_outline_for_save(outline: dict) -> dict:
    if not isinstance(outline, dict):
        raise HTTPException(status_code=422, detail="Outline must be an object")
    modules = outline.get("modules")
    if not isinstance(modules, list) or not modules:
        raise HTTPException(status_code=422, detail="Outline must include at least one module")
    normalized_modules = []
    for module_index, module in enumerate(modules[:40], start=1):
        if not isinstance(module, dict):
            continue
        module_id = compact_string(module.get("id"), 120) or f"module-{module_index}"
        items = module.get("items") if isinstance(module.get("items"), list) else []
        normalized_items = []
        for item_index, item in enumerate(items[:20], start=1):
            if not isinstance(item, dict):
                continue
            raw_type = compact_string(item.get("type"), 40).lower()
            if raw_type not in {"overview", "page", "learningmaterials", "assignment", "discussion", "quiz"}:
                raw_type = "page"
            normalized_items.append({
                "type": raw_type,
                "title": compact_string(item.get("title"), 180) or f"Item {item_index}",
                "purpose": compact_string(item.get("purpose"), 800),
                "source_chunk_ids": normalize_string_list(item.get("source_chunk_ids"), limit=12, item_limit=160),
            })
        normalized_modules.append({
            "id": module_id,
            "title": compact_string(module.get("title"), 180) or f"Module {module_index}",
            "overview": compact_string(module.get("overview"), 1600),
            "objectives": normalize_string_list(module.get("objectives"), limit=10, item_limit=260),
            "topics": normalize_string_list(module.get("topics"), limit=12, item_limit=180),
            "estimated_workload": compact_string(module.get("estimated_workload"), 120),
            "source_chunk_ids": normalize_string_list(module.get("source_chunk_ids"), limit=20, item_limit=160),
            "items": normalized_items,
        })
    if not normalized_modules:
        raise HTTPException(status_code=422, detail="Outline must include at least one valid module")
    return {
        **outline,
        "title": compact_string(outline.get("title"), 180) or "Generated Course Outline",
        "description": compact_string(outline.get("description"), 1200),
        "modules": normalized_modules,
        "gaps": normalize_string_list(outline.get("gaps"), limit=20, item_limit=400),
        "assumptions": normalize_string_list(outline.get("assumptions"), limit=20, item_limit=400),
        "status": "reviewed",
        "review_revision_id": str(uuid.uuid4()),
    }


def compact_source_pool_text(value, limit: int = 700) -> str:
    return " ".join(str(value or "").split())[:limit]


def source_pool_item(source: dict, chunk: dict) -> dict:
    chunk_id = compact_string(chunk.get("id"), 120)
    source_id = compact_string(source.get("id"), 120)
    title = compact_string(chunk.get("title"), 180) or compact_string(source.get("filename"), 180)
    text = compact_source_pool_text(chunk.get("text") or chunk.get("text_preview") or chunk.get("summary"))
    return {
        "id": f"{source_id}:{chunk_id}" if chunk_id and not chunk_id.startswith(f"{source_id}:") else chunk_id,
        "source_id": source_id,
        "source_title": source.get("filename"),
        "summary": text,
        "topics": [title] if title else [],
        "content_types": [chunk.get("type") or "source"],
        "source_locator": chunk.get("source_locator") if isinstance(chunk.get("source_locator"), dict) else {},
        "recommended_use": "Available source chunk for reviewing or rebinding a Course Creation outline.",
    }


def draft_preview_match(metadata: dict, *, outline_job_id: str | None, outline_revision_id: str | None) -> bool:
    if not metadata.get("created_from_course_creation"):
        return False
    if outline_revision_id:
        return metadata.get("course_creation_outline_revision_id") == outline_revision_id
    return bool(outline_job_id) and metadata.get("course_creation_outline_job_id") == outline_job_id


def queue_source_extraction(
    supabase,
    *,
    session_id: str,
    user_id: str,
    source_id: str,
    filename: str,
    background_tasks: BackgroundTasks,
) -> dict:
    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": COURSE_CREATION_EXTRACT_JOB_TYPE,
        "status": "queued",
        "payload": {
            "session_id": session_id,
            "source_id": source_id,
            "filename": filename,
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to queue source extraction")

    job = job_result.data[0]
    mark_source_extraction_queued(
        supabase,
        session_id=session_id,
        user_id=user_id,
        source_id=source_id,
        job_id=job["id"],
    )
    dispatch_background_task(
        background_tasks,
        run_course_creation_source_extraction_job,
        job["id"],
        session_id,
        user_id,
        source_id,
    )
    return job


def queue_outline_generation(
    supabase,
    *,
    session_id: str,
    user_id: str,
    background_tasks: BackgroundTasks,
) -> dict:
    if not is_ai_configured():
        raise HTTPException(status_code=503, detail="ASU AIML is not configured for this environment")

    sources = list_course_creation_sources(supabase, session_id=session_id, user_id=user_id)
    ready_sources = [
        source
        for source in sources
        if source.get("extraction_status") == "succeeded"
        and isinstance(source.get("extraction_summary"), dict)
        and source["extraction_summary"].get("artifact_key")
    ]
    if not ready_sources:
        raise HTTPException(status_code=422, detail="Extract at least one source file before generating an outline")

    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": COURSE_CREATION_OUTLINE_JOB_TYPE,
        "status": "queued",
        "payload": {
            "session_id": session_id,
            "ready_source_count": len(ready_sources),
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to queue outline generation")

    job = job_result.data[0]
    update_course_creation_project_data(
        supabase,
        session_id=session_id,
        user_id=user_id,
        project_patch={
            "outline_generation": {
                "status": "queued",
                "job_id": job["id"],
                "ready_source_count": len(ready_sources),
            }
        },
    )
    dispatch_background_task(background_tasks, run_course_creation_outline_job, job["id"], session_id, user_id)
    return job


def queue_draft_generation(
    supabase,
    *,
    session_id: str,
    user_id: str,
    use_ai_body_generation: bool,
    background_tasks: BackgroundTasks,
) -> dict:
    job_result = supabase.table("background_jobs").insert({
        "user_id": user_id,
        "session_id": session_id,
        "job_type": COURSE_CREATION_DRAFT_JOB_TYPE,
        "status": "queued",
        "payload": {
            "session_id": session_id,
            "use_ai_body_generation": use_ai_body_generation,
        },
    }).execute()
    if not job_result.data:
        raise HTTPException(status_code=500, detail="Failed to queue draft generation")

    job = job_result.data[0]
    update_course_creation_project_data(
        supabase,
        session_id=session_id,
        user_id=user_id,
        project_patch={
            "draft_generation": {
                "status": "queued",
                "job_id": job["id"],
                "use_ai_body_generation": use_ai_body_generation,
            }
        },
    )
    dispatch_background_task(
        background_tasks,
        run_course_creation_draft_job,
        job["id"],
        session_id,
        user_id,
        use_ai_body_generation=use_ai_body_generation,
    )
    return job


@router.get("/sessions/{session_id}/course-creation")
async def get_course_creation_project(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    return project_response(supabase, session=session)


@router.put("/sessions/{session_id}/course-creation")
async def update_course_creation_project(
    session_id: str,
    payload: CourseCreationSetupRequest,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    setup_patch = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    updated = update_course_creation_setup(
        supabase,
        session=session,
        setup_patch=setup_patch,
    )
    return project_response(supabase, session=updated)


@router.get("/sessions/{session_id}/course-creation/sources")
async def list_course_creation_project_sources(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_course_creation_session(supabase, session_id, user_id)
    return {"items": list_course_creation_sources(supabase, session_id=session_id, user_id=user_id)}


@router.get("/sessions/{session_id}/course-creation/source-chunks")
async def list_course_creation_source_chunks(
    session_id: str,
    limit: int = Query(250, ge=1, le=500),
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_course_creation_session(supabase, session_id, user_id)
    sources = list_course_creation_sources(supabase, session_id=session_id, user_id=user_id)
    items = []
    for source in sources:
        summary = source.get("extraction_summary") if isinstance(source.get("extraction_summary"), dict) else {}
        artifact_key = summary.get("artifact_key")
        if not artifact_key:
            continue
        try:
            data, _content_type = download_bytes(artifact_key)
            artifact = json.loads(data.decode("utf-8"))
        except Exception:
            continue
        chunks = artifact.get("chunks") if isinstance(artifact.get("chunks"), list) else []
        for chunk in chunks:
            if not isinstance(chunk, dict):
                continue
            items.append(source_pool_item(source, chunk))
            if len(items) >= limit:
                return {"items": items}
    return {"items": items}


@router.post("/sessions/{session_id}/course-creation/sources")
async def upload_course_creation_source(
    session_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_course_creation_session(supabase, session_id, user_id)

    filename = safe_upload_filename(file.filename, fallback="course-source")
    content_type = normalize_source_content_type(filename, file.content_type)
    data = await file.read()
    validate_source_upload(filename, content_type, data)

    source = create_course_creation_source(
        supabase,
        session_id=session_id,
        user_id=user_id,
        filename=filename,
        content_type=content_type,
        data=data,
    )
    job = queue_source_extraction(
        supabase,
        session_id=session_id,
        user_id=user_id,
        source_id=source["id"],
        filename=filename,
        background_tasks=background_tasks,
    )
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="course_creation_source_uploaded",
        properties={
            "source_id": source["id"],
            "job_id": job["id"],
            "filename": filename,
            "content_type": content_type,
            "size": len(data),
        },
    )
    refreshed = get_course_creation_source(
        supabase,
        session_id=session_id,
        user_id=user_id,
        source_id=source["id"],
    )
    return {
        "source": source_row(refreshed, job),
        "job": job,
    }


@router.post("/sessions/{session_id}/course-creation/sources/{source_id}/extract")
async def extract_course_creation_source(
    session_id: str,
    source_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_course_creation_session(supabase, session_id, user_id)
    source = get_course_creation_source(
        supabase,
        session_id=session_id,
        user_id=user_id,
        source_id=source_id,
    )
    job = queue_source_extraction(
        supabase,
        session_id=session_id,
        user_id=user_id,
        source_id=source_id,
        filename=source.get("filename") or "course-source",
        background_tasks=background_tasks,
    )
    refreshed = get_course_creation_source(
        supabase,
        session_id=session_id,
        user_id=user_id,
        source_id=source_id,
    )
    return {
        "source": source_row(refreshed, job),
        "job": job,
    }


@router.post("/sessions/{session_id}/course-creation/outline/generate")
async def generate_course_creation_outline(
    session_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_course_creation_session(supabase, session_id, user_id)
    job = queue_outline_generation(
        supabase,
        session_id=session_id,
        user_id=user_id,
        background_tasks=background_tasks,
    )
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="course_creation_outline_queued",
        properties={"job_id": job["id"]},
    )
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    return {
        "project": project_response(supabase, session=session),
        "job": job,
    }


@router.put("/sessions/{session_id}/course-creation/outline")
async def save_course_creation_outline(
    session_id: str,
    payload: CourseCreationOutlineRequest,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    project = course_creation_meta(session)
    existing_outline = project.get("outline") if isinstance(project.get("outline"), dict) else {}
    outline = normalize_course_creation_outline_for_save({
        **existing_outline,
        **payload.outline,
    })
    updated = update_course_creation_project_data(
        supabase,
        session_id=session_id,
        user_id=user_id,
        project_patch={
            "status": "outline_reviewed",
            "outline": outline,
            "draft_generation": None,
        },
    )
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="course_creation_outline_reviewed",
        properties={
            "review_revision_id": outline.get("review_revision_id"),
            "module_count": len(outline.get("modules") or []),
        },
    )
    return project_response(supabase, session=updated)


@router.post("/sessions/{session_id}/course-creation/drafts/generate")
async def generate_course_creation_editable_drafts(
    session_id: str,
    background_tasks: BackgroundTasks,
    use_ai_body_generation: bool = Query(True),
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    project = course_creation_meta(session)
    if not isinstance(project.get("outline"), dict):
        raise HTTPException(status_code=422, detail="Generate an outline before creating editable drafts")
    job = queue_draft_generation(
        supabase,
        session_id=session_id,
        user_id=user_id,
        use_ai_body_generation=use_ai_body_generation,
        background_tasks=background_tasks,
    )
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="course_creation_drafts_queued",
        properties={"job_id": job["id"], "use_ai_body_generation": use_ai_body_generation},
    )
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    return {
        "project": project_response(supabase, session=session),
        "job": job,
    }


@router.get("/sessions/{session_id}/course-creation/drafts/preview")
async def preview_course_creation_editable_drafts(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    project = course_creation_meta(session)
    outline = project.get("outline") if isinstance(project.get("outline"), dict) else {}
    outline_job_id = outline.get("job_id")
    outline_revision_id = outline.get("review_revision_id")

    modules_result = supabase.table("course_modules").select(
        "id, name, position, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).order("position").execute()
    modules = []
    module_ids = []
    for module in modules_result.data or []:
        metadata = module.get("metadata") if isinstance(module.get("metadata"), dict) else {}
        if not draft_preview_match(metadata, outline_job_id=outline_job_id, outline_revision_id=outline_revision_id):
            continue
        module_ids.append(module["id"])
        modules.append({
            "id": module["id"],
            "title": module.get("name"),
            "position": module.get("position"),
            "items": [],
        })
    if not module_ids:
        return {
            "module_count": 0,
            "content_item_count": 0,
            "modules": [],
        }

    module_by_id = {module["id"]: module for module in modules}
    module_items_result = supabase.table("course_module_items").select(
        "module_id, content_item_id, title, content_type, position, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).in_("module_id", module_ids).order("position").execute()
    content_item_ids = [
        row["content_item_id"]
        for row in module_items_result.data or []
        if row.get("content_item_id")
    ]
    bodies_by_id = {}
    if content_item_ids:
        bodies_by_id = {
            row["content_item_id"]: row
            for row in fetch_content_body_rows(
                supabase,
                content_item_ids,
                columns="content_item_id, html_body, plain_text",
            )
            if row.get("content_item_id")
        }

    item_count = 0
    for row in module_items_result.data or []:
        module = module_by_id.get(row.get("module_id"))
        content_item_id = row.get("content_item_id")
        if not module or not content_item_id:
            continue
        body = bodies_by_id.get(content_item_id) or {}
        module["items"].append({
            "id": content_item_id,
            "title": row.get("title"),
            "content_type": row.get("content_type"),
            "position": row.get("position"),
            "html_body": body.get("html_body") or "",
            "plain_text": body.get("plain_text") or "",
        })
        item_count += 1

    return {
        "module_count": len(modules),
        "content_item_count": item_count,
        "modules": modules,
    }


@router.post("/sessions/{session_id}/course-creation/export/confirm")
async def confirm_course_creation_export(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    session = get_owned_course_creation_session(supabase, session_id, user_id)
    project = course_creation_meta(session)
    draft_generation = project.get("draft_generation") if isinstance(project.get("draft_generation"), dict) else {}
    if draft_generation.get("status") != "succeeded" or not draft_generation.get("content_item_count"):
        raise HTTPException(status_code=422, detail="Generate editable drafts before exporting to Canvas Clean")

    updated_session = update_course_creation_project_data(
        supabase,
        session_id=session_id,
        user_id=user_id,
        project_patch={
            "status": "exported_to_canvas_clean",
            "exported_to_canvas_clean_at": utc_now_iso(),
        },
    )
    return {"project": project_response(supabase, session=updated_session)}


@router.delete("/sessions/{session_id}/course-creation/sources/{source_id}")
async def delete_course_creation_source(
    session_id: str,
    source_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_course_creation_session(supabase, session_id, user_id)
    mark_source_deleted(supabase, session_id=session_id, user_id=user_id, source_id=source_id)
    return {"ok": True}


@router.get("/sessions/{session_id}/course-creation/jobs/{job_id}")
async def get_course_creation_job(
    session_id: str,
    job_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = current_user_id(user)
    supabase = get_supabase()
    get_owned_course_creation_session(supabase, session_id, user_id)
    result = supabase.table("background_jobs").select(
        "id, session_id, job_type, status, attempts, payload, result, error_message, queued_at, started_at, finished_at"
    ).eq("id", job_id).eq("session_id", session_id).eq("user_id", user_id).in_(
        "job_type",
        [
            COURSE_CREATION_EXTRACT_JOB_TYPE,
            COURSE_CREATION_OUTLINE_JOB_TYPE,
            COURSE_CREATION_DRAFT_JOB_TYPE,
        ],
    ).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return result.data[0]
