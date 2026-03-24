"""
reset_demo.py — Delete all data for the demo user and re-seed.

Usage:
    cd apps/api
    python -m scripts.reset_demo --email demo@hazo.app --password Demo1234!

Deletes:
  - MongoDB: UserDB, GoalDB, SkillDB, TaskDB, MentorSessions for this user
  - Redis: daily task cards for this user
Then re-runs seed_demo.
"""

import argparse
import asyncio
import logging
import os
import sys

import redis.asyncio as aioredis
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

logger = logging.getLogger("hazo.reset_demo")
logging.basicConfig(level=logging.INFO)


async def delete_demo_data(email: str) -> None:
    """Remove all MongoDB and Redis data for the demo user."""
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client.hazo

    user_doc = await db.users.find_one({"email": email})
    if not user_doc:
        logger.info("No user found with email %s — nothing to delete.", email)
        return

    uid = user_doc.get("supabase_id", str(user_doc["_id"]))
    logger.info("Deleting data for user %s (supabase_id=%s) …", email, uid)

    # Delete from all collections
    r1 = await db.goals.delete_many({"user_id": uid})
    r2 = await db.skills.delete_many({"user_id": uid})
    r3 = await db.tasks.delete_many({"user_id": uid})
    r4 = await db.mentor_sessions.delete_many({"user_id": uid})
    r5 = await db.community_members.delete_many({"user_id": uid})
    r6 = await db.community_posts.delete_many({"user_id": uid})
    r7 = await db.users.delete_one({"_id": user_doc["_id"]})

    logger.info(
        "Deleted: %d goals, %d skills, %d tasks, %d mentor sessions, "
        "%d community members, %d community posts, %d user doc.",
        r1.deleted_count, r2.deleted_count, r3.deleted_count,
        r4.deleted_count, r5.deleted_count, r6.deleted_count,
        r7.deleted_count,
    )

    # Clean Redis keys for this user
    try:
        rdb = aioredis.from_url(REDIS_URL, decode_responses=True)
        keys = []
        async for key in rdb.scan_iter(f"daily:task:{uid}:*"):
            keys.append(key)
        async for key in rdb.scan_iter(f"mentor:rate:{uid}:*"):
            keys.append(key)
        async for key in rdb.scan_iter(f"replan:done:{uid}:*"):
            keys.append(key)
        if keys:
            await rdb.delete(*keys)
            logger.info("Deleted %d Redis keys.", len(keys))
        await rdb.close()
    except Exception as exc:
        logger.warning("Redis cleanup failed (non-fatal): %s", exc)

    print(f"🗑️  All data for {email} deleted.\n")


async def reset(email: str, password: str) -> None:
    await delete_demo_data(email)

    # Re-seed
    from scripts.seed_demo import seed
    await seed(email, password)


def main():
    parser = argparse.ArgumentParser(description="Reset and re-seed demo data for Hazo")
    parser.add_argument("--email", default="demo@hazo.app")
    parser.add_argument("--password", default="Demo1234!")
    args = parser.parse_args()
    asyncio.run(reset(args.email, args.password))


if __name__ == "__main__":
    main()
