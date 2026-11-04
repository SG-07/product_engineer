# Transaction Webhook Service

A Python service that receives transaction webhooks from a payment processor (RazorPay-style), **acknowledges them immediately with `202`**, and **processes them reliably in the background** (30 s simulated external call), exactly once per `transaction_id`. A React dashboard lets you send test webhooks and watch them being processed.

Amounts are stored in **INR** and can be viewed in **INR, USD, EUR or GBP** (`?currency=`).

- Task description: [backend_task.md](backend_task.md)
- Live backend: `https://txn-webhooks.onrender.com` · interactive API docs: `https://txn-webhooks.onrender.com/docs`
- Live dashboard: `https://product-engineer.onrender.com`

## Built with

Versions are the pins in `backend/requirements*.txt` and the ranges in `frontend/package.json`; a fresh `npm install` can pull newer minor versions.

| Layer | Tool | Version | Used for |
|---|---|---|---|
| Language | Python | 3.12+ (Render pins 3.12.8) | backend |
| Web framework | FastAPI | 0.115.6 | async API, request validation, auto-generated `/docs` |
| ASGI server | Uvicorn (standard) | 0.34.0 | runs the app |
| Validation and config | Pydantic, pydantic-settings | 2.10.4, 2.7.1 | strict webhook schemas, env-var settings |
| Database access | SQLAlchemy (asyncio) | 2.0.36 | queries and conditional `UPDATE`s |
| Postgres driver | asyncpg | 0.30.0 | async driver used in production and tests |
| SQLite driver | aiosqlite | 0.20.0 | no-Docker fallback only (not valid for latency) |
| Database | PostgreSQL | 16 | local (Docker), CI, and production (Supabase) |
| Tests | pytest, pytest-asyncio, httpx | 8.3.4, 0.25.0, 0.28.1 | test suite and async test client |
| Frontend | React | 19 (`^19.3.1`) | dashboard UI |
| Build tool | Vite | 8 (`^8.3.5`) | dev server and production build |
| Styling | Tailwind CSS | 4 (`^4.3.4`) | styling, with `tw-animate-css` for motion |
| UI primitives | Radix UI, lucide-react, sonner | 1.x, 1.x, 2.x | accessible tabs and dialogs, icons, toast messages |
| Data fetching | TanStack Query | 5 (`^5.105.3`) | polling for stats, pipeline and tables |
| Routing | React Router | 7 | Dashboard and Settings pages |
| Charts | Recharts | 3 (`^3.10.1`) | latency charts |
| Linting | oxlint | 1.x | `npm run lint` |
| Hosting (app) | Render | Blueprint, native Python runtime | backend web service and static dashboard |
| Hosting (database) | Supabase | managed | PostgreSQL via the Session pooler |
| Containers | Docker Desktop | current | local PostgreSQL 16 |
| CI | GitHub Actions | — | full test suite on Postgres 16 on every push |
| Source control | Git and GitHub | — | repository and CI trigger |
| AI coding assistant | Claude Code | — | used to build, test and document the project |

## Status at a glance (2026-11-04)

| Area | State |
|---|---|
| Features (webhook, idempotency, 30 s processing, recovery, currency views, dashboard) | Working end to end, locally and on Render |
| Requirements in [backend_task.md](backend_task.md) | All met locally (`scripts/spec_check.py`: 33 of 33 checks, no deviations), including the array response `[{...}]` for `GET /v1/transactions/{id}` ([decision D18](docs/decisions.md)). The 500 ms rule is **not met on Render yet** (below). |
| Tests | 86 tests; 85 pass on PostgreSQL 16. The 20-concurrent-senders latency test fails on the Windows dev machine in most runs (passed 2 of 8) |
| Reliability | A forced kill 3 s after a webhook, then restart: the transaction was recovered and finished as `PROCESSED` 128 s after the restart (slow because of the 90 s lease) |
| `202` within 500 ms, one sender at a time, local | **Met** (p95 ≈ 30–36 ms; the very first request after a fresh start can take ~700 ms while connections open) |
| `202` within 500 ms, 20 concurrent senders, local | **Borderline**: p95 ≈ 460–550 ms on Linux, higher on Windows |
| `202` within 500 ms on Render | **Not met yet**: a webhook takes 477–924 ms server-side. Each request makes ~7 sequential database round trips of ≈ 57–60 ms each. Moving the database on 2026-11-04 did not change this, so the app is still ≈ 60 ms from its database (details in [docs/test-results.md](docs/test-results.md)) |

Details, numbers and bottleneck analysis: [docs/test-results.md](docs/test-results.md). Open risks: [docs/risks.md](docs/risks.md).

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

## Single webhook under 500 ms

Requirement: `POST /v1/webhooks/transactions` must answer `202` within 500 ms, however long the background processing takes. The project uses HTTP polling rather than WebSockets (see [decision D21](docs/decisions.md)), so "under 500 ms" here means the webhook response.

| Setup | Measured (2026-11-04) | Verdict |
|---|---|---|
| Local, one sender (`load_test.py --n 50 --concurrency 1`) | p50 24 ms, p95 36 ms, max 52 ms | **Met** |
| Local, dashboard, five sends in a row | 13–78 ms | **Met** |
| Local, 20 concurrent senders | p95 ≈ 460–550 ms on Linux, higher on Windows | Borderline |
| Render + Supabase, one webhook (server-side) | 477–924 ms | **Not met** |

Why it is fast locally: the request does validation and one `INSERT`, commits, and returns. The 30 s processing runs afterwards in a background task, so it does not add to the response time.

Why Render misses it: each database round trip from Render costs ≈ 57–60 ms, and a webhook makes about 7 of them (about 14 for a duplicate). Fixing it means putting the database in the same region as Render (first confirm which host `DATABASE_URL` points at), and reducing round trips per request. Details: [docs/test-results.md](docs/test-results.md) §5.6 and [risk R18](docs/risks.md).

To measure it yourself:

```powershell
cd backend
python scripts/load_test.py --n 50 --concurrency 1                                                        # local
python scripts/load_test.py --base-url https://txn-webhooks.onrender.com --n 50 --concurrency 1          # Render
```

On Render, send one request and wait first: the free tier can take ~40 s to wake up after idle, which would skew the numbers.

## Install and run locally (Windows PowerShell)

### What you need

| Tool | Version | Used for |
|---|---|---|
| Python | 3.12+ | backend |
| Docker Desktop | current | local PostgreSQL 16 (same engine as production and CI) |
| Node.js | 20.19+ or 22.12+ | frontend dashboard |
| Git | any | cloning |

Start Docker Desktop and wait until it says **Engine running** before step 2.

### 1. Get the code

```powershell
git clone https://github.com/SG-07/product_engineer.git
cd product_engineer
```

### 2. Start the database (once)

```powershell
docker run --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
```

Wait a few seconds for Postgres to initialise, then confirm it is ready and create a separate database for the tests (the tests delete all rows in `transactions`, so never point them at the app database):

```powershell
docker exec pg pg_isready -U postgres                          # must say "accepting connections"
docker exec pg psql -U postgres -c "CREATE DATABASE test;"
```

Later, after a reboot, start it again with `docker start pg`.

### 3. Start the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
if (-not (Test-Path .env)) { copy .env.example .env }          # already points at the Docker Postgres
uvicorn app.main:app --reload                                   # http://127.0.0.1:8000  (docs at /docs)
```

Leave this terminal running. The tables are created automatically on first start.

> SQLite is only a fallback for quick experiments without Docker (`DATABASE_URL=sqlite+aiosqlite:///./local.db`). Do not use it for latency or concurrency checks.
>
> **Windows tip:** use `127.0.0.1`, not `localhost`, for the backend. On some Windows machines every new `localhost` connection stalls ~2 s (IPv6 fallback) which looks like a slow API but isn't.

### 4. Try the API (optional, second terminal in `backend/`)

```powershell
.\.venv\Scripts\Activate.ps1
python scripts/send_webhook.py --amount 100 --currency USD --id txn_demo --repeat 3
curl.exe "http://127.0.0.1:8000/v1/transactions/txn_demo"                 # PROCESSING
# ... ~30 seconds later ...
curl.exe "http://127.0.0.1:8000/v1/transactions/txn_demo?currency=EUR"    # PROCESSED, amount shown in EUR
```

`--repeat 3` sends the same webhook three times: you should see one `accepted` and two `duplicate`. To iterate faster set `PROCESSING_DELAY_SECONDS=2` in `backend/.env` and restart uvicorn (edits to `.env` are not picked up by `--reload`).

### 5. Start the frontend dashboard (third terminal)

```powershell
cd frontend
npm install
if (-not (Test-Path .env)) { copy .env.example .env }
```

Open `frontend/.env` and set it for the live backend:

```
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_USE_MOCK=false
```

```powershell
npm run dev
```

Open **http://localhost:5173** in the browser. (Use `localhost` here, not `127.0.0.1`: the backend only allows the `http://localhost:5173` origin by default; see `CORS_ORIGINS`.)

## Using the dashboard

On first visit a **currency picker** asks which currency to display (INR, USD, EUR or GBP). Change it later in **Settings**. Amounts are converted by the backend; the browser never does money arithmetic.

| Area | What it shows or does |
|---|---|
| Header | Health badge (is the backend reachable), links to Dashboard and Settings, and the **request log** button that opens every HTTP call the page made (status, time, body). |
| Status strip | Live counts of processing / processed / failed transactions, and DB pool use, from `GET /v1/stats`. |
| Pipeline board | The newest transactions grouped as Processing / Processed / Failed. Processing ones count down towards ~30 s, then move across. |
| Latency panel | Time per webhook as seen by the browser versus the server's own `X-Response-Time-Ms`; the median gap is the network overhead. Also shows the share of webhooks the server answered in over 500 ms. |
| **Send webhook** tab | A form for one webhook (id, source, destination, amount, currency). Shows the HTTP status, the response and the latency, then tracks the transaction until it is `PROCESSED` or `FAILED`. |
| **Idempotency** tab | Two scenarios, chosen from a dropdown. *Identical*: sends the same webhook N times; expect one accepted, the rest `duplicate`, and the transaction processed once. *Conflict*: sends an original, then the same id with changed fields; expect `409` for each change and the original kept. |
| **Load test** tab | Sends N distinct webhooks (up to the page's batch limit) at a chosen concurrency and reports min / average / p95 latency, coloured against the 500 ms budget. |
| Transactions table | The 50 newest transactions, filterable by status and searchable, with a detail panel per row. Refreshes automatically while anything is processing. |
| Settings | Currency, theme (light / dark / system), the **mock API** switch, and a button to clear mock data. |

### Using the complete program

Start the three pieces in this order, each in its own terminal: the database (Docker), the backend (`uvicorn` in `backend/`), then the dashboard (`npm run dev` in `frontend/`). Then open **http://localhost:5173** and work through this tour once; it covers every part of the system.

1. **Check the health badge.** Green "Healthy" means the dashboard reaches the backend. Red means it does not: see Troubleshooting below.
2. **Pick a display currency** in the first-visit picker. It is saved in the browser and you can change it later in **Settings**. The backend converts every amount, so the dashboard just displays what it receives.
3. **Send one webhook** from the **Send webhook** tab. Note the `202` status and the latency. The Latency panel shows that number next to the 500 ms line.
4. **Watch it move.** The pipeline board shows the transaction under *Processing* with a countdown. After about 30 s it moves to *Processed*, and the table shows its INR amount. The status strip counts it along the way.
5. **Test idempotency.** In the **Idempotency** tab run *Identical*: expect one `accepted` and the rest `duplicate`, with the transaction processed once. Then run *Conflict*: expect `409` for the changed fields and the original kept.
6. **Measure under load.** In the **Load test** tab run 20 webhooks at concurrency 1, then at concurrency 20, and compare p95 with the 500 ms line. Concurrency 20 sits near the line on a local machine, so repeat it about three times and read the median.
7. **Explore the data.** The transactions table filters by status, searches by id, and opens a detail panel per row. Switch currency in **Settings** and the same row shows USD, EUR or GBP, with the original amount as secondary text.
8. **Debug from the request log.** The **request log** button in the header lists every HTTP call the page made, with status, time and response body. Check it first when something looks wrong.
9. **Script it if you want.** Open **http://127.0.0.1:8000/docs** for the interactive API reference, or use `scripts/send_webhook.py` from a terminal.

Tips:

- Open the dashboard at `http://localhost:5173` and point the backend URL at `127.0.0.1:8000`. Opening it at `127.0.0.1:5173` fails CORS.
- The frontend defaults to mock mode. Set `VITE_USE_MOCK=false` in `frontend/.env`, and make sure the **Settings → Use mock API** switch is off, or you will see fake data.
- Mock mode is fine for UI work without a backend, but its timings mean nothing for latency. Use the live backend for any latency check.
- On Render the first load can take about 40 s; wait before measuring.

### Mock mode versus the live backend

| Mode | When | Notes |
|---|---|---|
| **Mock** (`VITE_USE_MOCK=true`, the default) | Working on the UI without a backend | Everything is simulated in the browser; no request reaches the server. Mock processing delay is `VITE_MOCK_PROCESSING_SECONDS` (default 30). |
| **Live** (`VITE_USE_MOCK=false`) | Testing the real service | Calls `VITE_API_BASE_URL`. |

Things that commonly go wrong:

- **Still seeing fake data.** The **Settings → Use mock API** switch is saved in the browser and overrides the `.env` value. Turn it off in Settings (or clear the site's local storage) after changing `VITE_USE_MOCK`.
- **`.env` changes have no effect.** Restart `npm run dev`. `VITE_*` values are read at start and, for a deployed site, at build time.
- **CORS errors in the browser console.** The origin you opened (for example `http://127.0.0.1:5173`) is not in the backend's `CORS_ORIGINS`. Use `http://localhost:5173`, or add the origin and restart the backend.
- **Health badge shows DOWN.** The backend is not running, the URL in `VITE_API_BASE_URL` is wrong, or on Render's free tier the service is cold-starting (the first request can take 30 s+).
- **The dashboard sends unsigned webhooks.** It only works against a backend with `SIGNATURE_REQUIRED=false` (the default). A secret must never be placed in the browser.
- **Avoiding CORS entirely in development (optional).** Set `VITE_DEV_PROXY_TARGET=http://127.0.0.1:8000` and `VITE_API_BASE_URL=/api` in `frontend/.env`; the dev server then proxies `/api` to the backend.

Frontend commands (from `frontend/`):

```powershell
npm run dev       # dev server on http://localhost:5173
npm run lint      # oxlint
npm run build     # production build into dist/
npm run preview   # serve the built dist/ locally
```

Frontend specification and acceptance criteria: [docs/frontend.md](docs/frontend.md).

## API summary

| Method & path | Purpose | Success |
|---|---|---|
| `POST /v1/webhooks/transactions` | Receive a transaction webhook | `202` |
| `GET /` | Health check | `200 {"status":"HEALTHY","current_time":...}` |
| `GET /v1/transactions/{id}?currency=` | Transaction status, as a one-element array `[{...}]` (as in the spec) | `200` / `404` / `422` (unsupported currency) |
| `GET /v1/transactions?status=&currency=&limit=&offset=` | List, newest first | `200` |
| `GET /v1/currencies` | Supported currencies + the fixed rates in use | `200` |
| `GET /v1/stats` | Live counts, server-side latency, DB pool usage (for the dashboard) | `200` |
| `GET /health/ready` | Health check that also pings the database | `200` / `503` |
| `GET /dashboard` | Redirects to the frontend dashboard (`FRONTEND_URL`) | `307` / `404` if not configured |

Error codes: `401` bad signature · `404` unknown id · `409` same id, different payload · `422` invalid input · `503` storage unavailable. Full contract with examples: [docs/api.md](docs/api.md).

## Configuration

All backend settings are environment variables (see [backend/.env.example](backend/.env.example)).

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | local: `.env.example` points at Docker Postgres · code default `sqlite+aiosqlite:///./local.db` | PostgreSQL URL (local Docker and Supabase in production). `postgres://`, `postgresql://` and `?sslmode=require` are accepted. |
| `PROCESSING_DELAY_SECONDS` | `30` | Simulated external call. |
| `MAX_ATTEMPTS` | `3` | Tries before `FAILED`. |
| `LEASE_SECONDS` | `90` | How long a worker owns a transaction; also the worst-case wait before a hard-crashed job is re-picked. Must exceed the processing delay. |
| `WEBHOOK_SECRET` / `SIGNATURE_REQUIRED` | unset / `false` | HMAC-SHA256 check of the raw body in `X-Razorpay-Signature`. |
| `FX_RATES_TO_INR` / `FX_RATES_AS_OF` | USD 94.75 / EUR 106.08 / GBP 127.14 INR, as of 2026-11-03 | Fixed rates (not live) - refresh when they drift. |
| `CORS_ORIGINS` | `http://localhost:5173` | Frontend origin(s), comma separated, no trailing slash. |
| `FRONTEND_URL` | unset | Where `GET /dashboard` redirects, e.g. `https://product-engineer.onrender.com`. Unset = `/dashboard` returns 404. |
| `API_DB_POOL_SIZE` / `API_DB_MAX_OVERFLOW` | `5` / `5` | Connections for the API. Local tests showed bigger pools are not faster; `render.yaml` uses 2 / 1 (not yet compared on Render). |
| `WORKER_DB_POOL_SIZE` / `WORKER_DB_MAX_OVERFLOW` | `3` / `2` | Connections for background processing and the sweeper, kept separate from the API pool. |
| `RETRY_BACKOFF_SECONDS` | `2` | Base wait between attempts; it doubles each retry (2 s, then 4 s). |
| `SWEEPER_INTERVAL_SECONDS` | `30` | How often the recovery sweeper looks for abandoned work. |
| `STALE_UNCLAIMED_SECONDS` | `10` | A `PROCESSING` row nobody has claimed for this long is rescheduled by the sweeper. |
| `SWEEPER_ENABLED` | `true` | Set `false` to turn the recovery sweeper off. |
| `SIGNATURE_HEADER` | `X-Razorpay-Signature` | Header that carries the HMAC signature. |
| `SIMULATED_FAILURE_RATE` | `0` | Demo: fraction of attempts that fail on purpose. |

Frontend settings (in `frontend/.env`, read at start / build time):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend base URL, no trailing slash. Use `http://127.0.0.1:8000` locally. |
| `VITE_USE_MOCK` | `true` | `true` = simulated backend in the browser; `false` = call the real backend. |
| `VITE_MOCK_PROCESSING_SECONDS` | `30` | Mock mode only: how long a fake transaction stays `PROCESSING`. |
| `VITE_DEV_PROXY_TARGET` | unset | Optional dev proxy target (see "Avoiding CORS entirely"). |

## Test

Run from the `backend/` folder, with the Docker Postgres running and the virtual environment active:

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/test"
pytest -q -rs                                          # whole suite on Postgres, ~30-45 s
python scripts/spec_check.py                           # checks every requirement in backend_task.md against a running server, ~40 s
python scripts/smoke_test.py                           # end-to-end against a running server, ~35 s (real 30 s wait)
python scripts/load_test.py --n 50  --concurrency 1    # latency, one sender at a time
python scripts/load_test.py --n 100 --concurrency 20   # latency under concurrency vs the 500 ms limit
```

`spec_check.py` exits 1 if any check fails. To test the deployed service, add `--base-url https://txn-webhooks.onrender.com` to the spec, smoke and load scripts.

`TEST_DATABASE_URL` points at the throw-away `test` database and enables the concurrent-latency test, which only runs on Postgres. Without it the suite falls back to SQLite, which is only a quick check. GitHub Actions runs the same suite on Postgres 16.

Current results: 86 tests are collected; 85 pass on Postgres. The exception is `test_ack_is_fast_under_concurrent_senders` (200 webhooks, 20 at once, p95 must be under 500 ms), which passed in 2 of 8 runs on the Windows dev machine and is borderline on Linux (p95 ≈ 460–550 ms). Reading the numbers: use the median of at least three runs, because laptop latency varies a lot between runs. Full results, experiments and bottlenecks: [docs/test-results.md](docs/test-results.md). How to run each test file: [docs/testing.md](docs/testing.md).

## Deploy (Supabase + Render)

### Database

Create a free project at supabase.com **in the same region as your Render service** (Render free services here run in Singapore, so choose Southeast Asia (Singapore)). A region mismatch is currently the largest source of latency (see [docs/test-results.md](docs/test-results.md), B1). Then *Project Settings → Database → Connection string → **Session pooler*** (port 5432). Use the pooler, not the "Direct connection": Render cannot reach Supabase's IPv6-only direct host. Tables are created automatically on first start.

### Backend

1. Push this repo to GitHub.
2. On render.com: *New → Blueprint* → select the repo (uses [render.yaml](render.yaml), which builds from `backend/`).
3. Set the environment variables:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Supabase **Session pooler** string (secret) |
   | `CORS_ORIGINS` | `https://product-engineer.onrender.com,http://localhost:5173` (your frontend's exact origin) |
   | `FRONTEND_URL` | `https://product-engineer.onrender.com` |
   | `PROCESSING_DELAY_SECONDS` | `30` |
   | `SIGNATURE_REQUIRED` | `false` (the dashboard sends unsigned requests) |
   | `WEBHOOK_SECRET` | leave empty unless signatures are enabled |

4. **Verify**: open `https://txn-webhooks.onrender.com/` and `/health/ready`, then run `python scripts/spec_check.py`, `python scripts/smoke_test.py` and `python scripts/load_test.py`, each with `--base-url https://txn-webhooks.onrender.com`. The live service is named `txn-webhooks`; the blueprint's default name in `render.yaml` is `transaction-webhook-service`. The first request after an idle period can take 40 s or more (measured: 42 s), so send one request and wait before timing anything.
5. **Keep it awake**: Render's free tier sleeps after ~15 min idle and the first request after that can take 30 s+ (breaks the 500 ms rule). Point a free pinger (cron-job.org / UptimeRobot) at `GET /` every 10 minutes, or use a paid instance. See [docs/risks.md](docs/risks.md).

### Deploy the frontend

The frontend is not part of `render.yaml`; create it as a **Static Site** on Render:

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npm install && npm run build` |
| Publish directory | `dist` |
| `VITE_API_BASE_URL` | `https://txn-webhooks.onrender.com` (no trailing slash) |
| `VITE_USE_MOCK` | `false` |

`VITE_*` values are baked into the bundle at build time: after changing them, trigger a manual deploy. Then add the site's exact URL to the backend's `CORS_ORIGINS` and `FRONTEND_URL`, and open the site. A visitor who previously used mock mode may need to switch it off in **Settings** (the choice is saved in their browser).

## Technical choices (short)

- **FastAPI** - async, so a burst of webhooks never blocks on the 30 s jobs; Pydantic gives strict validation and free OpenAPI docs.
- **PostgreSQL (Supabase)** - a primary key gives database-level idempotency that is safe even with several app instances; managed and free. Local development and tests use the same engine in Docker.
- **In-process asyncio + DB lease + sweeper** instead of Celery/Redis - one deployable, no broker; the database row (not memory) is the source of truth, so a crash cannot lose work. Trade-offs and the upgrade path to a real queue are in [docs/decisions.md](docs/decisions.md).
- **Decimal money, banker's rounding for display** - never floats; stored at 4 decimals, shown at 2.
- **Fixed FX rates in config** - deterministic and offline; swap for a live-rate provider later.
- **React + Vite dashboard** - polls a small `/v1/stats` endpoint instead of holding push connections open.

## Project layout

```
backend/            all backend code
  app/              FastAPI app (routers/, repository.py, processor.py, recovery.py, currency.py, ...)
  tests/            pytest suite
  scripts/          send_webhook.py · spec_check.py · smoke_test.py · load_test.py
  schema.sql        reference DDL (the app creates the table itself)
  requirements*.txt, pytest.ini, .env.example
frontend/           React + Vite dashboard
  src/pages/        Dashboard, Settings
  src/components/   send form, idempotency and load tests, live status/pipeline/latency, tables
  src/lib/          API client, mock API, preferences, request log
  .env.example      frontend settings
docs/               tracker · test-results · testing · risks · decisions · assumptions · architecture · api · frontend · interview-notes
render.yaml         Render blueprint for the backend (rootDir: backend)
.github/workflows/  CI (runs in backend/ on Postgres 16)
```

## Known limitations

Full list: [docs/risks.md](docs/risks.md). The most important:

- **Latency on Render is above 500 ms** (R1, R18): every database round trip costs ≈ 57–60 ms and a request makes about 7 of them. It was unchanged after the database was moved, so first check which database host `DATABASE_URL` really points at; reducing the round trips per request would also help.
- **Unknown transaction id returns `404`**, not an empty array; the spec does not say (R21, [assumptions](docs/assumptions.md) A1).
- **20 concurrent senders is borderline even locally** (p95 ≈ 460–550 ms on Linux); the 30 s background jobs share the event loop and database with the API, and opening database connections blocks the event loop for ~38 ms each (R10, R19, R22).
- **Recovery after a hard crash is slow**: a transaction interrupted by a forced kill finished 128 s after the restart (R4).
- Render's free tier sleeps when idle and needs a pinger (R3).
- Exchange rates are a fixed snapshot, not live; no user accounts (the currency preference lives in the browser); the list and stats endpoints are unauthenticated.
