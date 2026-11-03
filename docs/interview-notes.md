# Explaining this project to someone else

## The 60-second version
"It's a webhook receiver. A payment processor POSTs a transaction; we save it to Postgres and answer `202` straight away - that's one INSERT, a few milliseconds. A background task then waits 30 seconds (standing in for external calls), converts the amount to INR, and marks it processed. The transaction id is the primary key, so sending the same webhook ten times still gives one transaction. If the server dies mid-way, the row is still in the database as 'processing', and a sweeper picks it up again - so nothing is lost. Amounts are stored in INR and can be viewed in INR, USD, EUR or GBP."

## Three ideas that make it work
1. **The database row is the source of truth, not memory.** Save first, reply second, process third. Everything else (retries, recovery) follows from that.
2. **Let the database decide who wins a race.** `INSERT ... ON CONFLICT DO NOTHING` - exactly one concurrent request creates the row. No locks in application code.
3. **Leases instead of flags.** A worker "rents" a transaction for 90 s. If it dies, the rental expires and someone else can take it. A `processing = true` flag would be stuck forever.

## Questions you may be asked
**Why not Celery/Redis?** One service and no broker to run is right for this size, and reliability comes from the DB row, not the queue. If processing becomes real, CPU-heavy work, move it to a worker - `Processor.schedule()` is the single place to change.

**What if the server crashes after replying 202?** The row was committed before the 202, so it's safe. On restart the sweeper finds rows that are still PROCESSING with no live owner and re-runs them. I tested a hard kill: it finished 123 s after restart (lease expiry + sweep + the 30 s wait).

**What if the same webhook arrives twice at the same moment?** Both hit the INSERT; Postgres lets one through. The other gets "duplicate". Tested with 20 simultaneous identical requests: one accepted, 19 duplicates, processed once.

**Why 409 for a changed amount?** A retry should be identical. Same id with different data is either a bug or tampering, so we keep the original and say so loudly rather than silently ignore it.

**Why Decimal and banker's rounding?** Floats can't represent money exactly. Banker's rounding (half → nearest even) avoids systematically rounding half-cents up; it's what the owner chose. It's applied only for display; stored values keep 4 decimals.

**Why convert in the background, not in the webhook?** Keeps the request to one INSERT, protecting the 500 ms budget, and the FX step is part of the "external call" being simulated.

**Why no users/login?** Not in the spec and it would double the scope. The currency preference is a browser setting sent as `?currency=`. Accounts could supply the same value later with no API change.

**How would you scale it?** Move jobs to a queue + worker; add Alembic migrations; auth on read endpoints; live FX rates with history; metrics and alerts.

## Honest limits (say these before being asked)
- All testing so far ran on SQLite. The Postgres path and the Render deployment are the first things to verify; the 500 ms target under 20 concurrent senders is **not yet proven** (SQLite gave ~1.1–1.6 s p95 because it allows one writer at a time).
- FX rates are a fixed snapshot (2026-11-03), not live. Signatures were only tested with self-made HMACs.
- The list endpoint is unauthenticated.
- Free-tier Render sleeps; it needs a pinger.

See `risks.md` for the full list and `decisions.md` for alternatives considered.

## Suggested demo (5 minutes)
1. `GET /docs` - show the contract.
2. `send_webhook.py --repeat 5` - 1 accepted + 4 duplicates, `X-Response-Time-Ms` in ms.
3. `GET /v1/transactions/{id}` - PROCESSING; again after 30 s - PROCESSED with `amount_inr`.
4. Same id with a different amount → 409.
5. `?currency=EUR` - show rounding and the stored original.
6. (Optional) kill the server mid-processing, restart, watch it finish.
