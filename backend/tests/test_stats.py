import pytest

from app.metrics import Metrics, percentile
from app.routers import stats as stats_router
from tests.conftest import payload, wait_for_status

URL = "/v1/webhooks/transactions"


@pytest.fixture(autouse=True)
def no_cache(monkeypatch):
    monkeypatch.setattr(stats_router, "DB_CACHE_SECONDS", 0.0)


async def test_stats_on_empty_service(h):
    r = await h.client.get("/v1/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["transactions"] == {"processing": 0, "processed": 0, "failed": 0, "total": 0}
    assert body["in_flight_jobs"] == 0
    assert body["oldest_processing_age_seconds"] is None
    assert body["avg_processing_seconds"] is None
    assert body["webhooks"]["window"] == 0
    assert body["webhooks"]["ack_ms"] == {"p50": None, "p95": None, "max": None}
    assert body["config"]["latency_budget_ms"] == 500
    assert body["as_of"].endswith("Z")


async def test_counts_follow_the_transaction_lifecycle(make_harness):
    async with make_harness(processing_delay_seconds=0.6) as h:
        await h.client.post(URL, json=payload("txn_stats_1"))
        mid = (await h.client.get("/v1/stats")).json()
        assert mid["transactions"]["processing"] == 1
        assert mid["in_flight_jobs"] == 1
        assert mid["oldest_processing_age_seconds"] is not None

        await wait_for_status(h.client, "txn_stats_1")
        done = (await h.client.get("/v1/stats")).json()
        assert done["transactions"] == {"processing": 0, "processed": 1, "failed": 0, "total": 1}
        assert done["avg_processing_seconds"] is not None and done["avg_processing_seconds"] >= 0.5


async def test_failed_transactions_are_counted(make_harness):
    async with make_harness(simulated_failure_rate=1.0, max_attempts=2) as h:
        await h.client.post(URL, json=payload("txn_stats_fail"))
        await wait_for_status(h.client, "txn_stats_fail", statuses=("FAILED",))
        body = (await h.client.get("/v1/stats")).json()
        assert body["transactions"]["failed"] == 1


async def test_webhook_outcomes_are_counted(h):
    await h.client.post(URL, json=payload("txn_out_1"))
    for _ in range(3):
        await h.client.post(URL, json=payload("txn_out_1"))  # identical -> duplicate
    await h.client.post(URL, json=payload("txn_out_1", amount=999))  # same id, new amount -> 409
    await h.client.post(URL, json=payload("txn_out_bad", currency="JPY"))  # invalid -> 422
    w = (await h.client.get("/v1/stats")).json()["webhooks"]
    assert (w["accepted"], w["duplicate"], w["conflict"], w["rejected"]) == (1, 3, 1, 1)


async def test_ack_latency_is_recorded_for_webhooks_only(h):
    await h.client.get("/")
    await h.client.get("/v1/transactions")
    assert (await h.client.get("/v1/stats")).json()["webhooks"]["window"] == 0

    for i in range(5):
        await h.client.post(URL, json=payload(f"txn_lat_{i}"))
    w = (await h.client.get("/v1/stats")).json()["webhooks"]
    assert w["window"] == 5 and w["per_minute"] == 5
    assert 0 < w["ack_ms"]["p50"] <= w["ack_ms"]["p95"] <= w["ack_ms"]["max"]
    assert w["over_budget_pct"] == 0.0


async def test_db_section_reports_pool_limits(make_harness):
    async with make_harness(api_db_pool_size=2, api_db_max_overflow=1) as h:
        db = (await h.client.get("/v1/stats")).json()["db"]
        assert db["api_pool_max"] == 3
        assert db["worker_pool_max"] == 5
        if h.app.state.api_db.dialect != "sqlite":  # Postgres pools can report live checkouts
            assert isinstance(db["api_in_use"], int) and db["api_in_use"] >= 1


async def test_database_part_is_cached_briefly(h, monkeypatch):
    monkeypatch.setattr(stats_router, "DB_CACHE_SECONDS", 60.0)
    await h.client.get("/v1/stats")
    await h.client.post(URL, json=payload("txn_cache_1"))
    cached = (await h.client.get("/v1/stats")).json()
    assert cached["transactions"]["total"] == 0  # served from cache
    assert cached["webhooks"]["accepted"] == 1  # in-memory numbers are always live


async def test_spec_endpoints_are_untouched_by_stats(h):
    health = (await h.client.get("/")).json()
    assert health["status"] == "HEALTHY" and set(health) == {"status", "current_time"}
    r = await h.client.post(URL, json=payload("txn_spec_ok"))
    assert r.status_code == 202 and "X-Response-Time-Ms" in r.headers


def test_percentile_nearest_rank():
    values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    assert percentile(values, 50) == 50
    assert percentile(values, 95) == 100
    assert percentile([], 50) is None


def test_metrics_window_is_bounded():
    m = Metrics()
    for i in range(Metrics.WINDOW + 50):
        m.record_ack(float(i))
    assert m.snapshot()["window"] == Metrics.WINDOW
