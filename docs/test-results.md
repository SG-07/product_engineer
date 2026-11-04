# Test Results, Performance Findings and Bottlenecks

**Recorded:** 2026-11-04 · **Scope:** a record of what was tested, what was measured and where the time goes. No application code or deployment setting was changed. Section 5.7 (added later the same day) reproduces the Render delay on a laptop and compares API pool sizes; improvements are listed in section 9.

Related: [testing.md](testing.md) (how to run the tests) · [risks.md](risks.md) · [tracker.md](tracker.md) · [decisions.md](decisions.md)

## 1. Summary

| Question | Answer |
|---|---|
| Does the service do what `backend_task.md` asks? | **Yes, locally** (section 1.1). Checked requirement by requirement with `scripts/spec_check.py`: 33 of 33 checks pass, no deviations. On Render the end-to-end smoke test passes 14 of 15 checks (run before the array change); the 15th is latency, so the 500 ms requirement is **not met there**. |
| `202` within 500 ms, **one sender at a time**, local | **Met.** p95 36 ms (Windows laptop, Postgres in Docker); 13–78 ms per request in manual dashboard use. |
| `202` within 500 ms, **20 concurrent senders**, local, Linux | **Borderline.** p95 ≈ 460–550 ms; about half the runs pass. |
| Same, local, **Windows** | **Not met reliably.** p95 ≈ 670–1,200 ms, varies a lot between runs. |
| `202` within 500 ms on **Render + Supabase** | **Not met.** Server-side time per POST is 477–924 ms, **both before and after the owner moved the database** (2026-11-04); a single read stays at ≈ 400 ms. |
| `202` within 500 ms, **one sender, local database made 57 ms "distant"** (section 5.7) | **Borderline when quiet** (p50 ≈ 455 ms, p95 ≈ 490 ms). **Not met with the dashboard polling on the 2 + 1 pool** (p95 588 ms); met, narrowly, on a 5 + 5 pool (p95 482 ms). |

**Reproduced locally (section 5.7):** with a local database made to behave like Render's (57 ms round trip, via a delay proxy), a single webhook takes **≈ 450 ms p50** with nothing else running, against **28 ms** with the direct local database. Same code, same pool. So the delay on Render is caused by the distance to the database, not by the application. Adding the dashboard's own polling pushed p95 to **588 ms** on the current 2 + 1 API pool and kept it at **482 ms** on a 5 + 5 pool.

**Biggest finding for deployment:** the time is dominated by the *number of database round trips per request* (about 7 for a simple request, about 14 for a duplicate POST) multiplied by a round trip of **≈ 57–60 ms from Render to the database**. The numbers did not change when the database was moved, so the app is still talking to a database about 60 ms away: either the move did not take effect for this service (check the host in `DATABASE_URL`) or the new database is not near Render. A same-region database should take a few ms per round trip, i.e. ≈ 35 ms per request. See bottleneck B1 and section 5.6.

## 1.1 Compliance with `backend_task.md`

Verified on 2026-11-04 against a clean local instance on PostgreSQL (real 30 s delay), using the spec's own request body and `scripts/spec_check.py` (33 of 33 checks pass after the response was switched to the spec's array shape). The Render column comes from the earlier smoke test (14 of 15 pass), the owner's later dashboard session, and read-only requests; **`spec_check.py` has not yet been run against Render** (it writes about 42 test transactions to the live database).

| Requirement in `backend_task.md` | Local (Postgres) | Render |
|---|---|---|
| `POST /v1/webhooks/transactions` accepts the sample body (`amount` 1500, `INR`) | **Met** | Met |
| Returns `202 Accepted`, simple acknowledgment body | **Met** (`{"status":"accepted","transaction_id":...}`) | Met |
| Responds within 500 ms | **Met**: 15–21 ms warm; one run of the very first request after a restart took 693 ms (section 6, B7) | **Not met**: 477–924 ms server-side, before and after the database change (B1) |
| `GET /` returns `{"status":"HEALTHY","current_time":"…Z"}` | **Met** (exactly those two fields) | Met |
| `GET /v1/transactions/{id}` returns the listed fields (`transaction_id`, `source_account`, `destination_account`, `amount`, `currency`, `status`, `created_at`, `processed_at`) | **Met** (extra fields also returned: `attempts`, `original_*`, `amount_inr`, `fx_*`, `last_error`) | Met |
| …`status` is `PROCESSING` then `PROCESSED`; `processed_at` is null while processing | **Met** | Met |
| …response is an **array** `[{…}]` | **Met** since 2026-11-04 (a one-element array; it was a single object before the owner switched back, `decisions.md` D18). Unknown id still returns `404`, the spec is silent (`assumptions.md` A1) | **Met** after the redeploy (read-only `GET` of an existing id on 2026-11-04 returned `[{...}]`) |
| Processing includes a 30 s delay; final result stored in persistent storage | **Met**: `processed_at − created_at` = 30.0 s; stored in Postgres | Met (~31 s) |
| Idempotency: same `transaction_id` sent repeatedly → one processed transaction, no errors | **Met**: 5 duplicates while processing + 1 after = all `202`, one stored row, `attempts == 1` | Met |
| Same id with a different payload | Returns `409` (a design choice beyond the spec) | Met |
| Performance: endpoint stays fast under processing load | **Met** for one sender (40 webhooks while a 30 s job ran: max 15–16 ms). **Borderline** for 20 concurrent senders (section 4.2) | Not met (B1) |
| Reliability: errors handled gracefully, transactions not lost | **Met**: bad input → `422`, unknown id → `404`, malformed JSON → `422`, never `500`; **hard kill 3 s after a webhook, restart → recovered** (section 3) | not re-run |
| Public GitHub repo, README with run/test instructions and technical choices, public deployed endpoint | README updated; repo `github.com/SG-07/product_engineer`; backend live at `txn-webhooks.onrender.com` | — |

## 2. Environments used

| Id | Environment | Database | Notes |
|---|---|---|---|
| E1 | Windows 11 laptop, `uvicorn`, early development | SQLite file | SQLite allows one writer at a time, so it is **not valid for latency or concurrency conclusions**. |
| E2 | Same Windows laptop | PostgreSQL 16 in Docker Desktop | Round trip host → database measured at **0.94 ms p50 / 1.6 ms p95**, so the network to the database is not a factor here. |
| E3 | `python:3.12-slim` Linux container on the same laptop | Same Docker Postgres (via `host.docker.internal`) | Closest local match to Render/CI, which are Linux. |
| E4 | Render free web service (Singapore) | Supabase free project, Session pooler: **Seoul** until 2026-11-04, then changed by the owner "to match Render" (the actual region/host after the change is unconfirmed, see B1) | The real deployment: `https://txn-webhooks.onrender.com`. |
| E5 | GitHub Actions `ubuntu-latest` | Postgres 16 service container | Suite passed on 2026-11-03; latency figures from that run were not read (log needs sign-in). |
| E6 | Windows 11 laptop, two `uvicorn` backends (API pool 2+1 and 5+5) | Docker Postgres behind `scripts/delay_proxy.py` (28 ms each way, ≈ 57 ms round trip) | Local replica of Render's database distance, used in section 5.7. |

## 3. Correctness results

| Date | What | Env | Result |
|---|---|---|---|
| 2026-11-03 | `pytest` | E1 | 70 passed, 1 skipped (Postgres-only concurrency test) |
| 2026-11-04 | `pytest` (adds `test_stats`) | E1 | 81 passed, 1 skipped |
| 2026-11-03 | `pytest` | E5 | passed (first Postgres run) |
| 2026-11-04 | `pytest` (86 tests collected) | E2 | **86 passed** on the first run. On every later run 85 passed and 1 failed: `test_ack_is_fast_under_concurrent_senders` (e.g. p95 671.6 ms vs the 500 ms limit). Over all Windows runs that day the concurrency test passed 2 of 8 times. |
| 2026-11-03 | `smoke_test.py`, real 30 s wait | E1 | all checks passed |
| 2026-11-04 | `smoke_test.py` against Render | E4 | **14 of 15 passed.** Failed: "responds within 500ms" (748 ms from the client). Passed: duplicates (4 × `202 duplicate`), `409` for a changed amount, `PROCESSING` → `PROCESSED` after ~31 s with `attempts == 1`, INR conversion, `?currency=EUR`, `404`, `422` ×2. |
| 2026-11-03 | Hard kill 3 s after a webhook, then restart | E1 | row survived; finished 123 s after restart (lease + sweep + the 30 s wait) |
| 2026-11-04 | **Hard kill on Postgres:** webhook sent, process force-killed 3 s later (status was `PROCESSING`, `attempts` 1), server restarted | E2 | **Row survived and was recovered**: `PROCESSING` for ~96 s after the restart, then `attempts` 2, `PROCESSED` 128 s after the restart (`created_at` 05:58:00, `processed_at` 06:00:16). Recovery is slow because of the 90 s lease (risk R4). Two earlier attempts at this test were invalid (the kill did not land in time) and are not counted. |
| 2026-11-04 | `scripts/spec_check.py` against a clean local instance (Postgres, real 30 s), first with the single-object response | E2 | 32 of 32 checks pass, 1 reported deviation (array vs object). |
| 2026-11-04 | Response switched to the spec's one-element array; `pytest`, then `spec_check.py` and `smoke_test.py` on a fresh instance; frontend lint and build | E2 | `pytest`: 85 passed, 1 failed (the same 20-concurrent latency test). `spec_check.py`: **33 of 33 pass, 0 deviations**. `smoke_test.py`: all pass. Lint and build exit 0. See section 1.1. |
| 2026-11-04 | `smoke_test.py` against the same local instance | E2 | all checks passed (ack 21 ms, `PROCESSED` after 31 s, `attempts == 1`) |
| 2026-11-04 | `load_test.py --n 50 --concurrency 1` against the same instance | E2 | p50 18 ms, p95 30 ms, max 294 ms: pass |
| 2026-11-04 | `pytest`, three more runs, with two other servers running | E2 | each run 85 passed + 1 failed (the 20-concurrent latency test); 37–44 s per run |
| 2026-11-04 | Frontend `npm run lint` and `npm run build` | — | both exit 0 |
| 2026-11-04 | `GET /` on the deployed backend after ~1 h 50 min idle | E4 | **42.4 s** (Render free-tier cold start); the body was the correct `HEALTHY` JSON |
| 2026-11-04 | Deployed frontend `https://product-engineer.onrender.com` and CORS preflight from that origin to the deployed backend | E4 | frontend `200` HTML in 0.23 s; the preflight returns `access-control-allow-origin: https://product-engineer.onrender.com`. At the time of this check the array change had not been deployed yet, so Render ran the previous build (the response shape was not checked then, to avoid writing test data to the live database). Section 1.1 records the later redeploy check |
| 2026-11-04 | CORS preflight against the local backend | — | `Origin: http://localhost:5173` allowed; `http://127.0.0.1:5173` rejected (`400 Disallowed CORS origin`), as documented in the README |
| 2026-11-04 | Dashboard used by hand against a local backend | E1 | Send, duplicate (5 sends = 1 accepted + 4 duplicate), 30 s processing, EUR display all behaved correctly |

Not covered by any test yet: a database outage (the `503` path), two backend instances at once, real RazorPay payloads and signatures. See [testing.md](testing.md).

## 4. Latency results

Latency is the time for `POST /v1/webhooks/transactions` to answer `202`. Limit: 500 ms.

### 4.1 Single sender (sequential)

| Env | Test | p50 | p95 | Verdict |
|---|---|---|---|---|
| E2 | `load_test.py --n 50 --concurrency 1` | 24 ms | **36 ms** (max 52) | pass |
| E3 | `test_ack_is_fast_while_jobs_are_in_flight` (100 sequential, 30 s jobs running), 3 runs | 18–19 ms | 20–28 ms | pass |
| E1 | Manual dashboard run, 5 sends in a row | — | 78, 32, 20, 13, 13 ms | pass |
| E4 | Smoke test, 1 webhook, client-side | — | 748 ms | **fail** |
| E4 | Earlier smoke test (tracker, 2026-11-04) | — | 644 ms | **fail** |

### 4.2 20 concurrent senders

| Env | Test | p95 (ms) | Verdict |
|---|---|---|---|
| E1 | 5 simultaneous sends from the dashboard (1 new + 4 duplicates), server-side times | 966–1,201 | fail (SQLite) |
| E2 | `load_test.py --n 100 --concurrency 20`, default pool 5+5 | 790 | fail |
| E2 | same, pool 20+0 (confirmed via `/v1/stats`: `api_pool_max` = 20) | 1,176 | fail |
| E2 | `load_test.py --n 400 --concurrency 20`, pool 20+0 | 460 (p99 1,374) | pass |
| E2 | pytest concurrency test, default pool, 5 runs | passed in 2 of 5; failures 672 and 1,209 ms | flaky |
| E3 | pytest concurrency test, default pool, 3 runs | 483, 548, 464 | 2 of 3 pass |
| E4 | `load_test.py --n 50 --concurrency 5` (earlier run, tracker) | p50 496, **p95 1,835** | fail |

### 4.3 Deployed service (E4), server-side times from the Render log

The smoke test on 2026-11-04 (04:38 UTC) logged these:

| Request | Server-side time |
|---|---|
| `GET /` (no database) | ~84 ms (second call) |
| `GET /health/ready` (one database ping) | 555 ms |
| `POST` new webhook | 502.6 ms |
| `POST` duplicate ×4 | 828–907 ms each |
| `POST` conflicting duplicate (`409`) | 829 ms |
| `GET /v1/transactions/{id}` | 405–476 ms each (one outlier at 1,176 ms) |
| `POST` invalid payload (`422`, never touches the database) | 1.6–1.8 ms |

### 4.4 Deployed service after the owner changed the database (2026-11-04, 06:51–06:52 UTC log, dashboard session)

| Request | Server-side time |
|---|---|
| `POST` new webhook | 477.3 ms |
| `POST` duplicate ×4 | 924.3, 805.5, 803.9, 803.7 ms |
| `GET /v1/transactions/{id}` (steady polling) | 399–416 ms |
| `GET /v1/transactions?limit=50` | 467–483 ms (one 606–658 ms) |
| `GET /v1/stats` (cache miss) | 533–551 ms |
| Six requests at once just after a pause | 810–2,336 ms (new connections being opened, plus queueing) |

Timed from the developer's machine with `curl` (includes ~0.1–0.2 s of internet round trip; `GET /` alone took 0.10–0.21 s): `GET /health/ready` 0.53–0.76 s (one 1.57 s outlier), `GET /v1/transactions/<unknown id>` 0.55–0.67 s.

**Compared with section 4.3 (before the move) these are the same**: single read ≈ 400 vs 405–476 ms, duplicate POST ≈ 804–924 vs 828–907 ms.

The `422` and `GET /` rows show the app and network overhead are small; everything that touches the database costs roughly 400 ms or more.

## 5. Experiments run

Each row is a controlled comparison. "Jobs" = the 30 s background processing started by every accepted webhook. Test: 200 webhooks, 20 concurrent, p95 in ms.

### 5.1 Linux container (E3), the most representative local setup

| Setup | Run 1 | Run 2 | Run 3 | Median | Reading |
|---|---|---|---|---|---|
| Default pool 5+5, with jobs | 599 | 447 | 553 | **553** | baseline; 2 of 3 over 500 |
| Default pool, **without** jobs | 405 | 369 | 380 | **380** | all pass → jobs cost ≈ 170 ms |
| Pool 20+0, with jobs | 726 | 714 | 744 | **726** | **worse** |
| Pool 20+0, without jobs | 670 | — (test errored in teardown) | 721 | ~695 | **worse** |
| `pool_pre_ping` off, with jobs | 509 | 528 | 545 | **528** | too small to matter; change reverted |

### 5.2 Windows laptop (E2)

| Setup | Run 1 | Run 2 | Run 3 | Median |
|---|---|---|---|---|
| Default pool, with jobs | 1,057 | 837 | 1,054 | **1,054** |
| Default pool, without jobs | 515 | 713 | 667 | **667** |

### 5.3 Pool usage during a burst (E2, 400 requests, 20 concurrent)

Sampling `GET /v1/stats` every 250 ms: `api_in_use` peaked at **12 of 20**, and the worker pool stayed at its 5-connection limit. The API pool was never exhausted, so it was not the cause of the queueing.

### 5.4 Database network (E2)

200 sequential `SELECT 1` from the host to the Docker Postgres: p50 0.94 ms, p95 1.63 ms, max 2.24 ms.

### 5.5 Cost of opening a connection (E2)

`asyncpg.connect()` to the Docker Postgres (`password_encryption = scram-sha-256`), six sequential connects: 37–41 ms each. Five concurrent connects: 157 ms in total, with the longest event-loop stall 85 ms (a 5 ms ticker measured how late the loop woke up). In the earlier Windows profile the HMAC functions were called about 110,000 times during the 20-concurrent run, consistent with password hashing for the connections opened during that run.

### 5.6 Round trips per request: injected 100 ms database round trip (E2)

To find out *why* a request costs ~400 ms on Render, a small TCP proxy (now `backend/scripts/delay_proxy.py`) was placed between a local copy of the app and the Docker Postgres, delaying every packet by 50 ms in each direction (round trip 100 ms). Median over 7 requests each, after warming the pool:

| Endpoint | Median | ≈ round trips (÷ 100 ms) |
|---|---|---|
| `GET /` (no database) | 4 ms | 0 |
| `GET /health/ready` | 698 ms | 7 |
| `GET /v1/transactions/{unknown id}` (404) | 706 ms | 7 |
| `GET /v1/transactions/{id}` | 697 ms | 7 |
| `GET /v1/transactions?limit=50` | 841 ms | 8 |
| `POST` new webhook | 705 ms | 7 |
| `POST` duplicate webhook | 1,425 ms | 14 |
| `POST` invalid body (422) | 11 ms | 0 |
| `GET /v1/stats` | 4 ms | cached for 1 s (one 969 ms cache miss) |

So one simple request makes about 7 sequential database round trips and a duplicate webhook about 14. Dividing the Render timings (section 4.3 and 4.4) by those counts gives an implied round trip of **≈ 57 ms** (read: 400 ms ÷ 7) to **≈ 56–65 ms** (duplicate: 804–924 ms ÷ 14). This is an inference: it assumes Render + Supabase make the same number of round trips as the local run, which is likely (same code and driver) but not measured on Render. It also matches the pre-move numbers (≈ 59 ms), which is why the database move changed nothing.

**What this implies:** with a database a few ms away the same code would take ≈ 35–50 ms per simple request; at ≈ 60 ms it takes ≈ 400 ms. Cutting the number of round trips per request would help at any distance, but that is not implemented (section 9).

### 5.7 Distance experiment: a local replica of Render's latency (E6)

**Question.** Is the slow `202` on Render caused by distance to the database, and does the dashboard's own polling make it worse?

**Setup (2026-11-04, Windows laptop).** Docker Postgres behind `scripts/delay_proxy.py`, which delays every packet by 28 ms each way (≈ 57 ms round trip, the figure inferred for Render in 5.6). `/health/ready` through the proxy took 390–490 ms, against 555 ms on Render. Two backends shared that proxy and database: one with the API pool at 2 + 1 (the `render.yaml` setting) and one at 5 + 5. `scripts/dashboard_poller.py` reproduced the dashboard's polling with the same intervals as `frontend/src/config/app.js`: list every 3 s, stats every 3 s, health every 10 s, five tracked transactions every 2 s. Each test was `load_test.py` with one sender: 50 webhooks when quiet, 100 webhooks while the poller ran. Three rounds, interleaved (which pool went first alternated), with a 34 s pause between tests so earlier 30 s jobs finished.

**Results** (webhook `202` time, ms; limit 500):

| Case | Pool | p95 in rounds 1 / 2 / 3 | Median p50 | Median p95 | Against 500 ms |
|---|---|---|---|---|---|
| Quiet | 2 + 1 | 489 / 488 / 422 | 454 | 488 | borderline pass |
| Quiet | 5 + 5 | 487 / 492 / 537 | 458 | 492 | borderline |
| Dashboard polling | 2 + 1 | 628 / 588 / 578 | 442 | **588** | **fail in all 3 rounds** |
| Dashboard polling | 5 + 5 | 476 / 488 / 482 | 438 | **482** | pass in all 3 rounds, thin margin |

For comparison, with the **direct** local database (≈ 1 ms), pool 2 + 1, one run each: quiet p50 28 ms, p95 41 ms; with polling p50 21 ms, p95 44 ms.

**Reading.**
- **Distance sets the floor.** At a 57 ms round trip a single webhook takes about 450 ms even when nothing else is running, against 28 ms with the same code on the direct database. That is the Render problem reproduced without Render.
- **Dashboard polling adds about 100 ms at p95 on a 3-connection pool** (588 vs 488 ms). Each dashboard read holds a connection for about 400 ms, so with only 3 connections the webhook waits in the same queue. With 10 connections the penalty disappeared (482 vs 492 ms).
- **A bigger pool does not remove the distance.** Even on 5 + 5 the quiet p95 sits at about 490 ms, which leaves roughly 10 ms of margin. A safe margin needs the database closer to Render, or fewer round trips per request.

**Caveats.** The proxy adds a constant delay: no TLS, no Supabase pooler, none of the variation of a real network. The client, the proxy and both backends ran on one laptop. Three runs per cell. Not yet run on Render. An earlier first pass in which the polling covered only about half of the requests pointed the same way and is superseded by this table.

### 5.8 Summary: the single-webhook 500 ms target, why Render misses it, what we tried

The requirement is that `POST /v1/webhooks/transactions` answers `202` within 500 ms however long the background processing takes. The project uses HTTP polling, not WebSockets (decision D21), so this is the webhook response time.

| Setup | Measured (2026-11-04) | Verdict |
|---|---|---|
| Local, one sender (`load_test.py --n 50 --concurrency 1`) | p50 24 ms, p95 36 ms, max 52 ms | **Met** |
| Local, dashboard, five sends in a row | 13–78 ms | **Met** |
| Local, 20 concurrent senders | p95 ≈ 460–550 ms on Linux, higher on Windows | Borderline |
| Local, database made 57 ms "distant" like Render's, nothing else running | p50 ≈ 455 ms, p95 ≈ 490 ms | Borderline |
| Same, with the dashboard polling, API pool 2+1 (Render's setting) | p95 ≈ 588 ms | **Not met** |
| Same, with the dashboard polling, API pool 5+5 | p95 ≈ 482 ms | Met, narrowly |
| Render + Supabase, one webhook (server-side) | 477–924 ms | **Not met** |

**Why it is fast locally.** The request validates, does one `INSERT`, commits and returns. The 30 s processing runs afterwards in a background task, so it adds nothing to the response time.

**Why Render misses it: distance to the database.** Each database round trip from Render costs ≈ 57–60 ms, and a webhook makes about 7 of them, so even a request that does nothing else takes ≈ 400–500 ms. A local database made to behave the same way (a delay proxy adding 57 ms per round trip) takes the same code from **28 ms to ≈ 450 ms**. The application is not slow; the network between it and its database is.

**What we tried, and what it showed**

| Attempt | Result |
|---|---|
| Moved the Supabase database (it was in Seoul, Render is in Singapore) | Render timings did not change, so the app still reaches a database ≈ 60 ms away. Which host `DATABASE_URL` really points at is still to be confirmed. |
| Counted round trips by injecting a 100 ms delay locally | About 7 per simple request and 14 for a duplicate webhook (5.6). |
| Reproduced Render's latency locally with a 57 ms delay proxy | Confirms distance as the cause: 28 ms became ≈ 450 ms (5.7). |
| Compared API pool sizes while the dashboard polls | On Render's 2+1 pool the webhook p95 rose to ≈ 588 ms; a 5+5 pool kept it at ≈ 482 ms. Dashboard reads queue the webhook when the pool is small (5.7, B8). |
| Bigger pool with a nearby database; `pool_pre_ping` off; background jobs on and off | A bigger pool was worse with a nearby database, `pool_pre_ping` made no difference, and background jobs add ≈ 170 ms to p95 under 20 concurrent senders (5.1, B2). |

**What would fix it**, in order: (1) put the database in the same region as Render, after confirming the real host in `DATABASE_URL`; (2) raise the Render API pool to 5+5 so the dashboard cannot delay a `202` (recommended, not applied yet); (3) cut the database round trips per request (not implemented). A bigger pool alone is not enough: even at 5+5 the quiet p95 is ≈ 490 ms, about 10 ms under the limit. See also risks R1, R18, R23.

## 6. Bottlenecks, ranked

| # | Bottleneck | Evidence | Confidence |
|---|---|---|---|
| **B1** | **Many sequential database round trips per request, each ≈ 57–60 ms from Render to the database (deployed).** A simple request makes ~7 round trips and a duplicate webhook ~14 (section 5.6), so a read costs ~400 ms and a duplicate POST ~800–920 ms, while requests that skip the database take 2–84 ms. Part of the count is the connection check (`pool_pre_ping=True`), the transaction start/end and the driver's prepare-then-execute steps. When the database was in Seoul and Render in Singapore the numbers were the same as after the owner's database change on 2026-11-04, so **the app is still ≈ 60 ms from its database**. | Sections 4.3, 4.4, 5.6; `app/db.py` | High that round trips × distance is the cost (reproduced locally with an injected delay). **Not known** whether the new database is really in Singapore, or whether Render picked up the new `DATABASE_URL`: check the pooler host in that variable (`…ap-southeast-1…` is Singapore, `…ap-northeast-2…` is Seoul). |
| **B2** | **Background jobs share the event loop and database with the API.** Removing the jobs lowers p95 from ≈ 550 to ≈ 380 ms (Linux) and from ≈ 1,050 to ≈ 670 ms (Windows). Each accepted webhook immediately starts a job that claims the row and writes status changes. | Section 5.1, 5.2 | High (controlled comparison). |
| **B3** | **Windows development machine.** The same concurrency test gives ≈ 460–550 ms on Linux and ≈ 670–1,200 ms on Windows. Windows uses a different asyncio I/O backend. Does not affect Render. | Section 4.2, 5.1 vs 5.2 | Medium-high. |
| **B4** | **SQLite single writer.** Concurrent inserts queue up; p95 ≈ 1.1–1.6 s with 20 senders. | Early runs (E1) | High. Not relevant on Postgres. |
| **B5** | **Free-tier cold starts.** Render sleeps after ~15 minutes idle; the first request can take 30 s or more. A pinger on `GET /` is required. | Render docs; not measured here | Medium. |
| **B7** | **Opening a database connection is expensive and blocks the event loop.** Measured: one new Postgres connection (connect + `scram-sha-256` password hashing) takes ~38 ms of mostly CPU time; 5 at once take 157 ms with the event loop stalled for up to 85 ms. A cold pool at the start of a burst opens many connections, each stalling every in-flight request. This fits the 693 ms first webhook after a fresh start (a later warm run: 15–21 ms), the "first requests of a burst are slow" pattern, why a 20-connection pool was *worse* (more connections to open), and the ~110,000 HMAC calls seen in the Windows profile. `pool_recycle=300` also replaces every connection older than 5 minutes. On Render + Supabase each new connection additionally pays TLS and several network round trips. | Direct measurement (section 5.5) plus the profile; the link to the burst latency is an inference, **not isolated by an experiment** | Medium-high that it contributes; its share of the total is unmeasured. |
| **B8** | **A 3-connection API pool queues the webhook behind the dashboard's reads when the database is distant.** At a 57 ms round trip each read holds a connection for about 400 ms, and the dashboard issues several at once (list, stats, one per tracked transaction), so a `202` waits for a free connection. With the pool at 2 + 1 the webhook p95 was 588 ms; with 5 + 5 it was 482 ms. Observed on Render in the pasted log: webhooks at 415 ms when quiet and 1,231 ms right after a list and a stats call. | Section 5.7 (three interleaved rounds); Render log of 2026-11-04 14:57 UTC | High locally. **Not yet measured on Render**, where the pool is still 2 + 1. |
| B6 | **The test itself shares one process.** `test_ack_is_fast_under_concurrent_senders` runs the test client, the app and up to 200 background jobs in one Python process, so its numbers include the client's own CPU. | `tests/test_performance.py`, `tests/conftest.py` | High on the design; the size of the effect is unmeasured. |

## 7. Ruled out

| Hypothesis | Result |
|---|---|
| Network to the local database is slow | 0.94 ms p50 round trip (5.4). |
| API connection pool too small | **Ruled out with a nearby (≈ 1 ms) database:** a bigger pool (20) was **worse**; `api_in_use` peaked at 12 of 20 (5.1, 5.3). **Not ruled out with a distant (≈ 57 ms) database:** 2 + 1 gave p95 588 ms against 482 ms on 5 + 5 under dashboard polling (5.7, B8). The earlier conclusion only holds when the database is close. |
| `pool_pre_ping` adds a large cost locally | Median 528 vs 553 ms, inside run-to-run noise (5.1). |
| Request handler CPU | In the Linux profile the handler and the insert were cheap; the cumulative time sat in the background claim path (which also includes waiting for connections). Call counts in a coroutine profile are not reliable, so no per-call figures are quoted. |

## 8. Known issues found while testing

| Issue | Detail |
|---|---|
| Shutdown noise in pytest | After the suite, the log shows `Task was destroyed but it is pending ... asyncpg Connection._cancel` and `ValueError: I/O operation on closed file`. Some test or fixture leaves database connections open at interpreter exit. Results are not affected. |
| One teardown error with a 20-connection pool | A single experiment run failed in teardown (an anyio/SQLAlchemy assertion); not reproduced on default settings. |
| The 20-concurrent test is a coin flip near the limit | On Linux it passes about half the time; on Windows it mostly fails. CI (Linux) results should be read from the GitHub log. |
| Postgres was first run in two places on 2026-11-04 | Docker Postgres locally (suite passes) and Supabase on Render (smoke test passes). Both exercise the `ON CONFLICT` path, asyncpg and the pooler URL handling, so risk R2 is closed. |

## 9. Next steps (not done in this round)

Listed in the order that looks most valuable; none has been implemented.

1. **Check where the app really connects.** In Render's environment for the backend, look at the host in `DATABASE_URL` (do not share the password): `…ap-southeast-1…` is Singapore, `…ap-northeast-2…` is Seoul. Confirm the Supabase project's region in its settings, and that the value was saved and the service redeployed. After a correct move, `GET /v1/transactions/{id}` should drop from ≈ 400 ms to well under 100 ms; if it does not, the round trip is not distance.
2. **Cut the round trips per request** (about 7 for a simple request, 14 for a duplicate webhook), which helps at any distance: e.g. drop the per-checkout connection check or make reads and the single-statement insert run in autocommit. The injected-delay proxy in section 5.6 can measure the effect locally before deploying. Not implemented; changes the core request path.
3. **Raise the Render API pool and re-measure.** Section 5.7 found that 2 + 1 failed (p95 588 ms) and 5 + 5 passed (482 ms) with the dashboard polling at a 57 ms database distance. Set `API_DB_POOL_SIZE=5` and `API_DB_MAX_OVERFLOW=5` in Render's environment (or in `render.yaml`) and re-run `load_test.py --base-url https://txn-webhooks.onrender.com --concurrency 1`, once with the dashboard closed and once open. Not applied yet. A further option is a small separate pool used only by the webhook insert, so dashboard reads can never delay a `202`. Neither option removes the distance (item 1).
4. **Lighten the background job's database work.** Fewer statements and transactions per job to reduce B2. This touches the lease logic, so it needs the reliability tests.
5. **Move processing to a separate worker process.** Removes B2 entirely, at the cost of a second Render service.
6. **Open the connection pool before traffic arrives** (and avoid frequent recycling), so a burst does not pay ~38 ms × N of blocked event loop (B7); if Render's free instance has a small CPU share (not verified here) the cost there could be larger than the local ~38 ms. Test by comparing the first request after a restart and the first request of a burst, before and after.
7. **Fix the test teardown** so connections are disposed, and decide whether the 20-concurrent test should stay a pass/fail gate or become a recorded stress check (B6).
8. **Read the CI latency figures** from the GitHub Actions log to see the Linux number on a clean runner.

## 10. How to reproduce

From `backend/`, with the Docker Postgres running (see the README):

```powershell
# Full suite on Postgres
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/test"
pytest -q -rs

# Latency against a running server (local or Render)
python scripts/load_test.py --n 50  --concurrency 1
python scripts/load_test.py --n 100 --concurrency 20
python scripts/load_test.py --base-url https://txn-webhooks.onrender.com --n 50 --concurrency 5

# Requirement-by-requirement check against backend_task.md (~40 s; uses a fresh transaction id each run)
python scripts/spec_check.py --base-url http://127.0.0.1:8000
python scripts/spec_check.py --base-url https://txn-webhooks.onrender.com

# End to end (takes ~35 s because of the real 30 s wait)
python scripts/smoke_test.py --base-url https://txn-webhooks.onrender.com

# Watch pool use during a burst (second terminal)
curl.exe "http://127.0.0.1:8000/v1/stats"        # see db.api_in_use / api_pool_max
```

Distance replica (section 5.7): Docker Postgres behind a delay proxy, so the local database behaves like Render's. Use four terminals in `backend/`:

```powershell
python scripts/delay_proxy.py 5433 5432 28                                   # 1: 28 ms each way, about a 57 ms round trip
$env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"   # 2: backend through the proxy
$env:API_DB_POOL_SIZE="2"; $env:API_DB_MAX_OVERFLOW="1"                      #    (the render.yaml pool; try 5 and 5 to compare)
uvicorn app.main:app --port 8000
python scripts/dashboard_poller.py http://127.0.0.1:8000 75                  # 3: simulated dashboard polling for 75 s
python scripts/load_test.py --n 100 --concurrency 1                          # 4: one sender while the poller runs
```

Run the load test again without the poller for the quiet case. Repeat at least three times and compare medians.

Linux comparison (Docker Desktop running; Git Bash needs `MSYS_NO_PATHCONV=1`):

```bash
docker run --rm -v "E:/Learn_coding/Project/task/backend:/app" -w /app \
  -e TEST_DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/test" \
  -e PYTHONDONTWRITEBYTECODE=1 python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && pytest -q -p no:cacheprovider -s tests/test_performance.py"
```

Latency numbers move a lot between runs on a laptop. Use at least three runs and compare medians, not single results.
