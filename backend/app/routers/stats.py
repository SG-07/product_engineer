"""GET /v1/stats - read-only live numbers for the dashboard.

Additive: it touches none of the spec'd endpoints. The database part is cached
for a second so many open dashboards cannot multiply load on a small pool.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app import repository as repo
from app.config import Settings
from app.db import Database, utcnow
from app.deps import get_metrics, get_processor, get_session, get_settings_dep
from app.metrics import Metrics
from app.models import TxnStatus
from app.processor import Processor
from app.schemas import StatsOut

router = APIRouter(prefix="/v1", tags=["stats"])

DB_CACHE_SECONDS = 1.0


def _in_use(db: Database) -> int | None:
    pool = db.engine.sync_engine.pool
    checked_out = getattr(pool, "checkedout", None)
    return int(checked_out()) if callable(checked_out) else None


async def _database_numbers(session: AsyncSession) -> dict:
    counts = await repo.status_counts(session)
    oldest = await repo.oldest_processing_created_at(session)
    durations = await repo.recent_processing_durations(session, 50)
    return {
        "counts": counts,
        "oldest": oldest,
        "avg_processing": sum(durations) / len(durations) if durations else None,
    }


@router.get("/stats", response_model=StatsOut, summary="Live service numbers (counts, latency, pool)")
async def get_stats(
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
    processor: Processor = Depends(get_processor),
    metrics: Metrics = Depends(get_metrics),
) -> StatsOut:
    cache = request.app.state.stats_cache
    now = time.monotonic()
    if cache is not None and now < cache[0]:
        numbers = cache[1]
    else:
        numbers = await _database_numbers(session)
        request.app.state.stats_cache = (now + DB_CACHE_SECONDS, numbers)

    counts = numbers["counts"]
    processing = counts.get(TxnStatus.PROCESSING, 0)
    processed = counts.get(TxnStatus.PROCESSED, 0)
    failed = counts.get(TxnStatus.FAILED, 0)
    oldest = numbers["oldest"]
    as_of = utcnow()
    state = request.app.state
    return StatsOut(
        as_of=as_of,
        uptime_seconds=round(metrics.uptime_seconds(), 1),
        transactions={"processing": processing, "processed": processed, "failed": failed, "total": processing + processed + failed},
        in_flight_jobs=processor.in_flight,
        oldest_processing_age_seconds=round((as_of - oldest).total_seconds(), 1) if oldest else None,
        avg_processing_seconds=round(numbers["avg_processing"], 2) if numbers["avg_processing"] is not None else None,
        webhooks=metrics.snapshot(),
        db={
            "api_pool_max": settings.api_db_pool_size + settings.api_db_max_overflow,
            "api_in_use": _in_use(state.api_db),
            "worker_pool_max": settings.worker_db_pool_size + settings.worker_db_max_overflow,
            "worker_in_use": _in_use(state.worker_db),
        },
        config={
            "processing_delay_seconds": settings.processing_delay_seconds,
            "latency_budget_ms": metrics.budget_ms,
        },
    )
