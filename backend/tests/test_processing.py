from decimal import Decimal

from app import repository as repo
from app.db import as_utc
from tests.conftest import payload, wait_for_status

URL = "/v1/webhooks/transactions"


async def test_transaction_is_processed_after_the_delay(make_harness):
    async with make_harness(processing_delay_seconds=1.0) as h:
        await h.client.post(URL, json=payload("txn_delay"))
        assert (await h.client.get("/v1/transactions/txn_delay")).json()["status"] == "PROCESSING"
        done = await wait_for_status(h.client, "txn_delay")
        assert done["status"] == "PROCESSED"
        async with h.session() as s:
            row = await repo.get(s, "txn_delay")
        elapsed = (as_utc(row.processed_at) - as_utc(row.created_at)).total_seconds()
        assert elapsed >= 1.0


async def test_inr_transaction_stored_as_is(h):
    await h.client.post(URL, json=payload("txn_inr", amount=1500, currency="INR"))
    done = await wait_for_status(h.client, "txn_inr")
    assert done["amount_inr"] == 1500
    assert done["fx_rate_to_inr"] == 1
    assert done["fx_rate_as_of"] == str(h.settings.fx_rates_as_of)


async def test_foreign_currency_converted_to_inr_and_rate_recorded(h):
    await h.client.post(URL, json=payload("txn_usd", amount=150.50, currency="USD"))
    done = await wait_for_status(h.client, "txn_usd")
    assert Decimal(str(done["amount_inr"])) == Decimal("12642.00")  # 150.50 * 84
    assert done["fx_rate_to_inr"] == 84
    assert done["original_amount"] == 150.5 and done["original_currency"] == "USD"
    assert done["last_error"] is None
    assert done["processed_at"] is not None
