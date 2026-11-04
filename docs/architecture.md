# Architecture

## Components

```
                    ┌────────────────────────── one FastAPI process (uvicorn) ──────────────────────────┐
 Payment processor  │  routers/webhooks.py ──► repository.insert_if_absent ──┐                          │
 ─── POST ─────────►│        │  verify HMAC, validate                        │      ┌─────────────────┐ │
                    │        └─ schedule(txn_id) ─► Processor (asyncio tasks)├────►│  PostgreSQL     │ │
 Dashboard / curl   │  routers/transactions.py ──► repository.get/list ──────┤      │  transactions   │ │
 ─── GET ──────────►│  routers/currencies.py, health.py                      │      │  (one table)    │ │
                    │                                                        │      └─────────────────┘ │
                    │  RecoverySweeper (every 30 s) ─► find_stale ─► Processor.schedule                  │
                    │  API pool (webhook + reads)     Worker pool (processor + sweeper)  ← separate     │
                    └────────────────────────────────────────────────────────────────────────────────────┘
```

| File | Responsibility |
|---|---|
| `app/main.py` | App factory, lifespan (create table, start sweeper, graceful shutdown), CORS, timing header, error handlers |
| `app/config.py` | All settings from env vars; validates FX rates and lease/delay consistency at startup |
| `app/schemas.py` | The public API contract (Pydantic) |
| `app/routers/*` | HTTP layer only - no business logic beyond request/response mapping |
| `app/repository.py` | **Every SQL statement.** Each state change is one conditional statement |
| `app/processor.py` | Background lifecycle: claim → wait → convert → mark; retries; shutdown |
| `app/recovery.py` | Safety net that re-schedules abandoned work |
| `app/currency.py` | All money math (single place, `Decimal` only) |
| `app/security.py` | HMAC verification |
| `app/db.py` | Two engines (API / worker), URL normalisation for Supabase |

## Transaction state machine

```
              INSERT (webhook)
                   │
                   ▼
             ┌────────────┐   claim lease (attempts+1)    ┌────────────┐
             │ PROCESSING │ ────────────────────────────► │ PROCESSING │  (lease held, 30 s wait)
             └────────────┘ ◄──────────────────────────── └─────┬──────┘
                   ▲          lease expired / released          │
                   │          (crash, restart) → sweeper        ├── success ─────────────► PROCESSED  (terminal)
                   │                                            │
                   └──────── error, attempts < max ◄────────────┤
                             (backoff, keep lease)              └── error, attempts = max ► FAILED     (terminal)
```
Terminal states are never changed: every write is `UPDATE ... WHERE status='PROCESSING'`.

## Request flows

**Webhook** - (1) read raw body (2) verify signature if present (3) validate JSON → `422` on error (4) `INSERT ... ON CONFLICT DO NOTHING RETURNING`, committed (5a) row created → start background task → `202 accepted` (5b) row existed and identical → `202 duplicate` (5c) existed and different → `409`. If step 4 raises a DB error → `503`.

**Background job** - (1) `UPDATE ... SET locked_until=now+90s, attempts=attempts+1 WHERE id=? AND status='PROCESSING' AND (locked_until IS NULL OR locked_until<=now) RETURNING ...` - zero rows means someone else owns it, stop (2) sleep 30 s holding no DB connection (3) `amount_inr = original_amount × rate` (4) `UPDATE ... SET status='PROCESSED', ... WHERE id=? AND status='PROCESSING'`.

**Read with currency** - `display = round_half_even(amount_inr / rate[target], 2)`; same currency as received → original amount returned as is.

## Data model - `transactions`

| Column | Type | Notes |
|---|---|---|
| `transaction_id` | varchar(64) **PK** | idempotency key |
| `source_account`, `destination_account` | varchar(64) | |
| `original_amount`, `original_currency` | numeric(18,4), varchar(3) | exactly as received |
| `amount_inr`, `fx_rate_to_inr`, `fx_rate_as_of` | numeric(18,4), numeric(18,8), date | null until PROCESSED |
| `status` | varchar(16) | CHECK in PROCESSING / PROCESSED / FAILED |
| `attempts`, `last_error` | int, text | |
| `locked_until` | timestamptz | lease expiry |
| `created_at`, `updated_at`, `processed_at` | timestamptz | `processed_at` null until done |

Partial index on `(locked_until) WHERE status='PROCESSING'` keeps the sweeper cheap as history grows.

## Failure scenarios

| What happens | Result | Covered by |
|---|---|---|
| Same webhook ×N, even simultaneously | 1 row, processed once | `test_idempotency` (20 concurrent) |
| Same id, different amount | `409`, original kept | `test_idempotency` |
| Crash right after INSERT, before task starts | Sweeper picks it up on the first sweep after it has sat unclaimed ≥ 10 s (sweeps run every 30 s) | `test_recovery` |
| Worker dies mid-processing (hard kill) | Lease expires → sweeper re-runs; **~2 min worst case** | `test_recovery`; manual kill tests (123 s on SQLite, 128 s on Postgres) |
| Graceful restart/deploy | Tasks cancelled, leases released, resumed on next start | `test_recovery` |
| External step fails | Retry with backoff, then `FAILED` | `test_failures_retries` |
| Database down during webhook | `503` → sender retries | code path; **no dedicated test** |
| Database down during processing | Task aborts, logged; row still PROCESSING → sweeper retries later | code path; **no dedicated test** |
| Two app instances | Lease + conditional updates prevent double processing | design only; **not tested** |
| Bad / forged signature | `401`, nothing stored | `test_signature` |

## Tools and versions

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

## Scaling notes
Not needed for this task, but known: tasks and sweeper live in the web process; to scale processing independently, replace `Processor.schedule` with a queue publish and run the processor in a worker (see `decisions.md` D3).
