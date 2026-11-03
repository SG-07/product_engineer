# Risks and Known Limitations

Severity: **H** could fail a stated requirement · **M** could hurt in production · **L** minor.

| # | Sev | Risk | Evidence | Mitigation / next step |
|---|---|---|---|---|
| R1 | **H** | **500 ms under concurrent load is unproven on Postgres.** On SQLite, 20 simultaneous senders gave p95 ≈ 1.1–1.6 s; ~95 % of the time was inside the single INSERT (measured: median insert 17 ms alone → 83 ms at 20 concurrent). I attribute it to SQLite's one-writer lock, but I have no Postgres number to confirm. At low concurrency (sequential) with 100 background jobs running, acks took ~50 ms. | `tracker.md` verification log | Run `scripts/load_test.py` against Supabase/Render **before submitting**. If p95 > 500 ms there, look at API pool size (`API_DB_POOL_SIZE`, default 5+5), DB region vs Render region, and Supabase pooler latency. |
| R2 | **H** | **The Postgres/Supabase code path has never executed.** Untested: `ON CONFLICT` via the Postgres dialect, asyncpg, `normalize_database_url` (`postgres://` rewrite, `sslmode` → `ssl`, port-6543 prepared-statement workaround), partial index creation, check constraints. | all tests ran on SQLite | CI runs the suite on Postgres (first run may reveal fixes). Then the deployed smoke test. |
| R3 | **H** | **Render free tier sleeps after ~15 min idle**; first request after that can take 30 s+ → would break "respond within 500 ms" and could lose a processor's patience. | Render docs (not measured) | Pinger on `GET /` every ≤ 10 min (free), or a paid always-on instance. Note: pinger can't prevent a cold start after a deploy/restart. |
| R4 | M | **Hard-crash recovery is slow** - up to lease (90 s) + sweep interval (30 s) + the 30 s processing delay. Measured 123 s. Graceful restarts are fast. | ad hoc kill test | Lower `LEASE_SECONDS` (must stay > `PROCESSING_DELAY_SECONDS`; e.g. 45) and `SWEEPER_INTERVAL_SECONDS`. Trade-off: shorter lease = less margin if the DB is slow. |
| R5 | M | **FX rates are a fixed snapshot** (94.75 / 106.08 / 127.14, 2026-11-03, owner-supplied) and will drift from the market. Anything shown in USD/EUR/GBP is only as right as these. | `assumptions.md` A5 | Refresh config regularly; long-term, a rates provider + dated rate history. |
| R6 | M | **Free-tier DB limits** (connections, auto-pause on inactivity for Supabase free projects). A paused project = `503` on webhooks. | provider docs (not measured) | Pooler URL, keep project active, watch plan limits. |
| R7 | M | **No migrations.** `create_all` never alters an existing table. | design | Add Alembic before the first schema change on a live DB. |
| R8 | M | **Signature scheme unverified against real RazorPay**; enforcement off by default. | `assumptions.md` A2–A4 | Test with a real/sandbox webhook; set `SIGNATURE_REQUIRED=true` in production. |
| R9 | M | **Read endpoints are unauthenticated.** `GET /v1/transactions` lists *all* transactions (account ids, amounts) to anyone with the URL. The task asked for a status endpoint "for testing"; the list endpoint is my addition for the dashboard. | code | Before real use: API key / auth, or remove the list endpoint. |
| R10 | M | **Jobs run inside the web process.** CPU-heavy real processing would slow the API; a process OOM loses in-flight *progress* (not data). | design | See `decisions.md` D3 upgrade path. |
| R11 | M | **Multiple instances untested.** Lease + conditional updates should make it safe, but it is reasoning, not evidence. | `architecture.md` | Test with 2 local instances on one Postgres before scaling. |
| R12 | L | `FAILED` is terminal; no operator retry. | `assumptions.md` A13 | Admin endpoint/script. |
| R13 | L | No rate limiting / request size limit on the webhook. | code | Add at the platform or middleware level. |
| R14 | L | JSON numbers are floats in clients; fine for display, not arithmetic. | `decisions.md` D17 | Return strings if an integration needs exactness. |
| R15 | L | `render.yaml` `PYTHON_VERSION: 3.12.8` and the free `plan` value are from memory, never validated by Render. | - | Adjust on first deploy; local dev used 3.13. |
| R16 | L | Windows: `localhost` stalls ~2 s per new connection on the dev machine (IPv6 fallback). Client-side, not a service issue. | measured: localhost ≈ 2040 ms vs 127.0.0.1 ≈ 2–15 ms | Use `127.0.0.1`; scripts default to it. |
| R17 | L | Every webhook and read logs a line; no log shipping / metrics / alerting. | - | Add structured logs + uptime alert on `/`. |
