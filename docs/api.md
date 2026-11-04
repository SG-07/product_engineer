# API Reference

Base URL: `http://127.0.0.1:8000` locally, `https://txn-webhooks.onrender.com` deployed. Live, interactive version: `/docs` (Swagger) and `/openapi.json`.
All bodies are JSON. Timestamps are UTC ISO-8601 with `Z`. Every response carries `X-Response-Time-Ms`.
CORS is enabled for the origins in `CORS_ORIGINS` (GET, POST, OPTIONS).

---
## POST `/v1/webhooks/transactions`
Receive a transaction webhook. Optional header `X-Razorpay-Signature` (hex HMAC-SHA256 of the raw body, `sha256=` prefix allowed).

Request
```json
{ "transaction_id": "txn_abc123def456", "source_account": "acc_user_789",
  "destination_account": "acc_merchant_456", "amount": 1500, "currency": "INR" }
```
| Field | Rules |
|---|---|
| `transaction_id`, `source_account`, `destination_account` | string, 1–64 chars (whitespace trimmed) |
| `amount` | JSON **number** > 0, ≤ 4 decimals. Strings/booleans rejected |
| `currency` | `INR`, `USD`, `EUR`, `GBP` (case-insensitive input, stored upper-case) |
| other fields | ignored |

| Status | Body | Meaning |
|---|---|---|
| **202** | `{"status":"accepted","transaction_id":"..."}` | New; processing started |
| **202** | `{"status":"duplicate","transaction_id":"..."}` | Already received with the same payload; nothing reprocessed |
| 401 | `{"detail":"Invalid webhook signature"}` | Bad signature (or missing, when `SIGNATURE_REQUIRED=true`) |
| 409 | `{"detail":"transaction_id already exists with a different payload","transaction_id":"..."}` | Same id, different amount/currency/accounts |
| 422 | `{"detail":[{"type":"literal_error","loc":["currency"],"msg":"...","input":"JPY"}]}` | Invalid payload |
| 503 | `{"detail":"Storage temporarily unavailable, retry later"}` | Could not save; sender should retry |

---
## GET `/`
`200 {"status":"HEALTHY","current_time":"2026-11-03T17:25:23Z"}` - no DB call; safe for frequent pings.
`GET /health/ready` - same shape, but runs `SELECT 1`; `503 {"status":"UNHEALTHY",...}` if the DB is unreachable.

`GET /dashboard` - `307` redirect to `FRONTEND_URL` (the frontend dashboard). `404 {"detail":"FRONTEND_URL is not configured"}` when the variable is unset. `GET /` is unchanged and still returns the health JSON.

---
## GET `/v1/transactions/{transaction_id}`
Query: `currency` (optional) - `INR|USD|EUR|GBP`, case-insensitive.

```json
[{
  "transaction_id": "txn_abc123def456",
  "source_account": "acc_user_789",
  "destination_account": "acc_merchant_456",
  "amount": 17.86,             "currency": "USD",      // DISPLAY values (requested currency, or original if none requested)
  "original_amount": 1500,     "original_currency": "INR",
  "amount_inr": 1500.0,        "fx_rate_to_inr": 1.0,  "fx_rate_as_of": "2026-11-03",   // null until PROCESSED
  "status": "PROCESSED",       // PROCESSING | PROCESSED | FAILED
  "attempts": 1,
  "last_error": null,
  "created_at": "2024-01-15T10:30:00Z",
  "processed_at": "2024-01-15T10:30:30Z"             // null while PROCESSING/FAILED
}]
```
- Returns a **JSON array with exactly one element**, as sketched in `backend.md` (`[{...}]`). An unknown id returns `404`, not an empty array (`assumptions.md` A1).
- `amount`/`currency`: with `?currency=X` → converted (banker's rounding, 2 dp). Without → exactly as received. Asking for the currency it was received in returns the original amount unchanged.
- `404 {"detail":"Transaction not found"}` · `422 {"detail":"Unsupported currency 'JPY'. Supported: INR, USD, EUR, GBP"}`

> **Note for client code:** `422` `detail` is an **array** for invalid webhook bodies but a **string** for bad query parameters on GET - handle both.

---
## GET `/v1/transactions`
Query: `status` (`PROCESSING|PROCESSED|FAILED`), `currency`, `limit` (1–100, default 20), `offset` (default 0). Newest first.
```json
{ "items": [ /* same objects as above */ ], "total": 42, "limit": 20, "offset": 0 }
```
*Extension beyond the task spec, added for the dashboard.* ⚠ Unauthenticated and lists everything - see `risks.md` R9.

---
## GET `/v1/currencies`
```json
{ "base": "INR", "supported": ["INR","USD","EUR","GBP"],
  "rates_to_inr": {"INR":1.0,"USD":94.75,"EUR":106.08,"GBP":127.14},
  "as_of": "2026-11-03", "display_decimals": 2, "rounding": "ROUND_HALF_EVEN" }
```
Rates are fixed config values (a snapshot, not live).

---
## GET `/v1/stats`
Read-only live numbers for the dashboard. *Extension beyond the task spec; the four spec'd endpoints are unchanged.*
```json
{ "as_of": "2026-11-03T18:44:42Z", "uptime_seconds": 812.4,
  "transactions": {"processing": 3, "processed": 120, "failed": 1, "total": 124},
  "in_flight_jobs": 3, "oldest_processing_age_seconds": 21.4, "avg_processing_seconds": 30.1,
  "webhooks": {"window": 87, "accepted": 90, "duplicate": 12, "conflict": 1, "rejected": 2,
               "ack_ms": {"p50": 14.2, "p95": 41.0, "max": 88.3}, "over_budget_pct": 0.0, "per_minute": 22},
  "db": {"api_pool_max": 3, "api_in_use": 1, "worker_pool_max": 5, "worker_in_use": 0},
  "config": {"processing_delay_seconds": 30.0, "latency_budget_ms": 500.0} }
```
- `webhooks.*` is in-memory since the last process start; `ack_ms` is **server-side time only** (no network) over the last 200 webhooks. Compare with the client-measured time to see network overhead.
- The database part (`transactions`, `oldest_processing_age_seconds`, `avg_processing_seconds`) is cached for 1 s.
- `api_in_use` / `worker_in_use` are live connection checkouts on Postgres (`null` on SQLite). The stats request's own connection counts.
- ⚠ Unauthenticated (counts and timings only, no account data) - see `risks.md` R9.

---
## Example session
```powershell
python scripts/send_webhook.py --id txn_demo --amount 100 --currency USD --repeat 3
# prints 3 lines: 202 accepted, 202 duplicate, 202 duplicate
curl.exe "http://127.0.0.1:8000/v1/transactions/txn_demo"               # status PROCESSING, amount_inr null
# after ~30 s
curl.exe "http://127.0.0.1:8000/v1/transactions/txn_demo?currency=INR"  # PROCESSED, amount 9475.0, amount_inr 9475.0
```
