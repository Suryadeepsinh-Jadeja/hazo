"""
goals.py — all goal and roadmap endpoints for Hazo.

Endpoints:
  POST   /onboard/start
  POST   /onboard/followups
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
    followup_questions_prompt,
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
# Common onboarding questions
# ---------------------------------------------------------------------------

COMMON_ONBOARDING_QUESTIONS: List[Dict[str, str]] = [
    {
        "field_name": "timeline",
        "question_text": "What is your target timeline for this goal? Give a concrete range or date if you can.",
        "input_type": "text",
    },
    {
        "field_name": "dailyHours",
        "question_text": "On most days, how many hours can you realistically dedicate to this goal?",
        "input_type": "numeric",
    },
    {
        "field_name": "priorKnowledge",
        "question_text": "What is your current level or prior experience in this area?",
        "input_type": "text",
    },
    {
        "field_name": "budget",
        "question_text": "Are you limited to free resources, or are you open to paid resources if they are worth it?",
        "input_type": "budget",
    },
    {
        "field_name": "existingMaterials",
        "question_text": "Do you already have a syllabus, book list, course, notes, or any resources you want Hazo to take into account?",
        "input_type": "text",
    },
]

COMMON_QUESTION_FIELDS = {
    question["field_name"]
    for question in COMMON_ONBOARDING_QUESTIONS
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


def _get_common_questions() -> List[Dict[str, str]]:
    return [dict(question) for question in COMMON_ONBOARDING_QUESTIONS]


def _question_lookup(questions: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    for question in questions:
        field_name = str(question.get("field_name", "")).strip()
        if field_name:
            lookup[field_name] = question
    return lookup


def _build_question_answer_pairs(
    questions: List[Dict[str, Any]],
    answers: Dict[str, Any],
) -> List[Dict[str, str]]:
    pairs: List[Dict[str, str]] = []
    lookup = _question_lookup(questions)
    seen_fields: set[str] = set()

    for question in questions:
        field_name = str(question.get("field_name", "")).strip()
        if not field_name:
            continue

        answer = answers.get(field_name)
        if answer in (None, ""):
            continue

        pairs.append(
            {
                "field_name": field_name,
                "question_text": str(question.get("question_text", field_name)).strip(),
                "answer": str(answer).strip(),
            }
        )
        seen_fields.add(field_name)

    for field_name, answer in answers.items():
        if field_name in seen_fields or answer in (None, ""):
            continue

        question = lookup.get(field_name, {})
        pairs.append(
            {
                "field_name": str(field_name),
                "question_text": str(question.get("question_text", field_name)).strip(),
                "answer": str(answer).strip(),
            }
        )

    return pairs


def _derive_prior_knowledge(all_answers: Dict[str, Any]) -> str:
    return str(
        all_answers.get("priorKnowledge")
        or all_answers.get("dsaLevel")
        or all_answers.get("knowledgeLevel")
        or all_answers.get("experienceLevel")
        or all_answers.get("currentFitnessLevel")
        or all_answers.get("currentLevel")
        or all_answers.get("currentStack")
        or "beginner"
    ).strip()


def _derive_external_materials(all_answers: Dict[str, Any]) -> str:
    return str(
        all_answers.get("existingMaterials")
        or all_answers.get("hasSyllabus")
        or all_answers.get("existingResources")
        or all_answers.get("existingMaterialsOrSyllabus")
        or ""
    ).strip()


def _derive_domain_specific_context(qa_pairs: List[Dict[str, str]]) -> str:
    contextual_lines: List[str] = []
    for pair in qa_pairs:
        field_name = pair.get("field_name", "")
        if field_name in COMMON_QUESTION_FIELDS:
            continue

        question_text = pair.get("question_text", field_name).strip()
        answer = pair.get("answer", "").strip()
        if answer:
            contextual_lines.append(f"{question_text}: {answer}")

    return " | ".join(contextual_lines[:8])


def _derive_learner_constraints(all_answers: Dict[str, Any]) -> str:
    candidate_fields = [
        "timeline",
        "targetTier",
        "targetLanguage",
        "projectGoal",
        "purpose",
        "examNameAndDate",
        "specificGoal",
        "gymAccess",
        "injuries",
    ]
    parts: List[str] = []
    for field_name in candidate_fields:
        value = str(all_answers.get(field_name, "")).strip()
        if value:
            parts.append(f"{field_name}: {value}")
    return " | ".join(parts[:6])


def _summarize_availability(user_doc: Optional[dict]) -> str:
    if not user_doc:
        return ""

    availability = user_doc.get("availability") or {}
    if not isinstance(availability, dict):
        return ""

    weekday_order = [
        ("monday", "Mon"),
        ("tuesday", "Tue"),
        ("wednesday", "Wed"),
        ("thursday", "Thu"),
        ("friday", "Fri"),
        ("saturday", "Sat"),
        ("sunday", "Sun"),
    ]
    day_summaries: List[str] = []
    for key, label in weekday_order:
        blocks = availability.get(key) or []
        if not isinstance(blocks, list) or not blocks:
            continue

        rendered_blocks: List[str] = []
        for block in blocks[:3]:
            if not isinstance(block, dict):
                continue
            start = str(block.get("start", "")).strip()
            end = str(block.get("end", "")).strip()
            if start and end:
                rendered_blocks.append(f"{start}-{end}")

        if rendered_blocks:
            day_summaries.append(f"{label} {' , '.join(rendered_blocks)}".replace(" , ", ", "))

    return "; ".join(day_summaries)


def _fallback_followup_questions(domain: str, stage: int) -> List[Dict[str, str]]:
    domain_label = domain.replace("_", " ")
    if stage == 1:
        return [
            {
                "field_name": "successDefinition",
                "question_text": f"For this {domain_label} goal, what would success look like in a measurable or concrete way?",
                "input_type": "text",
            },
            {
                "field_name": "weakAreas",
                "question_text": "Which parts feel hardest, weakest, or most confusing right now?",
                "input_type": "text",
            },
            {
                "field_name": "targetContext",
                "question_text": "Is there any specific target, syllabus, company, project, exam section, or outcome Hazo should optimize for?",
                "input_type": "text",
            },
        ]

    return [
        {
            "field_name": "preferredLearningStyle",
            "question_text": "How do you learn best for this goal: explanations, practice, projects, revision, mock tests, or a mix?",
            "input_type": "text",
        },
        {
            "field_name": "resourcePreferences",
            "question_text": "Are there any resource types or sources you want Hazo to prefer or avoid?",
            "input_type": "text",
        },
    ]


async def _generate_followup_questions(
    *,
    session: Dict[str, Any],
    goal_text: str,
    domain: str,
    answers: Dict[str, Any],
    stage: int,
) -> List[Dict[str, str]]:
    question_count = 3 if stage == 1 else 2
    result = await call_gemini_json(
        followup_questions_prompt(
            domain=domain,
            goal_text=goal_text,
            prior_answers=answers,
            asked_questions=session.get("asked_questions", []),
            stage=stage,
            question_count=question_count,
        )
    )

    questions_raw = result.get("questions", []) if isinstance(result, dict) else []
    normalized: List[Dict[str, str]] = []
    seen_fields: set[str] = set()

    for idx, question in enumerate(questions_raw):
        if not isinstance(question, dict):
            continue

        field_name = str(question.get("field_name", "")).strip()
        question_text = str(question.get("question_text", "")).strip()
        input_type = str(question.get("input_type", "text")).strip().lower() or "text"

        if not field_name or not question_text or field_name in seen_fields:
            continue
        if input_type not in {"text", "numeric", "budget"}:
            input_type = "text"

        seen_fields.add(field_name)
        normalized.append(
            {
                "field_name": field_name,
                "question_text": question_text,
                "input_type": input_type,
            }
        )

    return normalized[:question_count] or _fallback_followup_questions(domain, stage)[:question_count]


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
    learner_constraints: str = "",
    resource_queries: Optional[List[str]] = None,
) -> Dict[str, List[dict]]:
    prompt_kwargs = {
        "goal_title": goal_title,
        "phase_title": phase_title,
        "phase_topics": phase_topics or [],
        "previous_topic_title": previous_topic_title,
        "next_topic_title": next_topic_title,
        "prior_knowledge": prior_knowledge,
        "domain_specific_answer": domain_specific_answer,
        "learner_constraints": learner_constraints,
        "resource_queries": resource_queries or [],
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
                    "learner_constraints": goal_doc.get("intake", {}).get("learner_constraints", ""),
                    "resource_queries": topic.get("resource_queries", []),
                }

    return {
        "goal_title": goal_doc.get("title", ""),
        "phase_title": "",
        "phase_topics": [],
        "previous_topic_title": "",
        "next_topic_title": "",
        "prior_knowledge": goal_doc.get("intake", {}).get("prior_knowledge", ""),
        "domain_specific_answer": goal_doc.get("intake", {}).get("domain_specific_answer", ""),
        "learner_constraints": goal_doc.get("intake", {}).get("learner_constraints", ""),
        "resource_queries": [],
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


async def _ensure_goal_state_consistency(goals_col, goal_doc: dict) -> dict:
    next_goal_state = _recompute_goal_state(goal_doc)
    current_snapshot = {
        "current_day_index": goal_doc.get("current_day_index"),
        "current_phase_index": goal_doc.get("current_phase_index"),
        "status": goal_doc.get("status"),
        "completed_at": goal_doc.get("completed_at"),
    }

    if current_snapshot == next_goal_state:
        return goal_doc

    goal_doc["current_day_index"] = next_goal_state["current_day_index"]
    goal_doc["current_phase_index"] = next_goal_state["current_phase_index"]
    goal_doc["status"] = next_goal_state["status"]
    goal_doc["completed_at"] = next_goal_state["completed_at"]

    if goal_doc.get("_id") is not None:
        await goals_col.update_one(
            {"_id": goal_doc["_id"]},
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

    return goal_doc


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class OnboardStartRequest(BaseModel):
    goal_text: str


class OnboardQ6Request(BaseModel):
    session_id: str
    answers: dict


class OnboardFollowupsRequest(BaseModel):
    session_id: str
    answers: dict
    stage: int


class OnboardCompleteRequest(BaseModel):
    session_id: str
    all_answers: dict


class TopicCompleteResponse(BaseModel):
    streak_count: int
    mastery_updated: bool
    next_topic_title: Optional[str]
    goal_completed: bool = False
    completed_goal_title: Optional[str] = None


# ---------------------------------------------------------------------------
# Background task: roadmap generation
# ---------------------------------------------------------------------------

async def _generate_roadmap_background(
    session_id: str,
    user_id: str,
    goal_text: str,
    domain: str,
    all_answers: dict,
    asked_questions: List[Dict[str, Any]],
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
        daily_hours = float(all_answers.get("dailyHours", 2) or 2)
        timeline_days = _derive_timeline_days(all_answers)
        user_doc = await users_col.find_one({"_id": ObjectId(user_id)})
        qa_pairs = _build_question_answer_pairs(asked_questions, all_answers)

        profile = {
            "goal_title": goal_text,
            "domain": domain,
            "timeline_days": timeline_days,
            "daily_hours": daily_hours,
            "prior_knowledge": _derive_prior_knowledge(all_answers),
            "budget": all_answers.get("budget", "free"),
            "external_materials": _derive_external_materials(all_answers),
            "domain_specific_answer": _derive_domain_specific_context(qa_pairs),
            "learner_constraints": _derive_learner_constraints(all_answers),
            "availability_summary": _summarize_availability(user_doc),
            "answers": all_answers,
            "qa_pairs": qa_pairs,
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
                        learner_constraints=profile["learner_constraints"],
                        resource_queries=topic.get("resource_queries", []),
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
                learner_constraints=profile["learner_constraints"] or None,
                availability_summary=profile["availability_summary"] or None,
                full_answers=all_answers,
                qa_pairs=qa_pairs,
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
    Step 1 of onboarding. Classifies the goal domain and returns common setup questions.
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

    # 2. Return shared onboarding questions first; the next batches are generated later.
    questions = _get_common_questions()

    # 3. Store session in Redis
    session_data = {
        "domain": domain,
        "goal_text": body.goal_text,
        "questions": questions,
        "asked_questions": questions,
        "answers": {},
        "followup_batches": {},
    }
    session_key = f"onboard:{current_user.id}"
    await _set_redis_json(session_key, session_data, ex=7200)

    return {
        "session_id": str(current_user.id),
        "domain": domain,
        "confidence": confidence,
        "questions": questions,
    }


# ── POST /onboard/followups ───────────────────────────────────────────────

@router.post("/onboard/followups")
async def onboard_followups(
    body: OnboardFollowupsRequest,
    current_user: UserDB = Depends(get_current_user),
):
    session_key = f"onboard:{body.session_id}"
    session = await _get_redis_json(session_key)
    if session is None:
        raise HTTPException(status_code=404, detail="Onboarding session not found or expired.")

    stage = max(1, min(int(body.stage), 2))
    session["answers"].update(_normalise_onboarding_answers(session, body.answers))

    cached_batches = session.get("followup_batches") or {}
    cached_questions = cached_batches.get(str(stage))
    if cached_questions:
        return {"stage": stage, "questions": cached_questions}

    try:
        questions = await _generate_followup_questions(
            session=session,
            goal_text=session["goal_text"],
            domain=session["domain"],
            answers=session["answers"],
            stage=stage,
        )
    except Exception as exc:
        logger.warning("Falling back to static onboarding follow-ups for stage %s: %s", stage, exc)
        questions = _fallback_followup_questions(session["domain"], stage)

    session.setdefault("asked_questions", []).extend(questions)
    cached_batches[str(stage)] = questions
    session["followup_batches"] = cached_batches
    await _set_redis_json(session_key, session, ex=7200)

    return {"stage": stage, "questions": questions}


# ── POST /onboard/q6 ──────────────────────────────────────────────────────

@router.post("/onboard/q6")
async def onboard_q6(
    body: OnboardQ6Request,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Backward-compatible single-question endpoint for older clients.
    """
    try:
        followup_result = await onboard_followups(
            OnboardFollowupsRequest(
                session_id=body.session_id,
                answers=body.answers,
                stage=1,
            ),
            current_user=current_user,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI Q6 generation failed: {exc}",
        )
    questions = followup_result.get("questions", [])
    first_question = questions[0] if questions else {
        "question_text": "What is the biggest thing that should shape this roadmap?",
        "field_name": "domainSpecificAnswer",
    }

    return {
        "question": first_question.get("question_text", ""),
        "field_name": first_question.get("field_name", "domainSpecificAnswer"),
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
        asked_questions=session.get("asked_questions", []),
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
        doc = await _ensure_goal_state_consistency(goals_col, doc)
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

    doc = await _ensure_goal_state_consistency(goals_col, doc)
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

    doc = await _ensure_goal_state_consistency(goals_col, doc)
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

    previous_goal_status = goal_doc.get("status")

    # ── Streak logic ───────────────────────────────────────────────────────
    streak_data = _compute_streak(current_user, _resolve_last_streak_date(current_user))
    next_goal_state = _recompute_goal_state(goal_doc)
    goal_completed = (
        next_goal_state["status"] == "completed"
        and previous_goal_status != "completed"
    )

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
    topic_keywords = [
        re.escape(part)
        for part in topic_title_lower.split()
        if part.strip()
    ][:3]
    matched_skill = None
    if topic_keywords:
        matched_skill = await skills_col.find_one(
            {
                "user_id": str(current_user.id),
                "goal_id": goal_id,
                "name": {
                    "$regex": "|".join(topic_keywords),
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
        goal_completed=goal_completed,
        completed_goal_title=goal_doc.get("title"),
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
