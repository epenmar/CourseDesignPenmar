from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from canvas_hosts import canvas_base_url_aliases, parse_canvas_course_url
from canvas_sync import get_active_pat
from encryption import encrypt
from supabase_client import get_supabase

router = APIRouter(prefix="/canvas/sessions", tags=["sessions"])

SESSION_TYPES = {"curate", "create", "transfer", "document"}


class CreateSessionRequest(BaseModel):
    canvas_url: str = ""
    session_type: str
    session_name: str = ""


@router.post("")
async def create_session(
    body: CreateSessionRequest,
    x_canvas_pat: str = Header(default=""),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    if body.session_type not in SESSION_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid session_type: {body.session_type}")

    supabase = get_supabase()
    now = datetime.now(timezone.utc)
    pat_token = x_canvas_pat.strip()
    source_course_id = None

    if body.session_type in {"create", "document"} and not body.canvas_url.strip():
        is_create_session = body.session_type == "create"
        name = body.session_name.strip() or (
            "New Course Build" if is_create_session else "Standalone document remediation"
        )
        meta = {
            "standalone": True,
            "canvas_connection_required": False,
        }
        if is_create_session:
            meta["course_creation"] = {
                "status": "draft",
                "setup": {
                    "course_title": body.session_name.strip(),
                    "course_code": "",
                    "course_description": "",
                    "audience": "",
                    "level": "",
                    "term_length": "",
                    "module_count": None,
                    "module_cadence": "",
                    "source_notes": "",
                },
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
        session_result = supabase.table("sessions").insert({
            "user_id": user_id,
            "type": body.session_type,
            "status": "active",
            "name": name,
            "source_course_id": None,
            "meta": meta,
        }).execute()

        if not session_result.data:
            raise HTTPException(status_code=500, detail="Failed to create session record")

        return {"session_id": session_result.data[0]["id"], "course_id": None}

    canvas_base_url, canvas_course_id = parse_canvas_course_url(body.canvas_url)

    if not pat_token:
        try:
            pat_token = get_active_pat(supabase, user_id, canvas_base_url)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Canvas personal access token required. {exc}",
            )

    if x_canvas_pat.strip():
        # Store credential via header (never in request body) only when a new PAT is supplied.
        encrypted = encrypt(pat_token)
        expires_at = (now + timedelta(days=7)).isoformat()

        supabase.table("user_canvas_credentials").update(
            {"status": "revoked", "updated_at": now.isoformat()}
        ).eq("user_id", user_id).in_("canvas_base_url", canvas_base_url_aliases(canvas_base_url)).eq(
            "status", "active"
        ).execute()

        supabase.table("user_canvas_credentials").insert({
            "user_id": user_id,
            "canvas_base_url": canvas_base_url,
            "credential_type": "pat",
            "status": "active",
            "pat_token_enc": encrypted,
            "expires_at": expires_at,
            "last_validated_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }).execute()

    # Find or create course record scoped to this user
    course_result = supabase.table("courses").select("id").eq(
        "user_id", user_id
    ).eq("canvas_base_url", canvas_base_url).eq(
        "canvas_course_id", canvas_course_id
    ).execute()

    if course_result.data:
        source_course_id = course_result.data[0]["id"]
    else:
        insert_result = supabase.table("courses").insert({
            "user_id": user_id,
            "canvas_base_url": canvas_base_url,
            "canvas_course_id": canvas_course_id,
        }).execute()
        if not insert_result.data:
            raise HTTPException(status_code=500, detail="Failed to create course record")
        source_course_id = insert_result.data[0]["id"]

    # Create session record owned by this user
    name = body.session_name.strip() or f"{body.session_type} — {canvas_course_id}"
    session_result = supabase.table("sessions").insert({
        "user_id": user_id,
        "type": body.session_type,
        "status": "active",
        "name": name,
        "source_course_id": source_course_id,
    }).execute()

    if not session_result.data:
        raise HTTPException(status_code=500, detail="Failed to create session record")

    session_id = session_result.data[0]["id"]

    return {"session_id": session_id, "course_id": source_course_id}
