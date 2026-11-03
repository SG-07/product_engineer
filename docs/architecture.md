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
| Worker dies mid-processing (hard kill) | Lease expires → sweeper re-runs; **~2 min worst case** | `test_recovery`; manual kill test (123 s) |
| Graceful restart/deploy | Tasks cancelled, leases released, resumed on next start | `test_recovery` |
| External step fails | Retry with backoff, then `FAILED` | `test_failures_retries` |
| Database down during webhook | `503` → sender retries | code path; **no dedicated test** |
| Database down during processing | Task aborts, logged; row still PROCESSING → sweeper retries later | code path; **no dedicated test** |
| Two app instances | Lease + conditional updates prevent double processing | design only; **not tested** |
| Bad / forged signature | `401`, nothing stored | `test_signature` |

## Scaling notes
Not needed for this task, but known: tasks and sweeper live in the web process; to scale processing independently, replace `Processor.schedule` with a queue publish and run the processor in a worker (see `decisions.md` D3).
