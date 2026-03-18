from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
import logging
from core.sentry import capture_exception

async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(
        status_code=400,
        content={"message": str(exc), "code": "VALIDATION_FAILED"}
    )

async def http_exception_handler(request: Request, exc: HTTPException):
    header_data = getattr(exc, "headers", None)
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": exc.detail},
        headers=header_data
    )

async def global_exception_handler(request: Request, exc: Exception):
    # Log locally for server observability
    logging.error(f"Unhandled Exception on {request.method} {request.url.path}: {str(exc)}", exc_info=True)
    
    # Track the anomalous crash remotely in Sentry
    capture_exception(exc)
    
    return JSONResponse(
        status_code=500,
        content={"message": "Internal Server Error. Our team has been notified."}
    )

def register_exception_handlers(app):
    app.add_exception_handler(ValueError, value_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(Exception, global_exception_handler)
