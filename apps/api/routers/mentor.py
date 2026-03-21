"""
mentor.py — AI mentor chat and history endpoints for Stride.

Endpoints:
  POST   /chat               streaming SSE chat with Gemini mentor
  GET    /history/{goal_id}  last 20 mentor messages (Pro users only)
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone, timedelta
from typing import Any, AsyncGenerator, Dict, List, Optional

import redis.asyncio as aioredis
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.auth import get_current_user
from db.database import get_goals_col, get_skills_col, get_mentor_sessions_col
from db.models import UserDB

# Repo root → packages importable
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from packages.ai.gemini_client import stream_gemini
from packages.ai.prompts import mentor_system_prompt

load_dotenv()
logger = logging.getLogger("stride.routers.mentor")
router = APIRouter(prefix="/mentor")

# ---------------------------------------------------------------------------
# Redis client (reuse pattern from goals.py)
# ---------------------------------------------------------------------------

_redis: Optional[aioredis.Redis] = None
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

FREE_DAILY_LIMIT = 5


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str       # "user" | "assistant" | "model"
    content: str


class MentorChatRequest(BaseModel):
    goal_id: str
    message: str
    history: List[ChatMessage] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_redis_json(key: str) -> Optional[dict]:
    raw = await get_redis().get(key)
    return json.loads(raw) if raw else None


def _seconds_until_midnight_utc() -> int:
    """Seconds from now until midnight UTC."""
    now = datetime.now(timezone.utc)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((midnight - now).total_seconds()))


def _safe_str(oid: Any) -> str:
    return str(oid) if oid else ""


async def _load_mentor_context(
    user_id: str,
    goal_id: str,
) -> Dict[str, Any]:
    """
    Fetch everything the mentor system prompt needs from MongoDB + Redis.
    Returns a dict with keys matching mentor_system_prompt() parameters.
    """
    goals_col = get_goals_col()
    skills_col = get_skills_col()

    # Load goal
    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id.")

    goal_doc = await goals_col.find_one({"_id": oid, "user_id": user_id})
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    goal_title: str = goal_doc.get("title", "")
    intake: dict = goal_doc.get("intake", {})
    prior_knowledge: str = intake.get("prior_knowledge", "beginner")
    budget: str = intake.get("budget", "free")
    total_days: int = goal_doc.get("total_days", 30)
    current_phase_idx: int = goal_doc.get("current_phase_index", 0)
    current_day_idx: int = goal_doc.get("current_day_index", 0)

    # Phase title
    phases: list = goal_doc.get("phases", [])
    phase_title = ""
    if current_phase_idx < len(phases):
        phase_title = phases[current_phase_idx].get("title", "")

    # Current topic and its resources
    topic_title = ""
    resources: List[dict] = []
    if current_phase_idx < len(phases):
        topics = phases[current_phase_idx].get("topics", [])
        # Find topic matching current day
        for t in topics:
            if t.get("day_index") == current_day_idx:
                topic_title = t.get("title", "")
                resources = t.get("resources", [])
                break
        # Fallback: first pending topic in phase
        if not topic_title and topics:
            for t in topics:
                if t.get("status") in ("pending", "in_progress"):
                    topic_title = t.get("title", "")
                    resources = t.get("resources", [])
                    break

    # Top 5 skills by mastery
    skills_cursor = (
        skills_col.find({"user_id": user_id, "goal_id": goal_id})
        .sort("mastery_level", -1)
        .limit(5)
    )
    recent_skills: List[str] = []
    async for skill in skills_cursor:
        recent_skills.append(skill.get("name", ""))

    # Today's task card from Redis (for extra context if needed)
    daily_card = await _get_redis_json(f"daily:task:{user_id}:{goal_id}")

    return {
        "goal_title": goal_title,
        "phase_title": phase_title,
        "day_index": current_day_idx,
        "total_days": total_days,
        "topic_title": topic_title,
        "resources": resources,
        "prior_knowledge": prior_knowledge,
        "recent_skills": recent_skills,
        "budget": budget,
    }


# ---------------------------------------------------------------------------
# POST /chat
# ---------------------------------------------------------------------------

@router.post("/chat")
async def mentor_chat(
    body: MentorChatRequest,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Streaming SSE mentor chat endpoint.

    Rate limit: free users capped at 5 messages/day.
    Returns text/event-stream; each chunk:
        data: {"delta": "..."}\n\n
    Terminator:
        data: {"done": true}\n\n
    Error event:
        data: {"error": "..."}\n\n
    """
    user_id = str(current_user.id)
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    rate_key = f"mentor:rate:{user_id}:{today_str}"

    # ── Rate limiting ──────────────────────────────────────────────────────
    rdb = get_redis()
    raw_count = await rdb.get(rate_key)
    message_count = int(raw_count) if raw_count else 0

    if message_count >= FREE_DAILY_LIMIT and current_user.plan == "free":
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "detail": "Daily limit reached",
                "upgrade_url": "/upgrade",
            },
        )

    # Increment counter; reset TTL to seconds until midnight
    ttl = _seconds_until_midnight_utc()
    pipe = rdb.pipeline()
    pipe.incr(rate_key)
    pipe.expire(rate_key, ttl)
    await pipe.execute()

    # ── Load mentor context ─────────────────────────────────────────────────
    ctx = await _load_mentor_context(user_id=user_id, goal_id=body.goal_id)

    system_prompt = mentor_system_prompt(
        goal_title=ctx["goal_title"],
        phase_title=ctx["phase_title"],
        day_index=ctx["day_index"],
        total_days=ctx["total_days"],
        topic_title=ctx["topic_title"],
        resources=ctx["resources"],
        prior_knowledge=ctx["prior_knowledge"],
        recent_skills=ctx["recent_skills"],
        budget=ctx["budget"],
    )

    # Map history to Gemini format (assistant → model)
    formatted_history = [
        {
            "role": "model" if msg.role == "assistant" else msg.role,
            "parts": [msg.content],
        }
        for msg in body.history
    ]

    # ── Streaming generator ─────────────────────────────────────────────────
    async def _event_stream() -> AsyncGenerator[str, None]:
        full_response_parts: List[str] = []
        try:
            async for chunk in stream_gemini(
                prompt=body.message,
                system=system_prompt,
                history=formatted_history,
                temperature=0.7,
            ):
                full_response_parts.append(chunk)
                yield f"data: {json.dumps({'delta': chunk})}\n\n"

            yield 'data: {"done": true}\n\n'

            # ── Persist session to MongoDB ──────────────────────────────────
            mentor_col = get_mentor_sessions_col()
            now = datetime.utcnow()
            full_response = "".join(full_response_parts)
            await mentor_col.insert_many(
                [
                    {
                        "user_id": user_id,
                        "goal_id": body.goal_id,
                        "role": "user",
                        "content": body.message,
                        "created_at": now,
                    },
                    {
                        "user_id": user_id,
                        "goal_id": body.goal_id,
                        "role": "model",
                        "content": full_response,
                        "created_at": now,
                    },
                ]
            )

        except Exception as exc:
            logger.exception("Mentor stream failed: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx buffering
        },
    )


# ---------------------------------------------------------------------------
# GET /history/{goal_id}
# ---------------------------------------------------------------------------

@router.get("/history/{goal_id}")
async def get_mentor_history(
    goal_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Return the last 20 mentor messages for this goal.
    Pro users only — returns 403 if the user is on the free plan.
    """
    if current_user.plan != "pro":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Mentor history is a Pro feature. Upgrade to access your full conversation history.",
        )

    mentor_col = get_mentor_sessions_col()
    cursor = (
        mentor_col.find(
            {"user_id": str(current_user.id), "goal_id": goal_id},
            {"_id": 0, "role": 1, "content": 1, "created_at": 1},
        )
        .sort("created_at", -1)
        .limit(20)
    )

    messages: List[dict] = []
    async for doc in cursor:
        if isinstance(doc.get("created_at"), datetime):
            doc["created_at"] = doc["created_at"].isoformat()
        messages.append(doc)

    # Return in chronological order (oldest first)
    messages.reverse()
    return messages
