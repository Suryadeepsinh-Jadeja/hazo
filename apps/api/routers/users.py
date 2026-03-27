import mimetypes
import os
import re
from typing import Any, Literal, Optional

import httpx
from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from core.auth import get_current_user
from db.database import (
    get_database,
    get_goals_col,
    get_mentor_sessions_col,
    get_rooms_col,
    get_skills_col,
    get_tasks_col,
    get_users_col,
)
from db.models import UserDB, WeeklyAvailability
from packages.ai.gemini_client import call_gemini_json_multimodal

router = APIRouter()

_WEEKDAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()


class PreferencesUpdate(BaseModel):
    preferred_reminder_time: Optional[str] = None
    push_token: Optional[str] = None


class AvailabilityExtractionResponse(BaseModel):
    source_type: Literal["image", "pdf"]
    availability: WeeklyAvailability
    summary: list[str]
    warnings: list[str]


class DeleteAccountResponse(BaseModel):
    message: str


def _empty_availability_dict() -> dict[str, list[dict[str, str]]]:
    return {day: [] for day in _WEEKDAYS}


def _normalise_time_string(raw: Any) -> Optional[str]:
    if raw is None:
        return None

    text = str(raw).strip()
    if _TIME_RE.match(text):
        return text

    match = re.search(r"(\d{1,2})[:.](\d{2})", text)
    if not match:
        return None

    hours = int(match.group(1))
    minutes = int(match.group(2))
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        return None

    return f"{hours:02d}:{minutes:02d}"


def _normalise_availability_payload(payload: Any) -> dict[str, list[dict[str, str]]]:
    normalised = _empty_availability_dict()
    if not isinstance(payload, dict):
        return normalised

    for raw_day, raw_blocks in payload.items():
        day = str(raw_day).strip().lower()
        if day not in normalised or not isinstance(raw_blocks, list):
            continue

        blocks: list[dict[str, str]] = []
        for raw_block in raw_blocks:
            if not isinstance(raw_block, dict):
                continue

            start = _normalise_time_string(raw_block.get("start"))
            end = _normalise_time_string(raw_block.get("end"))
            if start is None or end is None or start >= end:
                continue

            blocks.append({"start": start, "end": end})

        normalised[day] = sorted(blocks, key=lambda block: block["start"])

    return normalised


def _summarise_availability(availability: dict[str, list[dict[str, str]]]) -> list[str]:
    summary: list[str] = []
    for day in _WEEKDAYS:
        label = day.capitalize()
        blocks = availability.get(day, [])
        if not blocks:
            summary.append(f"{label}: Off")
            continue

        block_text = ", ".join(f"{block['start']}-{block['end']}" for block in blocks)
        summary.append(f"{label}: {block_text}")

    return summary


def _availability_extraction_prompt(filename: str) -> str:
    return f"""
You are extracting WEEKLY FREE TIME from an uploaded timetable file named "{filename}".

Return strict JSON only in this exact shape:
{{
  "availability": {{
    "monday": [{{"start": "HH:MM", "end": "HH:MM"}}],
    "tuesday": [],
    "wednesday": [],
    "thursday": [],
    "friday": [],
    "saturday": [],
    "sunday": []
  }},
  "warnings": ["short notes about anything uncertain"]
}}

Rules:
- Extract the user's FREE / AVAILABLE slots, not the occupied classes.
- Use 24-hour HH:MM format.
- If a day is unclear, return an empty list for that day and add a warning.
- Do not invent overnight or midnight slots unless the timetable clearly shows them.
- Prefer conservative extraction when the timetable is ambiguous.
- Merge obviously adjacent free windows when they are part of one continuous free block.
- Return JSON only. No markdown, no explanation.
""".strip()


async def _delete_supabase_auth_user(current_user: UserDB) -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account deletion is unavailable because Supabase admin credentials are not configured.",
        )

    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{current_user.supabase_id}",
            headers=headers,
        )

    if response.status_code not in (200, 204):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not delete the auth account. Please try again in a moment.",
        )


@router.put("/me/availability", response_model=UserDB)
async def update_availability(
    availability: WeeklyAvailability,
    current_user: UserDB = Depends(get_current_user),
):
    users_col = get_users_col()
    await users_col.update_one(
        {"supabase_id": current_user.supabase_id},
        {"$set": {"availability": availability.model_dump()}},
    )
    current_user.availability = availability
    return current_user


@router.post("/me/availability/extract", response_model=AvailabilityExtractionResponse)
async def extract_availability(
    file: UploadFile = File(...),
    current_user: UserDB = Depends(get_current_user),
):
    del current_user

    filename = file.filename or "timetable"
    mime_type = file.content_type or mimetypes.guess_type(filename)[0] or ""
    if mime_type == "application/octet-stream":
        mime_type = mimetypes.guess_type(filename)[0] or mime_type

    source_type: Literal["image", "pdf"]
    if mime_type.startswith("image/"):
        source_type = "image"
    elif mime_type == "application/pdf":
        source_type = "pdf"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please upload a timetable image or PDF.",
        )

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file was empty.")
    if len(raw_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Please upload a file smaller than 10 MB.")

    try:
        extracted = await call_gemini_json_multimodal(
            _availability_extraction_prompt(filename),
            attachments=[{"mime_type": mime_type, "data": raw_bytes}],
            temperature=0.1,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Timetable extraction failed: {exc}",
        ) from exc

    availability_payload = _normalise_availability_payload(extracted.get("availability"))
    warnings = [
        str(item).strip()
        for item in (extracted.get("warnings") or [])
        if str(item).strip()
    ]

    if not any(availability_payload[day] for day in _WEEKDAYS):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hazo could not confidently detect any free slots from that file. Please review manually or try a clearer timetable.",
        )

    return AvailabilityExtractionResponse(
        source_type=source_type,
        availability=WeeklyAvailability(**availability_payload),
        summary=_summarise_availability(availability_payload),
        warnings=warnings,
    )


@router.put("/me/preferences", response_model=UserDB)
async def update_preferences(
    prefs: PreferencesUpdate,
    current_user: UserDB = Depends(get_current_user),
):
    users_col = get_users_col()
    update_fields = prefs.model_dump(exclude_unset=True)

    if update_fields:
        await users_col.update_one(
            {"supabase_id": current_user.supabase_id},
            {"$set": update_fields},
        )
        for key, value in update_fields.items():
            setattr(current_user, key, value)

    return current_user


@router.delete("/me", response_model=DeleteAccountResponse)
async def delete_account(
    current_user: UserDB = Depends(get_current_user),
):
    await _delete_supabase_auth_user(current_user)

    user_id = str(current_user.id)
    users_col = get_users_col()
    goals_col = get_goals_col()
    tasks_col = get_tasks_col()
    skills_col = get_skills_col()
    mentor_col = get_mentor_sessions_col()
    rooms_col = get_rooms_col()
    db = get_database()
    members_col = db.community_members
    posts_col = db.community_posts

    owned_room_docs = await rooms_col.find(
        {"created_by": current_user.supabase_id},
        {"_id": 1},
    ).to_list(length=None)
    owned_room_ids = [str(doc["_id"]) for doc in owned_room_docs]
    owned_room_oids = [doc["_id"] for doc in owned_room_docs]

    member_docs = await members_col.find(
        {"user_id": current_user.supabase_id},
        {"room_id": 1},
    ).to_list(length=None)
    membership_counts: dict[str, int] = {}
    for doc in member_docs:
        room_id = doc.get("room_id")
        if not room_id or room_id in owned_room_ids:
            continue
        membership_counts[room_id] = membership_counts.get(room_id, 0) + 1

    await goals_col.delete_many({"user_id": user_id})
    await tasks_col.delete_many({"user_id": user_id})
    await skills_col.delete_many({"user_id": user_id})
    await mentor_col.delete_many({"user_id": {"$in": [user_id, current_user.supabase_id]}})

    if owned_room_ids:
        await posts_col.delete_many({"room_id": {"$in": owned_room_ids}})
        await members_col.delete_many({"room_id": {"$in": owned_room_ids}})
        await rooms_col.delete_many({"_id": {"$in": owned_room_oids}})

    await posts_col.delete_many({"user_id": current_user.supabase_id})
    await members_col.delete_many({"user_id": current_user.supabase_id})

    for room_id, count in membership_counts.items():
        try:
            room_filter = {"_id": ObjectId(room_id)}
        except Exception:
            room_filter = {"_id": room_id}

        await rooms_col.update_one(
            room_filter,
            {"$inc": {"member_count": -count}},
        )

    await users_col.delete_one({"supabase_id": current_user.supabase_id})

    return DeleteAccountResponse(message="Account deleted.")


@router.get("/me/stats")
async def get_user_stats(current_user: UserDB = Depends(get_current_user)):
    goals_col = get_goals_col()

    active_goals_count = await goals_col.count_documents(
        {
            "user_id": str(current_user.id),
            "status": "active",
        }
    )

    pipeline = [
        {"$match": {"user_id": str(current_user.id)}},
        {"$unwind": "$phases"},
        {"$unwind": "$phases.topics"},
        {"$match": {"phases.topics.status": "done"}},
        {"$count": "total"},
    ]
    cursor = goals_col.aggregate(pipeline)
    total_topics_done_list = await cursor.to_list(length=1)
    total_topics_done_count = total_topics_done_list[0]["total"] if total_topics_done_list else 0

    return {
        "streak_count": current_user.streak_count,
        "total_topics_done": total_topics_done_count,
        "active_goals_count": active_goals_count,
    }
