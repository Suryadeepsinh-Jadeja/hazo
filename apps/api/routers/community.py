"""
community.py — Community rooms router for Hazo.

Endpoints:
  GET    /community/rooms              — list / search public rooms
  POST   /community/rooms              — create room (Pro only)
  POST   /community/rooms/{id}/join    — join a public room
  POST   /community/rooms/private/join — join via invite code
  GET    /community/rooms/{id}/progress — aggregate member progress
  GET    /community/rooms/{id}/feed    — paginated post feed
  POST   /community/rooms/{id}/posts   — submit post (Pro only, Gemini toxicity check)
"""

import os
import secrets
import sys
import logging
from datetime import datetime, date
from typing import Any, Dict, List, Optional

import redis.asyncio as aioredis
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from motor.motor_asyncio import AsyncIOMotorCollection
from pydantic import BaseModel

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from core.auth import get_current_user
from db.database import get_goals_col, get_rooms_col, get_users_col, get_database
from db.models import CommunityRoomDB, UserDB
from packages.ai.gemini_client import call_gemini_json

logger = logging.getLogger("hazo.routers.community")

router = APIRouter(prefix="/community", tags=["community"])

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(_REDIS_URL, decode_responses=True)


def _get_members_col() -> AsyncIOMotorCollection:
    return get_database().community_members


def _get_posts_col() -> AsyncIOMotorCollection:
    return get_database().community_posts


def _oid(val: str) -> ObjectId:
    try:
        return ObjectId(val)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID.")


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class JoinRoomBody(BaseModel):
    display_name: Optional[str] = None
    is_anonymous: bool = False


class JoinPrivateBody(BaseModel):
    invite_code: str
    display_name: Optional[str] = None
    is_anonymous: bool = False


class CreateRoomBody(BaseModel):
    name: str
    domain: str
    target_date: Optional[datetime] = None
    is_private: bool = False


class PostBody(BaseModel):
    content: str


# ---------------------------------------------------------------------------
# Toxicity check prompt (inline — no toxicity prompt exists in prompts.py)
# ---------------------------------------------------------------------------

_TOXICITY_PROMPT = """You are a community moderator for an educational goal-tracking app called Hazo.
Review the post below and decide if it is appropriate.

A post is INAPPROPRIATE if it contains:
- Hate speech, slurs, or discrimination
- Sexual content or explicit language
- Spam, phishing links, or self-promotion
- Personal attacks, bullying, or harassment
- Misinformation presented as fact

Post content:
\"\"\"{content}\"\"\"

Return JSON only (no markdown fences):
{{"appropriate": true}}  OR  {{"appropriate": false, "reason": "one sentence"}}
"""


async def _check_toxicity(content: str) -> bool:
    """Return True if the content is appropriate."""
    try:
        result = await call_gemini_json(
            _TOXICITY_PROMPT.format(content=content[:2000])
        )
        if isinstance(result, dict):
            return bool(result.get("appropriate", True))
    except Exception as exc:
        logger.warning("Toxicity check failed, defaulting to approve: %s", exc)
    return True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _serialize(doc: dict) -> dict:
    """Convert ObjectIds and datetimes for JSON response."""
    return jsonable_encoder(doc, custom_encoder={ObjectId: str})


async def _ensure_not_member(members_col, user_id: str, room_id: str) -> None:
    existing = await members_col.find_one({"user_id": user_id, "room_id": room_id})
    if existing:
        raise HTTPException(status_code=409, detail="Already a member of this room.")


async def _do_join(
    rooms_col,
    members_col,
    room_doc: dict,
    user_id: str,
    display_name: Optional[str],
    is_anonymous: bool,
) -> dict:
    room_id = str(room_doc["_id"])
    await _ensure_not_member(members_col, user_id, room_id)

    now = datetime.utcnow()
    await members_col.insert_one({
        "user_id": user_id,
        "room_id": room_id,
        "joined_at": now,
        "display_name": display_name or "Anonymous",
        "is_anonymous": is_anonymous,
    })
    updated = await rooms_col.find_one_and_update(
        {"_id": room_doc["_id"]},
        {"$inc": {"member_count": 1}},
        return_document=True,
    )
    return {
        "room": _serialize(updated),
        "member_count": updated.get("member_count", 1),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/rooms")
async def list_rooms(
    domain: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    current_user: UserDB = Depends(get_current_user),
) -> List[dict]:
    """Top 20 public rooms by member_count desc, with optional domain/search filter."""
    rooms_col = get_rooms_col()
    query: Dict[str, Any] = {"is_private": False}
    if domain:
        query["domain"] = domain
    if search:
        query["name"] = {"$regex": search, "$options": "i"}

    docs = await rooms_col.find(query).sort("member_count", -1).limit(20).to_list(length=20)
    return [_serialize(d) for d in docs]


@router.post("/rooms", status_code=status.HTTP_201_CREATED)
async def create_room(
    body: CreateRoomBody,
    current_user: UserDB = Depends(get_current_user),
) -> dict:
    """Create a new community room. Pro users only."""
    if current_user.plan != "pro":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Creating rooms is a Pro feature. Upgrade to unlock.",
        )

    rooms_col = get_rooms_col()
    invite_code = secrets.token_urlsafe(6) if body.is_private else None
    now = datetime.utcnow()

    room_doc = {
        "name": body.name,
        "domain": body.domain,
        "target_date": body.target_date,
        "is_private": body.is_private,
        "invite_code": invite_code,
        "member_count": 1,
        "created_by": current_user.supabase_id,
        "admins": [current_user.supabase_id],
        "created_at": now,
    }

    result = await rooms_col.insert_one(room_doc)
    room_doc["_id"] = result.inserted_id
    return _serialize(room_doc)


@router.post("/rooms/{room_id}/join")
async def join_room(
    room_id: str,
    body: JoinRoomBody = JoinRoomBody(),
    current_user: UserDB = Depends(get_current_user),
) -> dict:
    """Join a public room."""
    rooms_col = get_rooms_col()
    room_doc = await rooms_col.find_one({"_id": _oid(room_id), "is_private": False})
    if not room_doc:
        raise HTTPException(status_code=404, detail="Room not found.")

    return await _do_join(
        rooms_col,
        _get_members_col(),
        room_doc,
        current_user.supabase_id,
        body.display_name,
        body.is_anonymous,
    )


@router.post("/rooms/private/join")
async def join_private_room(
    body: JoinPrivateBody,
    current_user: UserDB = Depends(get_current_user),
) -> dict:
    """Join a private room via invite code."""
    rooms_col = get_rooms_col()
    room_doc = await rooms_col.find_one({"invite_code": body.invite_code})
    if not room_doc:
        raise HTTPException(status_code=404, detail="Invalid invite code.")

    return await _do_join(
        rooms_col,
        _get_members_col(),
        room_doc,
        current_user.supabase_id,
        body.display_name,
        body.is_anonymous,
    )


@router.get("/rooms/{room_id}/progress")
async def room_progress(
    room_id: str,
    current_user: UserDB = Depends(get_current_user),
) -> dict:
    """Aggregate member progress for a room. Cached 30 minutes."""
    rdb = _get_redis()
    cache_key = f"room:progress:{room_id}"
    cached = await rdb.get(cache_key)
    if cached:
        import json as _json
        return _json.loads(cached)

    members_col = _get_members_col()
    goals_col = get_goals_col()
    users_col = get_users_col()

    member_docs = await members_col.find({"room_id": room_id}).to_list(length=1000)
    member_count = len(member_docs)
    if member_count == 0:
        return {"member_count": 0, "active_today": 0, "collective_progress_pct": 0.0, "top_streaks": []}

    today = date.today()
    active_today = 0
    progress_values: List[float] = []
    streaks: List[Dict[str, Any]] = []

    for m in member_docs:
        uid = m["user_id"]
        user_doc = await users_col.find_one({"supabase_id": uid})
        if not user_doc:
            continue

        # Active today
        last_active = user_doc.get("last_active_date")
        if last_active:
            if isinstance(last_active, datetime):
                last_active = last_active.date()
            if last_active == today:
                active_today += 1

        # Collect streaks for top 5
        streak = user_doc.get("streak_count", 0)
        streaks.append({
            "display_name": m.get("display_name", "Anonymous"),
            "is_anonymous": m.get("is_anonymous", False),
            "streak_count": streak,
        })

        # Goal progress
        goal_doc = await goals_col.find_one(
            {"user_id": uid, "status": "active"},
            {"current_day_index": 1, "total_days": 1},
        )
        if goal_doc:
            total = goal_doc.get("total_days", 1) or 1
            current = goal_doc.get("current_day_index", 0)
            progress_values.append(current / total * 100)

    collective_progress_pct = (
        round(sum(progress_values) / len(progress_values), 1) if progress_values else 0.0
    )
    top_streaks = sorted(streaks, key=lambda x: x["streak_count"], reverse=True)[:5]

    result = {
        "member_count": member_count,
        "active_today": active_today,
        "collective_progress_pct": collective_progress_pct,
        "top_streaks": top_streaks,
    }

    import json as _json
    await rdb.setex(cache_key, 1800, _json.dumps(result))
    return result


@router.get("/rooms/{room_id}/feed")
async def room_feed(
    room_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=50),
    current_user: UserDB = Depends(get_current_user),
) -> dict:
    """Paginated post feed for a room."""
    posts_col = _get_posts_col()
    skip = (page - 1) * limit
    total = await posts_col.count_documents({"room_id": room_id, "is_approved": True})
    docs = (
        await posts_col.find({"room_id": room_id, "is_approved": True})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(length=limit)
    )
    return {
        "page": page,
        "limit": limit,
        "total": total,
        "posts": [_serialize(d) for d in docs],
    }


@router.post("/rooms/{room_id}/posts", status_code=status.HTTP_201_CREATED)
async def create_post(
    room_id: str,
    body: PostBody,
    current_user: UserDB = Depends(get_current_user),
) -> dict:
    """Submit a post to a room. Pro users only. Gemini toxicity gate."""
    if current_user.plan != "pro":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Posting in rooms is a Pro feature. Upgrade to unlock.",
        )

    if not body.content.strip():
        raise HTTPException(status_code=422, detail="Post content cannot be empty.")

    rooms_col = get_rooms_col()
    room_doc = await rooms_col.find_one({"_id": _oid(room_id)})
    if not room_doc:
        raise HTTPException(status_code=404, detail="Room not found.")

    # Toxicity gate
    appropriate = await _check_toxicity(body.content)
    if not appropriate:
        raise HTTPException(
            status_code=422,
            detail="Post not approved — please keep it positive and on-topic.",
        )

    posts_col = _get_posts_col()
    now = datetime.utcnow()
    post_doc = {
        "room_id": room_id,
        "user_id": current_user.supabase_id,
        "content": body.content.strip(),
        "is_approved": True,
        "created_at": now,
    }
    result = await posts_col.insert_one(post_doc)
    post_doc["_id"] = result.inserted_id
    return _serialize(post_doc)
