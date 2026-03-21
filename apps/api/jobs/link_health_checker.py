"""
link_health_checker.py — Weekly resource link health checker for Stride.

Runs every Sunday at 20:30 UTC (~midnight IST) via APScheduler.
For every active goal → every resource in every topic:
  1. Check Redis cache (TTL 7 days).
  2. HTTP HEAD the URL.
  3. If alive: mark verified.
  4. If broken: find replacement via Gemini, verify the replacement.
  5. Persist changes to MongoDB.
"""

import asyncio
import hashlib
import json
import logging
import os
import sys
from datetime import datetime
from typing import Any, Dict, Optional

import httpx
import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from db.database import get_goals_col
from packages.ai.gemini_client import call_gemini_json
from packages.ai.prompts import resource_curation_prompt

logger = logging.getLogger("stride.jobs.link_health")

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
_LINK_TTL_SECONDS = 7 * 24 * 3600  # 7 days
_HEAD_TIMEOUT = 5.0  # seconds


def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(_REDIS_URL, decode_responses=True)


def _url_cache_key(url: str) -> str:
    digest = hashlib.md5(url.encode()).hexdigest()
    return f"link:health:{digest}"


async def _head_check(client: httpx.AsyncClient, url: str) -> bool:
    """Return True if HEAD on the URL returns a 2xx status."""
    try:
        resp = await client.head(url, follow_redirects=True, timeout=_HEAD_TIMEOUT)
        return resp.status_code < 300
    except Exception:
        return False


async def _find_replacement(
    topic_title: str,
    domain: str,
    budget: str,
    broken_url: str,
    client: httpx.AsyncClient,
) -> Optional[Dict[str, Any]]:
    """Ask Gemini for replacement resources, return first valid one."""
    try:
        resources = await call_gemini_json(
            resource_curation_prompt(
                topic_title=topic_title,
                domain=domain,
                budget=budget,
            )
        )
        if not isinstance(resources, list):
            return None
        for r in resources:
            new_url = r.get("url", "")
            if new_url and new_url != broken_url:
                if await _head_check(client, new_url):
                    return r  # type: ignore[return-value]
    except Exception as exc:
        logger.warning("Gemini replacement search failed: %s", exc)
    return None


async def run_link_health_checker() -> None:
    """Main entry point: check all resources across all active goals."""
    logger.info("Link health checker started at %s UTC", datetime.utcnow().isoformat())

    goals_col = get_goals_col()
    rdb = _get_redis()

    checked = 0
    fixed = 0

    async with httpx.AsyncClient() as http:
        async for goal_doc in goals_col.find({"status": "active"}):
            goal_id = goal_doc["_id"]
            domain = goal_doc.get("domain", "swe_career")
            budget = goal_doc.get("intake", {}).get("budget", "free")

            phases = goal_doc.get("phases", [])
            for p_idx, phase in enumerate(phases):
                topics = phase.get("topics", [])
                for t_idx, topic in enumerate(topics):
                    topic_title = topic.get("title", "")
                    resources = topic.get("resources", [])

                    for r_idx, resource in enumerate(resources):
                        url = resource.get("url", "")
                        if not url:
                            continue

                        checked += 1
                        cache_key = _url_cache_key(url)
                        cached = await rdb.get(cache_key)

                        # ── Step 1: Redis cache hit ────────────────────
                        if cached == "alive":
                            continue  # still healthy

                        # ── Step 2 & 3: HEAD check ─────────────────────
                        is_alive = await _head_check(http, url)
                        mongo_path = (
                            f"phases.{p_idx}.topics.{t_idx}.resources.{r_idx}"
                        )

                        if is_alive:
                            await rdb.setex(cache_key, _LINK_TTL_SECONDS, "alive")
                            await goals_col.update_one(
                                {"_id": goal_id},
                                {
                                    "$set": {
                                        f"{mongo_path}.is_broken": False,
                                        f"{mongo_path}.verified_at": datetime.utcnow(),
                                    }
                                },
                            )
                            continue

                        # ── Step 4: Broken — find replacement ──────────
                        replacement = await _find_replacement(
                            topic_title=topic_title,
                            domain=domain,
                            budget=budget,
                            broken_url=url,
                            client=http,
                        )

                        if replacement:
                            new_url = replacement.get("url", url)
                            await goals_col.update_one(
                                {"_id": goal_id},
                                {
                                    "$set": {
                                        f"{mongo_path}.url": new_url,
                                        f"{mongo_path}.title": replacement.get("title", resource.get("title", "")),
                                        f"{mongo_path}.is_broken": False,
                                        f"{mongo_path}.verified_at": datetime.utcnow(),
                                    }
                                },
                            )
                            await rdb.setex(_url_cache_key(new_url), _LINK_TTL_SECONDS, "alive")
                            fixed += 1
                        else:
                            # No valid replacement found — mark broken
                            await goals_col.update_one(
                                {"_id": goal_id},
                                {
                                    "$set": {
                                        f"{mongo_path}.is_broken": True,
                                        f"{mongo_path}.verified_at": datetime.utcnow(),
                                    }
                                },
                            )

    logger.info(
        "Link health checker complete: checked %d resources, fixed %d broken links.",
        checked,
        fixed,
    )

# ---------------------------------------------------------------------------
# APScheduler setup
# ---------------------------------------------------------------------------

from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()
scheduler.add_job(
    run_link_health_checker,
    "cron",
    day_of_week="sun",
    hour=20,
    minute=30,
    id="link_health_weekly",
    replace_existing=True,
)
