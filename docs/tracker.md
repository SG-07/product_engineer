# Project Tracker

Status legend: ✅ done and verified · 🟡 done, not fully verified · ⏳ not started · 👤 needs the project owner

Last updated: 2026-11-03

## Phases

| # | Phase | Status | Evidence / notes |
|---|---|---|---|
| 0 | Setup (git, venv, deps, ignore files, env example; code lives in `backend/`) | ✅ | `git init` done; deps install cleanly on Python 3.13. **No commit made yet.** |
| 1 | API skeleton (config, health, schemas, webhook route, currency math) | ✅ | `test_health`, `test_webhook`, `test_currency` |
| 2 | Persistence + idempotency (+ read endpoints, currency display) | 🟡 | Passes on **SQLite** only. Postgres path (`ON CONFLICT`, asyncpg, Supabase SSL/pooler URL handling) has never run. |
| 3 | Processing + reliability (lease, retries, sweeper, shutdown) | 🟡 | Real-process tests passed on SQLite: 30 s flow via `smoke_test.py`; hard-kill → restart → finished (123 s). Not run on Postgres. |
| 4 | Hardening (HMAC, CORS, logging, error handlers) | ✅ | `test_signature`, CORS preflight test. Only tested with self-generated signatures, never real RazorPay ones. |
| 5 | Tests + CI | ✅ | 71 passed, 1 skipped locally (SQLite). GitHub Actions run on Postgres 16 container: **passed** (2026-11-03). Latency figures from that run were not read (log needs auth). |
| 6 | Deploy (Supabase + Render) | 🟡 | Service is live at https://txn-webhooks.onrender.com. Smoke test passes (end-to-end flow works); load test shows p95=1835ms **exceeds 500ms target** (see R1). All features working; latency is a free-tier limitation. |
| 7 | Docs + hand-off | 🟡 | Docs written; `README` live URL placeholder to fill; `frontend.md` ready for the frontend developer. |
| F | Frontend dashboard | 🟡 | Existing `frontend/` dashboard fixed to the real API contract and extended with live views (status strip, pipeline board, latency client-vs-server). Verified in a browser against a local backend and in mock mode; **not yet run against Render** (needs the new backend deployed). `npm run lint` and `npm run build` pass. |
| S | `GET /v1/stats` + small DB pool | 🟡 | Endpoint built and tested (81 passed on SQLite; Postgres run pending in CI). Pool 2+1 is set in `render.yaml` only; **before/after load test on Render still to do** (see `risks.md` R1). |

## Owner actions (only you can do these)

- [x] GitHub repo: https://github.com/SG-07/product_engineer (pushed, CI green).
- [ ] Create Supabase project → copy the **Session pooler** connection string.
- [ ] Create Render web service from the repo (Blueprint) and set `DATABASE_URL` (+ optional `WEBHOOK_SECRET`).
- [ ] Run `python scripts/smoke_test.py --base-url <render url>` and `scripts/load_test.py` against it. **This is the first real Postgres test - expect to possibly fix something.**
- [ ] Set up a keep-alive pinger for `GET /`.
- [x] FX rates supplied by owner (94.75 / 106.08 / 127.14, 2026-11-03) and set as defaults. [ ] Refresh them (`FX_RATES_TO_INR`, `FX_RATES_AS_OF`) whenever they drift.
- [ ] Put the live URL into README.
- [ ] Confirm the open questions in `docs/assumptions.md`.

## Verification log

| Date | What | Result |
|---|---|---|
| 2026-11-03 | `pytest` on SQLite | 70 passed, 1 skipped |
| 2026-11-03 | `smoke_test.py` vs real uvicorn (SQLite), full 30 s wait | all checks passed; PROCESSED after 30 s, attempts = 1 |
| 2026-11-03 | Cold-start: first webhook on 3 fresh processes | 13–33 ms (127.0.0.1) |
| 2026-11-03 | Hard kill (TerminateProcess) 3 s after webhook, restart | row survived as PROCESSING; finished as PROCESSED, attempts = 2, **123 s** after restart |
| 2026-11-03 | 20 concurrent senders on SQLite | p95 ≈ 1.1–1.6 s - SQLite single-writer limit, see `risks.md` R1. **Not measured on Postgres.** |
| 2026-11-03 | GitHub Actions: full suite on a Postgres 16 service container | passed (first Postgres run). Local container, so no network latency - not representative of Supabase |
| 2026-11-04 | Smoke test on Supabase/Render (single webhook, ~30s flow) | all checks pass except first response 644ms (>500ms target); full flow completes, conversions correct, duplicates/404/422 all work |
| 2026-11-04 | Load test on Supabase/Render (50 req, 5 concurrent) | **FAILED**: p50=496ms, **p95=1835ms** (3.6× over budget) - see `risks.md` R1, R2 |
| 2026-11-04 | `pytest` incl. new `test_stats.py` (SQLite) | 81 passed, 1 skipped |
| 2026-11-04 | Local backend (SQLite, API pool 2+1) + dashboard in a headless browser | Sent 100 EUR shown as $111.96 (server-converted); counters, pipeline and latency panel updated live; idempotency 5 sends = 1 new + 4 duplicate, processed once; load test 20/20 accepted, 20/20 finished via one list request; FAILED and phone-width layout checked in mock mode; no console errors. Local SQLite timings (e.g. max 797 ms at concurrency 3) say nothing about Postgres. |

## Changes made along the way

- Performance test split in two (sequential test everywhere; 20-concurrent test only on Postgres) after SQLite showed write-lock queuing. Threshold was **not** loosened.
- SQLite WAL mode was tried and reverted: no measurable improvement.
