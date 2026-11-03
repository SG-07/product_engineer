from app.processor import SimulatedProcessingError
from tests.conftest import payload, wait_for_status

URL = "/v1/webhooks/transactions"


async def test_permanent_failure_ends_in_failed_after_max_attempts(make_harness):
    async with make_harness(simulated_failure_rate=1.0, max_attempts=3, processing_delay_seconds=0.05) as h:
        await h.client.post(URL, json=payload("txn_fail"))
        done = await wait_for_status(h.client, "txn_fail")
        assert done["status"] == "FAILED"
        assert done["attempts"] == 3
        assert "simulated" in done["last_error"]
        assert done["processed_at"] is None


async def test_transient_failure_is_retried_then_processed(h, monkeypatch):
    calls = {"n": 0}
    real = h.processor._simulate_external_call

    async def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise SimulatedProcessingError("temporary glitch")
        await real()

    monkeypatch.setattr(h.processor, "_simulate_external_call", flaky)
    await h.client.post(URL, json=payload("txn_flaky"))
    done = await wait_for_status(h.client, "txn_flaky")
    assert done["status"] == "PROCESSED"
    assert done["attempts"] == 2
    assert done["last_error"] is None  # cleared on success


async def test_failed_transaction_duplicate_is_not_reprocessed(make_harness):
    async with make_harness(simulated_failure_rate=1.0, max_attempts=1, processing_delay_seconds=0.05) as h:
        await h.client.post(URL, json=payload("txn_fail_dup"))
        await wait_for_status(h.client, "txn_fail_dup")
        r = await h.client.post(URL, json=payload("txn_fail_dup"))
        assert r.json()["status"] == "duplicate"
        assert (await h.client.get("/v1/transactions/txn_fail_dup")).json()["attempts"] == 1
