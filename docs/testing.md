# Testing

## How to run
All commands run from the `backend/` folder.
```powershell
# Standard (local): run on the Docker Postgres. Create the test DB once: docker exec pg psql -U postgres -c "CREATE DATABASE test;"
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/test"
pytest -q -rs                       # whole suite on Postgres; -rs shows why anything was skipped
pytest tests/test_idempotency.py    # one file
python scripts/spec_check.py        # every requirement in backend_task.md vs a running server (~40 s)
python scripts/smoke_test.py        # E2E vs a running server (~35 s, real 30 s wait)
python scripts/load_test.py --n 200 --concurrency 20
python scripts/delay_proxy.py 5433 5432 28   # distance replica: add ~57 ms round trip to the DB, then point DATABASE_URL at port 5433
python scripts/dashboard_poller.py http://127.0.0.1:8000 75   # simulate the dashboard's polling while load_test.py runs (steps: test-results.md §10)

# Quick check without Docker only (SQLite; not valid for latency):
Remove-Item Env:TEST_DATABASE_URL; pytest -q -rs
```
⚠ With `TEST_DATABASE_URL` the tests **delete all rows** in `transactions`. Use the throw-away `test` database, never the app database or production.
CI runs the same suite on Postgres 16 on every push (`.github/workflows/`).
Tests shrink the delays (`PROCESSING_DELAY_SECONDS≈0.3`, short lease/sweep) so the suite is fast; only `smoke_test.py` and the in-flight latency test use the real 30 s.
`TEST_DATABASE_URL` points at the throw-away `test` database and also enables the concurrent-latency test, which only runs on Postgres. Without it the suite falls back to SQLite, which is only a quick check.
`spec_check.py` exits 1 if any check fails. To test the deployed service add `--base-url https://txn-webhooks.onrender.com` to the spec, smoke and load scripts (`spec_check.py` writes about 42 test rows to the live database). Laptop latency varies a lot: use the median of at least three runs.

## Map: task success criteria → tests
| Criterion | Tests |
|---|---|
| 1. Single transaction processed after ~30 s | `test_processing` (delay respected, INR stored), `smoke_test.py` (real 30 s) |
| 2. Duplicate prevention | `test_idempotency`: 5 sequential, **20 concurrent**, after-processed, numeric-equality, 409 cases |
| 3. Fast ack under load | `test_performance`: 100 webhooks with 30 s jobs in flight (runs everywhere); 200 webhooks × 20 concurrent (**Postgres only**); `load_test.py` |
| 4. Reliability | `test_recovery` (orphaned row, dead worker, active lease not stolen, graceful restart), `test_failures_retries`, manual hard-kill test |

Other files: `test_webhook` (validation matrix), `test_transactions_api` (shape, 404, currency display, pagination), `test_currency` (rounding, config validation), `test_signature`, `test_health` (incl. CORS).

## Results on record
Full tables, experiments and bottleneck analysis are in **[test-results.md](test-results.md)**. In short (2026-11-04):
- Suite on local Docker Postgres 16: **86 passed** on the first run; on two repeat runs 85 passed and 1 failed — `test_ack_is_fast_under_concurrent_senders` (p95 672 ms vs the 500 ms limit). That test is flaky near the limit: about half of runs pass on Linux, most fail on Windows.
- Suite on SQLite (earlier): 70–81 passed, 1 skipped (the Postgres-only concurrency test).
- `scripts/spec_check.py` (every requirement in `backend_task.md`, using the spec's own body) on a clean local Postgres instance: **33 of 33 checks pass, no deviations**, including `GET /v1/transactions/{id}` returning the spec's one-element array (`decisions.md` D18). Unknown id returns `404` (`risks.md` R21).
- `smoke_test.py` vs a clean local instance: all checks pass. vs Render + Supabase: **14 of 15 checks pass**; the failing check is "responds within 500ms" (748 ms).
- Forced kill 3 s after a webhook, then restart, on Postgres: the transaction was recovered and `PROCESSED` 128 s after the restart.
- `load_test.py` on local Postgres: 50 sequential requests p95 36 ms (pass); 100 requests × 20 concurrent p95 790 ms (fail); 400 × 20 concurrent p95 460 ms (pass).
- Hard-kill test (ad hoc script, SQLite): row survived, finished 123 s after restart.
- **Distance replica** (`delay_proxy.py` plus `dashboard_poller.py`, 3 interleaved rounds, one sender): with the database made ≈ 57 ms away, the webhook takes ≈ 455 ms p50 (28 ms on the direct database). With the dashboard polling, p95 was 588 ms on pool 2+1 and 482 ms on 5+5. Details: [test-results.md](test-results.md) §5.7.

## What is NOT tested
- DB-outage behaviour (`503` path, processing abort) - code exists, no test injects a failure.
- Two app instances processing concurrently.
- Real RazorPay signatures / payloads.
- Hard-kill recovery is an ad hoc manual test, not part of `pytest` (it was run once on SQLite and once on Postgres).
- The port-6543 (transaction pooler) URL variant.
- Render load test after the database and service are placed in the same region (the current deployment has them in different regions; see `risks.md` R18).
- The frontend dashboard served from Render against the live backend.

## Known test-suite quirks
- **Shutdown noise on Postgres.** After the suite, asyncpg logs `Task was destroyed but it is pending ... Connection._cancel` and a `ValueError: I/O operation on closed file` logging error. Some test or fixture leaves connections open at exit. Results are not affected (`risks.md` R20).
- **The 20-concurrent test measures client and app in one process.** The test client, the app and up to 200 background jobs share one Python event loop, so its p95 includes the client's own CPU. Compare medians over several runs, not a single result (`risks.md` R19).
- When ~100 jobs are cancelled at once on SQLite (seen in an ad hoc load probe, not in the suite), shutdown logs "could not release lease … it will expire on its own": lease release is best-effort with a 2 s timeout and SQLite's single writer can exceed it. Correctness is unaffected (lease expiry is the fallback). `test_graceful_shutdown…` asserts the final outcome, not the release itself.
