from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from core.auth import get_current_user
from db.models import UserDB, WeeklyAvailability
from db.database import get_users_col, get_goals_col

router = APIRouter()

class PreferencesUpdate(BaseModel):
    preferred_reminder_time: Optional[str] = None
    push_token: Optional[str] = None

@router.put("/me/availability", response_model=UserDB)
async def update_availability(
    availability: WeeklyAvailability,
    current_user: UserDB = Depends(get_current_user)
):
    users_col = get_users_col()
    await users_col.update_one(
        {"_id": current_user.id},
        {"$set": {"availability": availability.model_dump()}}
    )
    current_user.availability = availability
    return current_user

@router.put("/me/preferences", response_model=UserDB)
async def update_preferences(
    prefs: PreferencesUpdate,
    current_user: UserDB = Depends(get_current_user)
):
    users_col = get_users_col()
    update_fields = {k: v for k, v in prefs.model_dump(exclude_unset=True).items() if v is not None}
    
    if update_fields:
        await users_col.update_one(
            {"_id": current_user.id},
            {"$set": update_fields}
        )
        for k, v in update_fields.items():
            setattr(current_user, k, v)
            
    return current_user

@router.get("/me/stats")
async def get_user_stats(current_user: UserDB = Depends(get_current_user)):
    goals_col = get_goals_col()
    
    active_goals_count = await goals_col.count_documents({
        "user_id": str(current_user.id),
        "status": "active"
    })
    
    pipeline = [
        {"$match": {"user_id": str(current_user.id)}},
        {"$unwind": "$phases"},
        {"$unwind": "$phases.topics"},
        {"$match": {"phases.topics.status": "done"}},
        {"$count": "total"}
    ]
    cursor = goals_col.aggregate(pipeline)
    total_topics_done_list = await cursor.to_list(length=1)
    total_topics_done_count = total_topics_done_list[0]["total"] if total_topics_done_list else 0

    return {
        "streak_count": current_user.streak_count,
        "total_topics_done": total_topics_done_count,
        "active_goals_count": active_goals_count
    }
