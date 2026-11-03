from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.deps import get_session
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])
log = logging.getLogger("app.health")


def _now_iso() -> str:
    return utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/", response_model=HealthResponse, summary="Liveness check")
async def health() -> HealthResponse:
    """Cheap liveness probe (no DB call) - used by Render and keep-alive pingers."""
    return HealthResponse(status="HEALTHY", current_time=_now_iso())


@router.get("/health/ready", response_model=HealthResponse, summary="Readiness check (includes database)")
async def ready(session: AsyncSession = Depends(get_session)):
    try:
        await session.execute(text("SELECT 1"))
        return HealthResponse(status="HEALTHY", current_time=_now_iso())
    except Exception:  # noqa: BLE001
        log.exception("readiness check failed")
        return JSONResponse(status_code=503, content={"status": "UNHEALTHY", "current_time": _now_iso()})
