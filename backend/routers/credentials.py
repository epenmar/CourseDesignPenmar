from datetime import datetime, timedelta, timezone
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel

from auth import get_current_user
from canvas_hosts import canvas_base_url_aliases, normalize_canvas_base_url
from encryption import decrypt, encrypt
from supabase_client import get_supabase

router = APIRouter(prefix="/canvas/credentials", tags=["credentials"])


class StorePatRequest(BaseModel):
    canvas_base_url: str


def validate_pat(canvas_base_url: str, pat: str):
    try:
        response = httpx.get(
            f"{canvas_base_url}/api/v1/users/self/profile",
            headers={"Authorization": f"Bearer {pat}", "Accept": "application/json"},
            timeout=15.0,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=403, detail="Canvas rejected the token")
        raise HTTPException(status_code=502, detail=f"Canvas returned HTTP {exc.response.status_code}")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Canvas token validation failed: {exc}")


def validate_pat_for_canvas_aliases(pat: str, aliases: list[str]) -> str:
    rejected_error: HTTPException | None = None
    validation_error: HTTPException | None = None
    for canvas_base_url in aliases:
        try:
            validate_pat(canvas_base_url, pat)
            return canvas_base_url
        except HTTPException as exc:
            if exc.status_code == 403:
                rejected_error = exc
                continue
            validation_error = exc
            continue
    if validation_error:
        raise validation_error
    if rejected_error:
        raise rejected_error
    raise HTTPException(status_code=403, detail="Canvas rejected the token")


def inactive_status(
    cred: dict,
    *,
    days_remaining: int,
    expired: bool,
    validation_status: str,
    validation_message: str,
):
    return {
        "has_credential": True,
        "active": False,
        "expires_at": cred["expires_at"],
        "days_remaining": days_remaining,
        "expired": expired,
        "warning": True,
        "last_validated_at": cred.get("last_validated_at"),
        "validation_status": validation_status,
        "validation_message": validation_message,
    }


def sorted_alias_credentials(credentials: list[dict], aliases: list[str]) -> list[dict]:
    alias_rank = {base_url: index for index, base_url in enumerate(aliases)}
    return sorted(
        credentials,
        key=lambda cred: (
            alias_rank.get(str(cred.get("canvas_base_url") or ""), len(aliases)),
            str(cred.get("expires_at") or ""),
        ),
    )


@router.post("")
async def store_pat(
    body: StorePatRequest,
    x_canvas_pat: str = Header(default=""),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if not x_canvas_pat:
        raise HTTPException(status_code=400, detail="X-Canvas-Pat header required")

    canvas_base_url = normalize_canvas_base_url(body.canvas_base_url)
    canvas_aliases = canvas_base_url_aliases(canvas_base_url)
    validate_pat_for_canvas_aliases(x_canvas_pat, canvas_aliases)
    encrypted = encrypt(x_canvas_pat)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(days=7)).isoformat()

    supabase = get_supabase()

    # Revoke any existing active credential for this user+url
    supabase.table("user_canvas_credentials").update(
        {"status": "revoked", "updated_at": now.isoformat()}
    ).eq("user_id", user_id).in_("canvas_base_url", canvas_aliases).eq(
        "status", "active"
    ).execute()

    # Insert new credential
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

    return {"status": "ok", "expires_at": expires_at}


@router.get("/status")
async def get_credential_status(
    canvas_base_url: str,
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    normalized_canvas_base_url = normalize_canvas_base_url(canvas_base_url)
    canvas_aliases = canvas_base_url_aliases(normalized_canvas_base_url)
    supabase = get_supabase()

    result = supabase.table("user_canvas_credentials").select(
        "id, canvas_base_url, status, expires_at, last_validated_at, pat_token_enc"
    ).eq("user_id", user_id).eq(
        "status", "active"
    ).in_(
        "canvas_base_url", canvas_aliases
    ).execute()

    if not result.data:
        return {"has_credential": False, "active": False, "validation_status": "missing"}

    now = datetime.now(timezone.utc)
    expired_credentials: list[tuple[dict, int]] = []
    rejected_credentials: list[tuple[dict, int, bool]] = []
    unverified_status: dict | None = None

    for cred in sorted_alias_credentials(result.data or [], canvas_aliases):
        expires_at = datetime.fromisoformat(cred["expires_at"].replace("Z", "+00:00"))
        seconds_remaining = (expires_at - now).total_seconds()
        days_remaining = int(seconds_remaining // 86400)
        if seconds_remaining <= 0:
            supabase.table("user_canvas_credentials").update({
                "status": "expired",
                "updated_at": now.isoformat(),
            }).eq("id", cred["id"]).execute()
            expired_credentials.append((cred, days_remaining))
            continue

        try:
            validation_base_url = validate_pat_for_canvas_aliases(
                decrypt(cred["pat_token_enc"]),
                [normalized_canvas_base_url, *[base_url for base_url in canvas_aliases if base_url != normalized_canvas_base_url]],
            )
        except HTTPException as exc:
            if exc.status_code == 403:
                rejected_credentials.append((cred, days_remaining, seconds_remaining <= 0))
                continue
            unverified_status = inactive_status(
                cred,
                days_remaining=days_remaining,
                expired=False,
                validation_status="unverified",
                validation_message=str(exc.detail),
            )
            continue

        validated_at = now.isoformat()
        supabase.table("user_canvas_credentials").update({
            "last_validated_at": validated_at,
            "updated_at": validated_at,
        }).eq("id", cred["id"]).execute()

        return {
            "has_credential": True,
            "active": True,
            "expires_at": cred["expires_at"],
            "days_remaining": days_remaining,
            "expired": seconds_remaining <= 0,
            "warning": seconds_remaining <= 2 * 86400,
            "last_validated_at": validated_at,
            "validation_status": "validated",
            "canvas_base_url": normalized_canvas_base_url,
            "credential_base_url": cred.get("canvas_base_url"),
            "validation_base_url": validation_base_url,
        }

    if unverified_status:
        return unverified_status

    if rejected_credentials:
        cred, days_remaining, expired = rejected_credentials[0]
        return inactive_status(
            cred,
            days_remaining=days_remaining,
            expired=expired,
            validation_status="rejected",
            validation_message="Canvas rejected the stored token.",
        )

    if expired_credentials:
        cred, days_remaining = expired_credentials[0]
        return inactive_status(
            cred,
            days_remaining=days_remaining,
            expired=True,
            validation_status="expired",
            validation_message="The stored Canvas token has passed its Curator expiry window.",
        )

    return {"has_credential": False, "active": False, "validation_status": "missing"}


@router.get("/expiring")
async def get_expiring_credentials(
    days: int = Query(default=2, ge=0, le=7),
    user: dict = Depends(get_current_user),
):
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=days)
    supabase = get_supabase()

    result = supabase.table("user_canvas_credentials").select(
        "id, canvas_base_url, status, expires_at, last_validated_at"
    ).eq("user_id", user_id).eq("status", "active").lte(
        "expires_at", cutoff.isoformat()
    ).order("expires_at").execute()

    credentials = []
    for cred in result.data or []:
        expires_at = datetime.fromisoformat(cred["expires_at"].replace("Z", "+00:00"))
        credentials.append({
            "id": cred["id"],
            "canvas_base_url": cred["canvas_base_url"],
            "status": cred["status"],
            "expires_at": cred["expires_at"],
            "last_validated_at": cred.get("last_validated_at"),
            "days_remaining": (expires_at - now).days,
            "expired": expires_at <= now,
        })

    return {"credentials": credentials}
