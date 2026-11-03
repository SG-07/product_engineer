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
| 5 | Tests + CI | 🟡 | 70 passed, 1 skipped locally. CI workflow written but **never run** (no GitHub repo yet). Skipped test = concurrent-latency test, needs Postgres. |
| 6 | Deploy (Supabase + Render) | 👤 | See "Owner actions". `render.yaml` unverified (`PYTHON_VERSION` value in particular). |
| 7 | Docs + hand-off | 🟡 | Docs written; `README` live URL placeholder to fill; `frontend.md` ready for the frontend developer. |
| F | Frontend (other developer) | ⏳ | `frontend/` has an untouched Vite + React scaffold. Spec in `docs/frontend.md`. |

## Owner actions (only you can do these)

- [ ] Create public GitHub repo, make the first commit, push.
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
| — | Anything on PostgreSQL / Render / GitHub Actions | **not yet run** |

## Changes made along the way

- Performance test split in two (sequential test everywhere; 20-concurrent test only on Postgres) after SQLite showed write-lock queuing. Threshold was **not** loosened.
- SQLite WAL mode was tried and reverted: no measurable improvement.
