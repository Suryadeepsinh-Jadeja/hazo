import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from datetime import datetime

from core.auth import get_current_user
from db.models import UserDB
from db.database import get_users_col

router = APIRouter()

class SyncUserRequest(BaseModel):
    supabase_id: str
    email: str
    name: str


class EmailStatusRequest(BaseModel):
    email: str


class EmailStatusResponse(BaseModel):
    exists: bool

@router.post("/sync", response_model=UserDB)
async def sync_user(data: SyncUserRequest):
    users_col = get_users_col()
    now = datetime.utcnow()
    normalized_email = data.email.strip().lower()
    
    update_data = {
        "$set": {
            "email": normalized_email,
            "name": data.name,
            "last_seen_at": now,
        },
        "$setOnInsert": {
            "supabase_id": data.supabase_id,
            "created_at": now
        }
    }
    
    user_doc = await users_col.find_one_and_update(
        {"supabase_id": data.supabase_id},
        update_data,
        upsert=True,
        return_document=True
    )
    
    return UserDB(**user_doc)


@router.post("/email-status", response_model=EmailStatusResponse)
async def email_status(payload: EmailStatusRequest):
    users_col = get_users_col()
    normalized_email = payload.email.strip().lower()
    if not normalized_email:
        return EmailStatusResponse(exists=False)

    existing_user = await users_col.find_one(
        {"email": {"$regex": f"^{re.escape(normalized_email)}$", "$options": "i"}},
        {"_id": 1},
    )
    return EmailStatusResponse(exists=existing_user is not None)

@router.get("/me", response_model=UserDB)
async def get_me(current_user: UserDB = Depends(get_current_user)):
    return current_user
