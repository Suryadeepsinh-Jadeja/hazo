from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from core.auth import get_current_user
from db.database import get_goals_col, get_skills_col
from db.models import UserDB

router = APIRouter(tags=["skills"])

DECAY_GRACE_DAYS = 30

class SkillResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    skill_id: str
    name: str
    domain: str
    prerequisite_skill_ids: List[str]
    mastery_level: float
    stored_mastery_level: float
    last_practiced: Optional[datetime] = None
    tasks_completed: int
    decay_rate: float
    days_since_practice: Optional[int] = None
    decay_penalty: float = 0.0
    is_decaying: bool = False


def _coerce_datetime(value: object) -> Optional[datetime]:
    if value is None:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    return None


def _build_skill_response(skill_doc: dict) -> SkillResponse:
    now = datetime.now(timezone.utc)
    last_practiced = _coerce_datetime(skill_doc.get("last_practiced"))
    stored_mastery = float(skill_doc.get("mastery_level", 0) or 0)
    decay_rate = float(skill_doc.get("decay_rate", 0.5) or 0.5)

    days_since_practice: Optional[int] = None
    decay_penalty = 0.0
    effective_mastery = stored_mastery
    is_decaying = False

    if last_practiced is not None:
        days_since_practice = max(0, (now - last_practiced).days)
        if days_since_practice > DECAY_GRACE_DAYS:
            is_decaying = True
            decay_penalty = (days_since_practice - DECAY_GRACE_DAYS) * decay_rate
            effective_mastery = max(0.0, stored_mastery - decay_penalty)

    return SkillResponse(
        skill_id=str(skill_doc.get("skill_id") or skill_doc.get("_id")),
        name=skill_doc.get("name", "Unnamed Skill"),
        domain=skill_doc.get("domain", "other"),
        prerequisite_skill_ids=list(skill_doc.get("prerequisite_skill_ids", []) or []),
        mastery_level=round(effective_mastery, 2),
        stored_mastery_level=round(stored_mastery, 2),
        last_practiced=last_practiced,
        tasks_completed=int(skill_doc.get("tasks_completed", 0) or 0),
        decay_rate=decay_rate,
        days_since_practice=days_since_practice,
        decay_penalty=round(decay_penalty, 2),
        is_decaying=is_decaying,
    )

@router.get("/{goal_id}", response_model=List[SkillResponse])
async def get_skills(
    goal_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Return the current user's skills for a goal, with decay applied at read time.
    """
    try:
        goal_oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    goals_col = get_goals_col()
    goal_doc = await goals_col.find_one({
        "_id": goal_oid,
        "user_id": str(current_user.id),
    })
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    skills_col = get_skills_col()
    skill_docs = await skills_col.find(
        {
            "user_id": str(current_user.id),
            "goal_id": goal_id,
        }
    ).to_list(length=500)

    responses = [_build_skill_response(skill_doc) for skill_doc in skill_docs]
    responses.sort(key=lambda skill: (-skill.mastery_level, skill.name.lower()))
    return responses
