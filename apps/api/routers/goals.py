"""
goals.py — all goal and roadmap endpoints for Hazo.

Endpoints:
  POST   /onboard/start
  POST   /onboard/q6
  POST   /onboard/complete
  GET    /onboard/status/{session_id}
  GET    /                             (list active goals)
  GET    /{goal_id}                    (full goal detail)
  POST   /{goal_id}/pause
  POST   /{goal_id}/resume
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
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx
import redis.asyncio as aioredis
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel

from core.auth import get_current_user
from db.database import (
    get_goals_col,
    get_mentor_sessions_col,
    get_skills_col,
    get_tasks_col,
    get_users_col,
)
from db.models import GoalDB, GoalIntake, Phase, Resource, SkillDB, Topic, UserDB

# Add the repo root to the path so `packages` is importable from apps/api
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from packages.ai.gemini_client import call_gemini, call_gemini_json
from packages.ai.prompts import (
    concept_resource_curation_prompt,
    domain_classify_prompt,
    q6_prompt,
    replan_prompt,
    resource_curation_prompt,
    roadmap_generation_prompt,
    supporting_resource_curation_prompt,
)

load_dotenv()
logger = logging.getLogger("hazo.routers.goals")
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


def _normalise_onboarding_answers(session: dict, answers: dict) -> Dict[str, Any]:
    """Map legacy q1/q2... answer keys onto real onboarding field names."""
    if not isinstance(answers, dict):
        return {}

    questions = session.get("questions") or []
    q6_field_name = (session.get("q6") or {}).get("field_name")
    normalised: Dict[str, Any] = {}

    for key, value in answers.items():
        mapped_key = key
        match = re.fullmatch(r"q(\d+)", str(key))
        if match:
            question_index = int(match.group(1)) - 1
            if 0 <= question_index < len(questions):
                mapped_key = questions[question_index].get("field_name") or key
            elif question_index == len(questions) and q6_field_name:
                mapped_key = q6_field_name
        normalised[mapped_key] = value

    if q6_field_name and normalised.get(q6_field_name):
        normalised["domainSpecificAnswer"] = normalised[q6_field_name]

    return normalised


def _derive_timeline_days(all_answers: Dict[str, Any]) -> int:
    """Best-effort timeline parser with an 8-week fallback."""
    raw_timeline_weeks = all_answers.get("timelineWeeks")
    if raw_timeline_weeks not in (None, ""):
        try:
            return max(1, int(float(str(raw_timeline_weeks).strip()) * 7))
        except ValueError:
            pass

    raw_timeline = str(all_answers.get("timeline", "")).strip().lower()
    if raw_timeline:
        match = re.search(r"(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years)", raw_timeline)
        if match:
            value = float(match.group(1))
            unit = match.group(2)
            if unit.startswith("day"):
                return max(1, int(round(value)))
            if unit.startswith("week"):
                return max(1, int(round(value * 7)))
            if unit.startswith("month"):
                return max(1, int(round(value * 30)))
            if unit.startswith("year"):
                return max(1, int(round(value * 365)))

        number_only = re.search(r"(\d+(?:\.\d+)?)", raw_timeline)
        if number_only:
            return max(1, int(round(float(number_only.group(1)) * 7)))

    return 56


def _clamp_roadmap_to_timeline(roadmap_data: Dict[str, Any], timeline_days: int) -> Dict[str, Any]:
    """Trim roadmap topics so the saved plan does not exceed the requested timeline."""
    remaining_days = max(1, timeline_days)
    clamped_phases: List[Dict[str, Any]] = []

    for phase in roadmap_data.get("phases", []):
        if remaining_days <= 0:
            break

        phase_topics = list(phase.get("topics", []))
        kept_topics = phase_topics[:remaining_days]
        if not kept_topics:
            continue

        clamped_phases.append(
            {
                **phase,
                "topics": kept_topics,
                "duration_days": len(kept_topics),
            }
        )
        remaining_days -= len(kept_topics)

    total_topics = sum(len(phase.get("topics", [])) for phase in clamped_phases)
    roadmap_data["phases"] = clamped_phases
    roadmap_data["total_topics"] = total_topics
    roadmap_data["total_days"] = total_topics
    roadmap_data["total_phases"] = len(clamped_phases)
    return roadmap_data


async def _get_redis_json(key: str) -> Optional[dict]:
    rdb = get_redis()
    raw = await rdb.get(key)
    if raw is None:
        return None
    return json.loads(raw)


async def _set_redis_json(key: str, value: dict, ex: int = 7200) -> None:
    rdb = get_redis()
    encoded_value = jsonable_encoder(value)
    await rdb.set(key, json.dumps(encoded_value), ex=ex)


async def _del_redis(key: str) -> None:
    rdb = get_redis()
    await rdb.delete(key)


def _goal_total_days(goal_doc: dict) -> int:
    max_day_index = -1
    topic_count = 0

    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            topic_count += 1
            day_index = topic.get("day_index")
            if isinstance(day_index, int):
                max_day_index = max(max_day_index, day_index)

    if max_day_index >= 0:
        return max_day_index + 1
    if topic_count > 0:
        return topic_count
    return max(1, int(goal_doc.get("total_days") or 1))


def _goal_timeline_target(goal_doc: dict, total_days: int) -> Any:
    timeline_start = goal_doc.get("timeline_start")
    if isinstance(timeline_start, str):
        try:
            timeline_start = datetime.fromisoformat(timeline_start)
        except ValueError:
            timeline_start = None

    if isinstance(timeline_start, datetime):
        return timeline_start + timedelta(days=max(total_days, 1))

    return goal_doc.get("timeline_target")


def _make_daily_task_card(goal_doc: dict, user_id: str) -> dict:
    """Build a DailyTaskCard from a GoalDB document dict."""
    current_day = goal_doc.get("current_day_index", 0)
    total_days = _goal_total_days(goal_doc)
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
        "total_days": total_days,
        "generated_at": datetime.utcnow().isoformat(),
    }


def _compute_streak(
    current_user: UserDB,
    last_active_date: Optional[datetime],
) -> Dict[str, Any]:
    """Return updated streak_count and longest_streak."""
    today = _today_for_user(current_user)
    streak = current_user.streak_count
    longest = current_user.longest_streak

    if last_active_date is None:
        # First completion ever
        streak = 1
    else:
        last_date = _date_for_user(current_user, last_active_date)
        diff = (today - last_date).days
        if diff == 0:
            pass  # already updated today, no change
        elif diff == 1:
            streak += 1
        else:
            streak = 1 if diff > 1 else streak

    longest = max(longest, streak)
    return {"streak_count": streak, "longest_streak": longest}


def _today_for_user(current_user: UserDB) -> date:
    timezone_name = getattr(current_user, "timezone", None) or "UTC"
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except Exception:
        return datetime.utcnow().date()


def _date_for_user(current_user: UserDB, value: datetime | date) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value

    timezone_name = getattr(current_user, "timezone", None) or "UTC"
    try:
        tz = ZoneInfo(timezone_name)
        dt_value = value
        if dt_value.tzinfo is None:
            dt_value = dt_value.replace(tzinfo=timezone.utc)
        return dt_value.astimezone(tz).date()
    except Exception:
        return value.date() if isinstance(value, datetime) else value


def _resolve_last_streak_date(current_user: UserDB) -> Optional[datetime]:
    last_streak_date = getattr(current_user, "last_streak_date", None)
    if last_streak_date is not None:
        return last_streak_date

    return current_user.last_active_date


async def _prepare_next_topic_resources(
    goal_oid: ObjectId,
    next_topic_id: str,
) -> None:
    goals_col = get_goals_col()
    goal_doc = await goals_col.find_one({"_id": goal_oid})
    if goal_doc is None:
        return

    next_topic_ref: Optional[dict] = None
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic.get("topic_id") == next_topic_id:
                next_topic_ref = topic
                break
        if next_topic_ref:
            break

    if next_topic_ref is None or next_topic_ref.get("resources"):
        return

    topic_context = _build_topic_context(goal_doc, next_topic_id)
    generated_payload = await _curate_resources_for_topic(
        next_topic_ref.get("title", ""),
        goal_doc.get("domain", "other"),
        goal_doc.get("intake", {}).get("budget", "free"),
        **topic_context,
    )
    if generated_payload["resources"] or generated_payload["practice_links"]:
        next_topic_ref["resources"] = generated_payload["resources"]
        next_topic_ref["practice_links"] = generated_payload["practice_links"]
        await goals_col.update_one(
            {"_id": goal_oid},
            {"$set": {"phases": goal_doc["phases"], "updated_at": datetime.utcnow()}},
        )


async def _curate_resources_for_topic(
    topic_title: str,
    domain: str,
    budget: str,
    *,
    goal_title: str = "",
    phase_title: str = "",
    phase_topics: Optional[List[str]] = None,
    previous_topic_title: str = "",
    next_topic_title: str = "",
    prior_knowledge: str = "",
    domain_specific_answer: str = "",
) -> Dict[str, List[dict]]:
    prompt_kwargs = {
        "goal_title": goal_title,
        "phase_title": phase_title,
        "phase_topics": phase_topics or [],
        "previous_topic_title": previous_topic_title,
        "next_topic_title": next_topic_title,
        "prior_knowledge": prior_knowledge,
        "domain_specific_answer": domain_specific_answer,
    }

    try:
        resources_raw = await call_gemini_json(
            resource_curation_prompt(topic_title, domain, budget, **prompt_kwargs)
        )
        if not isinstance(resources_raw, list):
            resources_raw = []
    except Exception as exc:
        logger.warning("Resource curation failed for %s: %s", topic_title, exc)
        resources_raw = []

    async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
        verified_payload = await _verify_and_split_resources(
            client=client,
            resources_raw=resources_raw,
            topic_title=topic_title,
            domain=domain,
        )

        needs_more_concepts = len(verified_payload["resources"]) < 2
        needs_more_support = len(verified_payload["practice_links"]) < 2

        if needs_more_concepts:
            try:
                concept_raw = await call_gemini_json(
                    concept_resource_curation_prompt(topic_title, domain, budget, **prompt_kwargs)
                )
                if isinstance(concept_raw, list):
                    concept_payload = await _verify_and_split_resources(
                        client=client,
                        resources_raw=concept_raw,
                        topic_title=topic_title,
                        domain=domain,
                    )
                    verified_payload = _merge_resource_payloads(
                        verified_payload,
                        concept_payload,
                    )
            except Exception as exc:
                logger.warning("Concept resource fallback failed for %s: %s", topic_title, exc)

        if needs_more_support:
            try:
                support_raw = await call_gemini_json(
                    supporting_resource_curation_prompt(topic_title, domain, budget, **prompt_kwargs)
                )
                if isinstance(support_raw, list):
                    support_payload = await _verify_and_split_resources(
                        client=client,
                        resources_raw=support_raw,
                        topic_title=topic_title,
                        domain=domain,
                    )
                    verified_payload = _merge_resource_payloads(
                        verified_payload,
                        support_payload,
                    )
            except Exception as exc:
                logger.warning("Support resource fallback failed for %s: %s", topic_title, exc)

        return {
            "resources": verified_payload["resources"][:4],
            "practice_links": verified_payload["practice_links"][:4],
        }


def _merge_resource_payloads(
    base_payload: Dict[str, List[dict]],
    extra_payload: Dict[str, List[dict]],
) -> Dict[str, List[dict]]:
    def _dedupe(items: List[dict]) -> List[dict]:
        seen_urls: set[str] = set()
        merged: List[dict] = []
        for item in items:
            url = item.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            merged.append(item)
        return merged

    return {
        "resources": _dedupe((base_payload.get("resources") or []) + (extra_payload.get("resources") or [])),
        "practice_links": _dedupe((base_payload.get("practice_links") or []) + (extra_payload.get("practice_links") or [])),
    }


_TRUSTED_CODING_PRACTICE_DOMAINS = (
    "leetcode.com",
    "codechef.com",
    "codeforces.com",
    "cses.fi",
    "atcoder.jp",
)

_CODING_TOPIC_KEYWORDS = (
    "array",
    "string",
    "sorting",
    "sort",
    "hash",
    "linked list",
    "stack",
    "queue",
    "tree",
    "graph",
    "dynamic programming",
    "dp",
    "greedy",
    "recursion",
    "backtracking",
    "binary search",
    "heap",
    "trie",
    "segment tree",
    "disjoint set",
    "union find",
    "two pointers",
    "sliding window",
    "bit manipulation",
    "math",
    "algorithm",
    "dsa",
    "leetcode",
)


def _normalise_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""
    if re.match(r"^[a-z][a-z0-9+.-]*://", url, re.IGNORECASE):
        return url
    return f"https://{url}"


def _is_trusted_coding_practice_url(url: str) -> bool:
    url_lower = url.lower()
    return any(domain in url_lower for domain in _TRUSTED_CODING_PRACTICE_DOMAINS)


def _topic_prefers_coding_practice(domain: str, topic_title: str) -> bool:
    if domain == "competitive_programming":
        return True
    if domain != "swe_career":
        return False

    title_lower = topic_title.lower()
    return any(keyword in title_lower for keyword in _CODING_TOPIC_KEYWORDS)


async def _is_resource_url_alive(client: httpx.AsyncClient, url: str) -> bool:
    if not url:
        return False

    url_lower = url.lower()

    try:
        if "youtube.com" in url_lower or "youtu.be" in url_lower:
            oembed_url = "https://www.youtube.com/oembed"
            response = await client.get(
                oembed_url,
                params={"url": url, "format": "json"},
            )
            return response.status_code < 400

        response = await client.head(url)
        if response.status_code < 400:
            return True
        if response.status_code in {403, 405}:
            response = await client.get(url)
            return response.status_code < 400
        return False
    except Exception:
        try:
            response = await client.get(url)
            return response.status_code < 400
        except Exception:
            return False


async def _verify_and_split_resources(
    client: httpx.AsyncClient,
    resources_raw: List[dict],
    topic_title: str,
    domain: str,
) -> Dict[str, List[dict]]:
    verified_resources: List[dict] = []
    practice_links: List[dict] = []
    seen_urls: set[str] = set()
    prefers_coding_practice = _topic_prefers_coding_practice(domain, topic_title)

    for resource in resources_raw:
        if not isinstance(resource, dict):
            continue

        url = _normalise_url(resource.get("url", ""))
        if not url or url in seen_urls:
            continue

        resource_type = _normalise_resource_type(resource.get("type", "article"))
        is_practice = resource_type == "problem"

        if prefers_coding_practice and is_practice and not _is_trusted_coding_practice_url(url):
            continue

        is_alive = await _is_resource_url_alive(client, url)
        if not is_alive:
            continue

        seen_urls.add(url)
        verified_resource = {
            "resource_id": str(uuid.uuid4()),
            "type": resource_type,
            "title": resource.get("title", ""),
            "url": url,
            "source": _map_source(url),
            "is_free": resource.get("is_free", True),
            "is_broken": False,
            "verified_at": datetime.utcnow().isoformat(),
        }

        if is_practice:
            practice_links.append(verified_resource)
        else:
            verified_resources.append(verified_resource)

    return {
        "resources": verified_resources[:4],
        "practice_links": practice_links[:3],
    }


def _find_topic_and_phase(goal_doc: dict, topic_id: str) -> tuple[Optional[dict], Optional[dict]]:
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic.get("topic_id") == topic_id:
                return topic, phase
    return None, None


def _build_topic_context(goal_doc: dict, topic_id: str) -> Dict[str, Any]:
    for phase in goal_doc.get("phases", []):
        topics = phase.get("topics", [])
        for idx, topic in enumerate(topics):
            if topic.get("topic_id") == topic_id:
                previous_topic = topics[idx - 1] if idx > 0 else None
                next_topic = topics[idx + 1] if idx + 1 < len(topics) else None
                return {
                    "goal_title": goal_doc.get("title", ""),
                    "phase_title": phase.get("title", ""),
                    "phase_topics": [item.get("title", "") for item in topics],
                    "previous_topic_title": previous_topic.get("title", "") if previous_topic else "",
                    "next_topic_title": next_topic.get("title", "") if next_topic else "",
                    "prior_knowledge": goal_doc.get("intake", {}).get("prior_knowledge", ""),
                    "domain_specific_answer": goal_doc.get("intake", {}).get("domain_specific_answer", ""),
                }

    return {
        "goal_title": goal_doc.get("title", ""),
        "phase_title": "",
        "phase_topics": [],
        "previous_topic_title": "",
        "next_topic_title": "",
        "prior_knowledge": goal_doc.get("intake", {}).get("prior_knowledge", ""),
        "domain_specific_answer": goal_doc.get("intake", {}).get("domain_specific_answer", ""),
    }


def _recompute_goal_state(goal_doc: dict) -> Dict[str, Any]:
    phases = goal_doc.get("phases", [])
    total_days = _goal_total_days(goal_doc)
    open_topics: List[tuple[int, int]] = []

    for phase_index, phase in enumerate(phases):
        for topic in phase.get("topics", []):
            if topic.get("status") in ("done", "skipped"):
                continue

            day_index = topic.get("day_index")
            if isinstance(day_index, int):
                open_topics.append((day_index, phase_index))

    if open_topics:
        next_day_index, next_phase_index = min(open_topics, key=lambda item: item[0])
        next_status = "paused" if goal_doc.get("status") == "paused" else "active"
        return {
            "current_day_index": next_day_index,
            "current_phase_index": next_phase_index,
            "status": next_status,
            "completed_at": None,
        }

    completed_phase_index = max(0, len(phases) - 1) if phases else 0
    existing_completed_at = goal_doc.get("completed_at")
    completed_at = existing_completed_at if isinstance(existing_completed_at, datetime) else datetime.utcnow()

    return {
        "current_day_index": total_days,
        "current_phase_index": completed_phase_index,
        "status": "completed",
        "completed_at": completed_at,
    }


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
        timeline_days = _derive_timeline_days(all_answers)

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

        raw_roadmap = await call_gemini(roadmap_generation_prompt(profile), max_tokens=65536)
        roadmap_data = _clamp_roadmap_to_timeline(
            _extract_roadmap_json(raw_roadmap),
            timeline_days,
        )

        # ── c. Resource curation + URL verification ────────────────────────
        budget = profile["budget"]
        all_topics: List[dict] = []
        for phase in roadmap_data.get("phases", []):
            for topic in phase.get("topics", []):
                all_topics.append(topic)

        async def _curate_and_verify(topic: dict) -> dict:
            phase_context = {
                "phase_title": "",
                "phase_topics": [],
                "previous_topic_title": "",
                "next_topic_title": "",
            }
            for phase in roadmap_data.get("phases", []):
                topics_in_phase = phase.get("topics", [])
                for idx, candidate in enumerate(topics_in_phase):
                    if candidate is topic:
                        phase_context = {
                            "phase_title": phase.get("title", ""),
                            "phase_topics": [item.get("title", "") for item in topics_in_phase],
                            "previous_topic_title": topics_in_phase[idx - 1].get("title", "") if idx > 0 else "",
                            "next_topic_title": topics_in_phase[idx + 1].get("title", "") if idx + 1 < len(topics_in_phase) else "",
                        }
                        break
                if phase_context["phase_topics"]:
                    break

            try:
                resources_raw = await call_gemini_json(
                    resource_curation_prompt(
                        topic["title"],
                        domain,
                        budget,
                        goal_title=goal_text,
                        phase_title=phase_context["phase_title"],
                        phase_topics=phase_context["phase_topics"],
                        previous_topic_title=phase_context["previous_topic_title"],
                        next_topic_title=phase_context["next_topic_title"],
                        prior_knowledge=profile["prior_knowledge"],
                        domain_specific_answer=profile["domain_specific_answer"],
                    )
                )
                if not isinstance(resources_raw, list):
                    resources_raw = []
            except Exception as exc:
                logger.warning("Resource curation failed for %s: %s", topic["title"], exc)
                resources_raw = []

            async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
                verified_payload = await _verify_and_split_resources(
                    client=client,
                    resources_raw=resources_raw,
                    topic_title=topic["title"],
                    domain=domain,
                )
            topic["resources"] = verified_payload["resources"]
            topic["practice_links"] = verified_payload["practice_links"]
            return topic

        # Process only the first topic (Day 0) to avoid exhausting free-tier Gemini limits.
        # Future topics will be curated daily via a nightly background cron scheduler.
        topics_to_curate = all_topics[:1]
        BATCH_SIZE = 5
        for i in range(0, len(topics_to_curate), BATCH_SIZE):
            batch = topics_to_curate[i : i + BATCH_SIZE]
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
                practice_links_for_topic = [
                    Resource(
                        resource_id=r["resource_id"],
                        type=_normalise_resource_type(r.get("type", "problem")),
                        title=r.get("title", ""),
                        url=r.get("url", ""),
                        source=_normalise_source(r.get("source", "other")),
                        is_free=r.get("is_free", True),
                        is_broken=r.get("is_broken", False),
                        verified_at=datetime.utcnow(),
                    )
                    for r in t.get("practice_links", [])
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
                        practice_links=practice_links_for_topic,
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
                "skill_id": skill_id,
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
    if "codechef" in url_lower:
        return "codechef"
    if "codeforces" in url_lower:
        return "codeforces"
    if "cses.fi" in url_lower:
        return "cses"
    if "atcoder.jp" in url_lower:
        return "atcoder"
    if "geeksforgeeks" in url_lower:
        return "geeksforgeeks"
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
        "youtube / neetcode": "youtube",
        "youtube / striver": "youtube",
        "leetcode": "leetcode",
        "codechef": "codechef",
        "codeforces": "codeforces",
        "cses": "cses",
        "atcoder": "atcoder",
        "geeksforgeeks": "geeksforgeeks",
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
    session["answers"].update(_normalise_onboarding_answers(session, body.answers))

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
    all_answers: dict = {
        **session.get("answers", {}),
        **_normalise_onboarding_answers(session, body.all_answers),
    }

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
    """List all non-abandoned goals for the current user."""
    goals_col = get_goals_col()
    cursor = goals_col.find(
        {"user_id": str(current_user.id), "status": {"$ne": "abandoned"}},
    )
    goals = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        computed_total_days = _goal_total_days(doc)
        doc["total_days"] = computed_total_days
        doc["timeline_target"] = _goal_timeline_target(doc, computed_total_days)
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
    computed_total_days = _goal_total_days(doc)
    doc["total_days"] = computed_total_days
    doc["timeline_target"] = _goal_timeline_target(doc, computed_total_days)
    return doc


@router.post("/{goal_id}/pause")
async def pause_goal(
    goal_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    goals_col = get_goals_col()
    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    goal_doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    if goal_doc.get("status") == "completed":
        raise HTTPException(status_code=409, detail="Completed goals cannot be paused.")
    if goal_doc.get("status") == "abandoned":
        raise HTTPException(status_code=409, detail="Abandoned goals cannot be paused.")
    if goal_doc.get("status") == "paused":
        return {"message": "Goal already paused.", "status": "paused"}

    await goals_col.update_one(
        {"_id": oid},
        {"$set": {"status": "paused", "updated_at": datetime.utcnow()}},
    )
    await _del_redis(f"daily:task:{current_user.id}:{goal_id}")
    return {"message": "Goal paused.", "status": "paused"}


@router.post("/{goal_id}/resume")
async def resume_goal(
    goal_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    goals_col = get_goals_col()
    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    goal_doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    if goal_doc.get("status") == "completed":
        raise HTTPException(status_code=409, detail="Completed goals cannot be resumed.")
    if goal_doc.get("status") == "abandoned":
        raise HTTPException(status_code=409, detail="Abandoned goals cannot be resumed.")

    next_goal_state = _recompute_goal_state({**goal_doc, "status": "active"})
    await goals_col.update_one(
        {"_id": oid},
        {
            "$set": {
                "current_day_index": next_goal_state["current_day_index"],
                "current_phase_index": next_goal_state["current_phase_index"],
                "status": next_goal_state["status"],
                "completed_at": next_goal_state["completed_at"],
                "updated_at": datetime.utcnow(),
            }
        },
    )
    await _del_redis(f"daily:task:{current_user.id}:{goal_id}")
    return {"message": "Goal resumed.", "status": next_goal_state["status"]}


# ── DELETE /{goal_id} ─────────────────────────────────────────────────────

@router.delete("/{goal_id}")
async def delete_goal(
    goal_id: str,
    current_user: UserDB = Depends(get_current_user),
):
    """Soft-delete a goal and clean up goal-scoped cached/supporting data."""
    goals_col = get_goals_col()
    skills_col = get_skills_col()
    tasks_col = get_tasks_col()
    mentor_col = get_mentor_sessions_col()

    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    goal_doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    await goals_col.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "abandoned",
                "updated_at": datetime.utcnow(),
            }
        },
    )

    await skills_col.delete_many(
        {
            "user_id": str(current_user.id),
            "goal_id": goal_id,
        }
    )
    await tasks_col.update_many(
        {
            "user_id": str(current_user.id),
            "linked_goal_id": goal_id,
        },
        {
            "$set": {"linked_goal_id": None},
        },
    )
    await mentor_col.delete_many(
        {
            "user_id": {"$in": [str(current_user.id), current_user.supabase_id]},
            "goal_id": goal_id,
        }
    )

    await _del_redis(f"daily:task:{current_user.id}:{goal_id}")

    return {"message": "Goal deleted."}


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
    background_tasks: BackgroundTasks,
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
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic["topic_id"] == topic_id:
                topic["status"] = "done"
                topic["completed_at"] = datetime.utcnow().isoformat()
                topic_found = True
                break
        if topic_found:
            break

    if not topic_found:
        raise HTTPException(status_code=404, detail="Topic not found in this goal.")

    # ── Streak logic ───────────────────────────────────────────────────────
    streak_data = _compute_streak(current_user, _resolve_last_streak_date(current_user))
    next_goal_state = _recompute_goal_state(goal_doc)

    # ── Persist goal update ────────────────────────────────────────────────
    await goals_col.update_one(
        {"_id": oid},
        {
            "$set": {
                "phases": goal_doc["phases"],
                "current_day_index": next_goal_state["current_day_index"],
                "current_phase_index": next_goal_state["current_phase_index"],
                "status": next_goal_state["status"],
                "completed_at": next_goal_state["completed_at"],
                "updated_at": datetime.utcnow(),
            }
        },
    )

    # ── Persist user streak + streak activity timestamp ────────────────────
    activity_now = datetime.utcnow()
    await users_col.update_one(
        {"supabase_id": current_user.supabase_id},
        {
            "$set": {
                "streak_count": streak_data["streak_count"],
                "longest_streak": streak_data["longest_streak"],
                "last_streak_date": activity_now,
                "last_seen_at": activity_now,
                # Keep legacy field in sync for older readers/jobs.
                "last_active_date": activity_now,
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
    next_topic_ref: Optional[dict] = None
    for phase in goal_doc.get("phases", []):
        for topic in phase.get("topics", []):
            if topic.get("day_index") == next_goal_state["current_day_index"] and topic.get("status") in (
                "pending",
                "in_progress",
            ):
                next_topic_title = topic["title"]
                next_topic_ref = topic
                break
        if next_topic_title:
            break

    # Prepare the next topic's links immediately so the user can inspect it
    # without waiting for the nightly resource hydration job.
    if next_topic_ref is not None and not next_topic_ref.get("resources"):
        background_tasks.add_task(
            _prepare_next_topic_resources,
            oid,
            next_topic_ref.get("topic_id", ""),
        )

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

    next_goal_state = _recompute_goal_state(goal_doc)
    await goals_col.update_one(
        {"_id": oid},
        {
            "$set": {
                "phases": goal_doc["phases"],
                "current_day_index": next_goal_state["current_day_index"],
                "current_phase_index": next_goal_state["current_phase_index"],
                "status": next_goal_state["status"],
                "completed_at": next_goal_state["completed_at"],
                "updated_at": datetime.utcnow(),
            }
        },
    )

    # Invalidate daily task cache so next GET /today recomputes
    await _del_redis(f"daily:task:{current_user.id}:{goal_id}")

    return {"message": "ok"}


@router.post("/{goal_id}/topics/{topic_id}/prepare")
async def prepare_topic_resources(
    goal_id: str,
    topic_id: str,
    force: bool = Query(False),
    current_user: UserDB = Depends(get_current_user),
):
    goals_col = get_goals_col()
    try:
        oid = ObjectId(goal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid goal_id format.")

    goal_doc = await goals_col.find_one({"_id": oid, "user_id": str(current_user.id)})
    if goal_doc is None:
        raise HTTPException(status_code=404, detail="Goal not found.")

    topic_doc, phase_doc = _find_topic_and_phase(goal_doc, topic_id)
    if topic_doc is None:
        raise HTTPException(status_code=404, detail="Topic not found in this goal.")

    has_existing_materials = bool(topic_doc.get("resources")) or bool(topic_doc.get("practice_links"))
    if has_existing_materials and not force:
        return {
            "topic": topic_doc,
            "phase_title": phase_doc.get("title", "") if phase_doc else "",
            "goal_title": goal_doc.get("title", ""),
        }

    topic_context = _build_topic_context(goal_doc, topic_id)
    generated_payload = await _curate_resources_for_topic(
        topic_doc.get("title", ""),
        goal_doc.get("domain", "other"),
        goal_doc.get("intake", {}).get("budget", "free"),
        **topic_context,
    )
    topic_doc["resources"] = generated_payload["resources"]
    topic_doc["practice_links"] = generated_payload["practice_links"]

    next_goal_state = _recompute_goal_state(goal_doc)
    await goals_col.update_one(
        {"_id": oid},
        {
            "$set": {
                "phases": goal_doc["phases"],
                "current_day_index": next_goal_state["current_day_index"],
                "current_phase_index": next_goal_state["current_phase_index"],
                "status": next_goal_state["status"],
                "completed_at": next_goal_state["completed_at"],
                "updated_at": datetime.utcnow(),
            }
        },
    )

    return {
        "topic": topic_doc,
        "phase_title": phase_doc.get("title", "") if phase_doc else "",
        "goal_title": goal_doc.get("title", ""),
    }


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

    next_goal_state = _recompute_goal_state(goal_doc)
    await goals_col.update_one(
        {"_id": oid},
        {
            "$set": {
                "phases": goal_doc["phases"],
                "current_day_index": next_goal_state["current_day_index"],
                "current_phase_index": next_goal_state["current_phase_index"],
                "status": next_goal_state["status"],
                "completed_at": next_goal_state["completed_at"],
                "updated_at": datetime.utcnow(),
            }
        },
    )

    # Invalidate daily task cache
    await _del_redis(f"daily:task:{current_user.id}:{goal_id}")

    return {"message": message, "topics_moved": topics_moved}
