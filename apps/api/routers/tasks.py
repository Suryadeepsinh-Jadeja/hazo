"""
tasks.py — task management endpoints for Stride.

Endpoints:
  POST   /                              create task with AI subtasks
  GET    /                              list tasks (filterable)
  GET    /today                         tasks due today or overdue
  POST   /{task_id}/subtasks/{subid}/complete
  DELETE /{task_id}                     soft-delete (abandoned)
"""

import os
import sys
import logging
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from core.auth import get_current_user
from db.database import get_tasks_col, get_skills_col
from db.models import SubtaskDB, TaskDB, UserDB

# Repo root → packages importable
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from packages.ai.gemini_client import call_gemini_json
from packages.ai.prompts import subtask_generation_prompt

load_dotenv()
logger = logging.getLogger("stride.routers.tasks")
router = APIRouter(prefix="/tasks")


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class CreateTaskRequest(BaseModel):
    raw_input: str
    due_date: Optional[str] = None          # ISO 8601 string, optional
    priority: Optional[Literal["low", "medium", "high"]] = "medium"
    linked_goal_id: Optional[str] = None


class UpdateTaskRequest(BaseModel):
    raw_input: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[Literal["low", "medium", "high"]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _doc_to_dict(doc: dict) -> dict:
    """Convert a MongoDB document to a JSON-serialisable dict."""
    doc["_id"] = str(doc["_id"])
    return doc


def _parse_iso_date(raw: Optional[str]) -> Optional[datetime]:
    """Parse an ISO 8601 string to a timezone-naive UTC datetime."""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        # Normalise to naive UTC
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid due_date format: '{raw}'. Expected ISO 8601.",
        )


def _compute_due_hours(due_date: Optional[datetime]) -> int:
    """Hours between now and due_date. Default 48 when not provided."""
    if due_date is None:
        return 48
    now = datetime.utcnow()
    diff = due_date - now
    hours = int(diff.total_seconds() / 3600)
    return max(1, hours)  # at least 1 h so the prompt makes sense


# ---------------------------------------------------------------------------
# POST /
# ---------------------------------------------------------------------------

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(
    body: CreateTaskRequest,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Create a task with AI-generated subtasks.

    Steps:
      1. Parse due_date and compute due_hours
      2. Call Gemini to break the task into 3–6 subtasks
      3. Build TaskDB and insert to MongoDB
    """
    due_date_dt = _parse_iso_date(body.due_date)
    due_hours = _compute_due_hours(due_date_dt)

    # AI subtask generation
    try:
        ai_result = await call_gemini_json(
            subtask_generation_prompt(body.raw_input, due_hours)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI subtask generation failed: {exc}",
        )

    estimated_total = ai_result.get("estimated_total_minutes", 30)
    subtask_raw_list: List[dict] = ai_result.get("subtasks", [])

    subtasks = [
        SubtaskDB(
            subtask_id=str(uuid.uuid4()),
            title=s.get("title", "Subtask"),
            estimated_minutes=int(s.get("estimated_minutes", 15)),
            status="pending",
        )
        for s in subtask_raw_list
    ]

    now = datetime.utcnow()
    task_doc: Dict[str, Any] = {
        "user_id": str(current_user.id),
        "raw_input": body.raw_input,
        "due_date": due_date_dt,
        "priority": body.priority or "medium",
        "estimated_minutes": estimated_total,
        "ai_subtasks": [s.model_dump() for s in subtasks],
        "linked_goal_id": body.linked_goal_id,
        "status": "pending",
        "created_at": now,
    }

    tasks_col = get_tasks_col()
    result = await tasks_col.insert_one(task_doc)
    task_doc["_id"] = str(result.inserted_id)
    return task_doc


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

_PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}


@router.get("")
async def list_tasks(
    task_status: Optional[str] = Query(None, alias="status"),
    due_today: Optional[bool] = Query(None),
    current_user: UserDB = Depends(get_current_user),
):
    """
    List tasks for the current user.

    Sort order: overdue → high priority → due_date ascending.
    Optional filters:
      - status=pending|done|overdue
      - due_today=true  (tasks due today only)
    """
    tasks_col = get_tasks_col()
    query: Dict[str, Any] = {"user_id": str(current_user.id)}

    if task_status:
        query["status"] = task_status

    if due_today:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)
        query["due_date"] = {"$lt": today_end}

    cursor = tasks_col.find(query).sort(
        [
            ("due_date", 1),   # closer deadlines first
        ]
    )

    tasks: List[dict] = []
    now = datetime.utcnow()
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        # Compute effective status for sorting — overdue if past due and not done
        due = doc.get("due_date")
        if due and isinstance(due, datetime) and due < now and doc.get("status") == "pending":
            doc["status"] = "overdue"
        tasks.append(doc)

    # Sort: overdue first, then by priority, then by due_date
    def _sort_key(t: dict):
        is_overdue = 0 if t.get("status") == "overdue" else 1
        prio = _PRIORITY_ORDER.get(t.get("priority", "medium"), 1)
        due = t.get("due_date") or datetime(9999, 12, 31)
        if isinstance(due, str):
            due = datetime.fromisoformat(due)
        return (is_overdue, prio, due)

    tasks.sort(key=_sort_key)
    return tasks


# ---------------------------------------------------------------------------
# GET /today
# ---------------------------------------------------------------------------

@router.get("/today")
async def get_tasks_today(current_user: UserDB = Depends(get_current_user)):
    """
    Return tasks due today or already overdue.
    Used by the home screen "Your Tasks Today" section.
    """
    tasks_col = get_tasks_col()
    now = datetime.utcnow()
    today_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    cursor = tasks_col.find(
        {
            "user_id": str(current_user.id),
            "status": {"$in": ["pending", "overdue"]},
            "$or": [
                {"due_date": {"$lte": today_end}},
                {"due_date": None},          # no due date = always surface
            ],
        }
    ).sort("due_date", 1)

    tasks: List[dict] = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        due = doc.get("due_date")
        if due and isinstance(due, datetime) and due < now and doc.get("status") == "pending":
            doc["status"] = "overdue"
        tasks.append(doc)

    return tasks


# ---------------------------------------------------------------------------
# GET /{task_id}
# ---------------------------------------------------------------------------

@router.get("/{task_id}")
async def get_task(
    task_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    tasks_col = get_tasks_col()

    try:
        oid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id format.")

    task_doc = await tasks_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if task_doc is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    due = task_doc.get("due_date")
    if due and isinstance(due, datetime) and due < datetime.utcnow() and task_doc.get("status") == "pending":
        task_doc["status"] = "overdue"

    return _doc_to_dict(task_doc)


# ---------------------------------------------------------------------------
# PUT /{task_id}
# ---------------------------------------------------------------------------

@router.put("/{task_id}")
async def update_task(
    task_id: str,
    body: UpdateTaskRequest,
    current_user: UserDB = Depends(get_current_user),
):
    tasks_col = get_tasks_col()

    try:
        oid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id format.")

    existing_task = await tasks_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if existing_task is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    payload = body.model_dump(exclude_unset=True)
    update_fields: Dict[str, Any] = {}

    if "raw_input" in payload:
        raw_input = (payload.get("raw_input") or "").strip()
        if not raw_input:
            raise HTTPException(status_code=422, detail="Task title cannot be empty.")
        update_fields["raw_input"] = raw_input

    if "due_date" in payload:
        update_fields["due_date"] = _parse_iso_date(payload.get("due_date"))

    if "priority" in payload and payload.get("priority") is not None:
        update_fields["priority"] = payload["priority"]

    if update_fields:
        await tasks_col.update_one({"_id": oid}, {"$set": update_fields})

    updated_task = await tasks_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if updated_task is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    due = updated_task.get("due_date")
    if due and isinstance(due, datetime) and due < datetime.utcnow() and updated_task.get("status") == "pending":
        updated_task["status"] = "overdue"

    return _doc_to_dict(updated_task)


# ---------------------------------------------------------------------------
# POST /{task_id}/subtasks/{subtask_id}/complete
# ---------------------------------------------------------------------------

@router.post("/{task_id}/subtasks/{subtask_id}/complete")
async def complete_subtask(
    task_id: str,
    subtask_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Mark one subtask as done.
    - If all subtasks are now done → parent task = done.
    - If linked_goal_id exists → find matching skill, +10 mastery (capped 100).
    """
    tasks_col = get_tasks_col()
    skills_col = get_skills_col()

    try:
        oid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id format.")

    task_doc = await tasks_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if task_doc is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    subtasks: List[dict] = task_doc.get("ai_subtasks", [])
    subtask_found = False
    for sub in subtasks:
        if sub["subtask_id"] == subtask_id:
            if sub["status"] == "done":
                raise HTTPException(status_code=409, detail="Subtask already completed.")
            sub["status"] = "done"
            sub["completed_at"] = datetime.utcnow().isoformat()
            subtask_found = True
            break

    if not subtask_found:
        raise HTTPException(status_code=404, detail="Subtask not found.")

    # Determine parent task status
    remaining = sum(1 for s in subtasks if s["status"] != "done")
    new_task_status = "done" if remaining == 0 else task_doc.get("status", "pending")

    update_fields: Dict[str, Any] = {
        "ai_subtasks": subtasks,
        "status": new_task_status,
    }

    await tasks_col.update_one({"_id": oid}, {"$set": update_fields})

    # Skill mastery update (+10) when linked to a goal
    linked_goal_id = task_doc.get("linked_goal_id")
    if linked_goal_id and new_task_status == "done":
        # Heuristic: match skill name against first few words of raw_input
        raw_words = task_doc.get("raw_input", "").split()[:4]
        pattern = "|".join(raw_words) if raw_words else "."
        matched_skill = await skills_col.find_one(
            {
                "user_id": str(current_user.id),
                "goal_id": linked_goal_id,
                "name": {"$regex": pattern, "$options": "i"},
            }
        )
        if matched_skill:
            new_mastery = min(100, matched_skill.get("mastery_level", 0) + 10)
            await skills_col.update_one(
                {"_id": matched_skill["_id"]},
                {
                    "$set": {
                        "mastery_level": new_mastery,
                        "last_practiced": datetime.utcnow(),
                    },
                    "$push": {
                        "mastery_history": {
                            "date": datetime.utcnow().isoformat(),
                            "level": new_mastery,
                            "source": "task",
                        }
                    },
                    "$inc": {"tasks_completed": 1},
                },
            )

    return {"task_status": new_task_status, "subtasks_remaining": remaining}


# ---------------------------------------------------------------------------
# DELETE /{task_id}  (soft delete)
# ---------------------------------------------------------------------------

@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """Soft-delete a task by setting its status to 'abandoned'."""
    tasks_col = get_tasks_col()

    try:
        oid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id format.")

    result = await tasks_col.update_one(
        {"_id": oid, "user_id": str(current_user.id)},
        {"$set": {"status": "abandoned"}},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found.")

    return {"message": "deleted"}
