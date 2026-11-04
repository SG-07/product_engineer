# Decision Log

Each entry: what we chose, what else was possible, and why. "Confirmed" = chosen by the project owner; the rest are engineering decisions made to implement those choices.

---

## D1 - Web framework: FastAPI  *(confirmed)*
**Alternatives:** Flask, Django + DRF.
**Why:** The service's whole job is "answer instantly, work later". FastAPI is async-native, so hundreds of waiting 30 s jobs are cheap tasks on the event loop, not blocked threads. Pydantic validates input strictly and OpenAPI docs come for free.
**Cost:** async code is harder to reason about than sync Flask.

## D2 - Database: managed PostgreSQL on Supabase  *(confirmed)*
**Alternatives:** MongoDB Atlas, Redis only, DynamoDB/Firestore, Neon Postgres.
**Why:** A primary key on `transaction_id` gives idempotency in the database itself - correct even with several app instances. ACID transactions make status changes safe. Free managed tier.
**Why not Neon:** Neon suspends idle compute after ~5 min; the wake-up delay could push the first webhook past 500 ms.
**Why not Redis-only:** fast, but weaker as the permanent record of financial data.

## D3 - Background processing: in-process asyncio + DB lease + recovery sweeper  *(confirmed)*
**Alternatives:** Celery/RQ + Redis; managed queue (SQS / Cloud Tasks); DB-as-queue with a separate worker.
**Why:** One deployable, no broker to pay for or operate - right for a one-day build and a free tier. Reliability does **not** come from memory: the row is committed before the `202`, and the sweeper re-runs anything unfinished, so a crash cannot lose a transaction.
**Costs / limits:**
- Jobs share the web process (CPU/memory). Fine for simulated work; for real heavy work move to a worker.
- After a *hard* crash a job waits for its lease to expire (up to `LEASE_SECONDS`=90) plus the sweep interval (30 s) before restarting. Measured: **123 s** end-to-end. Graceful restarts (deploys) release leases and resume immediately.
**Upgrade path:** `Processor.schedule()` is the only enqueue point; replace it with a queue publish and run `Processor._process_with_retries` in a worker. The table and lease logic stay.

## D4 - Hosting: Render, Python native runtime, no Docker  *(confirmed)*
**Alternatives:** Railway, Fly.io, Cloud Run/AWS.
**Why:** Deploys from GitHub with a free tier and runs a long-lived process rather than serverless (needed for in-process tasks).
**Why not Cloud Run:** CPU is throttled after the response unless "always allocated" - background tasks would stall.
**Cost:** free tier sleeps when idle → keep-alive pinger required (R3).

## D5 - Idempotency enforced by the database  *(engineering)*
`INSERT ... ON CONFLICT (transaction_id) DO NOTHING RETURNING`. Exactly one concurrent request sees a returned row and schedules processing; the rest are duplicates. Second layer: processing starts with a conditional `UPDATE ... WHERE status='PROCESSING' AND lease free` and finishes with `UPDATE ... WHERE status='PROCESSING'`, so even a bug in scheduling cannot process twice.
**Rejected:** check-then-insert in code (race condition); in-memory set of seen ids (lost on restart, wrong with >1 instance).

## D6 - Same id, different payload → `409`  *(confirmed)*
Same id **and** same payload → `202 {"status":"duplicate"}` (processors retry; that must not be an error). Same id with a different amount/currency/accounts is suspicious → `409`, original untouched. Comparison is numeric (`1500` equals `1500.0`).

## D7 - Lease (time-limited ownership) instead of a plain "processing" flag  *(engineering)*
A boolean would stay true forever if the worker died. A `locked_until` timestamp expires by itself, so a dead worker's job becomes claimable again. Retry/shutdown only touch a lease if they still hold the exact one (compare-and-set), so one instance can never release another's lease.

## D8 - Two connection pools (API vs background)  *(engineering)*
A burst of background DB work must never exhaust connections the webhook endpoint needs. Separate engines make that structurally impossible.

## D9 - Do not hold a DB connection during the 30 s wait  *(engineering)*
Claim (short transaction) → sleep with no connection → write result (short transaction). 500 sleeping jobs use zero connections.

## D10 - Return `503` (not `202`) if the row cannot be stored  *(engineering)*
Only the stored row guarantees we won't lose the transaction. If the DB is down we refuse so the processor's own retry mechanism re-sends. Better than a `202` we cannot honour.

## D11 - Signature verification: configurable  *(confirmed "check it"; enforcement mode is an assumption, A3)*
HMAC-SHA256 over the **raw body** (re-serialised JSON would not match), constant-time compare, optional `sha256=` prefix. Present-and-wrong → `401` always. Missing → rejected only if `SIGNATURE_REQUIRED=true`. Default is permissive because the task's test webhooks are likely unsigned.

## D12 - Statuses `PROCESSING` / `PROCESSED` / `FAILED` + retries  *(confirmed)*
3 attempts, exponential backoff (2 s, 4 s), then `FAILED` with `last_error`. `FAILED` is terminal; a duplicate webhook does **not** resurrect it (would be a manual/operational action).

## D13 - Users: none; currency preference lives in the browser  *(confirmed)*
**Alternative:** full accounts (users table, login/JWT, `PATCH /users/me/settings`).
**Why not now:** not in the spec, roughly doubles scope, adds security surface. The frontend stores `preferredCurrency` in localStorage and sends `?currency=`.
**Future:** accounts can supply the same value server-side; the API contract does not change.

## D14 - Store INR as the base currency, keep the original  *(confirmed)*
Store `original_amount/original_currency` (audit - exactly what the processor sent), plus `amount_inr`, `fx_rate_to_inr`, `fx_rate_as_of` (what we computed and with which rate). Never overwrite the original.

## D15 - Convert to INR during background processing, not in the webhook  *(confirmed)*
Keeps the webhook to one INSERT (500 ms budget) and makes the FX step part of the "external call" the task asks us to simulate. While `PROCESSING`, `amount_inr` is null and display conversion uses current config rates.

## D16 - Fixed FX rates from configuration  *(confirmed)*
**Alternative:** live rates (e.g. Frankfurter API).
**Why fixed:** deterministic tests, no extra network dependency inside the 30 s path, offline-friendly. **Cost:** rates go stale. Current values are an owner-supplied snapshot (2026-11-03); refresh via `FX_RATES_TO_INR` / `FX_RATES_AS_OF`.

## D17 - Money is `Decimal`, stored `NUMERIC(18,4)`, displayed to 2 dp with banker's rounding  *(confirmed rounding)*
Floats cannot represent money exactly. Rounding (ROUND_HALF_EVEN) happens **only** when producing display values; stored values keep 4 dp. Display in the transaction's own currency returns the original amount unchanged (no INR round-trip drift). JSON output uses numbers (`15.83`, for 1500 INR at 94.75), as the spec shows.
**Known limit:** JSON numbers are binary floats once parsed by a client; fine for 2 dp display, don't do arithmetic on them.

## D18 - GET `/v1/transactions/{id}` returns a one-element array, as in `backend_task.md`  *(owner-confirmed, revised 2026-11-04)*
`backend_task.md` sketches the response as `[{...}]`. Originally the owner chose a single object; on 2026-11-04, after checking the service against the spec, the owner switched back to the array so that a client or grader written to the sketch (`response.json()[0]`) works. Unknown id → `404` (the spec is silent; `assumptions.md` A1). A separate list endpoint exists for the dashboard and returns `{items, total, limit, offset}`.
**Cost:** a client that expects a bare object must read element `[0]`. The frontend client already normalises both shapes (`asArray` in `src/lib/api.js`), and `scripts/spec_check.py` now requires the array.

## D19 - Schema created at startup, no migration tool  *(engineering)*
One table, one day. `create_all` is idempotent; `schema.sql` is the reference. **Revisit with Alembic** the first time a column changes on a live database - `create_all` will not alter existing tables.

## D20 - PostgreSQL is the standard for local dev and tests; SQLite is a fallback  *(engineering, revised 2026-11-04)*
Originally SQLite was the zero-setup default. It is a different database from production: one writer at a time, and the Postgres-only `ON CONFLICT` path and concurrency test were not exercised. Local development and `pytest` now run on **PostgreSQL 16 in Docker** (README, `.env.example`, `docs/testing.md`), matching production and CI. The same repository code still runs on SQLite via dialect-specific `INSERT ... ON CONFLICT`, kept as a quick no-Docker fallback that is **not valid for latency or concurrency** conclusions (R1). The code defaults in `config.py` and `tests/conftest.py` still fall back to SQLite when nothing is configured; making Postgres mandatory is a possible follow-up.

## D21 - Live dashboard by polling a small `/v1/stats` endpoint; small DB pool  *(confirmed)*
**What:** the UI polls `GET /v1/stats` (3 s while anything is processing, else 10 s) plus the list endpoint. Stats = one cheap `GROUP BY` (cached 1 s) + in-memory counters (latency of the last 200 webhooks, outcomes). The API DB pool is set to 2 + 1 overflow via `API_DB_POOL_SIZE` / `API_DB_MAX_OVERFLOW` (env only; code defaults stay 5 + 5).
**Alternatives:** Server-Sent Events / WebSocket (push) - rejected: a held connection per viewer on a single free instance, more moving parts, little gain at 3 s freshness. Compute everything in the browser from the list endpoint - rejected: cannot show server-side latency, in-flight jobs or pool use.
**Why in-memory latency:** recording is O(1) with no await and no DB, so it cannot slow the 500 ms path. Server time vs client-measured time shows how much of any slowness is network.
**Cost:** counters reset on restart and are per instance; `/v1/stats` is unauthenticated (R9). **Pool 2 + 1 is an experiment:** keep it only if the load test (R1) is no worse than 5 + 5. **Findings so far (local, 2026-11-04):** a larger API pool was *worse*, not better (20 connections: p95 ≈ 726 ms vs ≈ 553 ms at 5 + 5 under 20 concurrent senders), and `api_in_use` peaked at 12 of 20, so the pool was not the limit. The 2 + 1 setting has not yet been compared on Render (`test-results.md` §5).
**Revised after the distance experiment (2026-11-04, `test-results.md` §5.7).** The finding above only holds when the database is nearby. With the local database made 57 ms "distant" (like Render's) and the dashboard polling, one sender's webhook p95 was **588 ms on 2 + 1** and **482 ms on 5 + 5**, in three interleaved rounds. Small pools make the webhook queue behind the dashboard's reads when each read holds a connection for about 400 ms. **Recommendation:** use 5 + 5 on Render (`render.yaml` still says 2 + 1; not yet applied), then confirm with `load_test.py` against Render. This does not remove the underlying delay, which is distance to the database (R18).
