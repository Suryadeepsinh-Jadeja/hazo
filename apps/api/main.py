from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
from core.sentry import init_sentry
from core.error_handler import register_exception_handlers
from db.database import init_indexes

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_sentry()
    await init_indexes()
    yield

app = FastAPI(lifespan=lifespan)
register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"


def include_legacy_and_v1(router_module, prefix: str):
    # Keep existing local routes working while exposing the versioned API
    # paths the React Native app calls.
    app.include_router(router_module.router, prefix=prefix)
    app.include_router(router_module.router, prefix=f"{API_PREFIX}{prefix}")


try:
    from routers import auth
    include_legacy_and_v1(auth, "/auth")
except ImportError as exc:
    logging.warning("Failed to load auth router: %s", exc)

try:
    from apps.api.routers import goals, tasks, mentor
    app.include_router(goals.router,  prefix="/api/v1", tags=["goals"])
    app.include_router(tasks.router,  prefix="/api/v1", tags=["tasks"])
    app.include_router(mentor.router, prefix="/api/v1", tags=["mentor"])
except ImportError as exc:
    logging.warning("Failed to load core routers: %s", exc)

try:
    from routers import skills
    include_legacy_and_v1(skills, "/skills")
except ImportError as exc:
    logging.warning("Failed to load skills router: %s", exc)

try:
    from routers import community
    include_legacy_and_v1(community, "/community")
except ImportError as exc:
    logging.warning("Failed to load community router: %s", exc)

try:
    from routers import users
    include_legacy_and_v1(users, "/users")
except ImportError as exc:
    logging.warning("Failed to load users router: %s", exc)
