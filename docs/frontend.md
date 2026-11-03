# Frontend Hand-off: "Webhook Tester Dashboard"

**Audience:** the developer building the UI. **Owner of the backend:** see `README.md`. **Not built by the backend work** - this is a spec.

## 1. Goal
A small dashboard to demo and inspect the webhook service: send test webhooks, watch them move from `PROCESSING` to `PROCESSED`, see duplicates being ignored, and view money in the viewer's preferred currency (INR / USD / EUR / GBP).

## 2. What already exists
`frontend/` is an untouched **Vite 8 + React 19 scaffold in plain JavaScript** (`.jsx`, no TypeScript, no router, no data-fetching library, `oxlint` for linting). You may add dependencies; suggestions below are optional. `npm run dev` serves on `http://localhost:5173`, which is already in the backend's default CORS list.

Suggested (optional) additions: `react-router-dom`, `@tanstack/react-query` (polling), a CSS approach of your choice.

## 3. Configuration
| Env var | Example | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` or `https://<service>.onrender.com` | Backend base URL, no trailing slash |

Windows: prefer `127.0.0.1` over `localhost` for the backend URL (a `localhost` connection can stall ~2 s per request).
Tell the backend owner your deployed origin so it is added to `CORS_ORIGINS`; until then, browser calls from it fail with a CORS error.

## 4. API contract (what you call)
Full reference: `docs/api.md`. Summary:

| Call | Purpose |
|---|---|
| `GET /` | health badge. `{"status":"HEALTHY","current_time"}` |
| `POST /v1/webhooks/transactions` | send a test webhook → `202 {"status":"accepted"\|"duplicate"}`, `409`, `422` |
| `GET /v1/transactions/{id}?currency=XXX` | one transaction (single object); `404` if unknown |
| `GET /v1/transactions?status=&currency=&limit=&offset=` | table data → `{items,total,limit,offset}` |
| `GET /v1/currencies` | supported currencies + rates + `as_of` date |

Transaction object (display fields first):
`amount`, `currency` (what to show) · `original_amount`, `original_currency` · `amount_inr`, `fx_rate_to_inr`, `fx_rate_as_of` (null until processed) · `status` = `PROCESSING|PROCESSED|FAILED` · `attempts`, `last_error` · `created_at`, `processed_at` (null until processed).

Error handling: `422` bodies have `detail` as an **array** for webhook payload errors and a **string** for bad query parameters. `503` means the backend's database is unavailable.

**Signatures:** the backend can require a signed webhook (`X-Razorpay-Signature`), but a secret must never be shipped to a browser. The dashboard sends **unsigned** requests, so it only works against a backend with `SIGNATURE_REQUIRED=false` (the default). Do not add a secret to the frontend.

## 5. Currency preference
- Four options: **INR, USD, EUR, GBP**. Default **INR**.
- Chosen by the user and **changeable at any time in Settings**. Stored in `localStorage` under `preferredCurrency` (no accounts exist on the backend). Wrap storage access in try/catch - it can be unavailable.
- Every `GET` for a transaction or list **must send `?currency=<preference>`**; the backend does the conversion and rounding.
- **Display the backend's `amount` as given. Do not recompute or re-round on the client** (banker's rounding is applied server-side).
- Format with `Intl.NumberFormat(locale, {style:'currency', currency, minimumFractionDigits:2, maximumFractionDigits:2})` → ₹ $ € £. Pick the locale deliberately (e.g. `en-IN` for INR digit grouping) and keep it consistent.
- Show the original as secondary text when it differs, e.g. "received as $100.00". Show "Rates as of {as_of}" from `/v1/currencies` somewhere visible (e.g. Settings, table footer) - rates are fixed, not live.
- Changing the preference should update every visible amount without a page reload.

## 6. Screens
1. **Header / health badge** - polls `GET /` every ~30 s. Green "Healthy" / red "Unreachable". If a request takes > 5 s, show "Server may be waking up (free hosting)".
2. **Send webhook** - form: transaction id (button "generate random": `txn_` + 12 hex chars), source, destination, amount (number > 0), currency (the 4 codes; this is the *sent* currency, separate from the display preference). Prefill with the sample payload. On submit show status code, the response body and latency in ms (measure with `performance.now()`). Handle 202 accepted / 202 duplicate / 409 / 422 / network error distinctly.
3. **Duplicate & burst tools** - "Send same webhook ×N" (N = 5): show 1× accepted + (N−1)× duplicate. "Burst" (e.g. 20 different ids) with a min/avg/max latency summary and a warning if any exceeded 500 ms.
4. **Track a transaction** - input an id (prefilled with the last one sent); poll `GET /v1/transactions/{id}` every 2 s until `PROCESSED` or `FAILED`, then stop. Show a progress bar/countdown to ~30 s using `created_at`, then status, attempts, timestamps, processing duration (`processed_at − created_at`), `last_error` if any. Unknown id → friendly "not found" (404).
5. **Transactions table** - from the list endpoint; columns: id, from → to, amount (display), original (secondary), status badge (colour + text, not colour alone), created, processed. Status filter (All / Processing / Processed / Failed), pagination (`limit/offset`), auto-refresh while any row is `PROCESSING`.
6. **Settings** - the currency selector (section 5), shows rates and "as of" date, and the backend URL currently in use.

## 7. Acceptance criteria
- [ ] Preference defaults to INR, persists across reloads, and switching updates all amounts immediately, with `?currency=` on every read.
- [ ] No amount is computed or rounded in the browser.
- [ ] Sending a webhook shows the HTTP status and latency; duplicates are visibly reported as duplicates; a changed amount for an existing id shows the 409 message.
- [ ] A new transaction visibly goes PROCESSING → PROCESSED within ~30–35 s without manual refresh; polling stops at a terminal status and on unmount.
- [ ] Table pagination, status filter and auto-refresh work; a `FAILED` row shows `last_error`.
- [ ] Empty states (no transactions), loading states, and errors (network down, 5xx, 503, 404, 422) all have clear messages; nothing crashes on a null `processed_at` / `amount_inr`.
- [ ] Backend unreachable or cold-starting is communicated, not shown as a blank page.
- [ ] Usable on a phone width; keyboard accessible; status not conveyed by colour alone.
- [ ] No secrets in the bundle; `VITE_API_BASE_URL` is the only backend setting; `npm run lint` and `npm run build` pass.

## 8. Out of scope
User accounts/login, server-side preferences, live exchange rates, editing or deleting transactions, signing webhooks in the browser.

## 9. Open items to settle with the backend owner
- Final deployed backend URL, and your deployed frontend origin (for CORS).
- How often the fixed FX rates get refreshed (they are a snapshot dated by `as_of`, not live) - show that date in the UI.
- Whether the unauthenticated list endpoint will stay (see `risks.md` R9) - the table screen depends on it.
