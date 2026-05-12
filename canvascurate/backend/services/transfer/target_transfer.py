"""Target-course Transfer push job orchestration."""

from __future__ import annotations

from typing import Any

import httpx

from canvas_sync import CanvasClient
from services.document_records import write_platform_event
from services.transfer.canvas_target import resolve_transfer_target_access
from services.transfer.content_remap import (
    expand_with_linked_supported_content as _expand_with_linked_supported_content,
    remap_content_links as _remap_content_links,
    remapped_quiz_question_row as _remapped_quiz_question_row,
)
from services.transfer.file_migration import (
    canvas_file_reference_ids as _canvas_file_reference_ids,
    migrate_referenced_files as _migrate_referenced_files,
)
from services.transfer.quiz_transfer import (
    create_canvas_quiz,
    create_quiz_question,
    is_classic_quiz,
    quiz_question_payload,
    update_canvas_quiz,
    update_quiz_question,
)
from services.transfer.shared import (
    SUPPORTED_TRANSFER_CONTENT_TYPES,
    _add_content_to_module,
    _add_event,
    _add_report_item,
    _compact_text,
    _content_type_label,
    _create_canvas_assignment,
    _create_canvas_discussion,
    _create_canvas_module,
    _create_canvas_page,
    _erase_target_course_contents,
    _html_values_for_content,
    _load_transfer_plan,
    _metadata,
    _quiz_question_rows,
    _report_count,
    _set_progress,
    _source_course_canvas_id,
    _update_canvas_assignment,
    _update_canvas_discussion,
    _update_canvas_page,
    _update_job,
    utc_now_iso,
)
from supabase_client import get_supabase


def run_transfer_target_job(job_id: str, session_id: str, user_id: str) -> None:
    """Create modules, pages, assignments, discussions, and placements in a target course.

    Quizzes and same-course updates are tracked as skipped/unsupported so
    later slices can extend this job without changing the API shape.
    """
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
        mode = str(payload.get("mode") or "target_course")
        canvas_url = str(payload.get("canvas_url") or "")
        erase_first = bool(payload.get("erase_first"))

        target_course, pat_token = resolve_transfer_target_access(
            supabase,
            user_id=user_id,
            canvas_url=canvas_url,
        )
        target_course_id = str(target_course["canvas_course_id"])
        client = CanvasClient(target_course["canvas_base_url"], pat_token)

        _add_event(supabase, job_id, state, f"Validated target course: {target_course['name']}", "done")
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

        plan = _load_transfer_plan(supabase, session_id=session_id, user_id=user_id)
        modules = plan["modules"]
        items_by_module = plan["items_by_module"]
        content_by_id = plan["content_by_id"]
        supported_content_by_id = plan["supported_content_by_id"]
        bodies_by_id = plan["bodies_by_id"]
        source_course_id = _source_course_canvas_id(plan)

        supported_items = [
            item
            for module in modules
            for item in items_by_module.get(module["id"], [])
            if item.get("content_item_id")
            and (content_by_id.get(item["content_item_id"]) or {}).get("content_type") in SUPPORTED_TRANSFER_CONTENT_TYPES
        ]
        initial_supported_ids = list(dict.fromkeys(item["content_item_id"] for item in supported_items if item.get("content_item_id")))
        html_values_by_content_id = {
            content_item_id: _html_values_for_content(plan, content_item_id)
            for content_item_id in set(initial_supported_ids)
        }
        unique_supported_ids, linked_supported_ids = _expand_with_linked_supported_content(
            initial_ids=initial_supported_ids,
            supported_content_by_id=supported_content_by_id,
            bodies_by_id=bodies_by_id,
            source_course_id=source_course_id,
            html_values_by_content_id=html_values_by_content_id,
        )
        unsupported_items = [
            item
            for module in modules
            for item in items_by_module.get(module["id"], [])
            if item.get("content_item_id")
            and (content_by_id.get(item["content_item_id"]) or {}).get("content_type") not in SUPPORTED_TRANSFER_CONTENT_TYPES
        ]

        total_steps = len(modules) + len(unique_supported_ids) + len(supported_items) + len(unique_supported_ids)
        completed_steps = 0
        module_id_map: dict[str, str] = {}
        canvas_ref_map_by_item_id: dict[str, str] = {}
        content_type_by_item_id: dict[str, str] = {}
        old_to_new_page_url_map: dict[str, str] = {}
        assignment_id_map: dict[str, str] = {}
        discussion_id_map: dict[str, str] = {}
        quiz_id_map: dict[str, str] = {}
        quiz_question_id_map: dict[str, str] = {}
        placement_count = 0
        remap_count = 0
        error_count = erase_error_count
        file_warning_count = 0
        file_id_map: dict[str, str] = {}
        created_counts = {"page": 0, "assignment": 0, "discussion": 0, "quiz": 0, "quiz_question": 0}

        _add_event(
            supabase,
            job_id,
            state,
            f"Starting {mode.replace('_', ' ')}: {len(modules)} modules, {len(unique_supported_ids)} supported items, {len(supported_items)} placements",
        )
        if linked_supported_ids:
            _add_event(
                supabase,
                job_id,
                state,
                f"Found {len(linked_supported_ids)} linked supported item(s) outside modules; they will be created for link preservation.",
            )

        for module in modules:
            try:
                created = _create_canvas_module(client, course_id=target_course_id, module=module)
                module_id_map[module["id"]] = str(created.get("id"))
                _add_report_item(
                    state,
                    "created",
                    title=module.get("name"),
                    content_type="module",
                    action="create",
                    status="done",
                )
                _add_event(supabase, job_id, state, f"Created module: {module.get('name')}", "done")
            except Exception as exc:
                error_count += 1
                _add_report_item(
                    state,
                    "errors",
                    title=module.get("name") or "Untitled module",
                    content_type="module",
                    action="create",
                    status="error",
                    reason=exc,
                )
                _add_event(supabase, job_id, state, f"Failed to create module '{module.get('name')}': {exc}", "error")
            completed_steps += 1
            _set_progress(supabase, job_id, state, completed_steps, total_steps)

        for content_item_id in unique_supported_ids:
            content = content_by_id.get(content_item_id) or {}
            body = bodies_by_id.get(content_item_id) or {}
            content_type = str(content.get("content_type") or "")
            title = _compact_text(content.get("title"), 255) or f"Untitled {_content_type_label(content_type).title()}"
            html_body = str(body.get("html_body") or "")
            try:
                new_ref = ""
                if content_type == "page":
                    created = _create_canvas_page(
                        client,
                        course_id=target_course_id,
                        title=title,
                        html_body=html_body,
                        published=bool(content.get("published")),
                    )
                    new_ref = str(created.get("url") or "")
                    old_canvas_id = str(content.get("canvas_id") or "")
                    if old_canvas_id and new_ref:
                        old_to_new_page_url_map[old_canvas_id] = new_ref
                elif content_type == "assignment":
                    created = _create_canvas_assignment(
                        client,
                        course_id=target_course_id,
                        title=title,
                        html_body=html_body,
                        published=bool(content.get("published")),
                    )
                    new_ref = str(created.get("id") or "")
                    old_canvas_id = str(content.get("canvas_id") or "")
                    if old_canvas_id and new_ref:
                        assignment_id_map[old_canvas_id] = new_ref
                elif content_type == "discussion":
                    created = _create_canvas_discussion(
                        client,
                        course_id=target_course_id,
                        title=title,
                        html_body=html_body,
                        published=bool(content.get("published")),
                    )
                    new_ref = str(created.get("id") or "")
                    old_canvas_id = str(content.get("canvas_id") or "")
                    if old_canvas_id and new_ref:
                        discussion_id_map[old_canvas_id] = new_ref
                elif content_type == "quiz":
                    if not is_classic_quiz(content):
                        raise ValueError("New Quizzes are not supported by this transfer slice")
                    created = create_canvas_quiz(
                        client,
                        course_id=target_course_id,
                        title=title,
                        html_body=html_body,
                        published=False,
                        metadata=_metadata(content),
                    )
                    new_ref = str(created.get("id") or "")
                    old_canvas_id = str(content.get("canvas_id") or "")
                    if old_canvas_id and new_ref:
                        quiz_id_map[old_canvas_id] = new_ref
                    question_count = 0
                    for question in _quiz_question_rows(plan, content.get("canvas_id")):
                        if _metadata(question).get("pending_delete"):
                            continue
                        question_html_body = str((bodies_by_id.get(question["id"]) or {}).get("html_body") or _metadata(question).get("question_text") or "")
                        question_payload = quiz_question_payload(question, question_html_body)
                        question_response = create_quiz_question(
                            client,
                            course_id=target_course_id,
                            quiz_id=new_ref,
                            payload=question_payload,
                        )
                        response_question_id = question_response.get("id") or question_response.get("question", {}).get("id")
                        if response_question_id:
                            quiz_question_id_map[question["id"]] = str(response_question_id)
                        question_count += 1
                    if question_count:
                        created_counts["quiz_question"] += question_count
                        _add_report_item(
                            state,
                            "created",
                            title=f"{title} questions",
                            content_type="quiz_question",
                            action="create",
                            status="done",
                            reason=f"Created {question_count} quiz question(s).",
                        )
                else:
                    raise ValueError(f"Unsupported content type: {content_type}")
                if new_ref:
                    canvas_ref_map_by_item_id[content_item_id] = new_ref
                    content_type_by_item_id[content_item_id] = content_type
                    created_counts[content_type] = created_counts.get(content_type, 0) + 1
                _add_report_item(
                    state,
                    "created",
                    title=title,
                    content_type=content_type,
                    action="create",
                    status="done",
                    canvas_url=content.get("canvas_url"),
                )
                _add_event(supabase, job_id, state, f"Created {_content_type_label(content_type)}: {title}", "done")
            except Exception as exc:
                error_count += 1
                _add_report_item(
                    state,
                    "errors",
                    title=title,
                    content_type=content_type,
                    action="create",
                    status="error",
                    reason=exc,
                    canvas_url=content.get("canvas_url"),
                )
                _add_event(supabase, job_id, state, f"Failed to create {_content_type_label(content_type)} '{title}': {exc}", "error")
            completed_steps += 1
            _set_progress(supabase, job_id, state, completed_steps, total_steps)

        for module in modules:
            canvas_module_id = module_id_map.get(module["id"])
            if not canvas_module_id:
                continue
            for item in items_by_module.get(module["id"], []):
                content_item_id = item.get("content_item_id")
                if not content_item_id:
                    continue
                content = content_by_id.get(content_item_id) or {}
                content_type = str(content.get("content_type") or "")
                if content_type not in SUPPORTED_TRANSFER_CONTENT_TYPES:
                    continue
                canvas_ref = canvas_ref_map_by_item_id.get(content_item_id)
                if not canvas_ref:
                    continue
                title = _compact_text(item.get("title") or content.get("title"), 255) or f"Untitled {_content_type_label(content_type).title()}"
                try:
                    _add_content_to_module(
                        client,
                        course_id=target_course_id,
                        canvas_module_id=canvas_module_id,
                        content_type=content_type,
                        title=title,
                        canvas_content_ref=canvas_ref,
                        position=item.get("position"),
                        indent=item.get("indent"),
                    )
                    placement_count += 1
                    _add_report_item(
                        state,
                        "placed",
                        title=title,
                        content_type=content_type,
                        action="place",
                        status="done",
                        reason=f"Placed in module {module.get('name') or canvas_module_id}",
                        canvas_url=content.get("canvas_url"),
                    )
                    _add_event(supabase, job_id, state, f"Placed {_content_type_label(content_type)} in module: {title}", "done")
                except Exception as exc:
                    error_count += 1
                    _add_report_item(
                        state,
                        "errors",
                        title=title,
                        content_type=content_type,
                        action="place",
                        status="error",
                        reason=exc,
                        canvas_url=content.get("canvas_url"),
                    )
                    _add_event(supabase, job_id, state, f"Failed to place {_content_type_label(content_type)} '{title}': {exc}", "error")
                completed_steps += 1
                _set_progress(supabase, job_id, state, completed_steps, total_steps)

        referenced_file_ids = _canvas_file_reference_ids([
            html_value
            for content_item_id in unique_supported_ids
            for html_value in _html_values_for_content(plan, content_item_id)
        ])
        source_course = plan.get("source_course") if isinstance(plan.get("source_course"), dict) else None
        source_canvas_base_url = str(
            (source_course or {}).get("canvas_base_url")
            or target_course["canvas_base_url"]
        )
        if referenced_file_ids and source_course_id:
            source_client = CanvasClient(source_canvas_base_url, pat_token)
            try:
                file_id_map, file_warning_count = _migrate_referenced_files(
                    source_client=source_client,
                    source_canvas_base_url=source_canvas_base_url,
                    target_canvas_base_url=target_course["canvas_base_url"],
                    pat_token=pat_token,
                    target_course_id=target_course_id,
                    file_ids=referenced_file_ids,
                    add_event=lambda message, status="info": _add_event(supabase, job_id, state, message, status),
                    add_report_item=lambda category, **kwargs: _add_report_item(state, category, **kwargs),
                )
            finally:
                source_client.close()
        elif referenced_file_ids:
            file_warning_count = len(referenced_file_ids)
            _add_report_item(
                state,
                "warnings",
                title="Referenced Canvas files",
                content_type="file",
                action="migrate",
                status="warning",
                reason=f"Skipped {len(referenced_file_ids)} referenced Canvas file(s) because this session has no source Canvas course.",
            )
            _add_event(
                supabase,
                job_id,
                state,
                f"Skipped {len(referenced_file_ids)} referenced Canvas file(s) because this session has no source Canvas course.",
                "warning",
            )

        if canvas_ref_map_by_item_id:
            _add_event(supabase, job_id, state, "Remapping internal links in created content...")
        for content_item_id, canvas_ref in canvas_ref_map_by_item_id.items():
            content_type = content_type_by_item_id.get(content_item_id) or ""
            body = bodies_by_id.get(content_item_id) or {}
            original_html = str(body.get("html_body") or "")
            remapped_html = _remap_content_links(
                original_html,
                source_course_id=source_course_id,
                target_course_id=target_course_id,
                page_url_map=old_to_new_page_url_map,
                assignment_id_map=assignment_id_map,
                discussion_id_map=discussion_id_map,
                quiz_id_map=quiz_id_map,
                file_id_map=file_id_map,
            )
            if remapped_html != original_html:
                try:
                    if content_type == "page":
                        _update_canvas_page(client, course_id=target_course_id, page_url=canvas_ref, html_body=remapped_html)
                    elif content_type == "assignment":
                        _update_canvas_assignment(client, course_id=target_course_id, assignment_id=canvas_ref, html_body=remapped_html)
                    elif content_type == "discussion":
                        _update_canvas_discussion(client, course_id=target_course_id, discussion_id=canvas_ref, html_body=remapped_html)
                    elif content_type == "quiz":
                        update_canvas_quiz(client, course_id=target_course_id, quiz_id=canvas_ref, html_body=remapped_html)
                    remap_count += 1
                except Exception as exc:
                    error_count += 1
                    _add_report_item(
                        state,
                        "warnings",
                        title=canvas_ref,
                        content_type=content_type,
                        action="remap_links",
                        status="warning",
                        reason=exc,
                    )
                    _add_event(supabase, job_id, state, f"Link remap warning for {content_type} '{canvas_ref}': {exc}", "warning")
            if content_type == "quiz":
                content = content_by_id.get(content_item_id) or {}
                for question in _quiz_question_rows(plan, content.get("canvas_id")):
                    target_question_id = quiz_question_id_map.get(question["id"])
                    if not target_question_id:
                        continue
                    question_html = str((bodies_by_id.get(question["id"]) or {}).get("html_body") or _metadata(question).get("question_text") or "")
                    remapped_question_html = _remap_content_links(
                        question_html,
                        source_course_id=source_course_id,
                        target_course_id=target_course_id,
                        page_url_map=old_to_new_page_url_map,
                        assignment_id_map=assignment_id_map,
                        discussion_id_map=discussion_id_map,
                        quiz_id_map=quiz_id_map,
                        file_id_map=file_id_map,
                    )
                    remapped_question = _remapped_quiz_question_row(
                        question,
                        source_course_id=source_course_id,
                        target_course_id=target_course_id,
                        page_url_map=old_to_new_page_url_map,
                        assignment_id_map=assignment_id_map,
                        discussion_id_map=discussion_id_map,
                        quiz_id_map=quiz_id_map,
                        file_id_map=file_id_map,
                    )
                    if remapped_question_html == question_html and _metadata(remapped_question).get("answers") == _metadata(question).get("answers"):
                        continue
                    try:
                        update_quiz_question(
                            client,
                            course_id=target_course_id,
                            quiz_id=canvas_ref,
                            question_id=target_question_id,
                            payload=quiz_question_payload(remapped_question, remapped_question_html),
                        )
                        remap_count += 1
                    except Exception as exc:
                        error_count += 1
                        _add_report_item(
                            state,
                            "warnings",
                            title=question.get("title") or "Quiz question",
                            content_type="quiz_question",
                            action="remap_links",
                            status="warning",
                            reason=exc,
                        )
                if content.get("published"):
                    try:
                        update_canvas_quiz(
                            client,
                            course_id=target_course_id,
                            quiz_id=canvas_ref,
                            published=True,
                        )
                    except Exception as exc:
                        _add_report_item(
                            state,
                            "warnings",
                            title=content.get("title") or canvas_ref,
                            content_type="quiz",
                            action="publish",
                            status="warning",
                            reason=exc,
                        )
            completed_steps += 1
            _set_progress(supabase, job_id, state, completed_steps, total_steps)

        skipped_by_type: dict[str, int] = {}
        for item in unsupported_items:
            content = content_by_id.get(item.get("content_item_id")) or {}
            content_type = str(content.get("content_type") or "unknown")
            skipped_by_type[content_type] = skipped_by_type.get(content_type, 0) + 1
            _add_report_item(
                state,
                "skipped",
                title=item.get("title") or content.get("title") or content_type,
                content_type=content_type,
                action="create",
                status="skipped",
                reason="This content type is not supported by the current target-course transfer slice.",
                canvas_url=content.get("canvas_url"),
            )
        if skipped_by_type:
            _add_event(
                supabase,
                job_id,
                state,
                "Skipped unsupported item types in this first slice: "
                + ", ".join(f"{count} {content_type}" for content_type, count in sorted(skipped_by_type.items())),
                "warning",
            )

        state["status"] = "succeeded" if error_count == 0 and file_warning_count == 0 else "succeeded_with_warnings"
        state["progress"] = 1
        state["target_course"] = target_course
        state["summary"] = {
            "mode": mode,
            "modules_created": len(module_id_map),
            "pages_created": created_counts.get("page", 0),
            "assignments_created": created_counts.get("assignment", 0),
            "discussions_created": created_counts.get("discussion", 0),
            "quizzes_created": created_counts.get("quiz", 0),
            "quiz_questions_created": created_counts.get("quiz_question", 0),
            "placements_created": placement_count,
            "page_placements_created": placement_count,
            "items_remapped": remap_count,
            "pages_remapped": remap_count,
            "linked_items_created": len(linked_supported_ids),
            "files_migrated": len(file_id_map),
            "target_items_erased": sum(erase_counts.values()),
            "target_modules_erased": erase_counts.get("module", 0),
            "target_pages_erased": erase_counts.get("page", 0),
            "target_assignments_erased": erase_counts.get("assignment", 0),
            "target_discussions_erased": erase_counts.get("discussion", 0),
            "target_quizzes_erased": erase_counts.get("quiz", 0),
            "target_files_erased": erase_counts.get("file", 0),
            "file_warnings": file_warning_count,
            "unsupported_skipped": skipped_by_type,
            "items_skipped": _report_count(state, "skipped"),
            "warnings": _report_count(state, "warnings"),
            "errors": error_count,
        }
        _add_event(
            supabase,
            job_id,
            state,
            f"Transfer complete: {len(module_id_map)} modules, "
            f"{created_counts.get('page', 0)} pages, "
            f"{created_counts.get('assignment', 0)} assignments, "
            f"{created_counts.get('discussion', 0)} discussions, "
            f"{created_counts.get('quiz', 0)} quizzes, "
            f"{placement_count} placements, "
            f"{len(file_id_map)} files migrated",
            "done" if error_count == 0 and file_warning_count == 0 else "warning",
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
            event_type="transfer_target_push_completed",
            properties={
                "job_id": job_id,
                "mode": mode,
                "target_course": target_course,
                "summary": state["summary"],
            },
        )
    except Exception as exc:
        state["status"] = "failed"
        state["error"] = str(exc)
        _add_event(supabase, job_id, state, f"Transfer failed: {exc}", "error")
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
