import re


async def test_root_health_shape(h):
    r = await h.client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "HEALTHY"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", body["current_time"])


async def test_readiness_checks_database(h):
    r = await h.client.get("/health/ready")
    assert r.status_code == 200
    assert r.json()["status"] == "HEALTHY"


async def test_cors_preflight_allows_configured_origin(h):
    r = await h.client.options(
        "/v1/webhooks/transactions",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_openapi_docs_available(h):
    r = await h.client.get("/openapi.json")
    assert r.status_code == 200
    assert "/v1/webhooks/transactions" in r.json()["paths"]
