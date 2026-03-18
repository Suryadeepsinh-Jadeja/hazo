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

@router.post("/sync", response_model=UserDB)
async def sync_user(data: SyncUserRequest):
    users_col = get_users_col()
    now = datetime.utcnow()
    
    update_data = {
        "$set": {
            "email": data.email,
            "name": data.name,
            "last_active_date": now
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

@router.get("/me", response_model=UserDB)
async def get_me(current_user: UserDB = Depends(get_current_user)):
    return current_user
