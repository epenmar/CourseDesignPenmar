import os
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import create_client

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    token = credentials.credentials

    url = os.getenv("SUPABASE_URL", "")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not service_key:
        raise HTTPException(status_code=500, detail="Supabase env vars not configured")

    try:
        client = create_client(url, service_key)
        response = client.auth.get_user(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {e}")

    if not response.user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return {"sub": response.user.id, "email": response.user.email}
