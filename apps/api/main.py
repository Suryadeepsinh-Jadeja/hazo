from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from core.sentry import init_sentry
from core.error_handler import register_exception_handlers

def init_indexes():
    pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_sentry()
    init_indexes()
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

try:
    from routers import auth
    app.include_router(auth.router, prefix="/auth")
except ImportError:
    pass

try:
    from routers import goals
    app.include_router(goals.router, prefix="/goals")
except ImportError:
    pass

try:
    from routers import tasks
    app.include_router(tasks.router, prefix="/tasks")
except ImportError:
    pass

try:
    from routers import mentor
    app.include_router(mentor.router, prefix="/mentor")
except ImportError:
    pass

try:
    from routers import skills
    app.include_router(skills.router, prefix="/skills")
except ImportError:
    pass

try:
    from routers import community
    app.include_router(community.router, prefix="/community")
except ImportError:
    pass

try:
    from routers import users
    app.include_router(users.router, prefix="/users")
except ImportError:
    pass
