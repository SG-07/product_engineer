# Transaction Webhook Service

A Python service that receives transaction webhooks from a payment processor (RazorPay-style), **acknowledges them immediately with `202`**, and **processes them reliably in the background** (30 s simulated external call), exactly once per `transaction_id`.

Amounts are stored in **INR** and can be viewed in **INR, USD, EUR or GBP** (`?currency=`).

- Task description: [backend.md](backend.md)
- Live URL: `https://<your-service>.onrender.com`  *(fill in after deploying - see [Deploy](#deploy-supabase--render))*
- Interactive API docs: `<live url>/docs`

## How it works (30 seconds)

```
Processor ─POST /v1/webhooks/transactions─► validate ─► INSERT ... ON CONFLICT DO NOTHING ─► 202   (a few ms)
                                                              │ (row committed BEFORE replying)
                                                              ▼
                                      background task: claim lease ─► wait 30 s ─► convert to INR ─► PROCESSED
                                      recovery sweeper (every 30 s): re-runs anything stuck after a crash/restart
```

| Requirement | How it is met |
|---|---|
| `202` within 500 ms | The request only validates and does **one** INSERT. The 30 s work runs in a background task. |
| 30 s background processing | `asyncio` task per transaction; no DB connection is held while waiting. |
| Idempotency | `transaction_id` is the primary key; `INSERT ... ON CONFLICT DO NOTHING` decides the winner atomically. Same id + same payload → `202 duplicate`; same id + different payload → `409`. |
| Never lose a transaction | The row is saved **before** the `202`. If the process dies, a lease on the row expires and the sweeper re-runs it. If the DB is down the webhook gets `503` so the sender retries. |
| Persistent storage | PostgreSQL (Supabase). |
| Failures | Up to 3 attempts with backoff, then status `FAILED` with `last_error`. |

More detail: [docs/architecture.md](docs/architecture.md) · design choices and alternatives: [docs/decisions.md](docs/decisions.md).

## Run locally (Windows PowerShell)

Requires Python 3.12+. No Docker, no database to install (local mode uses SQLite).

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt

uvicorn app.main:app --reload           # http://127.0.0.1:8000  (docs at /docs)
```

> **Windows tip:** use `127.0.0.1`, not `localhost`. On some Windows machines every new `localhost` connection stalls ~2 s (IPv6 fallback) which looks like a slow API but isn't.

Try it:

```powershell
python scripts/send_webhook.py --amount 100 --currency USD --id txn_demo --repeat 3
curl.exe "http://127.0.0.1:8000/v1/transactions/txn_demo"                 # PROCESSING
# ... ~30 seconds later ...
curl.exe "http://127.0.0.1:8000/v1/transactions/txn_demo?currency=EUR"    # PROCESSED, amount shown in EUR
```

To iterate faster set `PROCESSING_DELAY_SECONDS=2` in a `.env` file (copy `backend/.env.example` to `backend/.env`).

## API summary

| Method & path | Purpose | Success |
|---|---|---|
| `POST /v1/webhooks/transactions` | Receive a transaction webhook | `202` |
| `GET /` | Health check | `200 {"status":"HEALTHY","current_time":...}` |
| `GET /v1/transactions/{id}?currency=` | Transaction status (single object) | `200` / `404` |
| `GET /v1/transactions?status=&currency=&limit=&offset=` | List, newest first | `200` |
| `GET /v1/currencies` | Supported currencies + the fixed rates in use | `200` |
| `GET /health/ready` | Health check that also pings the database | `200` / `503` |

Error codes: `401` bad signature · `404` unknown id · `409` same id, different payload · `422` invalid input · `503` storage unavailable. Full contract with examples: [docs/api.md](docs/api.md).

## Configuration

All settings are environment variables (see [backend/.env.example](backend/.env.example)).

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///./local.db` | Postgres URL in production. `postgres://`, `postgresql://` and `?sslmode=require` are accepted. |
| `PROCESSING_DELAY_SECONDS` | `30` | Simulated external call. |
| `MAX_ATTEMPTS` | `3` | Tries before `FAILED`. |
| `LEASE_SECONDS` | `90` | How long a worker owns a transaction; also the worst-case wait before a hard-crashed job is re-picked. Must exceed the processing delay. |
| `WEBHOOK_SECRET` / `SIGNATURE_REQUIRED` | unset / `false` | HMAC-SHA256 check of the raw body in `X-Razorpay-Signature`. |
| `FX_RATES_TO_INR` / `FX_RATES_AS_OF` | USD 94.75 / EUR 106.08 / GBP 127.14 INR, as of 2026-11-03 | Fixed rates (not live) - refresh when they drift. |
| `CORS_ORIGINS` | `http://localhost:5173` | Frontend origin(s), comma separated. |
| `SIMULATED_FAILURE_RATE` | `0` | Demo: fraction of attempts that fail on purpose. |

## Test

Run from the `backend/` folder:

```powershell
pytest -q                                    # 70 tests on SQLite, ~15 s
python scripts/smoke_test.py                 # end-to-end against a running server, ~35 s (real 30 s wait)
python scripts/load_test.py --n 200 --concurrency 20   # latency vs the 500 ms limit
```

To run the suite on Postgres (this also enables the concurrent-latency test): set `TEST_DATABASE_URL=postgresql://...` first. GitHub Actions does this automatically. Details: [docs/testing.md](docs/testing.md).

## Deploy (Supabase + Render)

1. **Database** - create a free project at supabase.com. *Project Settings → Database → Connection string → **Session pooler*** (port 5432). Use the pooler, not the "Direct connection": Render cannot reach Supabase's IPv6-only direct host. Tables are created automatically on first start.
2. **Code** - push this repo to GitHub (public).
3. **Service** - on render.com: *New → Blueprint* → select the repo (uses [render.yaml](render.yaml), which builds from `backend/`). Set the secret env vars when prompted: `DATABASE_URL`, optionally `WEBHOOK_SECRET`, and `CORS_ORIGINS` once the frontend has a URL.
4. **Verify** - `python scripts/smoke_test.py --base-url https://<service>.onrender.com`, then `python scripts/load_test.py --base-url https://<service>.onrender.com`.
5. **Keep it awake** - Render's free tier sleeps after ~15 min idle and the first request after that can take 30 s+ (breaks the 500 ms rule). Point a free pinger (cron-job.org / UptimeRobot) at `GET /` every 10 minutes, or use a paid instance. See [docs/risks.md](docs/risks.md).

## Technical choices (short)

- **FastAPI** - async, so a burst of webhooks never blocks on the 30 s jobs; Pydantic gives strict validation and free OpenAPI docs.
- **PostgreSQL (Supabase)** - a primary key gives database-level idempotency that is safe even with several app instances; managed and free.
- **In-process asyncio + DB lease + sweeper** instead of Celery/Redis - one deployable, no broker; the database row (not memory) is the source of truth, so a crash cannot lose work. Trade-offs and the upgrade path to a real queue are in [docs/decisions.md](docs/decisions.md).
- **Decimal money, banker's rounding for display** - never floats; stored at 4 decimals, shown at 2.
- **Fixed FX rates in config** - deterministic and offline; swap for a live-rate provider later.

## Project layout

```
backend/            all backend code
  app/              FastAPI app (routers/, repository.py, processor.py, recovery.py, currency.py, ...)
  tests/            pytest suite
  scripts/          send_webhook.py · smoke_test.py · load_test.py
  schema.sql        reference DDL (the app creates the table itself)
  requirements*.txt, pytest.ini, .env.example
docs/               tracker · decisions · assumptions · architecture · api · testing · risks · interview-notes · frontend
frontend/           Vite + React scaffold (to be built by the frontend developer - see docs/frontend.md)
render.yaml         Render blueprint (rootDir: backend)
.github/workflows/  CI (runs in backend/)
```

## Known limitations

See [docs/risks.md](docs/risks.md). Most important: the Postgres path and the Render deployment are **not yet exercised** (everything so far ran on SQLite); exchange rates are a fixed snapshot, not live; no user accounts (currency preference lives in the browser).
