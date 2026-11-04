import asyncio

from tests.conftest import payload, wait_for_status

URL = "/v1/webhooks/transactions"


async def test_same_webhook_many_times_creates_one_transaction(h):
    results = [await h.client.post(URL, json=payload("txn_dup")) for _ in range(5)]
    assert [r.status_code for r in results] == [202] * 5
    assert [r.json()["status"] for r in results] == ["accepted"] + ["duplicate"] * 4

    done = await wait_for_status(h.client, "txn_dup")
    assert done["status"] == "PROCESSED"
    assert done["attempts"] == 1  # processed exactly once
    listing = (await h.client.get("/v1/transactions")).json()
    assert listing["total"] == 1


async def test_concurrent_duplicates_only_one_accepted(h):
    responses = await asyncio.gather(*[h.client.post(URL, json=payload("txn_race")) for _ in range(20)])
    assert all(r.status_code == 202 for r in responses)
    statuses = [r.json()["status"] for r in responses]
    assert statuses.count("accepted") == 1
    assert statuses.count("duplicate") == 19
    done = await wait_for_status(h.client, "txn_race")
    assert done["attempts"] == 1


async def test_duplicate_after_processing_does_not_reprocess(h):
    await h.client.post(URL, json=payload("txn_after"))
    first = await wait_for_status(h.client, "txn_after")
    r = await h.client.post(URL, json=payload("txn_after"))
    assert r.status_code == 202 and r.json()["status"] == "duplicate"
    await asyncio.sleep(h.settings.processing_delay_seconds * 2)
    again = (await h.client.get("/v1/transactions/txn_after")).json()[0]
    assert again["status"] == "PROCESSED"
    assert again["processed_at"] == first["processed_at"]
    assert again["attempts"] == 1


async def test_numerically_equal_amount_is_a_duplicate_not_a_conflict(h):
    await h.client.post(URL, json=payload("txn_num", amount=1500))
    r = await h.client.post(URL, json=payload("txn_num", amount=1500.0))
    assert r.status_code == 202 and r.json()["status"] == "duplicate"


async def test_same_id_different_amount_is_409(h):
    await h.client.post(URL, json=payload("txn_conf"))
    r = await h.client.post(URL, json=payload("txn_conf", amount=9999))
    assert r.status_code == 409
    assert r.json()["transaction_id"] == "txn_conf"
    stored = (await h.client.get("/v1/transactions/txn_conf")).json()[0]
    assert stored["original_amount"] == 1500  # original is untouched


async def test_same_id_different_currency_or_account_is_409(h):
    await h.client.post(URL, json=payload("txn_conf2"))
    assert (await h.client.post(URL, json=payload("txn_conf2", currency="USD"))).status_code == 409
    assert (await h.client.post(URL, json=payload("txn_conf2", destination_account="acc_other"))).status_code == 409
