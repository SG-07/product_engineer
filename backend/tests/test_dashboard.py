FRONTEND = "https://product-engineer.onrender.com"


async def test_dashboard_redirects_when_frontend_configured(make_harness):
    async with make_harness(frontend_url=FRONTEND) as h:
        r = await h.client.get("/dashboard", follow_redirects=False)
        assert r.status_code == 307
        assert r.headers["location"] == FRONTEND


async def test_dashboard_is_404_when_not_configured(h):
    r = await h.client.get("/dashboard", follow_redirects=False)
    assert r.status_code == 404
    assert r.json()["detail"] == "FRONTEND_URL is not configured"


async def test_root_health_unchanged_with_frontend_configured(make_harness):
    async with make_harness(frontend_url=FRONTEND) as h:
        r = await h.client.get("/", follow_redirects=False)
        assert r.status_code == 200
        assert r.json()["status"] == "HEALTHY"


async def test_blank_frontend_url_means_not_configured(make_harness):
    async with make_harness(frontend_url="   ") as h:
        r = await h.client.get("/dashboard", follow_redirects=False)
        assert r.status_code == 404
