"""
goals.py — all goal and roadmap endpoints for Stride.

Endpoints:
  POST   /onboard/start
  POST   /onboard/q6
  POST   /onboard/complete
  GET    /onboard/status/{session_id}
  GET    /                             (list active goals)
  GET    /{goal_id}                    (full goal detail)
  GET    /{goal_id}/today
  POST   /{goal_id}/topics/{topic_id}/complete
  POST   /{goal_id}/topics/{topic_id}/skip
  POST   /{goal_id}/replan
"""

import asyncio
import json
import logging
import os
import re
import sys
import uuid
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional

import httpx
import redis.asyncio as aioredis
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel

from core.auth import get_current_user
from db.database import get_goals_col, get_skills_col, get_users_col
from db.models import GoalDB, GoalIntake, Phase, Resource, SkillDB, Topic, UserDB

# Add the repo root to the path so `packages` is importable from apps/api
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from packages.ai.gemini_client import call_gemini, call_gemini_json
from packages.ai.prompts import (
    domain_classify_prompt,
    q6_prompt,
    replan_prompt,
    resource_curation_prompt,
    roadmap_generation_prompt,
)

load_dotenv()
logger = logging.getLogger("stride.routers.goals")
router = APIRouter(prefix="/goals")

# ---------------------------------------------------------------------------
# Redis client (lazy singleton)
# ---------------------------------------------------------------------------

_redis: Optional[aioredis.Redis] = None

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


# ---------------------------------------------------------------------------
# Domain question sets  (Q1–Q5)
# ---------------------------------------------------------------------------

DOMAIN_QUESTIONS: Dict[str, List[Dict[str, str]]] = {
    "competitive_programming": [
        {
            "field_name": "timelineWeeks",
            "question_text": "How many weeks do you have until your target contest or deadline?",
        },
        {
            "field_name": "dsaLevel",
            "question_text": "What is your current DSA level? (none / basics / intermediate / advanced)",
        },
        {
            "field_name": "dailyHours",
            "question_text": "How many hours per day can you dedicate to practice?",
        },
        {
            "field_name": "budget",
            "question_text": "Are you using free resources only, or are you open to paid platforms?",
        },
        {
            "field_name": "existingResources",
            "question_text": "Which resources do you already use? (e.g. NeetCode, Udemy, Striver, self-study, none)",
        },
    ],
    "academic_exam": [
        {
            "field_name": "examNameAndDate",
            "question_text": "What exam are you preparing for, and what is the exam date? (e.g. GATE CSE, 2 Feb 2026)",
        },
        {
            "field_name": "currentScore",
            "question_text": "What is your current mock test score or performance level? (e.g. 42/100 in last mock)",
        },
        {
            "field_name": "dailyHours",
            "question_text": "How many hours per day can you study?",
        },
        {
            "field_name": "budget",
            "question_text": "Are you using free resources only, or can you invest in paid materials?",
        },
        {
            "field_name": "hasSyllabus",
            "question_text": "Do you have the official syllabus or previous-year question papers? (yes / no)",
        },
    ],
    "swe_career": [
        {
            "field_name": "targetTier",
            "question_text": "What company tier are you targeting? (FAANG / top-mid-tier / startup)",
        },
        {
            "field_name": "timeline",
            "question_text": "When do you want to land the job? (e.g. in 3 months, Q3 2026)",
        },
        {
            "field_name": "experienceLevel",
            "question_text": "What is your current experience level? (student / 0–2 yrs / 2–5 yrs / senior)",
        },
        {
            "field_name": "dailyHours",
            "question_text": "How many hours per day can you dedicate to prep?",
        },
        {
            "field_name": "budget",
            "question_text": "Are you open to paid resources (e.g. LeetCode Premium, Grokking courses)?",
        },
    ],
    "fitness": [
        {
            "field_name": "specificGoal",
            "question_text": "What is your specific fitness target? (e.g. run a 5K in under 30 min, lose 10 kg, bench 100 kg)",
        },
        {
            "field_name": "currentFitnessLevel",
            "question_text": "How would you describe your current fitness level? (sedentary / lightly active / moderately active / athlete)",
        },
        {
            "field_name": "hoursPerWeek",
            "question_text": "How many hours per week can you train?",
        },
        {
            "field_name": "gymAccess",
            "question_text": "Do you have gym access, or are you training at home / outdoors?",
        },
        {
            "field_name": "injuries",
            "question_text": "Do you have any current injuries or physical limitations I should design around?",
        },
    ],
    "language_learning": [
        {
            "field_name": "targetLanguage",
            "question_text": "Which language are you learning?",
        },
        {
            "field_name": "currentLevel",
            "question_text": "What is your current level in that language? (complete beginner / A1 / A2 / B1 / B2 / C1)",
        },
        {
            "field_name": "dailyHours",
            "question_text": "How many hours per day can you study?",
        },
        {
            "field_name": "purpose",
            "question_text": "Why are you learning this language? (travel / work / exam like IELTS / living abroad / hobby)",
        },
        {
            "field_name": "nativeLanguage",
            "question_text": "What is your native language? (This helps me tailor pronunciation and grammar explanations.)",
        },
    ],
    "web_development": [
        {
            "field_name": "track",
            "question_text": "Are you focusing on frontend, backend, or full-stack development?",
        },
        {
            "field_name": "currentStack",
            "question_text": "What technologies do you already know? (e.g. basic HTML/CSS, React, Node.js, none)",
        },
        {
            "field_name": "projectGoal",
            "question_text": "What is the end product you want to build? (e.g. a personal portfolio, a SaaS MVP, a REST API)",
        },
        {
            "field_name": "dailyHours",
            "question_text": "How many hours per day can you commit to learning and building?",
        },
        {
            "field_name": "budget",
            "question_text": "Are you open to paid courses or tools (e.g. Udemy, GitHub Copilot)?",
        },
    ],
    "other": [
        {
            "field_name": "timeline",
            "question_text": "What is your target timeline? (e.g. 3 months, by December 2026)",
        },
        {
            "field_name": "knowledgeLevel",
            "question_text": "How would you describe your current knowledge in this area? (complete beginner / some experience / intermediate / advanced)",
        },
        {
            "field_name": "dailyHours",
            "question_text": "How many hours per day can you dedicate to this goal?",
        },
        {
            "field_name": "budget",
            "question_text": "Do you have a budget for courses, tools, or materials?",
        },
        {
            "field_name": "existingMaterials",
            "question_text": "Do you already have any books, courses, or resources lined up? If yes, list them.",
        },
    ],
}

# Domains without dedicated question sets fall back to "other"
_QUESTION_FALLBACK_DOMAINS = {
    "data_science": "other",
    "design": "other",
    "entrepreneurship": "other",
}

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

_ROADMAP_XML_RE = re.compile(r"<roadmap>(.*?)</roadmap>", re.DOTALL)


def _extract_roadmap_json(raw: str) -> dict:
    """Pull the JSON out of <roadmap>…</roadmap> tags and parse it, with a fallback for raw JSON."""
    match = _ROADMAP_XML_RE.search(raw)
    if match:
        text = match.group(1).strip()
    else:
        # Fallback: model ignored XML tags and returned JSON. It might have conversational
        # filler before or after it, so we locate the outermost braces.
        text = raw.strip()
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1 and end > start:
            text = text[start:end+1]
        
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse roadmap JSON. Raw response length: {len(raw[:500])}...")
        raise ValueError(f"Gemini response was not valid JSON: {str(e)}")


def _get_questions_for_domain(domain: str) -> List[Dict[str, str]]:
    resolved = _QUESTION_FALLBACK_DOMAINS.get(domain, domain)
    return DOMAIN_QUESTIONS.get(resolved, DOMAIN_QUESTIONS["other"])


async def _get_redis_json(key: str) -> Optional[dict]:
    rdb = get_redis()
    raw = await rdb.get(key)
    if raw is None:
        return None
    return json.loads(raw)


async def _set_redis_json(key: str, value: dict, ex: int = 7200) -> None:
    rdb = get_redis()
    await rdb.set(key, json.dumps(value), ex=ex)


async def _del_redis(key: str) -> None:
    rdb = get_redis()
    await rdb.delete(key)


def _make_daily_task_card(goal_doc: dict, user_id: str) -> dict:
    """Build a DailyTaskCard from a GoalDB document dict."""
    current_day = goal_doc.get("current_day_index", 0)
    pending_topics = []
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic.get("day_index") == current_day and topic.get("status") in ("pending", "in_progress"):
                pending_topics.append(topic)
    return {
        "goal_id": str(goal_doc.get("_id", "")),
        "goal_title": goal_doc.get("title", ""),
        "day_index": current_day,
        "topics": pending_topics,
        "generated_at": datetime.utcnow().isoformat(),
    }


def _compute_streak(
    current_user: UserDB,
    last_active_date: Optional[datetime],
) -> Dict[str, Any]:
    """Return updated streak_count and longest_streak."""
    today = date.today()
    streak = current_user.streak_count
    longest = current_user.longest_streak

    if last_active_date is None:
        # First completion ever
        streak = 1
    else:
        last_date = last_active_date.date() if isinstance(last_active_date, datetime) else last_active_date
        diff = (today - last_date).days
        if diff == 0:
            pass  # already updated today, no change
        elif diff == 1:
            streak += 1
        else:
            streak = 1 if diff > 1 else streak

    longest = max(longest, streak)
    return {"streak_count": streak, "longest_streak": longest}


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class OnboardStartRequest(BaseModel):
    goal_text: str


class OnboardQ6Request(BaseModel):
    session_id: str
    answers: dict


class OnboardCompleteRequest(BaseModel):
    session_id: str
    all_answers: dict


class TopicCompleteResponse(BaseModel):
    streak_count: int
    mastery_updated: bool
    next_topic_title: Optional[str]


# ---------------------------------------------------------------------------
# Background task: roadmap generation
# ---------------------------------------------------------------------------

async def _generate_roadmap_background(
    session_id: str,
    user_id: str,
    goal_text: str,
    domain: str,
    all_answers: dict,
) -> None:
    """
    Full roadmap generation pipeline (runs as a FastAPI BackgroundTask).

    Steps:
      a. Mark status = processing
      b. Build Gemini roadmap prompt → parse <roadmap> XML
      c. Curate resources for every topic (batches of 5), verify URLs
      d. Save GoalDB to MongoDB
      e. Create SkillDB entries from skill_nodes
      f. Pre-build DailyTaskCard → Redis (36 h TTL)
      g. Write {status: complete, goal_id} → Redis
    """
    status_key = f"onboard:status:{session_id}"
    rdb = get_redis()
    goals_col = get_goals_col()
    skills_col = get_skills_col()
    users_col = get_users_col()

    try:
        # ── a. Mark processing ─────────────────────────────────────────────
        await _set_redis_json(status_key, {"status": "processing"}, ex=7200)

        # ── b. Build profile and generate roadmap ──────────────────────────
        daily_hours = float(all_answers.get("dailyHours", 2))
        timeline_days = int(all_answers.get("timelineWeeks", 8)) * 7

        # Academic exams may give a concrete date; try to derive days from it.
        exam_date_raw: Optional[str] = all_answers.get("examNameAndDate", "")
        # (We just use timelineWeeks for simplicity; actual parsing is domain-specific.)

        profile = {
            "goal_title": goal_text,
            "domain": domain,
            "timeline_days": timeline_days,
            "daily_hours": daily_hours,
            "prior_knowledge": all_answers.get("dsaLevel")
                or all_answers.get("knowledgeLevel")
                or all_answers.get("experienceLevel")
                or all_answers.get("currentFitnessLevel")
                or all_answers.get("currentLevel")
                or all_answers.get("currentStack")
                or "beginner",
            "budget": all_answers.get("budget", "free"),
            "external_materials": all_answers.get("existingMaterials")
                or all_answers.get("hasSyllabus")
                or all_answers.get("existingResources")
                or "",
            "domain_specific_answer": all_answers.get("domainSpecificAnswer", ""),
        }

        raw_roadmap = await call_gemini(roadmap_generation_prompt(profile), max_tokens=8192)
        roadmap_data = _extract_roadmap_json(raw_roadmap)

        # ── c. Resource curation + URL verification ────────────────────────
        budget = profile["budget"]
        all_topics: List[dict] = []
        for phase in roadmap_data.get("phases", []):
            for topic in phase.get("topics", []):
                all_topics.append(topic)

        async def _curate_and_verify(topic: dict) -> dict:
            try:
                resources_raw = await call_gemini_json(
                    resource_curation_prompt(topic["title"], domain, budget)
                )
                if not isinstance(resources_raw, list):
                    resources_raw = []
            except Exception as exc:
                logger.warning("Resource curation failed for %s: %s", topic["title"], exc)
                resources_raw = []

            verified: List[dict] = []
            async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
                for r in resources_raw:
                    url = r.get("url", "")
                    is_broken = False
                    if url:
                        try:
                            resp = await client.head(url)
                            is_broken = resp.status_code >= 400
                        except Exception:
                            is_broken = True
                    verified.append({
                        "resource_id": str(uuid.uuid4()),
                        "type": r.get("type", "article"),
                        "title": r.get("title", ""),
                        "url": url,
                        "source": _map_source(url),
                        "is_free": r.get("is_free", True),
                        "is_broken": is_broken,
                        "verified_at": datetime.utcnow().isoformat(),
                    })
            topic["resources"] = verified
            return topic

        # Process in batches of 5 to avoid hammering Gemini rate limits.
        BATCH_SIZE = 5
        for i in range(0, len(all_topics), BATCH_SIZE):
            batch = all_topics[i : i + BATCH_SIZE]
            await asyncio.gather(*[_curate_and_verify(t) for t in batch])

        # ── d. Save GoalDB to MongoDB ──────────────────────────────────────
        now = datetime.utcnow()
        timeline_start = now
        timeline_target = now + timedelta(days=timeline_days)

        phases_embed = []
        day_cursor = 0
        for phase_data in roadmap_data.get("phases", []):
            topics_embed = []
            for t in phase_data.get("topics", []):
                resources_for_topic = [
                    Resource(
                        resource_id=r["resource_id"],
                        type=_normalise_resource_type(r.get("type", "article")),
                        title=r.get("title", ""),
                        url=r.get("url", ""),
                        source=_normalise_source(r.get("source", "other")),
                        is_free=r.get("is_free", True),
                        is_broken=r.get("is_broken", False),
                        verified_at=datetime.utcnow(),
                    )
                    for r in t.get("resources", [])
                ]
                topics_embed.append(
                    Topic(
                        topic_id=t.get("topic_id", str(uuid.uuid4())),
                        title=t.get("title", ""),
                        day_index=day_cursor,
                        estimated_minutes=t.get("estimated_minutes", 60),
                        ai_note=t.get("ai_note", ""),
                        resource_queries=t.get("resource_queries", []),
                        resources=resources_for_topic,
                        status="pending",
                    )
                )
                day_cursor += 1
            phases_embed.append(
                Phase(
                    phase_id=phase_data.get("phase_id", str(uuid.uuid4())),
                    title=phase_data.get("title", ""),
                    duration_days=phase_data.get("duration_days", 7),
                    topics=topics_embed,
                )
            )

        goal_obj = GoalDB(
            user_id=user_id,
            title=goal_text,
            domain=domain,
            timeline_start=timeline_start,
            timeline_target=timeline_target,
            total_days=timeline_days,
            intake=GoalIntake(
                daily_hours=daily_hours,
                prior_knowledge=profile["prior_knowledge"],
                budget="paid" if "paid" in budget.lower() else "free",
                external_materials=profile["external_materials"] or None,
                domain_specific_answer=profile["domain_specific_answer"] or None,
            ),
            phases=phases_embed,
            current_phase_index=0,
            current_day_index=0,
            status="active",
        )

        goal_dict = goal_obj.model_dump(by_alias=False, exclude={"id"})
        result = await goals_col.insert_one(goal_dict)
        goal_id = str(result.inserted_id)

        # ── e. Create SkillDB entries from skill_nodes ─────────────────────
        skill_nodes = roadmap_data.get("skill_nodes", [])
        skill_name_to_id: Dict[str, str] = {}

        # First pass: assign IDs
        for node in skill_nodes:
            skill_name_to_id[node["name"]] = str(uuid.uuid4())

        # Second pass: insert with resolved prerequisite IDs
        skill_docs = []
        for node in skill_nodes:
            skill_id = skill_name_to_id[node["name"]]
            prereq_ids = [
                skill_name_to_id[p]
                for p in node.get("prerequisites", [])
                if p in skill_name_to_id
            ]
            skill_docs.append({
                "_id": ObjectId(),
                "user_id": user_id,
                "goal_id": goal_id,
                "name": node["name"],
                "domain": domain,
                "prerequisite_skill_ids": prereq_ids,
                "mastery_level": 0,
                "mastery_history": [],
                "tasks_completed": 0,
                "last_practiced": None,
                "decay_rate": 0.5,
            })
        if skill_docs:
            await skills_col.insert_many(skill_docs)

        # ── f. Pre-generate DailyTaskCard → Redis (36 h TTL) ──────────────
        goal_doc_for_card = await goals_col.find_one({"_id": result.inserted_id})
        if goal_doc_for_card:
            goal_doc_for_card["_id"] = str(goal_doc_for_card["_id"])
            card = _make_daily_task_card(goal_doc_for_card, user_id)
            await _set_redis_json(
                f"daily:task:{user_id}:{goal_id}",
                card,
                ex=36 * 3600,
            )

        # ── g. Write complete status ───────────────────────────────────────
        await _set_redis_json(
            status_key,
            {"status": "complete", "goal_id": goal_id},
            ex=7200,
        )

    except Exception as exc:
        logger.exception("Roadmap generation background task failed: %s", exc)
        await _set_redis_json(
            status_key,
            {"status": "error", "error": str(exc)},
            ex=7200,
        )


def _map_source(url: str) -> str:
    """Derive a normalised source literal from a URL."""
    url_lower = url.lower()
    if "youtube" in url_lower or "youtu.be" in url_lower:
        return "youtube"
    if "leetcode" in url_lower:
        return "leetcode"
    if "github" in url_lower:
        return "github"
    if "udemy" in url_lower:
        return "udemy"
    return "other"


def _normalise_resource_type(raw: str) -> str:
    mapping = {
        "video": "video",
        "article": "article",
        "notes": "notes",
        "problem": "problem",
        "practice": "problem",
        "course": "course",
        "book": "notes",
        "tool": "article",
        "documentation": "article",
    }
    return mapping.get(raw.lower(), "article")


def _normalise_source(raw: str) -> str:
    mapping = {
        "youtube": "youtube",
        "youtube / abdul bari": "youtube",
        "leetcode": "leetcode",
        "github": "github",
        "udemy": "udemy",
    }
    return mapping.get(raw.lower(), "other")


# ---------------------------------------------------------------------------
# ── Endpoints ──────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

# ── POST /onboard/start ───────────────────────────────────────────────────

@router.post("/onboard/start")
async def onboard_start(
    body: OnboardStartRequest,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Step 1 of onboarding. Classifies the goal domain and returns Q1–Q5.
    Stores an onboarding session in Redis (TTL 2 h).
    """
    # 1. Domain classification
    try:
        classification = await call_gemini_json(
            domain_classify_prompt(body.goal_text)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI classification failed: {exc}",
        )

    domain = classification.get("domain", "other")
    confidence = classification.get("confidence", 0.0)

    # 2. Fetch Q1–Q5 for the domain
    questions = _get_questions_for_domain(domain)

    # 3. Store session in Redis
    session_data = {
        "domain": domain,
        "goal_text": body.goal_text,
        "questions": questions,
        "answers": {},
        "q6": None,
    }
    session_key = f"onboard:{current_user.id}"
    await _set_redis_json(session_key, session_data, ex=7200)

    return {
        "session_id": str(current_user.id),
        "domain": domain,
        "confidence": confidence,
        "questions": questions,
    }


# ── POST /onboard/q6 ──────────────────────────────────────────────────────

@router.post("/onboard/q6")
async def onboard_q6(
    body: OnboardQ6Request,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Step 2 of onboarding. Merges Q1–Q5 answers and returns an AI-generated Q6.
    """
    session_key = f"onboard:{body.session_id}"
    session = await _get_redis_json(session_key)
    if session is None:
        raise HTTPException(status_code=404, detail="Onboarding session not found or expired.")

    # Merge answers
    session["answers"].update(body.answers)

    # Generate Q6
    try:
        q6_result = await call_gemini_json(
            q6_prompt(
                domain=session["domain"],
                goal_text=session["goal_text"],
                prior_answers=session["answers"],
            )
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI Q6 generation failed: {exc}",
        )

    session["q6"] = q6_result
    await _set_redis_json(session_key, session, ex=7200)

    return {
        "question": q6_result.get("question", ""),
        "field_name": q6_result.get("field_name", "domainSpecificAnswer"),
    }


# ── POST /onboard/complete ────────────────────────────────────────────────

@router.post("/onboard/complete")
async def onboard_complete(
    body: OnboardCompleteRequest,
    background_tasks: BackgroundTasks,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Step 3 of onboarding. Returns immediately; roadmap generation happens
    in the background. Poll /onboard/status/{session_id} for completion.
    """
    session_key = f"onboard:{body.session_id}"
    session = await _get_redis_json(session_key)
    if session is None:
        raise HTTPException(status_code=404, detail="Onboarding session not found or expired.")

    domain = session["domain"]
    goal_text = session["goal_text"]

    # Merge all answers (Q1–Q5 + Q6)
    all_answers: dict = {**session.get("answers", {}), **body.all_answers}

    background_tasks.add_task(
        _generate_roadmap_background,
        session_id=body.session_id,
        user_id=str(current_user.id),
        goal_text=goal_text,
        domain=domain,
        all_answers=all_answers,
    )

    return {"session_id": body.session_id, "status": "processing"}


# ── GET /onboard/status/{session_id} ─────────────────────────────────────

@router.get("/onboard/status/{session_id}")
async def onboard_status(
    session_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Poll this endpoint after /onboard/complete.
    Returns {status: processing|complete|error, goal_id?, error?}.
    """
    status_key = f"onboard:status:{session_id}"
    result = await _get_redis_json(status_key)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No generation status found. The session may have expired.",
        )
    return result


# ── GET / ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_goals(current_user: UserDB = Depends(get_current_user)):
    """List all active goals for the current user."""
    goals_col = get_goals_col()
    cursor = goals_col.find(
        {"user_id": str(current_user.id), "status": "active"},
        {
            "_id": 1,
            "title": 1,
            "domain": 1,
            "status": 1,
            "current_day_index": 1,
            "total_days": 1,
            "timeline_target": 1,
            "created_at": 1,
        },
    )
    goals = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        goals.append(doc)
    return goals


# ── GET /{goal_id} ────────────────────────────────────────────────────────

@router.get("/{goal_id}")
async def get_goal(
    goal_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """Return the full goal document with all phases and topics."""
    goals_col = get_goals_col()
    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    doc["_id"] = str(doc["_id"])
    return doc


# ── GET /{goal_id}/today ──────────────────────────────────────────────────

@router.get("/{goal_id}/today")
async def get_today_task(
    goal_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Return the DailyTaskCard for today.
    Reads from Redis cache; falls back to computing from MongoDB.
    """
    cache_key = f"daily:task:{current_user.id}:{goal_id}"
    cached = await _get_redis_json(cache_key)
    if cached:
        return cached

    # Fallback: compute from MongoDB
    goals_col = get_goals_col()
    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    doc["_id"] = str(doc["_id"])
    card = _make_daily_task_card(doc, str(current_user.id))

    # Cache for 36 h
    await _set_redis_json(cache_key, card, ex=36 * 3600)
    return card


# ── POST /{goal_id}/topics/{topic_id}/complete ────────────────────────────

@router.post("/{goal_id}/topics/{topic_id}/complete", response_model=TopicCompleteResponse)
async def complete_topic(
    goal_id: str,
    topic_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Mark a topic as done, update streak, advance day index, update skill mastery.
    """
    goals_col = get_goals_col()
    skills_col = get_skills_col()
    users_col = get_users_col()

    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    goal_doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    # Locate the topic across all phases
    topic_found = False
    completed_day_index: Optional[int] = None
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic["topic_id"] == topic_id:
                topic["status"] = "done"
                topic["completed_at"] = datetime.utcnow().isoformat()
                topic_found = True
                completed_day_index = topic["day_index"]
                break
        if topic_found:
            break

    if not topic_found:
        raise HTTPException(status_code=404, detail="Topic not found in this goal.")

    # Advance current_day_index if this topic was at the current day
    new_day_index = goal_doc["current_day_index"]
    if completed_day_index is not None and completed_day_index == new_day_index:
        new_day_index += 1

    # ── Streak logic ───────────────────────────────────────────────────────
    streak_data = _compute_streak(current_user, current_user.last_active_date)

    # ── Persist goal update ────────────────────────────────────────────────
    await goals_col.update_one(
        {"_id": oid},
        {
            "$set": {
                "phases": goal_doc["phases"],
                "current_day_index": new_day_index,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    # ── Persist user streak + last_active_date ─────────────────────────────
    await users_col.update_one(
        {"supabase_id": current_user.supabase_id},
        {
            "$set": {
                "streak_count": streak_data["streak_count"],
                "longest_streak": streak_data["longest_streak"],
                "last_active_date": datetime.utcnow(),
            }
        },
    )

    # ── Skill mastery update (+40) ─────────────────────────────────────────
    # Find a skill whose name appears in the topic title (simple heuristic)
    topic_title_lower = (
        next(
            (
                t["title"]
                for phase in goal_doc.get("phases", [])
                for t in phase.get("topics", [])
                if t["topic_id"] == topic_id
            ),
            "",
        )
    ).lower()

    mastery_updated = False
    matched_skill = await skills_col.find_one(
        {
            "user_id": str(current_user.id),
            "goal_id": goal_id,
            "name": {
                "$regex": "|".join(topic_title_lower.split()[:3]),
                "$options": "i",
            },
        }
    )
    if matched_skill:
        new_mastery = min(100, matched_skill.get("mastery_level", 0) + 40)
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
                        "topic_id": topic_id,
                    }
                },
                "$inc": {"tasks_completed": 1},
            },
        )
        mastery_updated = True

    # ── Invalidate daily task cache ────────────────────────────────────────
    await _del_redis(f"daily:task:{current_user.id}:{goal_id}")

    # ── Find next topic title ──────────────────────────────────────────────
    next_topic_title: Optional[str] = None
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic.get("day_index") == new_day_index and topic.get("status") in (
                "pending",
                "in_progress",
            ):
                next_topic_title = topic["title"]
                break
        if next_topic_title:
            break

    return TopicCompleteResponse(
        streak_count=streak_data["streak_count"],
        mastery_updated=mastery_updated,
        next_topic_title=next_topic_title,
    )


# ── POST /{goal_id}/topics/{topic_id}/skip ────────────────────────────────

@router.post("/{goal_id}/topics/{topic_id}/skip")
async def skip_topic(
    goal_id: str,
    topic_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """Mark a topic as skipped."""
    goals_col = get_goals_col()
    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    goal_doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    topic_found = False
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic["topic_id"] == topic_id:
                topic["status"] = "skipped"
                topic_found = True
                break
        if topic_found:
            break

    if not topic_found:
        raise HTTPException(status_code=404, detail="Topic not found in this goal.")

    await goals_col.update_one(
        {"_id": oid},
        {"$set": {"phases": goal_doc["phases"], "updated_at": datetime.utcnow()}},
    )

    # Invalidate daily task cache so next GET /today recomputes
    await _del_redis(f"daily:task:{current_user.id}:{goal_id}")

    return {"message": "ok"}


# ── POST /{goal_id}/replan ────────────────────────────────────────────────

@router.post("/{goal_id}/replan")
async def replan_goal(
    goal_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Redistribute all skipped topics across the remaining timeline using AI.
    Returns a warm reassurance message and the count of topics moved.
    """
    goals_col = get_goals_col()
    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    goal_doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    # Collect all skipped topics
    skipped: List[dict] = []
    # Build a prerequisite map from resource_queries position heuristic
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic.get("status") == "skipped":
                skipped.append({
                    "topic_id": topic["topic_id"],
                    "title": topic["title"],
                    "estimated_minutes": topic.get("estimated_minutes", 60),
                    "prerequisites": [],  # model doesn't store this after creation; AI can infer
                })

    if not skipped:
        return {"message": "No skipped topics found — your plan is already clean.", "topics_moved": 0}

    # Compute remaining days
    target_date = goal_doc.get("timeline_target")
    if isinstance(target_date, str):
        target_date = datetime.fromisoformat(target_date)
    remaining_days = max(1, (target_date - datetime.utcnow()).days) if target_date else 30

    intake = goal_doc.get("intake", {})
    daily_hours = float(intake.get("daily_hours", 2))

    try:
        replan_result = await call_gemini_json(
            replan_prompt(
                skipped_topics=skipped,
                remaining_days=remaining_days,
                daily_hours=daily_hours,
            )
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI replan failed: {exc}",
        )

    redistributed = replan_result.get("redistributed", [])
    message = replan_result.get("message", "Your plan has been adjusted.")

    # Apply new day_indexes to the goal document
    id_to_new_day = {r["topic_id"]: r["new_day_index"] for r in redistributed}
    topics_moved = 0
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic["topic_id"] in id_to_new_day:
                topic["day_index"] = id_to_new_day[topic["topic_id"]]
                topic["status"] = "pending"  # un-skip after replanning
                topics_moved += 1

    await goals_col.update_one(
        {"_id": oid},
        {"$set": {"phases": goal_doc["phases"], "updated_at": datetime.utcnow()}},
    )

    # Invalidate daily task cache
    await _del_redis(f"daily:task:{current_user.id}:{goal_id}")

    return {"message": message, "topics_moved": topics_moved}
