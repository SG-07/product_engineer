from tests.conftest import payload, wait_for_status

URL = "/v1/webhooks/transactions"


async def test_unknown_transaction_is_404(h):
    r = await h.client.get("/v1/transactions/does_not_exist")
    assert r.status_code == 404
    assert r.json() == {"detail": "Transaction not found"}


async def test_response_is_a_single_object_matching_spec_fields(h):
    await h.client.post(URL, json=payload("txn_shape"))
    body = (await h.client.get("/v1/transactions/txn_shape")).json()
    assert isinstance(body, dict)
    for key in (
        "transaction_id", "source_account", "destination_account", "amount", "currency",
        "status", "created_at", "processed_at",
    ):
        assert key in body
    assert body["created_at"].endswith("Z")


async def test_no_currency_param_returns_amount_as_received(h):
    await h.client.post(URL, json=payload("txn_asis", amount=150.50, currency="USD"))
    body = (await h.client.get("/v1/transactions/txn_asis")).json()
    assert body["amount"] == 150.5 and body["currency"] == "USD"


async def test_display_currency_conversion_with_bankers_rounding(h):
    await h.client.post(URL, json=payload("txn_disp", amount=1500, currency="INR"))
    await wait_for_status(h.client, "txn_disp")
    usd = (await h.client.get("/v1/transactions/txn_disp?currency=USD")).json()
    assert usd["currency"] == "USD" and usd["amount"] == 17.86  # 1500/84 = 17.857...
    eur = (await h.client.get("/v1/transactions/txn_disp?currency=eur")).json()  # case-insensitive
    assert eur["currency"] == "EUR" and eur["amount"] == 16.48  # 1500/91 = 16.483...
    gbp = (await h.client.get("/v1/transactions/txn_disp?currency=GBP")).json()
    assert gbp["amount"] == 13.76  # 1500/109 = 13.761...
    inr = (await h.client.get("/v1/transactions/txn_disp?currency=INR")).json()
    assert inr["amount"] == 1500.0
    assert usd["original_amount"] == 1500 and usd["original_currency"] == "INR"


async def test_display_conversion_works_while_processing(h):
    await h.client.post(URL, json=payload("txn_early", amount=100, currency="USD"))
    body = (await h.client.get("/v1/transactions/txn_early?currency=INR")).json()
    assert body["status"] == "PROCESSING"
    assert body["amount"] == 8400.0 and body["amount_inr"] is None


async def test_unsupported_display_currency_is_422(h):
    await h.client.post(URL, json=payload("txn_jpy"))
    assert (await h.client.get("/v1/transactions/txn_jpy?currency=JPY")).status_code == 422
    assert (await h.client.get("/v1/transactions?currency=JPY")).status_code == 422


async def test_list_pagination_filter_and_currency(h):
    for i in range(5):
        await h.client.post(URL, json=payload(f"txn_list_{i}", amount=100 + i))
    page = (await h.client.get("/v1/transactions?limit=2&offset=0&currency=USD")).json()
    assert page["total"] == 5 and len(page["items"]) == 2 and page["limit"] == 2
    assert all(item["currency"] == "USD" for item in page["items"])
    page3 = (await h.client.get("/v1/transactions?limit=2&offset=4")).json()
    assert len(page3["items"]) == 1
    for i in range(5):
        await wait_for_status(h.client, f"txn_list_{i}")
    processed = (await h.client.get("/v1/transactions?status=PROCESSED")).json()
    assert processed["total"] == 5
    assert (await h.client.get("/v1/transactions?status=PROCESSING")).json()["total"] == 0
    assert (await h.client.get("/v1/transactions?status=BOGUS")).status_code == 422


async def test_currencies_endpoint(h):
    body = (await h.client.get("/v1/currencies")).json()
    assert body["base"] == "INR"
    assert body["supported"] == ["INR", "USD", "EUR", "GBP"]
    assert body["rates_to_inr"]["USD"] == 84.0
    assert body["rounding"] == "ROUND_HALF_EVEN" and body["display_decimals"] == 2
