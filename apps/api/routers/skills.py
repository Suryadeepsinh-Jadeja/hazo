from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from typing import List
from pydantic import BaseModel, ConfigDict

router = APIRouter(tags=["skills"])

class SkillResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    skill_id: str
    name: str
    mastery_level: float
    last_practiced: datetime

# Mocked fallback for DB state representing different skill tiers and decay
MOCK_SKILLS = [
    {"skill_id": "1", "name": "API Design", "mastery_level": 85.0, "last_practiced": datetime.now(timezone.utc)},
    {"skill_id": "2", "name": "System Arch", "mastery_level": 60.0, "last_practiced": datetime.now(timezone.utc)},
    {"skill_id": "3", "name": "Algorithms", "mastery_level": 35.0, "last_practiced": datetime.now(timezone.utc)},
    {"skill_id": "4", "name": "React Internals", "mastery_level": 90.0, "last_practiced": datetime.fromisoformat("2026-02-01T00:00:00+00:00")}, # Over 30 days old to trigger decay
    {"skill_id": "5", "name": "Databases", "mastery_level": 20.0, "last_practiced": datetime.now(timezone.utc)},
]

@router.get("/{goal_id}", response_model=List[SkillResponse])
async def get_skills(goal_id: str):
    """
    Returns all SkillDB entries for a user+goal.
    Applies mathematical decay logic dynamically.
    """
    decay_rate = 0.5 # 0.5 points per day
    now = datetime.now(timezone.utc)
    
    processed_skills = []
    for skill in MOCK_SKILLS:
        last_prac = skill["last_practiced"]
        # Ensure timezone awareness for math
        if last_prac.tzinfo is None:
             last_prac = last_prac.replace(tzinfo=timezone.utc)

        days_since = (now - last_prac).days
        mastery = skill["mastery_level"]
        
        # Apply strict memory decay rule > 30 days
        if days_since > 30:
            penalty = (days_since - 30) * decay_rate
            mastery = max(0.0, mastery - penalty)
            # In production: await db.skills.update_one({...}) if mastery drifted
            
        processed_skills.append({
            "skill_id": skill["skill_id"],
            "name": skill["name"],
            "mastery_level": mastery,
            "last_practiced": last_prac
        })
        
    return processed_skills
