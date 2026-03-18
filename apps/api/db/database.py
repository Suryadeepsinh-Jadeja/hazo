import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import IndexModel, ASCENDING
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
client = AsyncIOMotorClient(MONGODB_URI)
db = client.stride

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

async def init_indexes():
    """Create all necessary indexes in MongoDB."""
    logging.info("Initializing database indexes...")
    
    users_col = get_users_col()
    await users_col.create_indexes([
        IndexModel([("supabase_id", ASCENDING)], unique=True)
    ])
    
    goals_col = get_goals_col()
    await goals_col.create_indexes([
        IndexModel([("user_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("user_id", ASCENDING)])
    ])
    
    tasks_col = get_tasks_col()
    await tasks_col.create_indexes([
        IndexModel([
            ("user_id", ASCENDING), 
            ("status", ASCENDING), 
            ("due_date", ASCENDING)
        ])
    ])
    
    skills_col = get_skills_col()
    await skills_col.create_indexes([
        IndexModel([("user_id", ASCENDING), ("goal_id", ASCENDING)])
    ])
    
    rooms_col = get_rooms_col()
    await rooms_col.create_indexes([
        IndexModel([("domain", ASCENDING), ("is_private", ASCENDING)])
    ])
    
    logging.info("Database indexes initialized successfully.")
