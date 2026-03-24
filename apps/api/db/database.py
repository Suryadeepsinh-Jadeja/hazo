import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import IndexModel, ASCENDING
from pymongo.errors import OperationFailure
from dotenv import load_dotenv

_API_ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv(_API_ENV_PATH)

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
client = AsyncIOMotorClient(
    MONGODB_URI,
    maxPoolSize=10,
    minPoolSize=1,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
    retryWrites=True,
)
db = client.hazo

def get_database():
    return db

def get_users_col():
    return db.users

def get_goals_col():
    return db.goals

def get_tasks_col():
    return db.tasks

def get_skills_col():
    return db.skills

def get_rooms_col():
    return db.rooms

def get_mentor_sessions_col():
    return db.mentor_sessions

async def create_indexes_safely(collection, indexes, collection_name: str):
    try:
        await collection.create_indexes(indexes)
    except OperationFailure as exc:
        message = str(exc)
        if exc.code == 85 and "already exists with a different name" in message:
            logging.warning(
                "Skipping index creation for %s because an equivalent index already exists: %s",
                collection_name,
                message,
            )
            return
        raise

async def init_indexes():
    """Create all necessary indexes and warm up the connection pool."""
    logging.info("Initializing database indexes...")

    # Warm up the connection pool eagerly so the first user request is fast
    try:
        await client.admin.command('ping')
        logging.info("MongoDB connection pool warmed up.")
    except Exception as exc:
        logging.warning("MongoDB warmup ping failed: %s", exc)
    
    users_col = get_users_col()
    await create_indexes_safely(users_col, [
        IndexModel([("supabase_id", ASCENDING)], unique=True, name="supabase_id_unique")
    ], "users")
    
    goals_col = get_goals_col()
    await create_indexes_safely(goals_col, [
        IndexModel([("user_id", ASCENDING), ("status", ASCENDING)], name="user_id_status_idx"),
        IndexModel([("user_id", ASCENDING)], name="user_id_idx")
    ], "goals")
    
    tasks_col = get_tasks_col()
    await create_indexes_safely(tasks_col, [
        IndexModel([
            ("user_id", ASCENDING), 
            ("status", ASCENDING), 
            ("due_date", ASCENDING)
        ], name="user_id_status_due_date_idx")
    ], "tasks")
    
    skills_col = get_skills_col()
    await create_indexes_safely(skills_col, [
        IndexModel([("user_id", ASCENDING), ("goal_id", ASCENDING)], name="user_id_goal_id_idx")
    ], "skills")
    
    rooms_col = get_rooms_col()
    await create_indexes_safely(rooms_col, [
        IndexModel([("domain", ASCENDING), ("is_private", ASCENDING)], name="domain_is_private_idx")
    ], "rooms")
    
    logging.info("Database indexes initialized successfully.")
