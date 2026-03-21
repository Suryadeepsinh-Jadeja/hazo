"""
seed_demo.py — Seed a complete demo user for Stride.

Usage:
    cd apps/api
    python -m scripts.seed_demo --email demo@stride.app --password Demo1234!

Creates:
  - Supabase auth user
  - MongoDB: UserDB, GoalDB (4 phases), 8 SkillDB, 3 TaskDB
  - Redis: daily task card for today
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, date

import httpx
import redis.asyncio as aioredis
from bson import ObjectId
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip('"')
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip('"')
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

logger = logging.getLogger("stride.seed_demo")
logging.basicConfig(level=logging.INFO)

NOW = datetime.utcnow()
TODAY = date.today()


# ---------------------------------------------------------------------------
# Supabase admin helper
# ---------------------------------------------------------------------------

async def create_supabase_user(email: str, password: str) -> str:
    """Create a Supabase auth user via admin API. Returns the user UUID."""
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        # Try to create user
        resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=headers,
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"name": "Demo User"},
            },
        )
        if resp.status_code in (200, 201):
            return resp.json()["id"]

        # User already exists — sign in to get the ID
        logger.info("User already registered, signing in to retrieve ID …")
        sign_in = await client.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": SUPABASE_SERVICE_KEY, "Content-Type": "application/json"},
            json={"email": email, "password": password},
        )
        if sign_in.status_code == 200:
            return sign_in.json()["user"]["id"]

        raise RuntimeError(
            f"Could not create or sign in as {email}. "
            f"Create: {resp.status_code} {resp.text[:200]}, "
            f"SignIn: {sign_in.status_code} {sign_in.text[:200]}"
        )


# ---------------------------------------------------------------------------
# Data builders
# ---------------------------------------------------------------------------

def _rid() -> str:
    return str(uuid.uuid4())


def _resource(rtype: str, title: str, url: str, source: str) -> dict:
    return {
        "resource_id": _rid(),
        "type": rtype,
        "title": title,
        "url": url,
        "source": source,
        "is_free": True,
        "verified_at": NOW,
        "is_broken": False,
    }


def _topic(
    tid: str, title: str, day_index: int, status: str,
    yt_title: str, yt_url: str,
    lc_title: str, lc_url: str,
    est_min: int = 90,
    completed_at=None,
) -> dict:
    return {
        "topic_id": tid,
        "title": title,
        "day_index": day_index,
        "estimated_minutes": est_min,
        "ai_note": f"Master {title.lower()} — core building block for SDE interviews.",
        "resource_queries": [f"{title} tutorial", f"{title} leetcode"],
        "resources": [
            _resource("video", yt_title, yt_url, "youtube"),
            _resource("problem", lc_title, lc_url, "leetcode"),
        ],
        "practice_links": [],
        "ai_generated_notes": None,
        "status": status,
        "completed_at": completed_at,
    }


def _locked_topic(tid: str, title: str, day_index: int, est_min: int = 90) -> dict:
    return {
        "topic_id": tid,
        "title": title,
        "day_index": day_index,
        "estimated_minutes": est_min,
        "ai_note": f"Upcoming: {title.lower()}.",
        "resource_queries": [f"{title} tutorial", f"{title} problems"],
        "resources": [],
        "practice_links": [],
        "ai_generated_notes": None,
        "status": "locked",
        "completed_at": None,
    }


def build_phases() -> list:
    """Build all 4 phases with topics."""

    # ── Phase 1: Foundations (30 days) ────────────────────────────────────
    phase1_topics = [
        _topic("t1", "Arrays Basics", 0, "done",
               "Abdul Bari — Arrays", "https://www.youtube.com/watch?v=n60Dn0UsbEk",
               "LeetCode — Two Sum", "https://leetcode.com/problems/two-sum/",
               completed_at=NOW - timedelta(days=14)),
        _topic("t2", "String Manipulation", 1, "done",
               "String Manipulation Tutorial", "https://www.youtube.com/watch?v=xyqNr6vXJhw",
               "LeetCode — Valid Anagram", "https://leetcode.com/problems/valid-anagram/",
               completed_at=NOW - timedelta(days=13)),
        _topic("t3", "Two Pointers", 2, "done",
               "NeetCode — Two Pointers", "https://www.youtube.com/watch?v=On03HWe2tZM",
               "LeetCode — Container With Most Water", "https://leetcode.com/problems/container-with-most-water/",
               completed_at=NOW - timedelta(days=12)),
        _topic("t4", "Sliding Window", 3, "done",
               "NeetCode — Sliding Window", "https://www.youtube.com/watch?v=MK-NZ4hN7rs",
               "LeetCode — Longest Substring Without Repeating Characters",
               "https://leetcode.com/problems/longest-substring-without-repeating-characters/",
               completed_at=NOW - timedelta(days=11)),
        _topic("t5", "Linked Lists", 4, "done",
               "Abdul Bari — Linked Lists", "https://www.youtube.com/watch?v=Nq7ok-OyEpg",
               "LeetCode — Reverse Linked List", "https://leetcode.com/problems/reverse-linked-list/",
               completed_at=NOW - timedelta(days=10)),
        _topic("t6", "Stacks", 5, "done",
               "Abdul Bari — Stacks", "https://www.youtube.com/watch?v=I37kGX-nZEI",
               "LeetCode — Valid Parentheses", "https://leetcode.com/problems/valid-parentheses/",
               completed_at=NOW - timedelta(days=9)),
        _topic("t7", "Queues", 6, "done",
               "Queues Tutorial", "https://www.youtube.com/watch?v=zp6pBNbUB2U",
               "LeetCode — Implement Queue Using Stacks",
               "https://leetcode.com/problems/implement-queue-using-stacks/",
               completed_at=NOW - timedelta(days=7)),
        _topic("t8", "Recursion Basics", 7, "done",
               "Abdul Bari — Recursion", "https://www.youtube.com/watch?v=kepBmgvWNDw",
               "LeetCode — Climbing Stairs", "https://leetcode.com/problems/climbing-stairs/",
               completed_at=NOW - timedelta(days=6)),
        _topic("t9", "Binary Search", 8, "done",
               "NeetCode — Binary Search", "https://www.youtube.com/watch?v=V_T5NuccgRA",
               "LeetCode — Binary Search", "https://leetcode.com/problems/binary-search/",
               completed_at=NOW - timedelta(days=3)),
        _topic("t10", "Trees Introduction", 9, "in_progress",
               "Abdul Bari — Trees", "https://www.youtube.com/watch?v=qH6yxkw0u78",
               "LeetCode — Invert Binary Tree", "https://leetcode.com/problems/invert-binary-tree/"),
    ]

    phase1 = {
        "phase_id": "p1",
        "title": "Foundations",
        "duration_days": 30,
        "topics": phase1_topics,
    }

    # ── Phase 2: Core Algorithms (45 days) ────────────────────────────────
    p2_titles = [
        "Tree Traversals", "BST", "Heaps", "Hashing",
        "Graphs BFS", "Graphs DFS", "Topological Sort", "Shortest Path",
        "DP Intro", "1D DP", "2D DP",
        "Greedy Algorithms", "Divide and Conquer", "Backtracking", "Tries",
    ]
    phase2 = {
        "phase_id": "p2",
        "title": "Core Algorithms",
        "duration_days": 45,
        "topics": [
            _locked_topic(f"t{10+i+1}", title, 10 + i)
            for i, title in enumerate(p2_titles)
        ],
    }

    # ── Phase 3: Advanced Topics (30 days) ────────────────────────────────
    p3_titles = [
        "Segment Trees", "Fenwick Trees", "Union Find",
        "Advanced Graphs", "String Algorithms", "Bit Manipulation",
        "Math & Number Theory", "System Design Basics",
        "OOP Design Patterns", "Concurrency Fundamentals",
    ]
    p3_start = 10 + len(p2_titles)
    phase3 = {
        "phase_id": "p3",
        "title": "Advanced Topics",
        "duration_days": 30,
        "topics": [
            _locked_topic(f"t{p3_start+i+1}", title, p3_start + i)
            for i, title in enumerate(p3_titles)
        ],
    }

    # ── Phase 4: Interview Prep (15 days) ─────────────────────────────────
    p4_titles = [
        "Mock Interviews", "Behavioral Questions", "System Design Deep Dive",
        "Resume Review", "Company-Specific Prep",
    ]
    p4_start = p3_start + len(p3_titles)
    phase4 = {
        "phase_id": "p4",
        "title": "Interview Prep",
        "duration_days": 15,
        "topics": [
            _locked_topic(f"t{p4_start+i+1}", title, p4_start + i)
            for i, title in enumerate(p4_titles)
        ],
    }

    return [phase1, phase2, phase3, phase4]


def build_goal(user_id: str) -> dict:
    return {
        "user_id": user_id,
        "title": "Crack Google SDE Interview by December 2026",
        "domain": "swe_career",
        "timeline_start": NOW - timedelta(days=9),
        "timeline_target": NOW + timedelta(days=111),  # ~120 days total
        "total_days": 120,
        "intake": {
            "daily_hours": 2.5,
            "prior_knowledge": "Basic programming in Python, some math background",
            "budget": "free",
            "external_materials": None,
            "domain_specific_answer": "Targeting Google L4/L5 SDE role",
        },
        "phases": build_phases(),
        "current_phase_index": 0,
        "current_day_index": 9,
        "status": "active",
        "community_room_id": None,
        "created_at": NOW - timedelta(days=9),
        "updated_at": NOW,
    }


def build_skills(user_id: str, goal_id: str) -> list:
    skills_data = [
        ("Arrays", 85), ("Strings", 70), ("LinkedList", 65), ("Stacks", 50),
        ("Queues", 35), ("Recursion", 40), ("BinarySearch", 30), ("Trees", 10),
    ]
    result = []
    for name, mastery in skills_data:
        result.append({
            "user_id": user_id,
            "goal_id": goal_id,
            "name": name,
            "domain": "swe_career",
            "prerequisite_skill_ids": [],
            "mastery_level": mastery,
            "mastery_history": [{"date": NOW.isoformat(), "level": mastery}],
            "tasks_completed": mastery // 10,
            "last_practiced": NOW - timedelta(days=1),
            "decay_rate": 0.5,
        })
    return result


def build_tasks(user_id: str, goal_id: str) -> list:
    today_dt = datetime.combine(TODAY, datetime.min.time())
    tomorrow_dt = today_dt + timedelta(days=1)
    this_week_dt = today_dt + timedelta(days=5)

    return [
        {
            "user_id": user_id,
            "raw_input": "Review Recursion notes before tomorrow's class",
            "due_date": today_dt,
            "priority": "high",
            "estimated_minutes": 45,
            "ai_subtasks": [
                {"subtask_id": _rid(), "title": "Re-read recursion tree diagrams", "estimated_minutes": 20, "status": "pending", "completed_at": None},
                {"subtask_id": _rid(), "title": "Solve 2 warm-up recursion problems", "estimated_minutes": 25, "status": "pending", "completed_at": None},
            ],
            "linked_goal_id": goal_id,
            "status": "pending",
            "created_at": NOW,
        },
        {
            "user_id": user_id,
            "raw_input": "Submit assignment 4 for DSA lab",
            "due_date": tomorrow_dt,
            "priority": "high",
            "estimated_minutes": 90,
            "ai_subtasks": [
                {"subtask_id": _rid(), "title": "Read the problem statement", "estimated_minutes": 10, "status": "pending", "completed_at": None},
                {"subtask_id": _rid(), "title": "Implement the solution", "estimated_minutes": 40, "status": "pending", "completed_at": None},
                {"subtask_id": _rid(), "title": "Test with edge cases", "estimated_minutes": 20, "status": "pending", "completed_at": None},
                {"subtask_id": _rid(), "title": "Write comments and submit", "estimated_minutes": 20, "status": "pending", "completed_at": None},
            ],
            "linked_goal_id": goal_id,
            "status": "pending",
            "created_at": NOW,
        },
        {
            "user_id": user_id,
            "raw_input": "Watch lecture recording from last week",
            "due_date": this_week_dt,
            "priority": "medium",
            "estimated_minutes": 60,
            "ai_subtasks": [
                {"subtask_id": _rid(), "title": "Watch at 1.5x speed, take notes", "estimated_minutes": 60, "status": "pending", "completed_at": None},
            ],
            "linked_goal_id": goal_id,
            "status": "pending",
            "created_at": NOW,
        },
    ]


def build_user(supabase_id: str, email: str) -> dict:
    return {
        "supabase_id": supabase_id,
        "email": email,
        "name": "Demo User",
        "timezone": "Asia/Kolkata",
        "preferred_reminder_time": "08:00",
        "push_token": None,
        "availability": {
            "monday": [{"start": "09:00", "end": "11:30"}],
            "tuesday": [{"start": "09:00", "end": "11:30"}],
            "wednesday": [{"start": "09:00", "end": "11:30"}],
            "thursday": [{"start": "09:00", "end": "11:30"}],
            "friday": [{"start": "09:00", "end": "11:30"}],
            "saturday": [{"start": "10:00", "end": "13:00"}],
            "sunday": [{"start": "10:00", "end": "13:00"}],
        },
        "streak_count": 9,
        "longest_streak": 14,
        "last_active_date": NOW,
        "plan": "free",
        "created_at": NOW - timedelta(days=14),
    }


def build_daily_card(user_id: str, goal_id: str, goal_doc: dict) -> dict:
    """Build today's DailyTaskCard for Redis cache."""
    today_topic = goal_doc["phases"][0]["topics"][9]  # Trees Introduction
    return {
        "goal_id": goal_id,
        "goal_title": goal_doc["title"],
        "date": TODAY.isoformat(),
        "topics": [today_topic],
        "available_minutes": 150,
        "task_mode_count": 1,
        "phase_title": "Foundations",
        "day_index": 9,
        "total_days": 120,
    }


# ---------------------------------------------------------------------------
# Main seeder
# ---------------------------------------------------------------------------

async def seed(email: str, password: str) -> None:
    logger.info("Creating Supabase user %s …", email)
    supabase_id = await create_supabase_user(email, password)
    logger.info("Supabase user ID: %s", supabase_id)

    # MongoDB
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client.stride

    # Clean existing demo data for this user
    existing_user = await db.users.find_one({"supabase_id": supabase_id})
    if existing_user:
        uid = supabase_id
        await db.goals.delete_many({"user_id": uid})
        await db.skills.delete_many({"user_id": uid})
        await db.tasks.delete_many({"user_id": uid})
        await db.users.delete_one({"supabase_id": supabase_id})
        logger.info("Cleaned existing demo data.")

    # Insert user
    user_doc = build_user(supabase_id, email)
    await db.users.insert_one(user_doc)
    logger.info("Inserted UserDB.")

    # Insert goal
    goal_doc = build_goal(supabase_id)
    result = await db.goals.insert_one(goal_doc)
    goal_id = str(result.inserted_id)
    logger.info("Inserted GoalDB: %s", goal_id)

    # Insert skills
    skills = build_skills(supabase_id, goal_id)
    await db.skills.insert_many(skills)
    logger.info("Inserted %d SkillDB entries.", len(skills))

    # Insert tasks
    tasks = build_tasks(supabase_id, goal_id)
    await db.tasks.insert_many(tasks)
    logger.info("Inserted %d TaskDB entries.", len(tasks))

    # Cache today's daily task card in Redis
    try:
        rdb = aioredis.from_url(REDIS_URL, decode_responses=True)
        card = build_daily_card(supabase_id, goal_id, goal_doc)
        cache_key = f"daily:task:{supabase_id}:{goal_id}"
        await rdb.setex(cache_key, 36 * 3600, json.dumps(card, default=str))
        await rdb.close()
        logger.info("Cached DailyTaskCard in Redis.")
    except Exception as exc:
        logger.warning("Redis cache failed (non-fatal): %s", exc)

    print(f"\n✅ Demo user ready: {email} / {password}")
    print(f"   Supabase ID : {supabase_id}")
    print(f"   Goal ID     : {goal_id}")
    print(f"   Skills      : 8")
    print(f"   Tasks       : 3")
    print(f"   Streak      : 9 days\n")


def main():
    parser = argparse.ArgumentParser(description="Seed demo data for Stride")
    parser.add_argument("--email", default="demo@stride.app")
    parser.add_argument("--password", default="Demo1234!")
    args = parser.parse_args()
    asyncio.run(seed(args.email, args.password))


if __name__ == "__main__":
    main()
