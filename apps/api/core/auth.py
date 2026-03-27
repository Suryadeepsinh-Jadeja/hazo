import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Any
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from dotenv import load_dotenv
import httpx

from db.database import get_users_col
from db.models import UserDB

_API_ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv(_API_ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else ""
JWKS_CACHE_TTL_SECONDS = 600
SUPPORTED_SIGNING_ALGORITHMS = {"RS256", "ES256"}

logger = logging.getLogger("hazo.core.auth")

security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

_jwks_cache: dict[str, Any] | None = None
_jwks_cache_expires_at = 0.0
_jwks_lock = asyncio.Lock()


async def _fetch_jwks(force_refresh: bool = False) -> dict[str, Any]:
    global _jwks_cache, _jwks_cache_expires_at

    now = time.time()
    if (
        not force_refresh
        and _jwks_cache is not None
        and now < _jwks_cache_expires_at
    ):
        return _jwks_cache

    if not SUPABASE_JWKS_URL:
        raise RuntimeError("SUPABASE_URL is not configured.")

    async with _jwks_lock:
        now = time.time()
        if (
            not force_refresh
            and _jwks_cache is not None
            and now < _jwks_cache_expires_at
        ):
            return _jwks_cache

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(SUPABASE_JWKS_URL)
            response.raise_for_status()

        jwks = response.json()
        if not isinstance(jwks, dict) or not isinstance(jwks.get("keys"), list):
            raise RuntimeError("Supabase JWKS response did not contain a valid key set.")

        _jwks_cache = jwks
        _jwks_cache_expires_at = now + JWKS_CACHE_TTL_SECONDS
        return jwks


async def _verify_token_with_jwks(token: str) -> dict[str, Any]:
    if not SUPABASE_URL:
        raise RuntimeError("SUPABASE_URL is not configured.")

    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    alg = header.get("alg")
    if not kid:
        raise JWTError("JWT header did not include a key id (kid).")
    if alg not in SUPPORTED_SIGNING_ALGORITHMS:
        raise JWTError(f"Unsupported JWT signing algorithm: {alg}")

    async def _find_key(force_refresh: bool = False) -> dict[str, Any] | None:
        jwks = await _fetch_jwks(force_refresh=force_refresh)
        return next((key for key in jwks["keys"] if key.get("kid") == kid), None)

    key = await _find_key(force_refresh=False)
    if key is None:
        key = await _find_key(force_refresh=True)
    if key is None:
        raise JWTError(f"No JWKS signing key matched kid={kid!r}")

    return jwt.decode(
        token,
        key,
        algorithms=[alg],
        audience="authenticated",
        issuer=f"{SUPABASE_URL}/auth/v1",
    )


async def verify_token(token: str) -> dict:
    try:
        return await _verify_token_with_jwks(token)
    except Exception as exc:
        logger.warning("JWKS verification failed, falling back to Supabase /user lookup: %s", exc)

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
                "$set": {"last_seen_at": now},
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
        # Track app presence separately from streak-worthy completions.
        last_seen = user_doc.get("last_seen_at") or user_doc.get("last_active_date")
        now = datetime.utcnow()
        if not last_seen or (now - last_seen).total_seconds() > 3600:
            await users_col.update_one(
                {"_id": user_doc["_id"]},
                {"$set": {"last_seen_at": now}},
            )

    return UserDB(**user_doc)

async def optional_auth(credentials: HTTPAuthorizationCredentials = Depends(optional_security)) -> UserDB | None:
    if not credentials:
        return None
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None
