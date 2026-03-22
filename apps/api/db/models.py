from pydantic import BaseModel, Field, field_validator
from typing import List, Literal, Optional, Dict, Any
from datetime import datetime
import uuid

class MongoDocumentModel(BaseModel):
    id: Optional[str] = Field(alias="_id", default=None)

    @field_validator("id", mode="before")
    @classmethod
    def stringify_object_id(cls, value):
        if value is None:
            return value
        return str(value)

class TimeBlock(BaseModel):
    start: str = Field(description="HH:MM format", examples=["08:00"])
    end: str = Field(description="HH:MM format", examples=["09:00"])

class WeeklyAvailability(BaseModel):
    monday: List[TimeBlock] = Field(default_factory=list)
    tuesday: List[TimeBlock] = Field(default_factory=list)
    wednesday: List[TimeBlock] = Field(default_factory=list)
    thursday: List[TimeBlock] = Field(default_factory=list)
    friday: List[TimeBlock] = Field(default_factory=list)
    saturday: List[TimeBlock] = Field(default_factory=list)
    sunday: List[TimeBlock] = Field(default_factory=list)

class UserDB(MongoDocumentModel):
    supabase_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    timezone: str = "Asia/Kolkata"
    preferred_reminder_time: str = "08:00"
    push_token: Optional[str] = None
    availability: WeeklyAvailability = Field(default_factory=WeeklyAvailability)
    streak_count: int = 0
    longest_streak: int = 0
    last_active_date: Optional[datetime] = None
    plan: Literal["free", "pro", "team"] = "free"
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Resource(BaseModel):
    resource_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["video", "article", "notes", "problem", "course"]
    title: str
    url: str
    source: Literal[
        "youtube",
        "leetcode",
        "codechef",
        "codeforces",
        "cses",
        "atcoder",
        "geeksforgeeks",
        "github",
        "udemy",
        "other",
    ]
    is_free: bool
    verified_at: Optional[datetime] = None
    is_broken: bool = False

class Topic(BaseModel):
    topic_id: str
    title: str
    day_index: int
    estimated_minutes: int
    ai_note: str
    resource_queries: List[str] = Field(default_factory=list)
    resources: List[Resource] = Field(default_factory=list)
    practice_links: List[Resource] = Field(default_factory=list)
    ai_generated_notes: Optional[str] = None
    status: Literal["locked", "pending", "in_progress", "done", "skipped"] = "pending"
    completed_at: Optional[datetime] = None

class Phase(BaseModel):
    phase_id: str
    title: str
    duration_days: int
    topics: List[Topic] = Field(default_factory=list)

class GoalIntake(BaseModel):
    daily_hours: float
    prior_knowledge: str
    budget: Literal["free", "paid"]
    external_materials: Optional[str] = None
    domain_specific_answer: Optional[str] = None

class GoalDB(MongoDocumentModel):
    user_id: str
    title: str
    domain: str
    timeline_start: datetime
    timeline_target: datetime
    total_days: int
    intake: GoalIntake
    phases: List[Phase] = Field(default_factory=list)
    current_phase_index: int = 0
    current_day_index: int = 0
    status: Literal["active", "paused", "completed", "abandoned"] = "active"
    community_room_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class SubtaskDB(BaseModel):
    subtask_id: str
    title: str
    estimated_minutes: int
    status: Literal["pending", "done"] = "pending"
    completed_at: Optional[datetime] = None

class TaskDB(MongoDocumentModel):
    user_id: str
    raw_input: str
    due_date: Optional[datetime] = None
    priority: Literal["low", "medium", "high"] = "medium"
    estimated_minutes: int = 30
    ai_subtasks: List[SubtaskDB] = Field(default_factory=list)
    linked_goal_id: Optional[str] = None
    status: Literal["pending", "done", "overdue"] = "pending"
    created_at: datetime = Field(default_factory=datetime.utcnow)

class SkillDB(MongoDocumentModel):
    user_id: str
    goal_id: str
    name: str
    domain: str
    prerequisite_skill_ids: List[str] = Field(default_factory=list)
    mastery_level: int = 0
    mastery_history: List[Dict[str, Any]] = Field(default_factory=list)
    tasks_completed: int = 0
    last_practiced: Optional[datetime] = None
    decay_rate: float = 0.5

class CommunityRoomDB(MongoDocumentModel):
    name: str
    domain: str
    target_date: Optional[datetime] = None
    member_count: int = 0
    is_private: bool
    invite_code: Optional[str] = None
    created_by: str
    admins: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
