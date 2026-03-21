"""
nightly_scheduler.py — Nightly task scheduler for Stride.

Runs every hour via APScheduler.  When triggered, finds all users whose
local time is between 22:00 and 22:59 and generates the next day's
DailyTaskCard for each of their active goals.

Includes:
  - Smart topic selection based on user availability
  - Anti-procrastination push notifications (3+ consecutive skips)
  - Auto-replan via Gemini after 5+ consecutive skips
  - Streak decay for inactive users
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, date, timedelta, time as dt_time
from typing import Any, Dict, List, Optional

import httpx
import redis.asyncio as aioredis
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()

# Ensure packages/ is importable
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from db.database import get_users_col, get_goals_col, get_tasks_col
from db.models import UserDB, GoalDB, WeeklyAvailability
from packages.ai.gemini_client import call_gemini_json
from packages.ai.prompts import anti_procrastination_prompt, replan_prompt

logger = logging.getLogger("stride.jobs.nightly")

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(_REDIS_URL, decode_responses=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_day_name(dt: datetime) -> str:
    """Return lowercase weekday name: 'monday' through 'sunday'."""
    return dt.strftime("%A").lower()


def parse_time(hhmm: str) -> dt_time:
    """Parse 'HH:MM' → datetime.time."""
    parts = hhmm.strip().split(":")
    return dt_time(int(parts[0]), int(parts[1]))


def parse_time_blocks(blocks: list) -> int:
    """Sum total available minutes from a list of TimeBlock dicts."""
    total = 0
    for b in blocks:
        start = parse_time(b.get("start", "08:00") if isinstance(b, dict) else b.start)
        end = parse_time(b.get("end", "09:00") if isinstance(b, dict) else b.end)
        start_dt = datetime.combine(date.today(), start)
        end_dt = datetime.combine(date.today(), end)
        diff = (end_dt - start_dt).seconds // 60
        if diff > 0:
            total += diff
    return total


def compute_remaining_days(target_date: datetime) -> int:
    """Days left until the goal's target date (min 1)."""
    delta = (target_date - datetime.utcnow()).days
    return max(delta, 1)


# ---------------------------------------------------------------------------
# Push notification helper (Expo / FCM)
# ---------------------------------------------------------------------------


async def send_push(
    token: Optional[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> None:
    """Fire-and-forget push via Expo push API.  Never raises."""
    if not token:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                "https://exp.host/--/api/v2/push/send",
                json={
                    "to": token,
                    "sound": "default",
                    "title": title,
                    "body": body,
                    "data": data or {},
                },
            )
    except Exception as exc:
        logger.warning("Push notification failed for token %s: %s", token[:12], exc)


# ---------------------------------------------------------------------------
# Core algorithm: scheduleTaskForTomorrow
# ---------------------------------------------------------------------------


async def schedule_task_for_tomorrow(
    user_doc: dict,
    goal_doc: dict,
) -> None:
    """Generate tomorrow's DailyTaskCard for a single user × goal pair."""
    rdb = _get_redis()
    user_id = user_doc.get("supabase_id", str(user_doc["_id"]))
    goal_id = str(goal_doc["_id"])

    # ── Step 1: Available minutes tomorrow ────────────────────────────────
    tomorrow = datetime.utcnow() + timedelta(days=1)
    tomorrow_name = get_day_name(tomorrow)
    tomorrow_str = tomorrow.strftime("%Y-%m-%d")

    availability = user_doc.get("availability", {})
    blocks = []
    if isinstance(availability, dict):
        blocks = availability.get(tomorrow_name, [])
    elif hasattr(availability, tomorrow_name):
        blocks = getattr(availability, tomorrow_name, [])

    daily_hours = goal_doc.get("intake", {}).get("daily_hours", 2.0)

    if blocks:
        available_minutes = parse_time_blocks(blocks)
    else:
        available_minutes = int(daily_hours * 60)

    # ── Step 2: Subtract task-mode budget ─────────────────────────────────
    tasks_col = get_tasks_col()
    tomorrow_start = datetime.combine(tomorrow.date(), dt_time.min)
    tomorrow_end = datetime.combine(tomorrow.date(), dt_time.max)

    pending_tasks_cursor = tasks_col.find({
        "user_id": user_id,
        "status": "pending",
        "$or": [
            {"due_date": {"$lte": tomorrow_end, "$gte": tomorrow_start}},
            {"due_date": {"$lt": tomorrow_start}},  # overdue
        ],
    })
    pending_tasks = await pending_tasks_cursor.to_list(length=100)

    task_budget = min(
        sum(t.get("estimated_minutes", 30) for t in pending_tasks),
        int(available_minutes * 0.5),
    )
    goal_minutes = max(15, available_minutes - task_budget)

    # ── Step 3: Select topics that fit ────────────────────────────────────
    phases = goal_doc.get("phases", [])
    current_day_index = goal_doc.get("current_day_index", 0)

    # Flatten all topics with their phase context
    all_topics: List[dict] = []
    phase_map: Dict[int, dict] = {}  # day_index → phase
    for phase in phases:
        for topic in phase.get("topics", []):
            all_topics.append(topic)
            phase_map[topic.get("day_index", -1)] = phase

    # Sort by day_index to walk in order
    all_topics.sort(key=lambda t: t.get("day_index", 0))

    selected_topics: List[dict] = []
    remaining_minutes = goal_minutes
    phase_title = ""

    for topic in all_topics:
        if topic.get("day_index", 0) < current_day_index:
            continue  # already past
        if topic.get("status") not in ("pending", "locked"):
            continue  # already done or skipped

        est = topic.get("estimated_minutes", 60)
        if est <= remaining_minutes:
            selected_topics.append(topic)
            remaining_minutes -= est
            if not phase_title and topic.get("day_index") in phase_map:
                phase_title = phase_map[topic["day_index"]].get("title", "")

            # Try to include one more small topic if room
            if remaining_minutes <= 30:
                break
        else:
            break  # next topic too big

    if not selected_topics:
        # All topics completed or none fit — skip gracefully
        logger.info("No topics to schedule for user %s goal %s", user_id, goal_id)
        return

    # Mark selected topics as in_progress in MongoDB
    goals_col = get_goals_col()
    for topic in selected_topics:
        tid = topic.get("topic_id")
        await goals_col.update_one(
            {"_id": goal_doc["_id"], "phases.topics.topic_id": tid},
            {"$set": {"phases.$[].topics.$[t].status": "in_progress"}},
            array_filters=[{"t.topic_id": tid}],
        )

    # ── Step 4: Build and cache DailyTaskCard ─────────────────────────────
    card = {
        "goal_id": goal_id,
        "goal_title": goal_doc.get("title", ""),
        "date": tomorrow_str,
        "topics": selected_topics,
        "available_minutes": goal_minutes,
        "task_mode_count": len(pending_tasks),
        "phase_title": phase_title,
        "day_index": current_day_index,
        "total_days": goal_doc.get("total_days", 30),
    }

    cache_key = f"daily:task:{user_id}:{goal_id}"
    await rdb.setex(cache_key, 36 * 3600, json.dumps(card, default=str))

    # ── Step 5: Anti-procrastination check ────────────────────────────────
    consecutive_skips = 0
    for topic in reversed(all_topics):
        if topic.get("day_index", 0) >= current_day_index:
            continue
        if topic.get("status") == "skipped":
            consecutive_skips += 1
        else:
            break

    push_token = user_doc.get("push_token")

    if consecutive_skips >= 3:
        # Count completed vs total for notification context
        completed_count = sum(
            1 for t in all_topics if t.get("status") == "done"
        )
        total_count = len(all_topics)

        # Use first selected topic's info for the nudge
        first_topic = selected_topics[0]
        resource_url = ""
        resources = first_topic.get("resources", [])
        if resources:
            resource_url = resources[0].get("url", "") if isinstance(resources[0], dict) else ""

        try:
            notif = await call_gemini_json(
                anti_procrastination_prompt(
                    topic_title=first_topic.get("title", ""),
                    completed_count=completed_count,
                    total_count=total_count,
                    resource_url=resource_url,
                )
            )
            msg = notif.get("message", "")
            if msg:
                await send_push(push_token, "Stride", msg, {"screen": "home"})
        except Exception as exc:
            logger.warning("Anti-procrastination nudge failed: %s", exc)

    if consecutive_skips >= 5:
        replan_key = f"replan:done:{user_id}:{goal_id}"
        already_replanned = await rdb.get(replan_key)
        if not already_replanned:
            # Gather skipped topic info
            skipped_topics = [
                {
                    "topic_id": t.get("topic_id", ""),
                    "title": t.get("title", ""),
                    "estimated_minutes": t.get("estimated_minutes", 60),
                    "prerequisites": [],
                }
                for t in all_topics
                if t.get("status") == "skipped"
            ]
            remaining_days = compute_remaining_days(
                goal_doc.get("timeline_target", datetime.utcnow() + timedelta(days=30))
            )

            try:
                data = await call_gemini_json(
                    replan_prompt(
                        skipped_topics=skipped_topics,
                        remaining_days=remaining_days,
                        daily_hours=daily_hours,
                    )
                )
                await apply_replan(goal_doc, data)
                # Block replanning for 3 days
                await rdb.setex(replan_key, 3 * 86400, "1")
                logger.info("Replan applied for user %s goal %s", user_id, goal_id)
            except Exception as exc:
                logger.warning("Replan failed for user %s goal %s: %s", user_id, goal_id, exc)

    # ── Step 6: Streak decay ──────────────────────────────────────────────
    last_active = user_doc.get("last_active_date")
    today = date.today()
    yesterday = today - timedelta(days=1)

    if last_active:
        if isinstance(last_active, datetime):
            last_active_date = last_active.date()
        else:
            last_active_date = last_active

        if last_active_date != today and last_active_date != yesterday:
            users_col = get_users_col()
            await users_col.update_one(
                {"_id": user_doc["_id"]},
                {"$set": {"streak_count": 0}},
            )


# ---------------------------------------------------------------------------
# Replan applier
# ---------------------------------------------------------------------------


async def apply_replan(goal_doc: dict, replan_data: dict) -> None:
    """Apply redistributed day indices from replan_prompt output."""
    redistributed = replan_data.get("redistributed", [])
    if not redistributed:
        return

    goals_col = get_goals_col()
    for entry in redistributed:
        tid = entry.get("topic_id")
        new_day = entry.get("new_day_index")
        if tid is None or new_day is None:
            continue
        await goals_col.update_one(
            {"_id": goal_doc["_id"], "phases.topics.topic_id": tid},
            {
                "$set": {
                    "phases.$[].topics.$[t].day_index": new_day,
                    "phases.$[].topics.$[t].status": "pending",
                }
            },
            array_filters=[{"t.topic_id": tid}],
        )


# ---------------------------------------------------------------------------
# Hourly job: find users in 22:00–22:59 local time
# ---------------------------------------------------------------------------


async def run_nightly_scheduler() -> None:
    """Main entry point called every hour by APScheduler."""
    logger.info("Nightly scheduler triggered at %s UTC", datetime.utcnow().isoformat())

    users_col = get_users_col()
    goals_col = get_goals_col()

    # We need to find users whose local time is 22:xx right now.
    # Strategy: for each known timezone offset, check if UTC + offset → 22:xx.
    # Since we store timezone as IANA string, we use a simpler approach:
    # iterate all users and filter in Python.

    try:
        import zoneinfo
    except ImportError:
        from backports import zoneinfo  # type: ignore[no-redef]

    utc_now = datetime.utcnow()

    cursor = users_col.find({})
    processed = 0

    async for user_doc in cursor:
        try:
            tz_name = user_doc.get("timezone", "Asia/Kolkata")
            try:
                tz = zoneinfo.ZoneInfo(tz_name)
            except Exception:
                tz = zoneinfo.ZoneInfo("Asia/Kolkata")

            # Current local time for this user
            local_now = utc_now.astimezone(tz) if utc_now.tzinfo else utc_now.replace(
                tzinfo=zoneinfo.ZoneInfo("UTC")
            ).astimezone(tz)

            if local_now.hour != 22:
                continue  # Not 10 PM for this user yet

            user_id = user_doc.get("supabase_id", str(user_doc["_id"]))

            # Find all active goals for this user
            active_goals = await goals_col.find(
                {"user_id": user_id, "status": "active"}
            ).to_list(length=20)

            for goal_doc in active_goals:
                try:
                    await schedule_task_for_tomorrow(user_doc, goal_doc)
                    processed += 1
                except Exception as exc:
                    logger.error(
                        "Failed to schedule for user %s goal %s: %s",
                        user_id,
                        str(goal_doc["_id"]),
                        exc,
                    )

        except Exception as exc:
            logger.error(
                "Nightly scheduler error for user %s: %s",
                str(user_doc.get("_id", "?")),
                exc,
            )

    logger.info("Nightly scheduler completed: %d goal-cards generated.", processed)


# ---------------------------------------------------------------------------
# APScheduler setup (called from main.py lifespan)
# ---------------------------------------------------------------------------


_scheduler = None


def start_scheduler() -> None:
    """Start the APScheduler with the hourly nightly job."""
    global _scheduler
    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        run_nightly_scheduler,
        "interval",
        hours=1,
        id="nightly",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("APScheduler started — nightly job runs every hour.")


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped.")
