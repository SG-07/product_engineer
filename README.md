# Transaction Webhook Service

A Python service that receives transaction webhooks from a payment processor (RazorPay-style), **acknowledges them immediately with `202`**, and **processes them reliably in the background** (30 s simulated external call), exactly once per `transaction_id`. A React dashboard lets you send test webhooks and watch them being processed. Amounts are stored in **INR** and can be viewed in **INR, USD, EUR or GBP** (`?currency=`).

## Deliverables

| Required | Where |
|---|---|
| Public GitHub repo of the working Python application | https://github.com/SG-07/product_engineer (task description: [backend_task.md](backend_task.md)) |
| **Instructions to run and test the service** | [1. Run and test the service](#1-run-and-test-the-service) |
| **Brief explanation of the technical choices** | [2. Technical choices](#2-technical-choices) |
| **Public API endpoint deployed on the cloud** | [3. Public API endpoint](#3-public-api-endpoint-deployed-on-the-cloud): `https://txn-webhooks.onrender.com` |

## Status at a glance (2026-11-04)

| Area | State |
|---|---|
| Features (webhook, idempotency, 30 s processing, recovery, currency views, dashboard) | Working end to end, locally and on Render |
| Requirements in [backend_task.md](backend_task.md) | All met locally: `scripts/spec_check.py` passes 33 of 33 checks |
| Tests | 86 tests; 85 pass on PostgreSQL 16. The 20-concurrent-senders latency test is flaky on the Windows dev machine |
| `202` within 500 ms | **Met locally** (one sender: p95 ≈ 36 ms). **Not met on Render yet** (477–924 ms): the app is ≈ 60 ms from its database, and each request makes about 7 round trips. Reproduced locally by adding that delay (28 ms became ≈ 450 ms). See [section 3](#latency-on-render-the-honest-status) |

---

## 1. Run and test the service

### What you need

| Tool | Version | Used for |
|---|---|---|
| Python | 3.12+ | backend |
| Docker Desktop | current | local PostgreSQL 16 (same engine as production and CI) |
| Node.js | 20.19+ or 22.12+ | dashboard (optional) |
| Git | any | cloning |

Commands are for Windows PowerShell. Start Docker Desktop and wait until it says **Engine running** before step 2.

### Step 1: get the code

```powershell
git clone https://github.com/SG-07/product_engineer.git
cd product_engineer
```

### Step 2: start the database (once)

```powershell
docker run --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
docker exec pg pg_isready -U postgres                          # wait until it says "accepting connections"
docker exec pg psql -U postgres -c "CREATE DATABASE test;"     # separate database for the tests (they delete rows)
```

After a reboot, start it again with `docker start pg`.

### Step 3: start the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
if (-not (Test-Path .env)) { copy .env.example .env }          # already points at the Docker Postgres
uvicorn app.main:app --reload                                   # http://127.0.0.1:8000  (interactive docs at /docs)
```

Leave this terminal running; the tables are created on first start. Use `127.0.0.1`, not `localhost`, for the backend: on some Windows machines every new `localhost` connection stalls ~2 s (IPv6 fallback). SQLite (`DATABASE_URL=sqlite+aiosqlite:///./local.db`) is only a no-Docker fallback and is not valid for latency checks. All settings: [docs/configuration.md](docs/configuration.md).

### Step 4: try the API (second terminal, in `backend/`)

```powershell
.\.venv\Scripts\Activate.ps1
python scripts/send_webhook.py --amount 100 --currency USD --id txn_demo --repeat 3   # expect 1 accepted + 2 duplicate
curl.exe "http://127.0.0.1:8000/v1/transactions/txn_demo"                 # PROCESSING
# ... ~30 seconds later ...
curl.exe "http://127.0.0.1:8000/v1/transactions/txn_demo?currency=EUR"    # PROCESSED, amount shown in EUR
```

To iterate faster set `PROCESSING_DELAY_SECONDS=2` in `backend/.env` and restart uvicorn.

### Step 5 (optional): start the dashboard (third terminal)

```powershell
cd frontend
npm install
if (-not (Test-Path .env)) { copy .env.example .env }          # then set VITE_API_BASE_URL=http://127.0.0.1:8000 and VITE_USE_MOCK=false
npm run dev
```

Open **http://localhost:5173** (use `localhost` here: the backend only allows that origin by default). The dashboard sends webhooks, tracks them from `PROCESSING` to `PROCESSED`, runs idempotency and load tests, and shows latency against the 500 ms line. A guided tour, what each area does and troubleshooting are in [frontend/README.md](frontend/README.md).

### Run the tests

From `backend/`, with the Docker Postgres running and the virtual environment active:

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/test"
pytest -q -rs                                          # whole suite on Postgres, ~30-45 s
python scripts/spec_check.py                           # every requirement in backend_task.md against a running server, ~40 s
python scripts/smoke_test.py                           # end to end against a running server, ~35 s (real 30 s wait)
python scripts/load_test.py --n 50  --concurrency 1    # latency, one sender at a time
python scripts/load_test.py --n 100 --concurrency 20   # latency under concurrency vs the 500 ms limit
```

The success criteria map to tests like this: single transaction processed after ~30 s (`test_processing`, `smoke_test.py`), duplicate prevention (`test_idempotency`, including 20 simultaneous identical requests), fast acknowledgement under load (`test_performance`, `load_test.py`), reliability (`test_recovery`, `test_failures_retries`). To test the deployed service add `--base-url https://txn-webhooks.onrender.com` to the spec, smoke and load scripts. GitHub Actions runs the same suite on Postgres 16. More: [docs/testing.md](docs/testing.md).

---

## 2. Technical choices

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

Why these tools:

- **FastAPI** - async, so a burst of webhooks never blocks on the 30 s jobs; Pydantic gives strict validation and free OpenAPI docs.
- **PostgreSQL (Supabase)** - a primary key gives database-level idempotency that is safe even with several app instances; managed and free. Local development and tests use the same engine in Docker.
- **In-process asyncio + DB lease + sweeper** instead of Celery/Redis - one deployable, no broker; the database row (not memory) is the source of truth, so a crash cannot lose work. The upgrade path to a real queue is in [docs/decisions.md](docs/decisions.md).
- **Decimal money, banker's rounding for display** - never floats; stored at 4 decimals, shown at 2. **Fixed FX rates in config** - deterministic and offline.
- **React + Vite dashboard** - polls a small `/v1/stats` endpoint instead of holding push connections open.
- **Render + Supabase** - free tiers, deploys from GitHub, long-running process rather than serverless (needed for in-process tasks).

Stack: Python 3.12 · FastAPI · SQLAlchemy (asyncio) + asyncpg · Pydantic · PostgreSQL 16 · pytest · React 19 · Vite · Tailwind CSS · TanStack Query · Docker · GitHub Actions · Render · Supabase · built with Claude Code as the AI coding assistant. Versions: [docs/architecture.md](docs/architecture.md). Design alternatives: [docs/decisions.md](docs/decisions.md).

---

## 3. Public API endpoint deployed on the cloud

| | URL |
|---|---|
| **API (Render)** | `https://txn-webhooks.onrender.com` |
| Interactive API docs | `https://txn-webhooks.onrender.com/docs` |
| Health check | `https://txn-webhooks.onrender.com/` |
| Dashboard | `https://product-engineer.onrender.com` |

Try it (from `backend/` with the virtual environment active). Render's free tier sleeps when idle, so the first request can take 40 s or more; send one and wait:

```powershell
curl.exe https://txn-webhooks.onrender.com/                                    # {"status":"HEALTHY",...}
python scripts/send_webhook.py --base-url https://txn-webhooks.onrender.com --id txn_live1 --amount 1500 --currency INR --repeat 3
curl.exe "https://txn-webhooks.onrender.com/v1/transactions/txn_live1"         # PROCESSING, then PROCESSED after ~30 s
python scripts/smoke_test.py --base-url https://txn-webhooks.onrender.com      # full check, ~35 s
```

| Method & path | Purpose | Success |
|---|---|---|
| `POST /v1/webhooks/transactions` | Receive a transaction webhook | `202` |
| `GET /` | Health check | `200 {"status":"HEALTHY","current_time":...}` |
| `GET /v1/transactions/{id}?currency=` | Transaction status, as a one-element array `[{...}]` (as in the spec) | `200` / `404` / `422` (unsupported currency) |
| `GET /v1/transactions?status=&currency=&limit=&offset=` | List, newest first (for the dashboard) | `200` |
| `GET /v1/currencies` | Supported currencies + the fixed rates in use | `200` |
| `GET /v1/stats` | Live counts, server-side latency, DB pool usage (for the dashboard) | `200` |
| `GET /health/ready` | Health check that also pings the database | `200` / `503` |
| `GET /dashboard` | Redirects to the dashboard (`FRONTEND_URL`) | `307` / `404` if not configured |

Error codes: `401` bad signature · `404` unknown id · `409` same id, different payload · `422` invalid input · `503` storage unavailable. Full contract with examples: [docs/api.md](docs/api.md). How it was deployed (Supabase, Render, frontend) and how to repeat it: [docs/deployment.md](docs/deployment.md).

### Latency on Render: the honest status

The requirement is a `202` within 500 ms. **Locally it is met** (one sender: p95 ≈ 36 ms). **On Render it is not met yet:** a webhook takes 477–924 ms server-side. **The cause is distance to the database**, not the code: each database round trip from Render costs ≈ 57–60 ms and a request makes about 7 of them. We reproduced this without Render by making a local database behave the same way (a delay proxy adding 57 ms per round trip): the same code went from **28 ms to ≈ 450 ms**.

What we tried: moving the Supabase database (no change on Render, so the app still reaches a database ≈ 60 ms away); counting round trips with an injected delay (about 7 per request); the local delay replica above; comparing connection-pool sizes while the dashboard polls (Render's 2+1 pool gave p95 ≈ 588 ms, 5+5 gave ≈ 482 ms). What would fix it, in order: put the database in the same region as Render (confirm the real host in `DATABASE_URL`), raise the Render API pool to 5+5 (recommended, not applied yet), and cut the database round trips per request. Details and numbers: [docs/test-results.md](docs/test-results.md) §5.8.

---

## Known limitations

Full list: [docs/risks.md](docs/risks.md).

- Latency on Render is above 500 ms (see above; R1, R18, R23).
- Unknown transaction id returns `404`, not an empty array; the spec does not say (R21).
- 20 concurrent senders is borderline even locally (p95 ≈ 460–550 ms on Linux), because the 30 s jobs share the event loop with the API (R10, R19).
- Recovery after a hard crash is slow: a killed process's transaction finished 128 s after the restart, because of the 90 s lease (R4).
- Render's free tier sleeps when idle and needs a pinger (R3).
- Exchange rates are a fixed snapshot, not live; no user accounts; the list and stats endpoints are unauthenticated (R9).

## Project layout

```
backend/            FastAPI app (app/), tests/, scripts/ (send_webhook, spec_check, smoke_test, load_test, ...), schema.sql
frontend/           React + Vite dashboard (src/pages, src/components, src/lib)
docs/               detailed documentation (below)
render.yaml         Render blueprint for the backend
.github/workflows/  CI (full suite on Postgres 16)
```

## More documentation

| File | What is in it |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Components, state machine, data model, failure scenarios, tools and versions |
| [docs/decisions.md](docs/decisions.md) | Design choices with the alternatives considered |
| [docs/api.md](docs/api.md) | Full API contract with examples |
| [docs/configuration.md](docs/configuration.md) | Every backend and frontend setting |
| [docs/deployment.md](docs/deployment.md) | Supabase + Render deployment and live checks |
| [docs/testing.md](docs/testing.md) · [docs/test-results.md](docs/test-results.md) | How to test; measurements, experiments and bottlenecks |
| [docs/risks.md](docs/risks.md) · [docs/assumptions.md](docs/assumptions.md) | Known risks; things the task did not say |
| [docs/tracker.md](docs/tracker.md) · [docs/interview-notes.md](docs/interview-notes.md) | Project status; how to explain the project |
| [frontend/README.md](frontend/README.md) · [docs/frontend.md](docs/frontend.md) | Dashboard guide and tour; frontend specification |
