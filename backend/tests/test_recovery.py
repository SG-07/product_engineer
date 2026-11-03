"""Reliability: no transaction is lost if the process dies at any point."""

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import update

from app import repository as repo
from app.db import utcnow
from app.models import Transaction
from tests.conftest import payload, wait_for_status

URL = "/v1/webhooks/transactions"


def _new(txn_id: str) -> repo.NewTransaction:
    return repo.NewTransaction(
        transaction_id=txn_id, source_account="a", destination_account="b", amount=Decimal("10"), currency="USD"
    )


async def test_row_stored_but_never_scheduled_is_recovered(h):
    """Simulates a crash right after the INSERT committed but before the task started."""
    async with h.session() as s:
        assert await repo.insert_if_absent(s, _new("txn_orphan"))
    done = await wait_for_status(h.client, "txn_orphan")
    assert done["status"] == "PROCESSED"
    assert done["amount_inr"] == 840


async def test_row_with_expired_lease_is_recovered(h):
    """Simulates a worker that claimed the row and then died."""
    async with h.session() as s:
        await repo.insert_if_absent(s, _new("txn_dead_worker"))
        await s.execute(
            update(Transaction)
            .where(Transaction.transaction_id == "txn_dead_worker")
            .values(locked_until=utcnow() - timedelta(seconds=1), attempts=1)
        )
        await s.commit()
    done = await wait_for_status(h.client, "txn_dead_worker")
    assert done["status"] == "PROCESSED"
    assert done["attempts"] == 2


async def test_active_lease_is_not_stolen(make_harness):
    async with make_harness(sweeper_enabled=False) as h:
        async with h.session() as s:
            await repo.insert_if_absent(s, _new("txn_owned"))
            claim = await repo.claim(s, "txn_owned", lease_seconds=60)
            assert claim is not None
            assert await repo.claim(s, "txn_owned", lease_seconds=60) is None  # second claimer loses
        assert await h.sweeper.sweep_once() == 0


async def test_graceful_shutdown_hands_work_back_and_restart_finishes_it(make_harness):
    async with make_harness(processing_delay_seconds=5.0, lease_seconds=30.0) as h:
        await h.client.post(URL, json=payload("txn_restart"))
        # let the background task claim the row, then "deploy/restart" mid-processing
        for _ in range(50):
            async with h.session() as s:
                row = await repo.get(s, "txn_restart")
                if row.locked_until is not None:
                    break
            import asyncio

            await asyncio.sleep(0.02)

    # first instance is gone: row must still exist, still PROCESSING, lease released
    async with make_harness(reset=False, processing_delay_seconds=0.2) as h2:
        async with h2.session() as s:
            row = await repo.get(s, "txn_restart")
        assert row.status in ("PROCESSING", "PROCESSED")
        done = await wait_for_status(h2.client, "txn_restart")
        assert done["status"] == "PROCESSED"
