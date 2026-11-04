import pytest

from tests.conftest import payload

URL = "/v1/webhooks/transactions"


async def test_accepts_with_202_and_ack_body(h):
    r = await h.client.post(URL, json=payload("txn_ok"))
    assert r.status_code == 202
    assert r.json() == {"status": "accepted", "transaction_id": "txn_ok"}
    assert "x-response-time-ms" in r.headers


async def test_row_is_stored_as_processing_immediately(h):
    await h.client.post(URL, json=payload("txn_store"))
    r = await h.client.get("/v1/transactions/txn_store")
    assert r.status_code == 200
    body = r.json()[0]
    assert body["status"] == "PROCESSING"
    assert body["processed_at"] is None
    assert body["amount_inr"] is None


async def test_lowercase_currency_is_normalised(h):
    r = await h.client.post(URL, json=payload("txn_lower", currency="usd", amount=150.50))
    assert r.status_code == 202
    body = (await h.client.get("/v1/transactions/txn_lower")).json()[0]
    assert body["original_currency"] == "USD"
    assert body["original_amount"] == 150.5


async def test_unknown_fields_are_ignored(h):
    r = await h.client.post(URL, json={**payload("txn_extra"), "note": "hello"})
    assert r.status_code == 202


@pytest.mark.parametrize(
    "body",
    [
        {k: v for k, v in payload().items() if k != "amount"},  # missing field
        payload(amount=0),
        payload(amount=-5),
        payload(amount="1500"),  # string, not a number
        payload(amount=True),
        payload(amount=1.23456),  # more than 4 decimals
        payload(currency="JPY"),
        payload(currency=""),
        payload(transaction_id=""),
        payload(transaction_id="x" * 65),
        payload(source_account="   "),
    ],
)
async def test_invalid_payloads_get_422(h, body):
    r = await h.client.post(URL, json=body)
    assert r.status_code == 422, r.text


async def test_malformed_json_gets_422(h):
    r = await h.client.post(URL, content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 422


async def test_invalid_payload_is_not_stored(h):
    await h.client.post(URL, json=payload("txn_bad", currency="JPY"))
    assert (await h.client.get("/v1/transactions/txn_bad")).status_code == 404
