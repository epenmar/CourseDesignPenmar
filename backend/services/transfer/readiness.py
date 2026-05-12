"""Read-only Transfer readiness aggregation.

Builds the first Phase 6 transfer read model from existing Canvas Clean tables
without starting Canvas write operations.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from fastapi import HTTPException

from services.canvas_file_references import (
    canvas_file_reference_ids_from_html,
    referenced_canvas_file_ids_for_kept_content,
    referenced_canvas_file_labels_by_id,
)
from services.content_bodies import fetch_content_body_rows


TRANSFER_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz", "quiz_question", "file"}
HTML_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz"}
WRITE_SUPPORTED_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz"}
SAME_COURSE_DELETE_TYPES = {"page", "assignment", "discussion", "quiz", "file"}
SAME_COURSE_MODULE_ITEM_OPERATION_TYPES = {
    "item_publish",
    "item_indent",
    "item_rename",
    "item_move",
    "item_remove",
    "item_position",
}
SAME_COURSE_MODULE_OPERATION_TYPES = {"module_rename", "module_position", "module_delete"}


def _metadata(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("metadata")
    return value if isinstance(value, dict) else {}


def _normalized_title(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _discussion_assignment_id(discussion: dict[str, Any]) -> str:
    metadata = _metadata(discussion)
    assignment_id = metadata.get("assignment_id")
    return str(assignment_id) if assignment_id else ""


def _assignment_discussion_id(assignment: dict[str, Any]) -> str:
    metadata = _metadata(assignment)
    discussion_topic_id = metadata.get("discussion_topic_id")
    if discussion_topic_id:
        return str(discussion_topic_id)
    discussion_topic = metadata.get("discussion_topic")
    if isinstance(discussion_topic, dict) and discussion_topic.get("id"):
        return str(discussion_topic["id"])
    return ""


def _quiz_assignment_id(quiz: dict[str, Any]) -> str:
    metadata = _metadata(quiz)
    assignment_id = metadata.get("assignment_id")
    return str(assignment_id) if assignment_id else ""


def _assignment_quiz_id(assignment: dict[str, Any]) -> str:
    metadata = _metadata(assignment)
    quiz_id = metadata.get("quiz_id")
    return str(quiz_id) if quiz_id else ""


def _assignment_is_canvas_activity_shell(assignment: dict[str, Any]) -> bool:
    metadata = _metadata(assignment)
    return bool(
        metadata.get("discussion_topic_id")
        or metadata.get("discussion_topic")
        or metadata.get("quiz_id")
        or metadata.get("is_quiz_assignment")
        or metadata.get("source_content_type") in {"discussion", "quiz", "assignment"}
    )


def _has_kept_activity_counterpart(
    assignment: dict[str, Any],
    *,
    items: list[dict[str, Any]],
    delete_decisions: dict[str, dict[str, Any]],
) -> bool:
    assignment_id = str(assignment.get("canvas_id") or "")
    discussion_id = _assignment_discussion_id(assignment)
    quiz_id = _assignment_quiz_id(assignment)
    assignment_title = _normalized_title(assignment.get("title"))
    assignment_is_activity_shell = _assignment_is_canvas_activity_shell(assignment)
    for item in items:
        content_type = item.get("content_type")
        if content_type not in {"discussion", "quiz"}:
            continue
        if delete_decisions.get(item.get("id")):
            continue
        if content_type == "discussion":
            if assignment_id and _discussion_assignment_id(item) == assignment_id:
                return True
            if discussion_id and str(item.get("canvas_id") or "") == discussion_id:
                return True
            if (
                assignment_is_activity_shell
                and assignment_title
                and _normalized_title(item.get("title")) == assignment_title
            ):
                return True
        if content_type == "quiz":
            if assignment_id and _quiz_assignment_id(item) == assignment_id:
                return True
            if quiz_id and str(item.get("canvas_id") or "") == quiz_id:
                return True
            if (
                assignment_is_activity_shell
                and assignment_title
                and _normalized_title(item.get("title")) == assignment_title
            ):
                return True
    return False


def _course_creation_meta(session: dict[str, Any]) -> dict[str, Any]:
    meta = session.get("meta") if isinstance(session.get("meta"), dict) else {}
    project = meta.get("course_creation") if isinstance(meta.get("course_creation"), dict) else {}
    return project


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _after_last_sync(created_at: str | None, last_synced_at: str | None) -> bool:
    revision_time = _parse_datetime(created_at)
    synced_time = _parse_datetime(last_synced_at)
    if not synced_time:
        return True
    if not revision_time:
        return False
    return revision_time > synced_time


def _blank_counts() -> dict[str, int]:
    return {
        "page": 0,
        "assignment": 0,
        "discussion": 0,
        "quiz": 0,
        "file": 0,
    }


def _content_badges(item: dict[str, Any], revision_count: int) -> list[str]:
    metadata = _metadata(item)
    badges = []
    if metadata.get("created_from_course_creation"):
        badges.append("generated draft")
    if metadata.get("is_new_local") or str(item.get("canvas_id") or "").startswith("local:"):
        badges.append("new local item")
    if revision_count:
        badges.append("content edited")
    if item.get("is_orphaned"):
        badges.append("orphaned")
    return badges or ["ready"]


def _transfer_issue(
    *,
    title: str,
    content_type: str,
    reason: str,
    severity: str = "warning",
    item_id: str | None = None,
    impact: str | None = None,
) -> dict[str, Any]:
    return {
        "id": item_id or f"{content_type}:{title}:{reason}",
        "title": title,
        "content_type": content_type,
        "reason": reason,
        "severity": severity,
        "impact": impact,
    }


def _canvas_file_reference_ids(html_values: list[str]) -> list[str]:
    return canvas_file_reference_ids_from_html(html_values)


def _mode_card(
    *,
    mode: str,
    title: str,
    description: str,
    enabled: bool,
    disabled_reason: str | None = None,
    recommended: bool = False,
) -> dict[str, Any]:
    return {
        "mode": mode,
        "title": title,
        "description": description,
        "enabled": enabled,
        "disabled_reason": disabled_reason,
        "recommended": recommended,
    }


def build_transfer_readiness(supabase, *, session_id: str, user_id: str) -> dict[str, Any]:
    session_result = supabase.table("sessions").select(
        "id, name, type, source_course_id, meta, updated_at"
    ).eq("id", session_id).eq("user_id", user_id).limit(1).execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = session_result.data[0]
    project = _course_creation_meta(session)
    is_exported_course_creation = (
        session.get("type") == "create"
        and project.get("status") == "exported_to_canvas_clean"
    )

    course = None
    if session.get("source_course_id"):
        course_result = supabase.table("courses").select(
            "id, course_name, canvas_course_id, canvas_base_url"
        ).eq("id", session["source_course_id"]).eq("user_id", user_id).limit(1).execute()
        course = course_result.data[0] if course_result.data else None

    items_result = supabase.table("course_content_items").select(
        "id, canvas_id, title, content_type, canvas_url, module_name, is_orphaned, last_synced_at, metadata, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    items = [
        item for item in items_result.data or []
        if item.get("content_type") in TRANSFER_CONTENT_TYPES
    ]

    modules_result = supabase.table("course_modules").select(
        "id, name, canvas_module_id, position, metadata, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    modules = modules_result.data or []

    module_items_result = supabase.table("course_module_items").select(
        "id, module_id, content_item_id, title, content_type, position"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    module_items = module_items_result.data or []
    module_content_item_ids = {
        row.get("content_item_id")
        for row in module_items
        if row.get("content_item_id")
    }

    operations_result = supabase.table("module_queue_operations").select(
        "id, operation_type, target_type, title, action_label, detail, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq("status", "staged").execute()
    staged_operations = operations_result.data or []

    revisions_result = supabase.table("content_revisions").select(
        "id, content_item_id, revision_number, change_summary, created_at"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    revisions_by_item: dict[str, list[dict[str, Any]]] = {}
    for revision in revisions_result.data or []:
        content_item_id = revision.get("content_item_id")
        if content_item_id:
            revisions_by_item.setdefault(content_item_id, []).append(revision)

    decisions_result = supabase.table("content_inventory_decisions").select(
        "content_item_id, action, reason, applied_to_canvas, updated_at"
    ).eq("session_id", session_id).eq("user_id", user_id).eq("action", "delete").eq(
        "applied_to_canvas", False
    ).execute()
    delete_decisions = {
        row.get("content_item_id"): row
        for row in decisions_result.data or []
        if row.get("content_item_id")
    }
    protected_file_ids = referenced_canvas_file_ids_for_kept_content(
        supabase,
        session_id=session_id,
        user_id=user_id,
    )
    protected_file_labels = referenced_canvas_file_labels_by_id(
        supabase,
        session_id=session_id,
        user_id=user_id,
    )
    kept_image_result = supabase.table("course_images").select(
        "canvas_file_id, review_action"
    ).eq("session_id", session_id).eq("user_id", user_id).execute()
    protected_file_ids.update({
        str(row.get("canvas_file_id"))
        for row in kept_image_result.data or []
        if row.get("canvas_file_id") and row.get("review_action") != "delete"
    })

    counts = _blank_counts()
    pending_items = []
    deletion_items = []
    transfer_issues = []
    generated_count = 0
    modified_count = 0
    new_local_count = 0
    transferable_content_count = 0
    same_course_push_count = 0
    same_course_module_create_count = sum(
        1
        for module in modules
        if str(module.get("canvas_module_id") or "").startswith("local:")
        or bool(_metadata(module).get("is_new_local"))
    )
    same_course_module_item_operation_count = sum(
        1
        for operation in staged_operations
        if operation.get("operation_type") in SAME_COURSE_MODULE_ITEM_OPERATION_TYPES
    )
    same_course_module_operation_count = sum(
        1
        for operation in staged_operations
        if operation.get("operation_type") in SAME_COURSE_MODULE_OPERATION_TYPES
    )
    same_course_create_count = 0
    same_course_delete_count = 0
    transferable_content_ids: list[str] = []
    item_by_id = {item["id"]: item for item in items if item.get("id")}
    quiz_item_by_canvas_id = {
        str(item.get("canvas_id")): item
        for item in items
        if item.get("content_type") == "quiz" and item.get("canvas_id")
    }
    quiz_question_pending_by_parent_id: dict[str, int] = {}
    for item in items:
        if item.get("content_type") != "quiz_question":
            continue
        metadata = _metadata(item)
        item_revisions = [
            revision for revision in revisions_by_item.get(item.get("id"), [])
            if _after_last_sync(revision.get("created_at"), item.get("last_synced_at"))
        ]
        if not item_revisions and not metadata.get("pending_delete") and not metadata.get("is_new_local"):
            continue
        parent = quiz_item_by_canvas_id.get(str(metadata.get("parent_quiz_canvas_id") or ""))
        if parent and parent.get("id"):
            quiz_question_pending_by_parent_id[parent["id"]] = quiz_question_pending_by_parent_id.get(parent["id"], 0) + 1

    for item in items:
        content_type = item.get("content_type")
        if content_type == "quiz_question":
            continue
        if content_type in counts:
            counts[content_type] += 1
        metadata = _metadata(item)
        item_revisions = [
            revision for revision in revisions_by_item.get(item.get("id"), [])
            if _after_last_sync(revision.get("created_at"), item.get("last_synced_at"))
        ]
        revision_count = len(item_revisions)
        is_new_local = metadata.get("is_new_local") or str(item.get("canvas_id") or "").startswith("local:")
        is_generated = bool(metadata.get("created_from_course_creation"))
        is_transferable = (
            item.get("content_type") in HTML_CONTENT_TYPES
            and (
                item.get("id") in module_content_item_ids
                or is_exported_course_creation
                or bool(metadata.get("desired_module_id"))
            )
        )
        if is_transferable:
            transferable_content_count += 1
            if item.get("id"):
                transferable_content_ids.append(item["id"])
            if item.get("content_type") not in WRITE_SUPPORTED_CONTENT_TYPES:
                transfer_issues.append(_transfer_issue(
                    item_id=item.get("id"),
                    title=item.get("title") or "Untitled",
                    content_type=str(item.get("content_type") or "unknown"),
                    reason="This content type is not enabled for target transfer yet.",
                    impact="It will be listed as skipped and will need manual handling until that Transfer slice lands.",
                ))
        elif item.get("content_type") in WRITE_SUPPORTED_CONTENT_TYPES:
            transfer_issues.append(_transfer_issue(
                item_id=item.get("id"),
                title=item.get("title") or "Untitled",
                content_type=str(item.get("content_type") or "unknown"),
                reason="This supported content item is not assigned to a transferable module.",
                severity="info",
                impact="It will not be created in the target course unless it is added to a module or marked for placement.",
            ))
        if is_generated:
            generated_count += 1
        if is_new_local:
            new_local_count += 1
            if item.get("content_type") in WRITE_SUPPORTED_CONTENT_TYPES:
                same_course_create_count += 1
        question_revision_count = quiz_question_pending_by_parent_id.get(item.get("id"), 0)
        if revision_count or question_revision_count:
            modified_count += 1
            if (
                item.get("content_type") in WRITE_SUPPORTED_CONTENT_TYPES
                and item.get("canvas_id")
                and not str(item.get("canvas_id")).startswith("local:")
            ):
                same_course_push_count += 1

        if item.get("content_type") in HTML_CONTENT_TYPES and (revision_count or question_revision_count or is_new_local or is_generated):
            pending_items.append({
                "id": item.get("id"),
                "title": item.get("title") or "Untitled",
                "content_type": item.get("content_type"),
                "module_name": item.get("module_name"),
                "canvas_url": item.get("canvas_url"),
                "updated_at": item.get("updated_at"),
                "revision_count": revision_count + question_revision_count,
                "latest_change_summary": item_revisions[-1].get("change_summary") if item_revisions else None,
                "badges": _content_badges(item, revision_count),
            })

        decision = delete_decisions.get(item.get("id"))
        if item.get("is_orphaned") or decision:
            protected_activity_assignment = bool(
                decision
                and item.get("content_type") == "assignment"
                and _has_kept_activity_counterpart(item, items=items, delete_decisions=delete_decisions)
            )
            protected_referenced_file = bool(
                decision
                and item.get("content_type") == "file"
                and str(item.get("canvas_id") or "") in protected_file_ids
            )
            protected_reference_labels = protected_file_labels.get(str(item.get("canvas_id") or "")) if protected_referenced_file else []
            if (
                decision
                and item.get("content_type") in SAME_COURSE_DELETE_TYPES
                and item.get("canvas_id")
                and not str(item.get("canvas_id")).startswith("local:")
                and not protected_activity_assignment
                and not protected_referenced_file
            ):
                same_course_delete_count += 1
            deletion_items.append({
                "id": item.get("id"),
                "title": item.get("title") or "Untitled",
                "content_type": item.get("content_type"),
                "reason": (
                    "Appears to be the assignment shell for a kept graded discussion or quiz"
                    if protected_activity_assignment
                    else "Canvas file is still referenced by kept course content"
                    + (f": {', '.join(protected_reference_labels[:3])}" if protected_reference_labels else "")
                    if protected_referenced_file
                    else decision.get("reason") if decision else "Orphaned content"
                ),
                "action": "review" if protected_activity_assignment or protected_referenced_file else "delete" if decision else "review",
            })

    for content_item_id, decision in delete_decisions.items():
        if content_item_id in item_by_id:
            continue
        deletion_items.append({
            "id": content_item_id,
            "title": "Unknown item",
            "content_type": "unknown",
            "reason": decision.get("reason"),
            "action": "delete",
        })

    module_operation_items = [
        {
            "id": operation.get("id"),
            "title": operation.get("title") or operation.get("action_label") or operation.get("operation_type"),
            "operation_type": operation.get("operation_type"),
            "detail": operation.get("detail"),
            "created_at": operation.get("created_at"),
        }
        for operation in staged_operations
    ]

    referenced_file_count = 0
    if transferable_content_ids:
        referenced_file_count = len(_canvas_file_reference_ids([
            str(row.get("html_body") or "")
            for row in fetch_content_body_rows(supabase, transferable_content_ids)
        ]))

    recommended_mode = "target_course" if is_exported_course_creation or not session.get("source_course_id") else "same_course"
    same_course_enabled = bool(session.get("source_course_id"))
    copy_course_enabled = bool(session.get("source_course_id"))
    modes = [
        _mode_card(
            mode="same_course",
            title="Push to Same Course",
            description="Apply curated local edits back to the source Canvas course.",
            enabled=same_course_enabled,
            disabled_reason=None if same_course_enabled else "No source Canvas course is connected to this session.",
            recommended=recommended_mode == "same_course",
        ),
        _mode_card(
            mode="target_course",
            title="Push to Target Course",
            description="Push reviewed modules and content into a selected live or development Canvas shell.",
            enabled=True,
            recommended=recommended_mode == "target_course",
        ),
        _mode_card(
            mode="copy_course",
            title="Copy to Target Course",
            description="Use Canvas course copy to clone the connected source course into another Canvas shell.",
            enabled=copy_course_enabled,
            disabled_reason=None if copy_course_enabled else "No source Canvas course is connected to this session.",
        ),
    ]

    return {
        "session": {
            "id": session.get("id"),
            "name": session.get("name"),
            "type": session.get("type"),
            "source_course_id": session.get("source_course_id"),
            "is_course_creation_export": is_exported_course_creation,
            "updated_at": session.get("updated_at"),
        },
        "source_course": {
            "id": course.get("id"),
            "name": course.get("course_name"),
            "canvas_course_id": course.get("canvas_course_id"),
            "canvas_base_url": course.get("canvas_base_url"),
        } if course else None,
        "recommended_mode": recommended_mode,
        "modes": modes,
        "summary": {
            "content_counts": counts,
            "module_count": len(modules),
            "module_item_count": len(module_items),
            "staged_module_operation_count": len(staged_operations),
            "transferable_content_count": transferable_content_count,
            "referenced_file_count": referenced_file_count,
            "transfer_payload_count": transferable_content_count + referenced_file_count,
            "same_course_push_count": same_course_push_count,
            "same_course_module_create_count": same_course_module_create_count,
            "same_course_module_operation_count": same_course_module_operation_count,
            "same_course_module_item_operation_count": same_course_module_item_operation_count,
            "same_course_create_count": same_course_create_count,
            "same_course_delete_count": same_course_delete_count,
            "same_course_action_count": same_course_module_create_count + same_course_module_operation_count + same_course_module_item_operation_count + same_course_push_count + same_course_create_count + same_course_delete_count,
            "pending_content_count": len(pending_items),
            "generated_content_count": generated_count,
            "modified_content_count": modified_count,
            "new_local_content_count": new_local_count,
            "deletion_candidate_count": len(deletion_items),
            "transfer_issue_count": len(transfer_issues),
            "ready_item_count": len(pending_items) + len(staged_operations),
        },
        "pending_items": pending_items[:50],
        "module_operations": module_operation_items[:50],
        "deletion_items": deletion_items[:50],
        "transfer_issues": transfer_issues[:100],
    }
