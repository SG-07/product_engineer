"""Shared test fixtures.

Tests run against SQLite by default (zero setup). Set TEST_DATABASE_URL to run
the same suite against Postgres (CI does this):

    TEST_DATABASE_URL=postgresql://user:pass@host:5432/db pytest
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
import pytest
from sqlalchemy import delete

from app.config import Settings
from app.main import create_app
from app.models import Transaction

TEST_RATES = {"INR": 1, "USD": 84, "EUR": 91, "GBP": 109}  # fixed so expected values stay stable

TEST_DEFAULTS = dict(
    fx_rates_to_inr=TEST_RATES,
    processing_delay_seconds=0.3,
    lease_seconds=3.0,
    retry_backoff_seconds=0.05,
    sweeper_interval_seconds=0.2,
    stale_unclaimed_seconds=0.5,
    max_attempts=3,
    log_level="WARNING",
    cors_origins="http://localhost:5173",
)


@dataclass
class Harness:
    app: object
    client: httpx.AsyncClient
    settings: Settings

    @property
    def processor(self):
        return self.app.state.processor

    @property
    def sweeper(self):
        return self.app.state.sweeper

    def session(self):
        return self.app.state.api_db.sessionmaker()


@pytest.fixture
def database_url(tmp_path) -> str:
    return os.environ.get("TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"


@pytest.fixture
def make_harness(database_url) -> Callable:
    @asynccontextmanager
    async def _make(reset: bool = True, **overrides) -> AsyncIterator[Harness]:
        settings = Settings(_env_file=None, database_url=database_url, **{**TEST_DEFAULTS, **overrides})
        app = create_app(settings)
        async with app.router.lifespan_context(app):
            if reset:
                async with app.state.api_db.sessionmaker() as s:
                    await s.execute(delete(Transaction))
                    await s.commit()
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                yield Harness(app=app, client=client, settings=settings)

    return _make


@pytest.fixture
async def h(make_harness) -> AsyncIterator[Harness]:
    async with make_harness() as harness:
        yield harness


def payload(txn_id: str = "txn_abc123def456", **overrides) -> dict:
    body = {
        "transaction_id": txn_id,
        "source_account": "acc_user_789",
        "destination_account": "acc_merchant_456",
        "amount": 1500,
        "currency": "INR",
    }
    body.update(overrides)
    return body


async def wait_for_status(client: httpx.AsyncClient, txn_id: str, statuses=("PROCESSED", "FAILED"), timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = await client.get(f"/v1/transactions/{txn_id}")
        if r.status_code == 200 and r.json()[0]["status"] in statuses:
            return r.json()[0]
        await asyncio.sleep(0.05)
    raise AssertionError(f"{txn_id} did not reach {statuses} within {timeout}s (last: {r.status_code} {r.text})")
