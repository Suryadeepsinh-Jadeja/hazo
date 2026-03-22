import os
from datetime import datetime
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from dotenv import load_dotenv
import httpx

from db.database import get_users_col
from db.models import UserDB

_API_ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv(_API_ENV_PATH)

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ALGORITHM = "HS256"

security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

async def verify_token(token: str) -> dict:
    if SUPABASE_JWT_SECRET:
        try:
            # Supabase uses 'authenticated' as the audience for valid access tokens
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=[ALGORITHM],
                audience="authenticated"
            )
            return payload
        except JWTError:
            # Fall through to Supabase /auth/v1/user verification.
            pass

    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{SUPABASE_URL}/auth/v1/user",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "apikey": SUPABASE_SERVICE_KEY,
                    },
                )
            if response.status_code == 200:
                user = response.json()
                return {
                    "sub": user.get("id"),
                    "email": user.get("email"),
                    "user_metadata": user.get("user_metadata", {}),
                }
        except Exception:
            pass

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> UserDB:
    payload = await verify_token(credentials.credentials)
    supabase_id = payload.get("sub")
    email = payload.get("email")
    if supabase_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    users_col = get_users_col()

    # Fast path: read-only lookup (no write I/O on every request)
    user_doc = await users_col.find_one({"supabase_id": supabase_id})

    if user_doc is None:
        # First-time user — upsert
        now = datetime.utcnow()
        user_doc = await users_col.find_one_and_update(
            {"supabase_id": supabase_id},
            {
                "$set": {"last_active_date": now},
                "$setOnInsert": {
                    "supabase_id": supabase_id,
                    "email": email,
                    "name": payload.get("user_metadata", {}).get("name", "User"),
                    "created_at": now,
                },
            },
            upsert=True,
            return_document=True,
        )
    else:
        # Only update last_active_date if stale (> 1 hour)
        last_active = user_doc.get("last_active_date")
        now = datetime.utcnow()
        if not last_active or (now - last_active).total_seconds() > 3600:
            await users_col.update_one(
                {"_id": user_doc["_id"]},
                {"$set": {"last_active_date": now}},
            )

    return UserDB(**user_doc)

async def optional_auth(credentials: HTTPAuthorizationCredentials = Depends(optional_security)) -> UserDB | None:
    if not credentials:
        return None
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None
