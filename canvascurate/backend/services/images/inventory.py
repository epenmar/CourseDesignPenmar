"""Image inventory, upload, update, and asset services."""

from __future__ import annotations

import io
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

import httpx
from fastapi import HTTPException, Response, UploadFile
from PIL import Image, ImageOps

from api.images.schemas import BulkImageUpdateRequest, ImageUpdateRequest
from canvas_sync import get_active_pat, sha256_payload, sync_session_course_images
from content_inventory import build_image_inventory_rows, compact_whitespace
from image_proxy import cache_image_assets, editor_upload_storage_keys, make_thumb_bytes, read_cached_variant
from r2_storage import get_r2_bucket, is_r2_configured, upload_bytes
from services.alt_text_validator import alt_issue_label, classify_alt_text
from services.canvas_uploads import (
    canvas_course_connection,
    canvas_file_html_url,
    canvas_image_html_url,
    editor_upload_filename,
    upload_canvas_course_file,
)
from services.content_bodies import fetch_content_html_by_item_id
from services.document_records import get_owned_session, write_platform_event
from services.images.text import (
    COURSE_IMAGES_BASE_SELECT,
    COURSE_IMAGES_SELECT,
    EDITABLE_CONTENT_TYPES,
    MAX_AI_IMAGE_BYTES,
    annotate_image_content_apply_state,
    annotate_image_file_names,
    annotate_image_rows,
    encode_jpeg_under_limit,
    fetch_session_item_map,
    get_session_canvas_course_id,
    hydrate_image_row,
)
from services.inventory_decision_sync import sync_image_reviews_to_file_decisions
from supabase_client import get_supabase


logger = logging.getLogger(__name__)

IMAGE_STATUS_FILTERS = {"all", "deployed", "broken", "orphaned"}
MAX_EDITOR_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
HTML_BODY_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz", "quiz_question"}


def count_table_rows(supabase, table_name: str, session_id: str, user_id: str) -> int:
    result = supabase.table(table_name).select("*", count="exact", head=True).eq(
        "session_id", session_id
    ).eq("user_id", user_id).execute()
    return result.count or 0


def fetch_session_items_and_bodies(
    supabase,
    session_id: str,
    user_id: str,
    content_types: list[str] | None = None,
) -> tuple[list[dict], dict[str, str]]:
    query = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, canvas_url, module_canvas_id, module_name, published, is_orphaned, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id)
    if content_types:
        query = query.in_("content_type", content_types)

    item_result = query.execute()
    items = item_result.data or []
    item_ids = [
        item["id"]
        for item in items
        if item.get("id") and item.get("content_type") in HTML_BODY_CONTENT_TYPES
    ]
    body_by_item_id = fetch_content_html_by_item_id(supabase, item_ids)
    return items, body_by_item_id


def missing_review_action_column(exc: Exception) -> bool:
    message = str(exc).lower()
    return "review_action" in message and "column" in message


def process_editor_upload_image(data: bytes, content_type: str, filename: str) -> tuple[bytes, str, str, int, int, bool]:
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            if len(data) <= MAX_AI_IMAGE_BYTES:
                return data, content_type, filename, width, height, False
            processed, width, height = encode_jpeg_under_limit(image)
            return processed, "image/jpeg", editor_upload_filename(filename, "image/jpeg"), width, height, True
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Uploaded image could not be read: {exc}")


def shape_image_rows(
    rows: list[dict],
    q: str | None,
    alt: Literal["all", "missing", "complete"],
    status: Literal["all", "deployed", "broken", "orphaned"],
) -> tuple[list[dict], int, dict[str, int]]:
    filtered = []
    normalized_query = q.strip().lower() if q else ""
    status_counts = {"all": 0, "deployed": 0, "broken": 0, "orphaned": 0}
    for row in rows:
        effective_alt = compact_whitespace(row.get("edited_alt_text") or row.get("existing_alt_text"))
        if row.get("is_decorative"):
            effective_alt = "Decorative"
        alt_issue_code = None if row.get("is_decorative") else classify_alt_text(
            effective_alt,
            row.get("image_file_name"),
            row.get("canvas_url"),
        )
        current_status = row.get("status_label") or "deployed"
        if current_status in status_counts:
            status_counts[current_status] += 1
        status_counts["all"] += 1
        if alt == "missing" and not alt_issue_code:
            continue
        if alt == "complete" and alt_issue_code:
            continue
        if status != "all" and current_status != status:
            continue
        haystack = " ".join([
            row.get("canvas_url") or "",
            row.get("image_file_name") or "",
            row.get("image_file_url") or "",
            row.get("canvas_file_id") or "",
            row.get("existing_alt_text") or "",
            row.get("edited_alt_text") or "",
            row.get("long_description") or "",
            row.get("content_title") or "",
            row.get("module_name") or "",
        ]).lower()
        if normalized_query and normalized_query not in haystack:
            continue
        row["effective_alt_text"] = effective_alt or None
        row["alt_issue_code"] = alt_issue_code
        row["alt_issue_label"] = alt_issue_label(alt_issue_code)
        filtered.append(row)

    filtered.sort(key=lambda row: (
        (row.get("content_title") or "").lower(),
        (row.get("module_name") or "").lower(),
        row.get("canvas_url") or "",
        row.get("id") or "",
    ))
    missing_alt_count = sum(1 for row in filtered if row.get("alt_issue_code"))
    return filtered, missing_alt_count, status_counts


def list_session_images(
    *,
    session_id: str,
    user_id: str,
    limit: int,
    offset: int,
    q: str | None,
    alt: Literal["all", "missing", "complete"],
    status: Literal["all", "deployed", "broken", "orphaned"],
    refresh: bool,
) -> dict[str, Any]:
    if status not in IMAGE_STATUS_FILTERS:
        raise HTTPException(status_code=422, detail="Invalid image status filter")

    supabase = get_supabase()
    session = get_owned_session(supabase, session_id, user_id)
    source_canvas_course_id = get_session_canvas_course_id(supabase, session.get("source_course_id"), user_id)
    count_table_rows(supabase, "course_images", session_id, user_id)
    sync_error: str | None = None
    if refresh:
        try:
            sync_session_course_images(supabase, session_id, user_id, source_canvas_course_id)
        except Exception as exc:
            sync_error = str(exc)

    try:
        result = supabase.table("course_images").select(COURSE_IMAGES_SELECT).eq(
            "session_id", session_id
        ).eq("user_id", user_id).execute()
        rows = result.data or []
    except Exception as exc:
        if not missing_review_action_column(exc):
            raise
        result = supabase.table("course_images").select(COURSE_IMAGES_BASE_SELECT).eq(
            "session_id", session_id
        ).eq("user_id", user_id).execute()
        rows = result.data or []
        for row in rows:
            row["review_action"] = "keep"

    if not rows:
        items, body_by_item_id = fetch_session_items_and_bodies(
            supabase,
            session_id,
            user_id,
            EDITABLE_CONTENT_TYPES,
        )
        derived_rows = build_image_inventory_rows(items, body_by_item_id, source_canvas_course_id)
        now = datetime.now(timezone.utc).isoformat()
        rows = [
            {
                "id": f"derived-{index}",
                "content_item_id": row.get("content_item_id"),
                "canvas_url": row.get("canvas_url"),
                "canvas_file_id": row.get("canvas_file_id"),
                "canvas_course_id": row.get("canvas_course_id"),
                "status": "new",
                "r2_original_key": None,
                "r2_thumb_key": None,
                "existing_alt_text": row.get("existing_alt_text"),
                "edited_alt_text": None,
                "long_description": None,
                "is_decorative": False,
                "review_action": "delete" if row.get("content_is_orphaned") else "keep",
                "width": row.get("width"),
                "height": row.get("height"),
                "mime_type": None,
                "file_size_bytes": None,
                "is_broken": False,
                "created_at": now,
                "updated_at": now,
                "proxy_available": False,
            }
            for index, row in enumerate(derived_rows, start=1)
        ]
    else:
        for row in rows:
            row["proxy_available"] = True

    item_map = fetch_session_item_map(
        supabase,
        session_id,
        user_id,
        [row["content_item_id"] for row in rows if row.get("content_item_id")],
    )
    annotate_image_rows(rows, item_map, source_canvas_course_id)
    annotate_image_file_names(supabase, rows, session_id, user_id)
    for row in rows:
        row["review_action"] = row.get("review_action") or ("delete" if row.get("content_is_orphaned") else "keep")
    filtered, missing_alt_count, status_counts = shape_image_rows(rows, q, alt, status)
    total_count = len(filtered)
    page = filtered[offset: offset + limit]
    annotate_image_content_apply_state(supabase, page)

    return {
        "items": page,
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
        "next_offset": offset + limit if offset + limit < total_count else None,
        "counts": {
            "all": total_count,
            "missing_alt": missing_alt_count,
            "complete_alt": total_count - missing_alt_count,
        },
        "status_counts": status_counts,
        "warning": sync_error,
    }


def bulk_update_session_images(
    *,
    session_id: str,
    user_id: str,
    body: BulkImageUpdateRequest,
) -> dict[str, Any]:
    image_ids = list(dict.fromkeys(body.image_ids))
    supabase = get_supabase()
    get_owned_session(supabase, session_id, user_id)

    image_result = supabase.table("course_images").select(
        "id, canvas_file_id"
    ).eq("session_id", session_id).eq("user_id", user_id).in_(
        "id", image_ids
    ).execute()
    found_ids = {row["id"] for row in (image_result.data or [])}
    if len(found_ids) != len(image_ids):
        raise HTTPException(status_code=404, detail="One or more images were not found")

    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.is_decorative is not None:
        updates["is_decorative"] = body.is_decorative
        if body.is_decorative:
            updates["edited_alt_text"] = None
    if body.review_action is not None:
        updates["review_action"] = body.review_action

    if len(updates) == 1:
        raise HTTPException(status_code=422, detail="No bulk update fields provided")

    try:
        supabase.table("course_images").update(updates).eq(
            "session_id", session_id
        ).eq("user_id", user_id).in_(
            "id", image_ids
        ).execute()
    except Exception as exc:
        if not missing_review_action_column(exc):
            raise
        if body.review_action is not None:
            raise HTTPException(
                status_code=409,
                detail="Image keep/remove state requires the latest database migration. Run docs/migration.sql first.",
            )
        fallback_updates = {key: value for key, value in updates.items() if key != "review_action"}
        supabase.table("course_images").update(fallback_updates).eq(
            "session_id", session_id
        ).eq("user_id", user_id).in_(
            "id", image_ids
        ).execute()

    file_decision_sync_result = None
    if body.review_action is not None:
        file_decision_sync_result = sync_image_reviews_to_file_decisions(
            supabase,
            session_id=session_id,
            user_id=user_id,
            canvas_file_ids=[
                str(row["canvas_file_id"])
                for row in image_result.data or []
                if row.get("canvas_file_id")
            ],
        )

    return {
        "updated_count": len(image_ids),
        "image_ids": image_ids,
        "is_decorative": body.is_decorative,
        "review_action": body.review_action,
        "file_decision_sync": file_decision_sync_result,
    }


async def upload_editor_image(
    *,
    session_id: str,
    content_item_id: str,
    user_id: str,
    file: UploadFile,
) -> dict[str, Any]:
    filename = (file.filename or "image").strip() or "image"
    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="Only image uploads are supported here")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded image is empty")
    if len(data) > MAX_EDITOR_IMAGE_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image uploads must be 10 MB or smaller")
    data, content_type, filename, width, height, image_was_processed = process_editor_upload_image(data, content_type, filename)

    supabase = get_supabase()
    session = get_owned_session(supabase, session_id, user_id)
    item_result = supabase.table("course_content_items").select(
        "id, title, content_type"
    ).eq("id", content_item_id).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")
    item = item_result.data[0]
    if item.get("content_type") not in EDITABLE_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="This content type does not support editor image uploads")

    course = canvas_course_connection(supabase, session_id, user_id)
    canvas_base_url = course["canvas_base_url"]
    canvas_course_id = course["canvas_course_id"]
    pat_token = get_active_pat(supabase, user_id, canvas_base_url)

    try:
        file_row = upload_canvas_course_file(
            canvas_base_url=canvas_base_url,
            canvas_course_id=canvas_course_id,
            pat_token=pat_token,
            filename=filename,
            content_type=content_type,
            data=data,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code} while uploading image")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Canvas image upload failed: {exc}")

    image_id = str(uuid.uuid4())
    canvas_url = canvas_image_html_url(canvas_base_url, canvas_course_id, file_row)
    canvas_file_id = str(file_row.get("id")) if file_row.get("id") is not None else None
    uploaded_filename = file_row.get("filename") or filename
    image_file_title = file_row.get("display_name") or uploaded_filename
    original_key, thumb_key = editor_upload_storage_keys(session_id, image_id, filename, content_type)
    thumb_bytes, _thumb_width, _thumb_height, thumb_content_type = make_thumb_bytes(data)
    stored_in_r2 = False
    if is_r2_configured():
        try:
            upload_bytes(
                original_key,
                data,
                content_type=content_type,
                cache_control="private, max-age=31536000, immutable",
            )
            upload_bytes(
                thumb_key,
                thumb_bytes,
                content_type=thumb_content_type if thumb_content_type != "application/octet-stream" else content_type,
                cache_control="private, max-age=31536000, immutable",
            )
            stored_in_r2 = True
        except Exception:
            logger.exception(
                "Failed to store editor-uploaded image in R2 for session_id=%s content_item_id=%s image_id=%s",
                session_id,
                content_item_id,
                image_id,
            )

    now = datetime.now(timezone.utc).isoformat()
    if canvas_file_id:
        folder = file_row.get("folder") if isinstance(file_row.get("folder"), dict) else {}
        file_content_row = {
            "session_id": session_id,
            "user_id": user_id,
            "canvas_id": canvas_file_id,
            "content_type": "file",
            "title": image_file_title,
            "canvas_url": canvas_file_html_url(canvas_base_url, canvas_course_id, file_row),
            "published": not bool(file_row.get("hidden")),
            "module_name": None,
            "position": None,
            "body_hash": sha256_payload({"file": canvas_file_id, "filename": uploaded_filename}),
            "body_word_count": 0,
            "last_canvas_edit_at": file_row.get("updated_at") or file_row.get("created_at") or now,
            "last_synced_at": now,
            "is_orphaned": True,
            "metadata": {
                "filename": uploaded_filename,
                "content_type": file_row.get("content-type") or file_row.get("content_type") or content_type,
                "size": file_row.get("size") or len(data),
                "folder_id": file_row.get("folder_id") or folder.get("id"),
                "folder_name": folder.get("name"),
                "folder_path": folder.get("full_name"),
                "uploaded_via": "editor_image_upload",
                "source_content_item_id": content_item_id,
                "source_image_id": image_id,
                "processed": image_was_processed,
            },
            "updated_at": now,
        }
        existing_file_result = supabase.table("course_content_items").select("id").eq(
            "session_id", session_id
        ).eq("user_id", user_id).eq("canvas_id", canvas_file_id).eq(
            "content_type", "file"
        ).limit(1).execute()
        if existing_file_result.data:
            supabase.table("course_content_items").update(file_content_row).eq("id", existing_file_result.data[0]["id"]).execute()
        else:
            supabase.table("course_content_items").insert(file_content_row).execute()

    insert_values = {
        "id": image_id,
        "session_id": session_id,
        "user_id": user_id,
        "content_item_id": content_item_id,
        "canvas_url": canvas_url,
        "canvas_file_id": canvas_file_id,
        "canvas_course_id": str(canvas_course_id),
        "status": "new",
        "r2_original_key": original_key if stored_in_r2 else None,
        "r2_thumb_key": thumb_key if stored_in_r2 else None,
        "existing_alt_text": None,
        "edited_alt_text": None,
        "long_description": None,
        "is_decorative": False,
        "review_action": "keep",
        "width": width,
        "height": height,
        "mime_type": content_type,
        "file_size_bytes": len(data),
        "is_broken": False,
        "created_at": now,
        "updated_at": now,
    }
    try:
        supabase.table("course_images").insert(insert_values).execute()
        refreshed = supabase.table("course_images").select(COURSE_IMAGES_SELECT).eq(
            "id", image_id
        ).limit(1).execute()
    except Exception as exc:
        if not missing_review_action_column(exc):
            raise
        fallback_values = {key: value for key, value in insert_values.items() if key != "review_action"}
        supabase.table("course_images").insert(fallback_values).execute()
        refreshed = supabase.table("course_images").select(COURSE_IMAGES_BASE_SELECT).eq(
            "id", image_id
        ).limit(1).execute()

    row = refreshed.data[0] if refreshed.data else None
    if not row:
        raise HTTPException(status_code=500, detail="Failed to reload uploaded image")

    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="editor_image_uploaded",
        properties={
            "content_item_id": content_item_id,
            "image_id": image_id,
            "canvas_file_id": insert_values["canvas_file_id"],
            "canvas_url": canvas_url,
            "filename": uploaded_filename,
            "r2_original_key": original_key if stored_in_r2 else None,
            "uploaded_at": now,
            "processed": image_was_processed,
            "file_size_bytes": len(data),
        },
    )

    shaped = hydrate_image_row(supabase, session, user_id, row)
    return {
        "image": shaped,
        "insert": {
            "src": canvas_url,
            "alt": "",
            "title": filename,
            "canvas_file_id": insert_values["canvas_file_id"],
        },
    }


def update_session_image(
    *,
    session_id: str,
    image_id: str,
    user_id: str,
    body: ImageUpdateRequest,
) -> dict[str, Any]:
    supabase = get_supabase()
    session = get_owned_session(supabase, session_id, user_id)
    image_result = supabase.table("course_images").select(
        "id, canvas_file_id, existing_alt_text, edited_alt_text, long_description, is_decorative"
    ).eq("id", image_id).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not image_result.data:
        raise HTTPException(status_code=404, detail="Image not found")

    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.edited_alt_text is not None:
        updates["edited_alt_text"] = compact_whitespace(body.edited_alt_text) or None
    if body.long_description is not None:
        updates["long_description"] = compact_whitespace(body.long_description) or None
    if body.is_decorative is not None:
        updates["is_decorative"] = body.is_decorative
        if body.is_decorative:
            updates["edited_alt_text"] = None
    if body.review_action is not None:
        updates["review_action"] = body.review_action

    try:
        supabase.table("course_images").update(updates).eq("id", image_id).execute()
        refreshed = supabase.table("course_images").select(COURSE_IMAGES_SELECT).eq(
            "id", image_id
        ).limit(1).execute()
    except Exception as exc:
        if not missing_review_action_column(exc):
            raise
        if body.review_action is not None:
            raise HTTPException(
                status_code=409,
                detail="Image keep/remove state requires the latest database migration. Run docs/migration.sql first.",
            )
        fallback_updates = {key: value for key, value in updates.items() if key != "review_action"}
        supabase.table("course_images").update(fallback_updates).eq("id", image_id).execute()
        refreshed = supabase.table("course_images").select(COURSE_IMAGES_BASE_SELECT).eq(
            "id", image_id
        ).limit(1).execute()
    row = refreshed.data[0] if refreshed.data else None
    if not row:
        raise HTTPException(status_code=500, detail="Failed to reload updated image")
    if body.review_action is not None and image_result.data[0].get("canvas_file_id"):
        sync_image_reviews_to_file_decisions(
            supabase,
            session_id=session_id,
            user_id=user_id,
            canvas_file_ids=[str(image_result.data[0]["canvas_file_id"])],
        )
    return hydrate_image_row(supabase, session, user_id, row)


def get_session_image_asset(
    *,
    session_id: str,
    image_id: str,
    user_id: str,
    variant: Literal["thumb", "original"],
) -> Response:
    supabase = get_supabase()
    session = get_owned_session(supabase, session_id, user_id)
    image_result = supabase.table("course_images").select(
        "id, canvas_url, r2_original_key, r2_thumb_key, mime_type, status, width, height, file_size_bytes"
    ).eq("id", image_id).eq("session_id", session_id).eq("user_id", user_id).limit(1).execute()
    if not image_result.data:
        raise HTTPException(status_code=404, detail="Image not found")

    image = image_result.data[0]
    r2_configured = is_r2_configured()
    r2_bucket = get_r2_bucket() if r2_configured else "unconfigured"
    target_key = image.get("r2_thumb_key") if variant == "thumb" else image.get("r2_original_key")
    if target_key and r2_configured:
        try:
            payload, content_type = read_cached_variant(
                target_key,
                "image/webp" if variant == "thumb" else (image.get("mime_type") or "application/octet-stream"),
            )
            return Response(
                content=payload,
                media_type=content_type,
                headers={
                    "Cache-Control": "private, max-age=3600",
                    "X-CanvasCurate-Cache": "r2",
                    "X-CanvasCurate-R2-Configured": str(r2_configured).lower(),
                    "X-CanvasCurate-R2-Bucket": r2_bucket,
                    "X-CanvasCurate-R2-Key": "present",
                },
            )
        except Exception:
            logger.exception(
                "Failed to read image asset from R2 for session_id=%s image_id=%s variant=%s target_key=%s; falling back to Canvas",
                session_id,
                image_id,
                variant,
                target_key,
            )

    source_course_id = session.get("source_course_id")
    if not source_course_id:
        raise HTTPException(status_code=400, detail="Session has no source course")

    course_result = supabase.table("courses").select(
        "canvas_base_url"
    ).eq("id", source_course_id).eq("user_id", user_id).limit(1).execute()
    if not course_result.data:
        raise HTTPException(status_code=404, detail="Source course not found")

    canvas_base_url = course_result.data[0].get("canvas_base_url")
    pat_token = get_active_pat(supabase, user_id, canvas_base_url)
    logger.info(
        "Serving image asset from Canvas path session_id=%s image_id=%s variant=%s r2_configured=%s existing_target_key=%s bucket=%s",
        session_id,
        image_id,
        variant,
        r2_configured,
        bool(target_key),
        r2_bucket,
    )
    try:
        cached = cache_image_assets(
            session_id=session_id,
            image_id=image_id,
            canvas_url=image["canvas_url"],
            pat_token=pat_token,
            existing_original_key=image.get("r2_original_key"),
            existing_thumb_key=image.get("r2_thumb_key"),
        )
    except Exception as exc:
        supabase.table("course_images").update({
            "is_broken": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", image_id).execute()
        raise HTTPException(
            status_code=502,
            detail=f"Image could not be loaded from Canvas: {exc}",
        )

    logger.info(
        "Image asset cache attempt completed session_id=%s image_id=%s variant=%s r2_original_key=%s r2_thumb_key=%s status=%s",
        session_id,
        image_id,
        variant,
        bool(cached.get("r2_original_key")),
        bool(cached.get("r2_thumb_key")),
        cached.get("status"),
    )
    supabase.table("course_images").update({
        "status": cached["status"],
        "r2_original_key": cached.get("r2_original_key"),
        "r2_thumb_key": cached.get("r2_thumb_key"),
        "mime_type": cached.get("original_content_type") or image.get("mime_type"),
        "width": cached.get("width") or image.get("width"),
        "height": cached.get("height") or image.get("height"),
        "file_size_bytes": cached.get("file_size_bytes") or image.get("file_size_bytes"),
        "is_broken": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", image_id).execute()

    if variant == "original" and cached.get("original_bytes") is not None:
        return Response(
            content=cached["original_bytes"],
            media_type=cached.get("original_content_type") or "application/octet-stream",
            headers={
                "Cache-Control": "private, max-age=3600",
                "X-CanvasCurate-Cache": "canvas",
                "X-CanvasCurate-R2-Configured": str(r2_configured).lower(),
                "X-CanvasCurate-R2-Bucket": r2_bucket,
                "X-CanvasCurate-R2-Key": "present" if cached.get("r2_original_key") else "missing",
            },
        )

    return Response(
        content=cached["bytes"],
        media_type=cached["content_type"],
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-CanvasCurate-Cache": "canvas",
            "X-CanvasCurate-R2-Configured": str(r2_configured).lower(),
            "X-CanvasCurate-R2-Bucket": r2_bucket,
            "X-CanvasCurate-R2-Key": "present" if cached.get("r2_thumb_key") else "missing",
        },
    )
