"""Pending Review content push service."""

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException

from api.pending_review.schemas import ContentPushRequest
from canvas_sync import CanvasClient, get_active_pat, html_to_text, sha256_payload, word_count
from content_inventory import compact_whitespace
from services.editor.content_read import get_session_content_item
from services.editor.quiz_questions import (
    assert_no_quiz_submissions,
    local_quiz_question_canvas_id,
    metadata_with_canvas_question_response,
    quiz_question_child_ids_for_parent,
    touch_classic_quiz_after_question_push,
)
from services.pending_review.content_helpers import EDITABLE_CONTENT_TYPES
from services.pending_review.content_push_helpers import (
    canvas_id_from_create_response,
    canvas_push_payload,
    canvas_updated_timestamp,
    create_canvas_module_item_for_content,
    metadata_for_created_canvas_item,
    unpushed_revision_push_summary,
    unpushed_revision_rows,
)


def _write_content_pushed_event(
    supabase,
    *,
    session_id: str,
    user_id: str,
    body: ContentPushRequest,
    content_item_id: str,
    item: dict[str, Any],
    detail: dict[str, Any],
    next_title: str,
    next_canvas_url: str | None,
    next_published: bool | None,
    now: str,
    revision_push_summary: dict[str, Any],
) -> None:
    supabase.table("platform_events").insert({
        "user_id": user_id,
        "session_id": session_id,
        "event_type": "content_pushed",
        "properties": {
            "batch_id": body.batch_id,
            "content_item_id": content_item_id,
            "canvas_id": item.get("canvas_id"),
            "canvas_response_id": detail["canvas_response_id"],
            "content_type": item.get("content_type"),
            "title": next_title,
            "canvas_url": next_canvas_url,
            "published": next_published,
            "pushed_at": now,
            "revision_count": revision_push_summary["revision_count"],
            "first_revision_number": revision_push_summary["first_revision_number"],
            "latest_revision_number": revision_push_summary["latest_revision_number"],
            "first_changed_at": revision_push_summary["first_changed_at"],
            "latest_changed_at": revision_push_summary["latest_changed_at"],
            "latest_change_summary": revision_push_summary["latest_change_summary"],
            "change_summaries": revision_push_summary["change_summaries"],
        },
    }).execute()


async def push_content_item_to_canvas(
    supabase,
    *,
    session_id: str,
    content_item_id: str,
    user_id: str,
    user: dict,
    body: ContentPushRequest,
    canvas_base_url: str,
    canvas_course_id: str,
) -> dict[str, Any]:
    item_result = supabase.table("course_content_items").select(
        "id, canvas_id, content_type, title, canvas_url, published, module_canvas_id, module_name, is_orphaned, last_synced_at, metadata"
    ).eq("id", content_item_id).eq("session_id", session_id).eq(
        "user_id", user_id
    ).limit(1).execute()
    if not item_result.data:
        raise HTTPException(status_code=404, detail="Content item not found")

    item = item_result.data[0]
    if item.get("content_type") not in EDITABLE_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="This content type cannot be pushed to Canvas yet")

    revision_push_summary = unpushed_revision_push_summary(
        supabase,
        session_id=session_id,
        user_id=user_id,
        content_item_id=content_item_id,
        last_synced_at=item.get("last_synced_at"),
    )
    quiz_question_child_ids: list[str] = []
    changed_quiz_question_child_ids: set[str] = set()
    if item.get("content_type") == "quiz":
        quiz_question_child_ids = quiz_question_child_ids_for_parent(
            supabase,
            session_id,
            user_id,
            item.get("canvas_id"),
            include_pending_delete=True,
        )
        child_revision_rows = unpushed_revision_rows(
            supabase,
            session_id=session_id,
            user_id=user_id,
            content_item_ids=quiz_question_child_ids,
            last_synced_at=item.get("last_synced_at"),
        )
        changed_quiz_question_child_ids = {
            row["content_item_id"]
            for row in child_revision_rows
            if row.get("content_item_id")
        }
        if child_revision_rows:
            child_summaries = [
                compact_whitespace(row.get("change_summary"))
                for row in child_revision_rows
                if compact_whitespace(row.get("change_summary"))
            ]
            revision_push_summary = {
                **revision_push_summary,
                "revision_count": revision_push_summary.get("revision_count", 0) + len(child_revision_rows),
                "latest_change_summary": child_summaries[-1] if child_summaries else revision_push_summary.get("latest_change_summary"),
                "change_summaries": [
                    *(revision_push_summary.get("change_summaries") or []),
                    *child_summaries,
                ],
            }

    body_result = supabase.table("course_content_bodies").select(
        "html_body, plain_text"
    ).eq("content_item_id", content_item_id).limit(1).execute()
    saved_body = body_result.data[0] if body_result.data else {}
    html_body = saved_body.get("html_body") or ""
    publish_state = body.published if body.published is not None else item.get("published")
    item["canvas_course_id"] = canvas_course_id
    path, payload, method = canvas_push_payload(item, html_body, publish_state)

    pat_token = get_active_pat(supabase, user_id, canvas_base_url)
    client = CanvasClient(canvas_base_url, pat_token)
    now = datetime.now(timezone.utc).isoformat()
    try:
        assert_no_quiz_submissions(client, canvas_course_id, item)
        if method == "patch":
            canvas_response = client.patch_form(path, payload)
        elif method == "post":
            canvas_response = client.post_form(path, payload)
        elif method == "post_json":
            canvas_response = client.post_json(path, payload)
        elif method == "put_json":
            canvas_response = client.put_json(path, payload)
        else:
            canvas_response = client.put_form(path, payload)
        if item.get("content_type") == "quiz" and changed_quiz_question_child_ids:
            question_result = supabase.table("course_content_items").select(
                "id, canvas_id, metadata"
            ).eq("session_id", session_id).eq("user_id", user_id).in_(
                "id", list(changed_quiz_question_child_ids)
            ).execute()
            for question_item in question_result.data or []:
                metadata = question_item.get("metadata") if isinstance(question_item.get("metadata"), dict) else {}
                question_body_result = supabase.table("course_content_bodies").select(
                    "html_body"
                ).eq("content_item_id", question_item["id"]).limit(1).execute()
                question_html_body = (question_body_result.data[0].get("html_body") if question_body_result.data else "") or ""
                if metadata.get("pending_delete"):
                    question_id = metadata.get("question_id")
                    if question_id and not metadata.get("is_new_local"):
                        client.delete(f"/courses/{canvas_course_id}/quizzes/{item.get('canvas_id')}/questions/{question_id}")
                    supabase.table("content_revisions").delete().eq("content_item_id", question_item["id"]).execute()
                    supabase.table("course_content_bodies").delete().eq("content_item_id", question_item["id"]).execute()
                    supabase.table("course_content_items").delete().eq("id", question_item["id"]).execute()
                elif not metadata.get("question_id") or metadata.get("is_new_local"):
                    question_path, question_payload, question_method = canvas_push_payload(
                        {**question_item, "content_type": "quiz_question", "canvas_course_id": canvas_course_id},
                        question_html_body or metadata.get("question_text") or "",
                        None,
                    )
                    question_response = client.post_json(question_path, question_payload) if question_method == "post_json" else client.put_json(question_path, question_payload)
                    response_question_id = question_response.get("id")
                    updated_metadata = metadata_with_canvas_question_response(metadata, question_response)
                    if response_question_id:
                        supabase.table("course_content_items").update({
                            "canvas_id": local_quiz_question_canvas_id(item.get("canvas_id"), response_question_id),
                            "metadata": updated_metadata,
                            "last_synced_at": now,
                            "updated_at": now,
                        }).eq("id", question_item["id"]).execute()
                    else:
                        supabase.table("course_content_items").update({
                            "metadata": updated_metadata,
                            "last_synced_at": now,
                            "updated_at": now,
                        }).eq("id", question_item["id"]).execute()
                else:
                    question_path, question_payload, _ = canvas_push_payload(
                        {**question_item, "content_type": "quiz_question", "canvas_course_id": canvas_course_id},
                        question_html_body or metadata.get("question_text") or "",
                        None,
                    )
                    question_response = client.put_json(question_path, question_payload)
                    supabase.table("course_content_items").update({
                        "metadata": metadata_with_canvas_question_response(metadata, question_response),
                        "last_synced_at": now,
                        "updated_at": now,
                    }).eq("id", question_item["id"]).execute()
            touch_classic_quiz_after_question_push(
                client,
                canvas_course_id,
                str(item.get("canvas_id")),
                title=item.get("title"),
                description=html_body,
                question_count=len(quiz_question_child_ids_for_parent(supabase, session_id, user_id, str(item.get("canvas_id")))),
                quiz_type=(item.get("metadata") or {}).get("quiz_type") if isinstance(item.get("metadata"), dict) else None,
            )
    except httpx.HTTPStatusError as exc:
        client.close()
        status_code = exc.response.status_code
        if status_code in {401, 403}:
            raise HTTPException(status_code=403, detail="Canvas rejected the token for this push")
        if status_code == 404:
            raise HTTPException(status_code=404, detail="Canvas content item was not found")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {status_code} while pushing content")
    except httpx.HTTPError as exc:
        client.close()
        raise HTTPException(status_code=502, detail=f"Canvas push failed: {exc}")

    next_title = (
        canvas_response.get("title")
        or canvas_response.get("name")
        or item.get("title")
    )
    next_canvas_url = canvas_response.get("html_url") or item.get("canvas_url")
    next_published = canvas_response.get("published")
    if next_published is None:
        next_published = publish_state
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    next_metadata = metadata
    next_canvas_id = item.get("canvas_id")
    next_module_canvas_id = item.get("module_canvas_id")
    next_module_name = item.get("module_name")
    next_is_orphaned = item.get("is_orphaned")
    if metadata.get("is_new_local"):
        next_canvas_id = canvas_id_from_create_response(item["content_type"], canvas_response, item.get("canvas_id"))
        next_metadata = metadata_for_created_canvas_item(item["content_type"], metadata, canvas_response)
    if next_metadata.get("desired_canvas_module_id"):
        placed_in_module = create_canvas_module_item_for_content(
            supabase,
            session_id=session_id,
            user_id=user_id,
            client=client,
            canvas_course_id=canvas_course_id,
            item={**item, "title": next_title, "id": content_item_id, "content_type": item.get("content_type"), "published": next_published},
            canvas_response=canvas_response,
            metadata=next_metadata,
            now=now,
        )
        if placed_in_module:
            next_module_canvas_id = str(next_metadata.get("desired_canvas_module_id"))
            next_module_name = next_metadata.get("desired_module_name")
            next_is_orphaned = False
    client.close()
    updated_item_values = {
        "canvas_id": next_canvas_id,
        "title": next_title,
        "canvas_url": next_canvas_url,
        "published": next_published,
        "module_canvas_id": next_module_canvas_id,
        "module_name": next_module_name,
        "is_orphaned": next_is_orphaned,
        "metadata": next_metadata,
        "body_hash": sha256_payload({"title": next_title, "html_body": html_body, "metadata": next_metadata}),
        "body_word_count": word_count(saved_body.get("plain_text") or html_to_text(html_body)),
        "last_canvas_edit_at": canvas_updated_timestamp(item["content_type"], canvas_response),
        "last_synced_at": now,
        "updated_at": now,
    }
    if item.get("content_type") == "quiz_question":
        response_question_id = canvas_response.get("id") or canvas_response.get("question", {}).get("id")
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        parent_quiz_id = metadata.get("parent_quiz_canvas_id")
        if parent_quiz_id:
            parent_body = ""
            parent_title = metadata.get("parent_quiz_title")
            parent_result = supabase.table("course_content_items").select(
                "id, title, metadata"
            ).eq("session_id", session_id).eq("user_id", user_id).eq(
                "content_type", "quiz"
            ).eq("canvas_id", str(parent_quiz_id)).limit(1).execute()
            if parent_result.data:
                parent_item = parent_result.data[0]
                parent_title = parent_item.get("title") or parent_title
                parent_body_result = supabase.table("course_content_bodies").select(
                    "html_body"
                ).eq("content_item_id", parent_item["id"]).limit(1).execute()
                parent_body = (parent_body_result.data[0].get("html_body") if parent_body_result.data else "") or ""
            question_count = len(quiz_question_child_ids_for_parent(supabase, session_id, user_id, str(parent_quiz_id)))
            touch_classic_quiz_after_question_push(
                client,
                canvas_course_id,
                str(parent_quiz_id),
                title=parent_title,
                description=parent_body,
                question_count=question_count,
                quiz_type=(parent_item.get("metadata") or {}).get("quiz_type") if parent_result.data and isinstance(parent_item.get("metadata"), dict) else None,
            )
        updated_metadata = metadata_with_canvas_question_response(metadata, canvas_response)
        updated_item_values["metadata"] = updated_metadata
        if response_question_id:
            updated_item_values["canvas_id"] = local_quiz_question_canvas_id(metadata.get("parent_quiz_canvas_id"), response_question_id)

    supabase.table("course_content_items").update(updated_item_values).eq("id", content_item_id).execute()

    detail = await get_session_content_item(session_id, content_item_id, user)
    detail["pushed"] = True
    detail["canvas_response_id"] = canvas_response.get("id") or canvas_response.get("page_id")
    _write_content_pushed_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        body=body,
        content_item_id=content_item_id,
        item=item,
        detail=detail,
        next_title=next_title,
        next_canvas_url=next_canvas_url,
        next_published=next_published,
        now=now,
        revision_push_summary=revision_push_summary,
    )
    return detail
