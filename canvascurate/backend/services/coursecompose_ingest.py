"""Translate a CourseCompose handoff bundle into Curate's course model.

A CourseCompose bundle is the JSONB payload stored on a
`coursecompose_handoffs` row. The bundle has the shape:

    {
      "handoff": { version, bundledAt, bundledBy, bundledByRole, ... },
      "spec":    { format, course, modules: [ ... ] }
    }

Ingesting that bundle means seeding 5 Curate tables so the user lands
on `/sessions/{id}/edit` with the course's module + page tree fully
populated:

    sessions               (1 row — the workspace container)
    course_modules         (N rows — one per spec.modules[])
    course_content_items   (M rows — one per activity AND material)
    course_content_bodies  (M rows — 1:1 with items that have richText)
    course_module_items    (M rows — linking content into modules)

No `courses` row is created — that table requires a real
`canvas_course_id` and we don't have one yet (the whole point of
CourseCompose is that the Canvas course doesn't exist). When the user
later pushes this session to Canvas, a separate job replaces all the
`local:*` canvas IDs we seed here with real IDs and creates the
`courses` row.

Idempotency lives one level up in the PATCH endpoint — it refuses to
re-ingest a handoff whose `session_id` is already set. This module
assumes the caller has already done that check.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from canvas_sync import html_to_text, sha256_payload, word_count
from services.course_creation.draft_builder import canvas_module_item_type


# Curate's `content_type` enum. Anything not in this set falls back to
# 'page' — most CourseCompose materials are reading-style content that
# Canvas just renders as a Page anyway.
_CURATE_CONTENT_TYPES = {"page", "assignment", "discussion", "quiz"}

# Frozen-in-time epoch we stamp on `last_synced_at` for locally-created
# items so they sort below any genuinely Canvas-synced row. Mirrors the
# draft_builder constant — keep them aligned.
_LOCAL_EPOCH = "1970-01-01T00:00:00+00:00"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_content_type(raw: Any) -> str:
    """Map a CourseCompose activity.contentType to a Curate enum value.

    CourseCompose's Canvas Plan picker emits Canvas-style lowercase
    types ('page' / 'assignment' / 'quiz' / 'discussion'). Older
    bundles may have legacy values like 'Reading' from the materials
    side or capitalized strings — coerce them to 'page' instead of
    bouncing off the enum check constraint.
    """
    if not isinstance(raw, str):
        return "page"
    norm = raw.strip().lower()
    if norm in _CURATE_CONTENT_TYPES:
        return norm
    return "page"


def _module_metadata(module: Dict[str, Any]) -> Dict[str, Any]:
    """Stash CourseCompose-only fields (MLOs, topic, etc.) on the
    `course_modules.metadata` JSONB column. Curate's editor currently
    ignores these but they're load-bearing for downstream features
    like alignment traceability — losing them at ingest would force
    the faculty to re-tag everything inside Curate."""
    return {
        "created_from_coursecompose": True,
        "coursecompose_module_number": module.get("number"),
        "mlos": module.get("mlos") or [],
    }


def _activity_metadata(activity: Dict[str, Any], module: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "created_from_coursecompose": True,
        "coursecompose_kind": "activity",
        "coursecompose_activity_id": activity.get("id"),
        "coursecompose_module_number": module.get("number"),
        "objectives": activity.get("objectives") or [],
        "points": activity.get("points") or None,
        "due": activity.get("due") or None,
        "linked_material_ids": activity.get("linkedMaterialIds") or [],
    }


def _material_metadata(material: Dict[str, Any], module: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "created_from_coursecompose": True,
        "coursecompose_kind": "material",
        "coursecompose_material_id": material.get("id"),
        "coursecompose_module_number": module.get("number"),
        "coursecompose_material_type": material.get("type"),
        "objectives": material.get("objectives") or [],
        "linked_activity_ids": material.get("linkedActivityIds") or [],
        "notes": material.get("notes") or "",
    }


def _insert_content_item(
    supabase,
    *,
    session_id: str,
    user_id: str,
    module: Dict[str, Any],
    canvas_id_prefix: str,
    title: str,
    content_type: str,
    html_body: str,
    item_metadata: Dict[str, Any],
    position: int,
    module_db_id: str,
) -> str:
    """Insert a content item + body + module item linkage. Returns the
    content_item_id so the caller can reference it elsewhere if needed."""
    content_item_id = str(uuid.uuid4())
    local_canvas_id = f"{canvas_id_prefix}:{content_item_id}"
    plain_text = html_to_text(html_body)
    now = _now_iso()

    supabase.table("course_content_items").insert({
        "id": content_item_id,
        "session_id": session_id,
        "user_id": user_id,
        "canvas_id": local_canvas_id,
        "content_type": content_type,
        "title": title,
        "canvas_url": None,
        "published": False,
        "module_canvas_id": module["canvas_module_id"],
        "module_name": module["name"],
        "position": position,
        "body_hash": sha256_payload({
            "title": title,
            "html_body": html_body,
            "metadata": item_metadata,
        }),
        "body_word_count": word_count(plain_text),
        "last_canvas_edit_at": None,
        "last_synced_at": _LOCAL_EPOCH,
        "is_orphaned": False,
        "metadata": item_metadata,
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

    supabase.table("course_module_items").insert({
        "session_id": session_id,
        "user_id": user_id,
        "module_id": module_db_id,
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
            "created_from_coursecompose": True,
        },
        "created_at": now,
        "updated_at": now,
    }).execute()

    return content_item_id


def ingest_bundle(supabase, handoff_row: Dict[str, Any], user_id: str) -> str:
    """Materialize a CourseCompose bundle as a fresh Curate session.

    Returns the new `sessions.id`. Raises any exception from the
    underlying inserts after attempting to clean up the half-built
    session — the FK cascades from sessions → modules → items → bodies
    take care of most of the cleanup automatically.
    """
    bundle = handoff_row.get("bundle") or {}
    spec = bundle.get("spec") or {}
    course = spec.get("course") or {}
    modules: List[Dict[str, Any]] = spec.get("modules") or []

    course_code = course.get("code") or "UNKNOWN"
    full_title = course.get("fullTitle") or course.get("name") or course_code
    session_name = f"{course_code} — {full_title}"

    now = _now_iso()
    session_id = str(uuid.uuid4())

    # ---- 1. sessions row ----
    # type='create' is the closest existing analog to "course built from
    # scratch, no upstream Canvas course." But the session layout only
    # renders the full editor chrome (SideNav with Health/Inventory/Edit/
    # Images/Links/...) when meta.course_creation.status is
    # 'exported_to_canvas_clean'. Without that flag the SideNav narrows
    # to a single 'Create' link, which leaves a CourseCompose-built
    # session looking like a stripped-down draft instead of a full
    # editable course. We set the flag here so the ingest lands the
    # user inside the same workspace they'd see for a
    # synced-from-Canvas course.
    supabase.table("sessions").insert({
        "id": session_id,
        "user_id": user_id,
        "type": "create",
        "status": "active",
        "name": session_name,
        "created_at": now,
        "updated_at": now,
        "meta": {
            "created_from_coursecompose": True,
            "coursecompose_handoff_id": handoff_row.get("id"),
            "course_code": course_code,
            "course_full_title": full_title,
            "course_creation": {
                "status": "exported_to_canvas_clean",
            },
        },
    }).execute()

    try:
        for mod_index, module in enumerate(modules):
            module_db_id = str(uuid.uuid4())
            local_module_canvas_id = f"local:{module_db_id}"
            module_name = module.get("topic") or f"Module {module.get('number') or mod_index + 1}"

            # ---- 2. course_modules row ----
            supabase.table("course_modules").insert({
                "id": module_db_id,
                "session_id": session_id,
                "user_id": user_id,
                "canvas_module_id": local_module_canvas_id,
                "name": module_name,
                "position": module.get("number") if isinstance(module.get("number"), int) else mod_index + 1,
                "published": False,
                "workflow_state": None,
                "items_count": None,
                "metadata": _module_metadata(module),
                "created_at": now,
                "updated_at": now,
            }).execute()

            # The downstream helpers need the canvas_module_id + name
            # but not the spec dict — package them up so the loop below
            # doesn't have to keep reaching back into `module`.
            module_ctx = {
                "canvas_module_id": local_module_canvas_id,
                "name": module_name,
            }

            position = 1
            # NOTE: Module Overview page creation (from module.overviewPageHtml)
            # is handled by the LIVE Curate ingest in canvascurateV2 (it
            # reconciled the field into its existing _build_overview_html path).
            # This snapshot intentionally does NOT insert it — adding a second
            # insert here would duplicate the Overview page if ever synced over.
            # ---- 3a. activities → course_content_items ----
            for activity in module.get("activities") or []:
                title = (activity.get("name") or "Untitled activity").strip() or "Untitled activity"
                _insert_content_item(
                    supabase,
                    session_id=session_id,
                    user_id=user_id,
                    module=module_ctx,
                    canvas_id_prefix="activity",
                    title=title,
                    content_type=_normalize_content_type(activity.get("type")),
                    html_body=activity.get("richText") or "",
                    item_metadata=_activity_metadata(activity, module),
                    position=position,
                    module_db_id=module_db_id,
                )
                position += 1

            # ---- 3b. materials → course_content_items ----
            # CourseCompose distinguishes activities (gradable / Canvas-
            # native types) from materials (readings / resources). Canvas
            # has no native "material" type, so all materials become Pages.
            for material in module.get("materials") or []:
                title = (material.get("title") or "Untitled material").strip() or "Untitled material"
                _insert_content_item(
                    supabase,
                    session_id=session_id,
                    user_id=user_id,
                    module=module_ctx,
                    canvas_id_prefix="material",
                    title=title,
                    content_type="page",
                    html_body=material.get("richText") or "",
                    item_metadata=_material_metadata(material, module),
                    position=position,
                    module_db_id=module_db_id,
                )
                position += 1

    except Exception:
        # FK cascades from sessions → modules → items → bodies clean up
        # most of the partial insert. Deleting the session is enough.
        try:
            supabase.table("sessions").delete().eq("id", session_id).execute()
        except Exception:
            # Best-effort cleanup. The real exception below tells the
            # caller what actually failed.
            pass
        raise

    return session_id
