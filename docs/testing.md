# Testing

## How to run
All commands run from the `backend/` folder.
```powershell
pytest -q -rs                       # whole suite; SQLite; ~15 s; -rs shows why anything was skipped
pytest tests/test_idempotency.py    # one file
$env:TEST_DATABASE_URL="postgresql://user:pass@host:5432/db"; pytest -q -rs   # same suite on Postgres
python scripts/smoke_test.py        # E2E vs a running server (~35 s, real 30 s wait)
python scripts/load_test.py --n 200 --concurrency 20
```
⚠ With `TEST_DATABASE_URL` the tests **delete all rows** in `transactions`. Use a throw-away database, never production.
Tests shrink the delays (`PROCESSING_DELAY_SECONDS≈0.3`, short lease/sweep) so the suite is fast; only `smoke_test.py` and the in-flight latency test use the real 30 s.

## Map: task success criteria → tests
| Criterion | Tests |
|---|---|
| 1. Single transaction processed after ~30 s | `test_processing` (delay respected, INR stored), `smoke_test.py` (real 30 s) |
| 2. Duplicate prevention | `test_idempotency`: 5 sequential, **20 concurrent**, after-processed, numeric-equality, 409 cases |
| 3. Fast ack under load | `test_performance`: 100 webhooks with 30 s jobs in flight (runs everywhere); 200 webhooks × 20 concurrent (**Postgres only**); `load_test.py` |
| 4. Reliability | `test_recovery` (orphaned row, dead worker, active lease not stolen, graceful restart), `test_failures_retries`, manual hard-kill test |

Other files: `test_webhook` (validation matrix), `test_transactions_api` (shape, 404, currency display, pagination), `test_currency` (rounding, config validation), `test_signature`, `test_health` (incl. CORS).

## Results on record (2026-11-03)
- Suite on SQLite: **70 passed, 1 skipped** (the Postgres-only concurrency test).
- `smoke_test.py` vs a real uvicorn process: all checks passed.
- Hard-kill test (outside the suite, ad hoc script): row survived, finished 123 s after restart.

## What is NOT tested
- **Anything on PostgreSQL** - CI is configured to do it, but has not run. This includes the Postgres `ON CONFLICT` path, asyncpg, SSL/pooler URL handling.
- The deployed Render service.
- DB-outage behaviour (`503` path, processing abort) - code exists, no test injects a failure.
- Two app instances processing concurrently.
- Real RazorPay signatures / payloads.
- Latency at 20 concurrent senders (SQLite measured ≈ 1.1–1.6 s p95; a SQLite limitation, but Postgres figure unknown).

## Known test-suite quirk
When ~100 jobs are cancelled at once on SQLite (seen in an ad hoc load probe, not in the suite), shutdown logs "could not release lease … it will expire on its own": lease release is best-effort with a 2 s timeout and SQLite's single writer can exceed it. Correctness is unaffected (lease expiry is the fallback). `test_graceful_shutdown…` asserts the final outcome, not the release itself.
