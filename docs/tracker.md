# Project Tracker

Status legend: ✅ done and verified · 🟡 done, not fully verified · ⏳ not started · 👤 needs the project owner

Last updated: 2026-11-04 · Full test and performance record: [test-results.md](test-results.md)

## Phases

| # | Phase | Status | Evidence / notes |
|---|---|---|---|
| 0 | Setup (git, venv, deps, ignore files, env example; code lives in `backend/`) | ✅ | Git repo with commits; deps install cleanly on Python 3.13. Local development now uses PostgreSQL 16 in Docker (see README). |
| 1 | API skeleton (config, health, schemas, webhook route, currency math) | ✅ | `test_health`, `test_webhook`, `test_currency` |
| 2 | Persistence + idempotency (+ read endpoints, currency display) | ✅ | Verified on **PostgreSQL**: full suite on Docker Postgres 16 (2026-11-04) and the smoke test on Supabase via Render (`ON CONFLICT`, asyncpg and the pooler URL all work). Earlier runs were on SQLite. |
| 3 | Processing + reliability (lease, retries, sweeper, shutdown) | 🟡 | 30 s flow passes on Postgres (local suite and `smoke_test.py` on Render: processed once, `attempts == 1`). Hard-kill → restart: nothing lost on SQLite (123 s) and on Postgres (128 s, 2026-11-04). |
| 4 | Hardening (HMAC, CORS, logging, error handlers) | ✅ | `test_signature`, CORS preflight test. Only tested with self-generated signatures, never real RazorPay ones. |
| 5 | Tests + CI | 🟡 | 86 tests. On local Postgres: 86 passed once, then 85 passed + 1 failed on repeat runs — `test_ack_is_fast_under_concurrent_senders` is flaky near the 500 ms limit (p95 ≈ 460–550 ms on Linux, 670–1,200 ms on Windows). GitHub Actions (Postgres 16) passed on 2026-11-03; its latency figures were not read. Shutdown prints asyncpg "Task was destroyed" noise. See [test-results.md](test-results.md). |
| 6 | Deploy (Supabase + Render) | 🟡 | Live at https://txn-webhooks.onrender.com. Smoke test: 14 of 15 checks pass (2026-11-04); the failure is latency — the `202` takes 500–900 ms server-side. **Render is in Singapore but Supabase is in Seoul**; database-touching requests cost ~400 ms, non-database ones 2–84 ms (R1, R18). Not yet fixed. |
| 7 | Docs + hand-off | ✅ | Docs written and updated 2026-11-04: README now covers install, run, tests, the frontend dashboard and deployment; [test-results.md](test-results.md) records tests, measurements and bottlenecks. |
| F | Frontend dashboard | 🟡 | Existing `frontend/` dashboard fixed to the real API contract and extended with live views (status strip, pipeline board, latency client-vs-server). Verified in a browser against a local backend and in mock mode; **not yet run against Render** (needs the new backend deployed). `npm run lint` and `npm run build` pass. |
| S | `GET /v1/stats` + small DB pool | 🟡 | Endpoint built and tested; used to watch pool use during local bursts (`api_in_use` peaked at 12 of 20). Local experiments showed a *bigger* API pool is not better (20 connections was worse than 5+5). Pool 2+1 in `render.yaml` has still **not** been compared on Render (see `risks.md` R1, [test-results.md](test-results.md) §5). |

## Owner actions (only you can do these)

- [x] GitHub repo: https://github.com/SG-07/product_engineer (pushed, CI green).
- [x] Create Supabase project → copy the **Session pooler** connection string. *(Created in Seoul.)*
- [x] Create Render web service from the repo (Blueprint) and set `DATABASE_URL` (+ optional `WEBHOOK_SECRET`). *(Created in Singapore.)*
- [x] Run `python scripts/smoke_test.py --base-url <render url>` against it. *(14 of 15 pass; see test-results.md.)* [ ] Re-run `scripts/load_test.py` after the region is fixed.
- [ ] **Put the database and the Render service in the same region** (new Supabase project in Singapore, then update `DATABASE_URL`). **Owner will do this later and report back**; it is the main open performance item (R18). After it: redeploy, then re-run `spec_check.py`, `smoke_test.py` and `load_test.py` against Render and update `test-results.md`.
- [ ] **Redeploy the backend** so Render serves the array response (D18). Re-run `python scripts/spec_check.py --base-url https://txn-webhooks.onrender.com`.
- [ ] Set up a keep-alive pinger for `GET /`. (Measured 2026-11-04: the first request after ~1 h 50 min idle took **42 s**.)
- [x] Frontend Static Site exists at https://product-engineer.onrender.com (responds `200` HTML; the backend's CORS preflight accepts that origin; `render.yaml` already lists it). [ ] Not checked: whether it was built with `VITE_USE_MOCK=false` and `VITE_API_BASE_URL=https://txn-webhooks.onrender.com`.
- [x] FX rates supplied by owner (94.75 / 106.08 / 127.14, 2026-11-03), set as defaults. Owner-confirmed 2026-11-04: a fixed snapshot, source not recorded, no refresh schedule.
- [x] Put the live URLs into README.
- [x] Unknown transaction id stays `404` (owner: "do what is standard").
- [ ] Still open in `docs/assumptions.md`: signed webhooks (assumed unsigned) and amount units (assumed major units).

## Verification log

| Date | What | Result |
|---|---|---|
| 2026-11-03 | `pytest` on SQLite | 70 passed, 1 skipped |
| 2026-11-03 | `smoke_test.py` vs real uvicorn (SQLite), full 30 s wait | all checks passed; PROCESSED after 30 s, attempts = 1 |
| 2026-11-03 | Cold-start: first webhook on 3 fresh processes (SQLite) | 13–33 ms (127.0.0.1). On **Postgres** the first webhook after a fresh start took 693 ms in one run (2026-11-04), because opening a connection costs ~38 ms of blocked event loop (`risks.md` R22). |
| 2026-11-03 | Hard kill (TerminateProcess) 3 s after webhook, restart | row survived as PROCESSING; finished as PROCESSED, attempts = 2, **123 s** after restart |
| 2026-11-03 | 20 concurrent senders on SQLite | p95 ≈ 1.1–1.6 s - SQLite single-writer limit, see `risks.md` R1. **Not measured on Postgres.** |
| 2026-11-03 | GitHub Actions: full suite on a Postgres 16 service container | passed (first Postgres run). Local container, so no network latency - not representative of Supabase |
| 2026-11-04 | Smoke test on Supabase/Render (single webhook, ~30s flow) | all checks pass except first response 644ms (>500ms target); full flow completes, conversions correct, duplicates/404/422 all work |
| 2026-11-04 | Load test on Supabase/Render (50 req, 5 concurrent) | **FAILED**: p50=496ms, **p95=1835ms** (3.6× over budget) - see `risks.md` R1, R2 |
| 2026-11-04 | `pytest` incl. new `test_stats.py` (SQLite) | 81 passed, 1 skipped |
| 2026-11-04 | Local backend (SQLite, API pool 2+1) + dashboard in a headless browser | Sent 100 EUR shown as $111.96 (server-converted); counters, pipeline and latency panel updated live; idempotency 5 sends = 1 new + 4 duplicate, processed once; load test 20/20 accepted, 20/20 finished via one list request; FAILED and phone-width layout checked in mock mode; no console errors. Local SQLite timings (e.g. max 797 ms at concurrency 3) say nothing about Postgres. |
| 2026-11-04 | Smoke test on Render + Supabase (Singapore + Seoul) | 14 of 15 pass; "responds within 500ms" failed (748 ms client-side; server log 502–907 ms for POSTs, ~410–475 ms for single reads) |
| 2026-11-04 | `pytest` on Docker Postgres 16 | 86 passed on the first run; 85 passed + 1 failed (concurrency latency test, p95 672 ms) on two later runs |
| 2026-11-04 | `load_test.py` on local Postgres | 50 sequential: p95 36 ms (pass). 100 × 20 concurrent: p95 790 ms (fail); with a 20-connection pool 1,176 ms (fail); 400 × 20 concurrent: p95 460 ms (pass) |
| 2026-11-04 | `scripts/spec_check.py` (new) against a clean local instance on Postgres, real 30 s | 32 of 32 checks pass; 1 deviation reported at the time: the query endpoint returned an object, not the spec's array |
| 2026-11-04 | **Response switched to the spec's array `[{...}]`** (owner decision, D18). Router, 8 test files, `smoke_test.py`, mock API and docs updated | `pytest` 85 passed + 1 failed (the same 20-concurrent latency test); `spec_check.py` **33 of 33, 0 deviations**; `smoke_test.py` all pass; lint and build exit 0 |
| 2026-11-04 | **Hard kill on Postgres** 3 s after a webhook, then restart | Transaction survived, recovered by the sweeper (`attempts` 2), `PROCESSED` 128 s after restart |
| 2026-11-04 | `smoke_test.py` and `load_test.py --n 50 --concurrency 1` on the clean local instance; frontend `npm run lint` / `npm run build` | all smoke checks pass; load p95 30 ms; lint and build exit 0 |
| 2026-11-04 | Controlled experiments (jobs on/off, pool size, `pool_pre_ping`, Linux vs Windows, DB round trip) | Background jobs add ≈ 170 ms p95 (Linux); a bigger pool is worse; Linux ≈ 460–550 ms vs Windows ≈ 670–1,200 ms; DB round trip locally ≈ 1 ms. Details in [test-results.md](test-results.md) |

## Changes made along the way

- Performance test split in two (sequential test everywhere; 20-concurrent test only on Postgres) after SQLite showed write-lock queuing. Threshold was **not** loosened.
- SQLite WAL mode was tried and reverted: no measurable improvement.
- 2026-11-04: local development moved to PostgreSQL 16 in Docker (README, `.env.example`, `docs/testing.md`). SQLite stays only as a no-Docker fallback. Code defaults (`config.py`, `tests/conftest.py`) still fall back to SQLite if nothing is configured.
- 2026-11-04: **`GET /v1/transactions/{id}` now returns the one-element array from `backend.md`** (was a single object, D18). **Render still runs the old build until it is redeployed**; re-run `scripts/spec_check.py --base-url <render url>` after deploying.
- 2026-11-04: `pool_pre_ping` was switched off temporarily to measure it and **reverted**; no application code was changed by the performance investigation.
