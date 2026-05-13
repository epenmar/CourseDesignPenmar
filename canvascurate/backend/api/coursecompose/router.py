"""CourseCompose ↔ CanvasCurate handoff bridge.

Receives a versioned spec bundle (`coursecompose/v1.0` envelope) from the
CourseCompose worksheet and stores it in `coursecompose_handoffs` so the
Curate UI can surface it as "Incoming from CourseCompose" and start a
build from there.

POST /api/coursecompose/handoff
    Body: { handoff: {...}, spec: {...} }
    Returns: { ok, handoff_id, received_at, course_code }

    Unauthenticated by design — CourseCompose is the worksheet side, not
    a Curate-logged-in user. Service-role writes (RLS bypassed) so a
    leaked anon key can't write here directly from a browser. Add a
    shared-secret HMAC header before exposing publicly.

GET /api/coursecompose/handoffs
    Query: ?status=pending&limit=50
    Returns: { handoffs: [...], count }

    Authenticated. Lists incoming handoffs for the Curate UI's inbox.

PATCH /api/coursecompose/handoff/{handoff_id}
    Body: { status?, notes? }
    Returns: { ok, handoff }

    Authenticated. Used by Curate UI to flip status as it processes
    a handoff (pending → processing → built / error / archived).
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth import get_current_user
from services.coursecompose_ingest import ingest_bundle
from supabase_client import get_supabase


router = APIRouter(prefix="/api/coursecompose", tags=["coursecompose"])


# ---------- Request / response models ----------

class HandoffPayload(BaseModel):
    """The envelope CourseCompose emits.

    handoff: metadata about the bundling run (version, who, when)
    spec:    the actual CourseCompose spec (format / course / modules / ...)
    """
    handoff: Dict[str, Any]
    spec: Dict[str, Any]


class HandoffPatch(BaseModel):
    status: Optional[str] = None  # pending | processing | built | error | archived
    notes: Optional[str] = None


_ALLOWED_STATUS = {"pending", "processing", "built", "error", "archived"}


# ---------- Helpers ----------

def _validate_envelope(payload: HandoffPayload) -> None:
    """Reject malformed bundles early with a clear 4xx instead of a vague
    500 from the DB constraint check. Keeps the public surface helpful
    when the CourseCompose side iterates the spec shape."""
    spec = payload.spec or {}
    fmt = spec.get("format") or ""
    if not isinstance(fmt, str) or not fmt.startswith("coursecompose/"):
        raise HTTPException(
            status_code=400,
            detail=f"Unrecognized spec format {fmt!r}; expected 'coursecompose/v…'",
        )
    course = spec.get("course") or {}
    if not course.get("code"):
        raise HTTPException(
            status_code=400,
            detail="Spec is missing course.code — Curate can't route the build without it.",
        )
    if not isinstance(spec.get("modules"), list):
        raise HTTPException(
            status_code=400,
            detail="Spec is missing modules array.",
        )


# ---------- Routes ----------

@router.post("/handoff", status_code=201)
async def receive_handoff(payload: HandoffPayload, request: Request) -> Dict[str, Any]:
    """Accept a CourseCompose handoff and (atomically-ish) supersede any
    earlier pending row for the same course.

    Why supersede: CourseCompose users iterate. They push partial work,
    refine, push again. Without this step, the second push lands as a
    second `pending` row alongside the first — Curate's inbox shows two
    items for the same course and a builder who picks the older one
    ships a stale spec. Supersede guarantees at most ONE pending row
    per (course_code) at any given time, so the inbox can't surface a
    superseded snapshot.

    Earlier rows get status='superseded' (not deleted) so the audit
    trail of every push is preserved — useful for debugging or for
    showing "Elisa pushed 3 times before this build" in a future UI.
    """
    _validate_envelope(payload)

    source = request.headers.get("x-coursecompose-source") or "unknown"
    course_code = (payload.spec.get("course") or {}).get("code")

    supabase = get_supabase()

    # Step 1: supersede any prior PENDING rows for this course. We don't
    # touch rows in processing / built / error / archived / superseded
    # states — those are user-actioned outcomes that shouldn't be
    # rewritten by a fresh push. Only the un-actioned 'pending' tier
    # gets bumped aside.
    superseded_count = 0
    if course_code:
        prior = (
            supabase.table("coursecompose_handoffs")
            .update({"status": "superseded"})
            .eq("course_code", course_code)
            .eq("status", "pending")
            .execute()
        )
        superseded_count = len(prior.data or [])

    # Step 2: insert the new handoff. If insert fails after supersede,
    # we end up with zero pending rows for the course — recoverable
    # by pushing again, no data loss (the prior bundles remain
    # in 'superseded' state and are still in the table).
    row = {
        "bundle": payload.model_dump(mode="json"),
        "status": "pending",
        "source": source,
    }
    result = supabase.table("coursecompose_handoffs").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Insert returned no rows.")

    inserted = result.data[0]
    return {
        "ok": True,
        "handoff_id": inserted["id"],
        "received_at": inserted["received_at"],
        "course_code": course_code,
        "superseded_count": superseded_count,
    }


@router.get("/handoffs")
async def list_handoffs(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if status and status not in _ALLOWED_STATUS:
        raise HTTPException(status_code=400, detail=f"Unknown status {status!r}")
    supabase = get_supabase()
    q = (
        supabase.table("coursecompose_handoffs")
        .select(
            "id, received_at, status, course_code, course_title, "
            "generated_by, generated_role, source, processed_at, notes"
        )
        .order("received_at", desc=True)
        .limit(limit)
    )
    if status:
        q = q.eq("status", status)
    result = q.execute()
    rows = result.data or []
    return {"handoffs": rows, "count": len(rows)}


@router.get("/handoff/{handoff_id}")
async def get_handoff(
    handoff_id: str,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Full payload (including the raw bundle) — used by Curate's UI when
    actually starting a build. List endpoint above stays bundle-free so
    the inbox view doesn't hammer the wire."""
    supabase = get_supabase()
    result = (
        supabase.table("coursecompose_handoffs")
        .select("*")
        .eq("id", handoff_id)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return {"handoff": rows[0]}


@router.patch("/handoff/{handoff_id}")
async def update_handoff(
    handoff_id: str,
    patch: HandoffPatch,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Drive a handoff through its lifecycle.

    Special case: when the caller sets status='processing' we run the
    full ingest synchronously here — translating the bundle into a new
    Curate session + module/page tree — and only then write status,
    session_id, and the processed_at stamp. Doing it in one round-trip
    means the inbox's "Start build" button can immediately redirect
    the user to /sessions/{session_id}/edit on success.

    Ingest is idempotent at this layer: a handoff already carrying a
    session_id is treated as 'built' and we refuse to run again rather
    than creating a duplicate session.
    """
    from datetime import datetime, timezone

    supabase = get_supabase()

    if patch.status is not None and patch.status not in _ALLOWED_STATUS:
        raise HTTPException(status_code=400, detail=f"Unknown status {patch.status!r}")

    # Special-cased branch: trigger the ingest pipeline.
    if patch.status == "processing":
        existing = (
            supabase.table("coursecompose_handoffs")
            .select("*")
            .eq("id", handoff_id)
            .execute()
        )
        existing_rows = existing.data or []
        if not existing_rows:
            raise HTTPException(status_code=404, detail="Handoff not found")
        handoff_row = existing_rows[0]

        if handoff_row.get("session_id"):
            # Already built. Surface the session_id so the UI can
            # navigate the user there instead of erroring out.
            return {"ok": True, "handoff": handoff_row, "session_id": handoff_row["session_id"]}

        if handoff_row.get("status") in {"built", "archived"}:
            raise HTTPException(
                status_code=409,
                detail=f"Handoff is already {handoff_row['status']}.",
            )

        # Mark processing first so concurrent clicks don't race the
        # ingest. We undo this on failure below.
        now_iso = datetime.now(timezone.utc).isoformat()
        supabase.table("coursecompose_handoffs").update({
            "status": "processing",
            "processed_at": now_iso,
            "processed_by": user.get("sub"),
            "notes": patch.notes if patch.notes is not None else handoff_row.get("notes"),
        }).eq("id", handoff_id).execute()

        try:
            session_id = ingest_bundle(supabase, handoff_row, user_id=user.get("sub"))
        except Exception as exc:  # pragma: no cover — surfaced to UI
            supabase.table("coursecompose_handoffs").update({
                "status": "error",
                "notes": f"Ingest failed: {exc}",
            }).eq("id", handoff_id).execute()
            raise HTTPException(status_code=500, detail=f"Ingest failed: {exc}") from exc

        final = supabase.table("coursecompose_handoffs").update({
            "status": "built",
            "session_id": session_id,
        }).eq("id", handoff_id).execute()
        rows = final.data or []
        built_row = rows[0] if rows else {**handoff_row, "status": "built", "session_id": session_id}
        return {"ok": True, "handoff": built_row, "session_id": session_id}

    # Plain status / notes update — no ingest.
    updates: Dict[str, Any] = {}
    if patch.status is not None:
        updates["status"] = patch.status
        if patch.status in {"built", "error", "archived"}:
            # Stamp processed_at + processed_by the moment a handoff
            # leaves the working states. Lets the UI show "built 3h ago
            # by …" without an extra audit table.
            updates["processed_at"] = datetime.now(timezone.utc).isoformat()
            updates["processed_by"] = user.get("sub")
    if patch.notes is not None:
        updates["notes"] = patch.notes
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    result = (
        supabase.table("coursecompose_handoffs")
        .update(updates)
        .eq("id", handoff_id)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return {"ok": True, "handoff": rows[0]}
