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
    # Start the nightly scheduler + link health checker
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from jobs.nightly_scheduler import run_nightly_scheduler
        from jobs.link_health_checker import run_link_health_checker

        _jobs_scheduler = AsyncIOScheduler()
        _jobs_scheduler.add_job(
            run_nightly_scheduler,
            "interval",
            hours=1,
            id="nightly",
            replace_existing=True,
        )
        _jobs_scheduler.add_job(
            run_link_health_checker,
            "cron",
            day_of_week="sun",
            hour=20,
            minute=30,
            id="link_health_weekly",
            replace_existing=True,
        )
        app.state.jobs_scheduler = _jobs_scheduler
        _jobs_scheduler.start()
        logging.info("APScheduler started — nightly + weekly link-health jobs active.")
    except Exception as exc:
        logging.warning("Failed to start background schedulers: %s", exc)
    yield
    # Stop the scheduler on shutdown
    try:
        sched = getattr(app.state, "jobs_scheduler", None)
        if sched:
            sched.shutdown(wait=False)
    except Exception:
        pass

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
    from routers import goals, tasks, mentor
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
