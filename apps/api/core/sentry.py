import sentry_sdk
import os

def init_sentry():
    dsn = os.getenv("SENTRY_DSN")
    env = os.getenv("NODE_ENV", "development")
    
    if dsn and dsn != "":
        sentry_sdk.init(
            dsn=dsn,
            environment=env,
            traces_sample_rate=0.2,
        )
        print(f"Sentry initialized in module for {env} environment.")

def capture_exception(exc: Exception):
    """
    Safe wrapper that only transmits if SDK was successfully initialized
    """
    if os.getenv("SENTRY_DSN"):
        sentry_sdk.capture_exception(exc)
