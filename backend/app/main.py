"""Application entry point: `uvicorn app.main:app`."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.db import Database
from app.metrics import Metrics
from app.processor import Processor
from app.recovery import RecoverySweeper
from app.routers import currencies, health, stats, transactions, webhooks

log = logging.getLogger("app")

LATENCY_BUDGET_MS = 500.0  # the spec: acknowledge within 500 ms
WEBHOOK_PATH = "/v1/webhooks/transactions"


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    _configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        api_db = Database(
            settings.database_url, pool_size=settings.api_db_pool_size, max_overflow=settings.api_db_max_overflow
        )
        worker_db = Database(
            settings.database_url,
            pool_size=settings.worker_db_pool_size,
            max_overflow=settings.worker_db_max_overflow,
        )
        await api_db.create_schema()
        processor = Processor(settings, worker_db)
        sweeper = RecoverySweeper(settings, worker_db, processor)

        app.state.settings = settings
        app.state.api_db = api_db
        app.state.worker_db = worker_db
        app.state.processor = processor
        app.state.sweeper = sweeper
        app.state.metrics = Metrics(budget_ms=LATENCY_BUDGET_MS)
        app.state.stats_cache = None

        if settings.sweeper_enabled:
            sweeper.start()  # first sweep runs immediately: resumes work from before a restart
        log.info("service started (db=%s, delay=%ss)", api_db.dialect, settings.processing_delay_seconds)
        try:
            yield
        finally:
            await sweeper.stop()
            await processor.shutdown()
            await api_db.dispose()
            await worker_db.dispose()
            log.info("service stopped")

    app = FastAPI(
        title="Transaction Webhook Service",
        version="1.0.0",
        description=(
            "Receives payment-processor transaction webhooks, acknowledges them immediately (202) "
            "and processes them reliably in the background. Amounts are stored in INR and can be "
            "displayed in INR, USD, EUR or GBP."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["X-Response-Time-Ms"],
    )

    @app.middleware("http")
    async def timing(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
        if request.method == "POST" and request.url.path == WEBHOOK_PATH:
            request.app.state.metrics.record_ack(elapsed_ms)
        if request.url.path != "/":
            log.info("%s %s -> %s in %.1fms", request.method, request.url.path, response.status_code, elapsed_ms)
        return response

    @app.exception_handler(SQLAlchemyError)
    async def db_error_handler(request: Request, exc: SQLAlchemyError):
        log.exception("database error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=503, content={"detail": "Database temporarily unavailable"})

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(health.router)
    app.include_router(webhooks.router)
    app.include_router(transactions.router)
    app.include_router(currencies.router)
    app.include_router(stats.router)
    return app


app = create_app()
