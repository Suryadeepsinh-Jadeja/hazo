import os
from datetime import datetime
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from dotenv import load_dotenv

from db.database import get_users_col
from db.models import UserDB

load_dotenv()

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
ALGORITHM = "HS256"

security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

async def verify_token(token: str) -> dict:
    try:
        # Supabase uses 'authenticated' as the audience for valid access tokens
        payload = jwt.decode(
            token, 
            SUPABASE_JWT_SECRET, 
            algorithms=[ALGORITHM], 
            audience="authenticated"
        )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> UserDB:
    payload = await verify_token(credentials.credentials)
    supabase_id = payload.get("sub")
    email = payload.get("email")
    if supabase_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    users_col = get_users_col()
    
    # Upsert user in db
    now = datetime.utcnow()
    update_data = {
        "$set": {
            "last_active_date": now,
        },
        "$setOnInsert": {
            "supabase_id": supabase_id,
            "email": email,
            "name": payload.get("user_metadata", {}).get("name", "User"),
            "created_at": now
        }
    }
    
    user_doc = await users_col.find_one_and_update(
        {"supabase_id": supabase_id},
        update_data,
        upsert=True,
        return_document=True
    )
    
    return UserDB(**user_doc)

async def optional_auth(credentials: HTTPAuthorizationCredentials = Depends(optional_security)) -> UserDB | None:
    if not credentials:
        return None
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None
