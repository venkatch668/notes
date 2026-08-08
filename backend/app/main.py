"""Application entry point: wiring only.

Creates the app, installs middleware and error handling, mounts the router.
No business logic lives here — if this file starts growing conditionals,
something belongs in a service instead.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes import router as api_router
from app.config import get_settings
from app.db import SessionFactory, dispose_engine
from app.errors import AppError

settings = get_settings()
logging.basicConfig(level=settings.log_level)
log = logging.getLogger("work-notebook")

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    log.info("Starting in %s mode", settings.environment)
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Work Notebook API",
        version="0.1.0",
        summary="Backend for the OneNote-style daily work notebook",
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        """One place decides how a domain failure becomes an HTTP response."""
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, **exc.details}},
        )

    @app.get("/health", tags=["ops"])
    async def health() -> dict[str, str]:
        """Liveness only — no database call, so a slow query cannot make the
        platform think the process is dead and restart it mid-request."""
        return {"status": "ok", "environment": settings.environment}

    @app.get("/health/ready", tags=["ops"])
    async def ready() -> JSONResponse:
        """Readiness — proves the database is actually reachable."""
        try:
            async with SessionFactory() as session:
                await session.execute(text("SELECT 1"))
            return JSONResponse({"status": "ready", "database": "up"})
        except Exception as exc:  # noqa: BLE001 - report any failure as not-ready
            log.exception("Readiness check failed")
            return JSONResponse(
                status_code=503,
                content={"status": "not-ready", "database": "down", "detail": str(exc)},
            )

    app.include_router(api_router, prefix=API_PREFIX)
    return app


app = create_app()
