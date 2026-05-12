"""Admin authorization helpers.

System admins are managed in Supabase by setting ``user_profiles.role`` to
``system_admin`` or ``super_admin``. New users default to ``id`` through the
database trigger in ``docs/migration.sql``.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException


ADMIN_ROLES = {"system_admin", "super_admin"}


def get_user_profile(supabase, user: dict[str, Any]) -> dict[str, Any]:
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    result = supabase.table("user_profiles").select(
        "id, email, full_name, avatar_url, role, is_active, created_at, updated_at"
    ).eq("id", user_id).limit(1).execute()
    if result.data:
        return result.data[0]

    # Existing auth users created before the trigger was installed may not have
    # a profile. Insert with the table default role ('id') so role checks remain
    # explicit and auditable in Supabase.
    insert_result = supabase.table("user_profiles").insert({
        "id": user_id,
        "email": user.get("email") or f"{user_id}@unknown.local",
        "auth_provider": "unknown",
    }).execute()
    if not insert_result.data:
        raise HTTPException(status_code=500, detail="Unable to initialize user profile")
    return insert_result.data[0]


def require_system_admin(supabase, user: dict[str, Any]) -> dict[str, Any]:
    profile = get_user_profile(supabase, user)
    if not profile.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is inactive")
    if str(profile.get("role") or "") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="System administrator access required")
    return profile
