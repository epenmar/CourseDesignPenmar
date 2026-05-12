"""Materialize Course Creation outlines into local editable Canvas drafts."""

from __future__ import annotations

import html
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from canvas_sync import html_to_text, sha256_payload, word_count
from services.course_creation.content_templates import (
    build_template_content,
    merge_ai_template_content,
    normalize_template_kind,
    render_template_html,
    template_schema_for_prompt,
)
from services.document_records import write_platform_event

LOCAL_EPOCH = "1970-01-01T00:00:00+00:00"
SUPPORTED_DRAFT_TYPES = {"page", "assignment", "discussion", "quiz", "overview", "learningmaterials"}


def compact_text(value: Any, limit: int = 500) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


def normalize_content_type(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"overview", "learningmaterials"}:
        return "page"
    if normalized in {"page", "assignment", "discussion", "quiz"}:
        return normalized
    return "page"


def canvas_module_item_type(content_type: str) -> str:
    if content_type == "page":
        return "Page"
    if content_type == "assignment":
        return "Assignment"
    if content_type == "discussion":
        return "Discussion"
    if content_type == "quiz":
        return "Quiz"
    return content_type.title()


def render_outline_item_html(module: dict[str, Any], item: dict[str, Any], setup: dict[str, Any]) -> str:
    title = compact_text(item.get("title"), 180) or "Draft Item"
    module_title = compact_text(module.get("title"), 180)
    purpose = compact_text(item.get("purpose"), 700)
    overview = compact_text(module.get("overview"), 1000)
    objectives = [
        compact_text(objective, 240)
        for objective in (module.get("objectives") if isinstance(module.get("objectives"), list) else [])
        if compact_text(objective, 240)
    ][:6]
    topics = [
        compact_text(topic, 120)
        for topic in (module.get("topics") if isinstance(module.get("topics"), list) else [])
        if compact_text(topic, 120)
    ][:8]
    source_ids = [
        compact_text(source_id, 120)
        for source_id in (item.get("source_chunk_ids") if isinstance(item.get("source_chunk_ids"), list) else [])
        if compact_text(source_id, 120)
    ][:12]
    course_title = compact_text(setup.get("course_title"), 180)

    parts = [f"<h2>{html.escape(title)}</h2>"]
    if module_title:
        parts.append(f"<p><strong>Module:</strong> {html.escape(module_title)}</p>")
    if course_title:
        parts.append(f"<p><strong>Course:</strong> {html.escape(course_title)}</p>")
    if purpose:
        parts.append(f"<h3>Purpose</h3><p>{html.escape(purpose)}</p>")
    if overview:
        parts.append(f"<h3>Module Overview</h3><p>{html.escape(overview)}</p>")
    if objectives:
        parts.append("<h3>Learning Objectives</h3><ul>")
        parts.extend(f"<li>{html.escape(objective)}</li>" for objective in objectives)
        parts.append("</ul>")
    if topics:
        parts.append("<h3>Topics</h3><ul>")
        parts.extend(f"<li>{html.escape(topic)}</li>" for topic in topics)
        parts.append("</ul>")
    if normalize_content_type(item.get("type")) == "discussion":
        parts.append("<h3>Discussion Prompt</h3><p>Use this space to refine the discussion prompt before Canvas push.</p>")
    elif normalize_content_type(item.get("type")) == "assignment":
        parts.append("<h3>Instructions</h3><p>Use this space to refine assignment requirements, deliverables, and grading expectations before Canvas push.</p>")
    elif normalize_content_type(item.get("type")) == "quiz":
        parts.append("<h3>Quiz Guidance</h3><p>Use this space to refine quiz instructions and add questions in the editor before Canvas push.</p>")
    if source_ids:
        parts.append("<h3>Source References</h3><ul>")
        parts.extend(f"<li><code>{html.escape(source_id)}</code></li>" for source_id in source_ids)
        parts.append("</ul>")
    return "\n".join(parts)


def parse_ai_content_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("AI draft content response must be a JSON object")
    return parsed


def source_analysis_lookup(project: dict[str, Any]) -> dict[str, dict[str, Any]]:
    analysis = project.get("source_analysis") if isinstance(project.get("source_analysis"), dict) else {}
    items = analysis.get("items") if isinstance(analysis.get("items"), list) else []
    return {
        str(item.get("id")): item
        for item in items
        if isinstance(item, dict) and item.get("id")
    }


def source_context_for_item(source_lookup: dict[str, dict[str, Any]], source_ids: list[Any]) -> list[dict[str, Any]]:
    context: list[dict[str, Any]] = []
    for source_id in source_ids[:8]:
        item = source_lookup.get(str(source_id))
        if not item:
            continue
        context.append({
            "id": item.get("id"),
            "source_title": item.get("source_title"),
            "topics": item.get("topics") if isinstance(item.get("topics"), list) else [],
            "summary": compact_text(item.get("summary"), 700),
            "source_locator": item.get("source_locator") if isinstance(item.get("source_locator"), dict) else {},
        })
    return context


def render_templated_item_html(
    *,
    module: dict[str, Any],
    item: dict[str, Any],
    setup: dict[str, Any],
    source_context: list[dict[str, Any]],
    use_ai: bool,
) -> tuple[str, dict[str, Any]]:
    raw_type = compact_text(item.get("type"), 40).lower()
    template_kind = normalize_template_kind(raw_type)
    fallback_content = build_template_content(
        template_kind=template_kind,
        module=module,
        item=item,
        setup=setup,
        source_summaries=source_context,
    )
    generation_metadata: dict[str, Any] = {
        "course_creation_template": template_kind,
        "course_creation_ai_body_status": "not_requested" if not use_ai else "fallback",
    }

    content = fallback_content
    if use_ai:
        try:
            from ai_image_text import generate_course_creation_draft_content, is_ai_configured

            if is_ai_configured():
                payload = {
                    "template_kind": template_kind,
                    "template_schema": template_schema_for_prompt(template_kind),
                    "course_setup": {
                        "course_title": setup.get("course_title"),
                        "course_code": setup.get("course_code"),
                        "course_description": setup.get("course_description"),
                        "audience": setup.get("audience"),
                        "level": setup.get("level"),
                        "term_length": setup.get("term_length"),
                    },
                    "module": {
                        "id": module.get("id"),
                        "title": module.get("title"),
                        "overview": module.get("overview"),
                        "objectives": module.get("objectives") if isinstance(module.get("objectives"), list) else [],
                        "topics": module.get("topics") if isinstance(module.get("topics"), list) else [],
                    },
                    "item": {
                        "type": raw_type or template_kind,
                        "title": item.get("title"),
                        "purpose": item.get("purpose"),
                        "source_chunk_ids": item.get("source_chunk_ids") if isinstance(item.get("source_chunk_ids"), list) else [],
                    },
                    "source_summaries": source_context,
                }
                ai_content = parse_ai_content_json(generate_course_creation_draft_content(item_payload=payload))
                content = merge_ai_template_content(
                    template_kind=template_kind,
                    fallback_content=fallback_content,
                    ai_content=ai_content,
                )
                generation_metadata["course_creation_ai_body_status"] = "succeeded"
            else:
                generation_metadata["course_creation_ai_body_status"] = "not_configured"
        except Exception as exc:
            generation_metadata["course_creation_ai_body_error"] = compact_text(exc, 500)

    return render_template_html(template_kind, content), generation_metadata


def next_module_position(supabase, *, session_id: str, user_id: str) -> int:
    result = supabase.table("course_modules").select("position").eq(
        "session_id", session_id
    ).eq("user_id", user_id).order("position", desc=True).limit(1).execute()
    last_position = (result.data or [{}])[0].get("position") if result.data else 0
    return int(last_position or 0) + 1


def existing_course_creation_modules(
    supabase,
    *,
    session_id: str,
    user_id: str,
    outline_job_id: str | None,
    outline_revision_id: str | None,
) -> dict[str, dict[str, Any]]:
    if not outline_job_id and not outline_revision_id:
        return {}
    result = supabase.table("course_modules").select(
        "id, canvas_module_id, name, position, items_count, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    existing: dict[str, dict[str, Any]] = {}
    for module in result.data or []:
        metadata = module.get("metadata") if isinstance(module.get("metadata"), dict) else {}
        if not metadata.get("created_from_course_creation"):
            continue
        if outline_revision_id:
            if metadata.get("course_creation_outline_revision_id") != outline_revision_id:
                continue
        elif metadata.get("course_creation_outline_job_id") != outline_job_id:
            continue
        outline_module_id = compact_text(metadata.get("course_creation_module_id"), 120)
        if outline_module_id and outline_module_id not in existing:
            existing[outline_module_id] = module
    return existing


def existing_course_creation_items(
    supabase,
    *,
    session_id: str,
    user_id: str,
    outline_job_id: str | None,
    outline_revision_id: str | None,
) -> dict[tuple[str, int], dict[str, Any]]:
    if not outline_job_id and not outline_revision_id:
        return {}
    result = supabase.table("course_content_items").select(
        "id, metadata"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    existing: dict[tuple[str, int], dict[str, Any]] = {}
    for item in result.data or []:
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        if not metadata.get("created_from_course_creation"):
            continue
        if outline_revision_id:
            if metadata.get("course_creation_outline_revision_id") != outline_revision_id:
                continue
        elif metadata.get("course_creation_outline_job_id") != outline_job_id:
            continue
        outline_module_id = compact_text(metadata.get("course_creation_module_id"), 120)
        try:
            item_index = int(metadata.get("course_creation_item_index") or 0)
        except (TypeError, ValueError):
            item_index = 0
        if outline_module_id and item_index > 0:
            existing[(outline_module_id, item_index)] = item
    return existing


def existing_module_item_counts(existing_items: dict[tuple[str, int], dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for outline_module_id, _item_index in existing_items:
        counts[outline_module_id] = counts.get(outline_module_id, 0) + 1
    return counts


def create_local_module(
    supabase,
    *,
    session_id: str,
    user_id: str,
    title: str,
    position: int,
    metadata: dict[str, Any],
    now: str,
) -> dict[str, Any]:
    module_id = str(uuid.uuid4())
    local_canvas_module_id = f"local:{module_id}"
    module_values = {
        "id": module_id,
        "session_id": session_id,
        "user_id": user_id,
        "canvas_module_id": local_canvas_module_id,
        "name": title,
        "position": position,
        "published": False,
        "workflow_state": "unpublished",
        "items_count": 0,
        "metadata": {
            "is_new_local": True,
            "created_in_v2": True,
            "pending_canvas_push": True,
            "created_from_course_creation": True,
            **metadata,
        },
        "created_at": now,
        "updated_at": now,
    }
    result = supabase.table("course_modules").insert(module_values).execute()
    module = result.data[0] if result.data else module_values

    operation_values = {
        "session_id": session_id,
        "user_id": user_id,
        "operation_key": f"module_create:{module_id}",
        "operation_type": "module_create",
        "target_type": "module",
        "module_id": module_id,
        "module_item_id": None,
        "content_item_id": None,
        "canvas_module_id": local_canvas_module_id,
        "canvas_module_item_id": None,
        "title": title,
        "action_label": "Create Module",
        "detail": f"{title}: create module at position {position}",
        "before_state": {},
        "after_state": {"name": title, "position": position, "published": False},
        "status": "staged",
        "created_at": now,
        "updated_at": now,
    }
    supabase.table("module_queue_operations").insert(operation_values).execute()
    return module


def create_local_content_item(
    supabase,
    *,
    session_id: str,
    user_id: str,
    module: dict[str, Any],
    position: int,
    content_type: str,
    title: str,
    html_body: str,
    metadata: dict[str, Any],
    now: str,
) -> str:
    content_item_id = str(uuid.uuid4())
    local_canvas_id = f"local:{content_item_id}"
    plain_text = html_to_text(html_body)
    item_metadata = {
        "is_new_local": True,
        "created_in_v2": True,
        "created_pending_canvas_push": True,
        "created_from_course_creation": True,
        "desired_module_id": module["id"],
        "desired_canvas_module_id": module["canvas_module_id"],
        "desired_module_name": module.get("name"),
        **metadata,
    }
    item_values = {
        "id": content_item_id,
        "session_id": session_id,
        "user_id": user_id,
        "canvas_id": local_canvas_id,
        "content_type": content_type,
        "title": title,
        "canvas_url": None,
        "published": False,
        "module_canvas_id": module["canvas_module_id"],
        "module_name": module.get("name"),
        "position": None,
        "body_hash": sha256_payload({"title": title, "html_body": html_body, "metadata": item_metadata}),
        "body_word_count": word_count(plain_text),
        "last_canvas_edit_at": None,
        "last_synced_at": LOCAL_EPOCH,
        "is_orphaned": False,
        "metadata": item_metadata,
        "created_at": now,
        "updated_at": now,
    }
    supabase.table("course_content_items").insert(item_values).execute()
    supabase.table("course_module_items").insert({
        "session_id": session_id,
        "user_id": user_id,
        "module_id": module["id"],
        "content_item_id": content_item_id,
        "canvas_module_id": str(module["canvas_module_id"]),
        "canvas_module_item_id": f"local:{content_item_id}",
        "canvas_content_id": local_canvas_id,
        "page_url": None,
        "title": title,
        "module_item_type": canvas_module_item_type(content_type),
        "content_type": content_type,
        "position": position,
        "indent": 0,
        "published": False,
        "completion_requirement": {},
        "metadata": {
            "is_new_local": True,
            "pending_canvas_push": True,
            "created_from_course_creation": True,
            **metadata,
        },
        "created_at": now,
        "updated_at": now,
    }).execute()
    supabase.table("course_content_bodies").insert({
        "content_item_id": content_item_id,
        "html_body": html_body,
        "plain_text": plain_text,
        "extracted_at": now,
        "updated_at": now,
    }).execute()
    supabase.table("content_revisions").insert({
        "content_item_id": content_item_id,
        "session_id": session_id,
        "user_id": user_id,
        "revision_number": 1,
        "before_title": None,
        "after_title": title,
        "before_html": "",
        "after_html": html_body,
        "change_summary": "Created from Course Creation outline",
        "created_at": now,
    }).execute()
    return content_item_id


def materialize_outline_to_editable_drafts(
    supabase,
    *,
    session_id: str,
    user_id: str,
    project: dict[str, Any],
    use_ai_body_generation: bool = True,
) -> dict[str, Any]:
    outline = project.get("outline") if isinstance(project.get("outline"), dict) else {}
    modules = outline.get("modules") if isinstance(outline.get("modules"), list) else []
    if not modules:
        raise ValueError("Generate an outline before creating editable drafts")

    setup = project.get("setup") if isinstance(project.get("setup"), dict) else {}
    outline_job_id = outline.get("job_id")
    outline_revision_id = outline.get("review_revision_id")
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    position = next_module_position(supabase, session_id=session_id, user_id=user_id)
    created_modules: list[dict[str, Any]] = []
    created_item_ids: list[str] = []
    skipped_module_ids: list[str] = []
    skipped_item_ids: list[str] = []
    source_lookup = source_analysis_lookup(project)
    ai_body_counts = {"succeeded": 0, "fallback": 0, "not_configured": 0, "not_requested": 0}
    existing_modules = existing_course_creation_modules(
        supabase,
        session_id=session_id,
        user_id=user_id,
        outline_job_id=outline_job_id,
        outline_revision_id=outline_revision_id,
    )
    existing_items = existing_course_creation_items(
        supabase,
        session_id=session_id,
        user_id=user_id,
        outline_job_id=outline_job_id,
        outline_revision_id=outline_revision_id,
    )
    item_counts = existing_module_item_counts(existing_items)

    for module_index, outline_module in enumerate(modules, start=1):
        if not isinstance(outline_module, dict):
            continue
        outline_module_id = compact_text(outline_module.get("id"), 120) or f"module-{module_index}"
        module_title = compact_text(outline_module.get("title"), 180) or f"Module {module_index}"
        module_metadata = {
            "course_creation_run_id": run_id,
            "course_creation_outline_job_id": outline_job_id,
            "course_creation_outline_revision_id": outline_revision_id,
            "course_creation_module_id": outline_module_id,
            "source_chunk_ids": outline_module.get("source_chunk_ids") if isinstance(outline_module.get("source_chunk_ids"), list) else [],
        }
        if outline_module_id in existing_modules:
            local_module = existing_modules[outline_module_id]
            if local_module.get("id"):
                skipped_module_ids.append(str(local_module["id"]))
        else:
            local_module = create_local_module(
                supabase,
                session_id=session_id,
                user_id=user_id,
                title=module_title,
                position=position,
                metadata=module_metadata,
                now=now,
            )
            created_modules.append(local_module)
            position += 1

        outline_items = outline_module.get("items") if isinstance(outline_module.get("items"), list) else []
        if not outline_items:
            outline_items = [{"type": "overview", "title": f"{module_title} Overview", "purpose": outline_module.get("overview"), "source_chunk_ids": outline_module.get("source_chunk_ids") or []}]

        item_position = item_counts.get(outline_module_id, 0) + 1
        for item_index, outline_item in enumerate(outline_items, start=1):
            if not isinstance(outline_item, dict):
                continue
            existing_item = existing_items.get((outline_module_id, item_index))
            if existing_item:
                if existing_item.get("id"):
                    skipped_item_ids.append(str(existing_item["id"]))
                continue
            raw_type = compact_text(outline_item.get("type"), 40).lower()
            if raw_type and raw_type not in SUPPORTED_DRAFT_TYPES:
                continue
            content_type = normalize_content_type(raw_type)
            title = compact_text(outline_item.get("title"), 180) or f"{module_title} Item {item_index}"
            item_metadata = {
                "course_creation_run_id": run_id,
                "course_creation_outline_job_id": outline_job_id,
                "course_creation_outline_revision_id": outline_revision_id,
                "course_creation_module_id": outline_module_id,
                "course_creation_item_index": item_index,
                "course_creation_item_type": raw_type or content_type,
                "source_chunk_ids": outline_item.get("source_chunk_ids") if isinstance(outline_item.get("source_chunk_ids"), list) else [],
            }
            source_context = source_context_for_item(source_lookup, item_metadata["source_chunk_ids"])
            html_body, generation_metadata = render_templated_item_html(
                module=outline_module,
                item=outline_item,
                setup=setup,
                source_context=source_context,
                use_ai=use_ai_body_generation,
            )
            item_metadata.update(generation_metadata)
            ai_status = generation_metadata.get("course_creation_ai_body_status")
            if ai_status in ai_body_counts:
                ai_body_counts[ai_status] += 1
            content_item_id = create_local_content_item(
                supabase,
                session_id=session_id,
                user_id=user_id,
                module=local_module,
                position=item_position,
                content_type=content_type,
                title=title,
                html_body=html_body,
                metadata=item_metadata,
                now=now,
            )
            created_item_ids.append(content_item_id)
            item_position += 1
            item_counts[outline_module_id] = item_counts.get(outline_module_id, 0) + 1

        supabase.table("course_modules").update({
            "items_count": item_counts.get(outline_module_id, item_position - 1),
            "updated_at": now,
        }).eq("id", local_module["id"]).eq("session_id", session_id).eq("user_id", user_id).execute()

    total_module_count = len(created_modules) + len(skipped_module_ids)
    total_item_count = len(created_item_ids) + len(skipped_item_ids)
    result = {
        "status": "succeeded",
        "run_id": run_id,
        "module_count": total_module_count,
        "content_item_count": total_item_count,
        "created_module_count": len(created_modules),
        "created_content_item_count": len(created_item_ids),
        "skipped_existing_module_count": len(skipped_module_ids),
        "skipped_existing_content_item_count": len(skipped_item_ids),
        "ai_body_generation": {
            "enabled": use_ai_body_generation,
            **ai_body_counts,
        },
        "module_ids": [module["id"] for module in created_modules if module.get("id")],
        "content_item_ids": created_item_ids,
        "skipped_existing_module_ids": skipped_module_ids,
        "skipped_existing_content_item_ids": skipped_item_ids,
        "created_at": now,
    }
    write_platform_event(
        supabase,
        user_id=user_id,
        session_id=session_id,
        event_type="course_creation_drafts_materialized",
        properties=result,
    )
    return result
