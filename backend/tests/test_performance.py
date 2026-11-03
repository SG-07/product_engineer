"""The webhook must answer fast even while lots of 30 s jobs are running.

Two tests, because they prove different things:

* test_ack_is_fast_while_jobs_are_in_flight  - runs everywhere. Sends webhooks one after
  another while up to 100 real 30 s jobs are sleeping in the background. Proves that
  background load does not slow the acknowledgement.
* test_ack_is_fast_under_concurrent_senders  - Postgres only. 20 simultaneous senders.
  SQLite allows one writer at a time (commit ~17 ms each on the dev machine), so the
  inserts queue up and p95 reaches ~1.2 s there; that says nothing about Postgres, so
  the test is skipped unless TEST_DATABASE_URL points at Postgres (CI does this).
"""

import asyncio
import os
import statistics
import time

import pytest

from tests.conftest import payload

URL = "/v1/webhooks/transactions"
LIMIT_MS = 500
ON_POSTGRES = os.environ.get("TEST_DATABASE_URL", "").startswith(("postgres://", "postgresql"))


async def _send_many(h, count: int, concurrency: int) -> list[float]:
    sem = asyncio.Semaphore(concurrency)
    latencies: list[float] = []

    async def send(i: int) -> None:
        async with sem:
            start = time.perf_counter()
            r = await h.client.post(URL, json=payload(f"txn_load_{concurrency}_{i}"))
            latencies.append((time.perf_counter() - start) * 1000)
            assert r.status_code == 202

    await asyncio.gather(*[send(i) for i in range(count)])
    return sorted(latencies)


def _report(latencies: list[float]) -> float:
    p95 = latencies[int(len(latencies) * 0.95) - 1]
    print(f"\nwebhook latency ms: p50={statistics.median(latencies):.1f} p95={p95:.1f} max={latencies[-1]:.1f}")
    return p95


async def test_ack_is_fast_while_jobs_are_in_flight(make_harness):
    async with make_harness(processing_delay_seconds=30.0, lease_seconds=90.0) as h:
        latencies = await _send_many(h, count=100, concurrency=1)
        assert h.processor.in_flight > 0  # 30 s jobs really are running in the background

        start = time.perf_counter()
        assert (await h.client.get("/")).status_code == 200
        health_ms = (time.perf_counter() - start) * 1000

    assert _report(latencies) < LIMIT_MS
    assert health_ms < LIMIT_MS


@pytest.mark.skipif(not ON_POSTGRES, reason="needs Postgres: SQLite serialises writers (see module docstring)")
async def test_ack_is_fast_under_concurrent_senders(make_harness):
    async with make_harness(processing_delay_seconds=30.0, lease_seconds=90.0) as h:
        latencies = await _send_many(h, count=200, concurrency=20)
        assert h.processor.in_flight > 0
    assert _report(latencies) < LIMIT_MS
