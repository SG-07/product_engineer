# Configuration

All backend settings are environment variables (see [backend/.env.example](../backend/.env.example) and `backend/app/config.py`). Frontend settings are `VITE_*` variables in `frontend/.env`.

## Backend

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | local: `.env.example` points at Docker Postgres · code default `sqlite+aiosqlite:///./local.db` | PostgreSQL URL (local Docker and Supabase in production). `postgres://`, `postgresql://` and `?sslmode=require` are accepted. |
| `PROCESSING_DELAY_SECONDS` | `30` | Simulated external call. |
| `MAX_ATTEMPTS` | `3` | Tries before `FAILED`. |
| `RETRY_BACKOFF_SECONDS` | `2` | Base wait between attempts; it doubles each retry (2 s, then 4 s). |
| `LEASE_SECONDS` | `90` | How long a worker owns a transaction; also the worst-case wait before a hard-crashed job is re-picked. Must exceed the processing delay. |
| `SWEEPER_INTERVAL_SECONDS` | `30` | How often the recovery sweeper looks for abandoned work. |
| `STALE_UNCLAIMED_SECONDS` | `10` | A `PROCESSING` row nobody has claimed for this long is rescheduled by the sweeper. |
| `SWEEPER_ENABLED` | `true` | Set `false` to turn the recovery sweeper off. |
| `WEBHOOK_SECRET` / `SIGNATURE_REQUIRED` | unset / `false` | HMAC-SHA256 check of the raw body. `SIGNATURE_REQUIRED=true` needs a secret. |
| `SIGNATURE_HEADER` | `X-Razorpay-Signature` | Header that carries the HMAC signature. |
| `FX_RATES_TO_INR` / `FX_RATES_AS_OF` | USD 94.75 / EUR 106.08 / GBP 127.14 INR, as of 2026-11-03 | Fixed rates (not live); refresh when they drift. |
| `CORS_ORIGINS` | `http://localhost:5173` | Frontend origin(s), comma separated, no trailing slash. |
| `FRONTEND_URL` | unset | Where `GET /dashboard` redirects, e.g. `https://product-engineer.onrender.com`. Unset = `/dashboard` returns 404. |
| `API_DB_POOL_SIZE` / `API_DB_MAX_OVERFLOW` | `5` / `5` | Connections for the API (webhook and reads). With a nearby database a bigger pool was not faster, but with a distant one (like Render's) the 2 / 1 pool let dashboard polling push the webhook p95 to ≈ 588 ms while 5 / 5 held ≈ 482 ms ([test-results.md](test-results.md) §5.7). `render.yaml` still uses 2 / 1; raising it is recommended and not yet applied. |
| `WORKER_DB_POOL_SIZE` / `WORKER_DB_MAX_OVERFLOW` | `3` / `2` | Connections for background processing and the sweeper, kept separate from the API pool. |
| `SIMULATED_FAILURE_RATE` | `0` | Demo: fraction of attempts that fail on purpose. |

Edits to `backend/.env` are not picked up by `uvicorn --reload`; restart it. To iterate faster set `PROCESSING_DELAY_SECONDS=2`.

## Frontend (`frontend/.env`, read at start and at build time)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend base URL, no trailing slash. Use `http://127.0.0.1:8000` locally. |
| `VITE_USE_MOCK` | `true` | `true` = simulated backend in the browser; `false` = call the real backend. |
| `VITE_MOCK_PROCESSING_SECONDS` | `30` | Mock mode only: how long a fake transaction stays `PROCESSING`. |
| `VITE_DEV_PROXY_TARGET` | unset | Optional dev proxy target. With `VITE_API_BASE_URL=/api`, the dev server proxies `/api` to this target and avoids CORS entirely. |

For a deployed site these values are baked in at build time; see [deployment.md](deployment.md).
