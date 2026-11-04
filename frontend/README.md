# Webhook Testing Dashboard (frontend)

A React 19 + Vite 8 + Tailwind dashboard for the Transaction Webhook Service. Send test webhooks, watch them go from `PROCESSING` to `PROCESSED`, check idempotency and measure response times against the 500 ms limit.

Full install, run and deployment instructions, including the backend and database, are in the **[main README](../README.md)**. This file is the quick reference for the frontend alone.

## Quick start

Requires Node.js 20.19+ or 22.12+. The backend should be running (see the main README) unless you use mock mode.

```powershell
cd frontend
npm install
if (-not (Test-Path .env)) { copy .env.example .env }
```

Edit `.env`:

```
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_USE_MOCK=false
```

```powershell
npm run dev          # open http://localhost:5173
```

Open it as `http://localhost:5173` (not `127.0.0.1`): the backend only allows that origin by default.

## Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend base URL, no trailing slash. Use `http://127.0.0.1:8000` locally. |
| `VITE_USE_MOCK` | `true` | `true` = fake backend inside the browser; `false` = call the real backend. |
| `VITE_MOCK_PROCESSING_SECONDS` | `30` | Mock mode only: how long a fake transaction stays `PROCESSING`. |
| `VITE_DEV_PROXY_TARGET` | unset | Optional. With `VITE_API_BASE_URL=/api`, the dev server proxies `/api` to this target, avoiding CORS. |

Restart `npm run dev` after editing `.env`. For a deployed site these values are baked in at build time, so redeploy after changing them.

> **The Settings page overrides `.env`.** The "Use mock API" switch is saved in the browser. If you still see fake data after setting `VITE_USE_MOCK=false`, turn the switch off in **Settings** or clear the site's local storage.

## Using it

- **First visit:** pick a display currency (INR, USD, EUR, GBP). Change it any time in **Settings**. The backend converts the amounts.
- **Send webhook** tab: send one webhook, see status and latency, and track it until it is processed.
- **Idempotency** tab: *Identical* sends the same webhook several times (expect one accepted, the rest `duplicate`); *Conflict* sends changed fields for an existing id (expect `409`).
- **Load test** tab: send many distinct webhooks at a chosen concurrency and read the min / average / p95 latency against the 500 ms budget.
- **Status strip, pipeline board, latency panel:** live view of counts, in-flight jobs with a ~30 s countdown, and browser-measured versus server-measured time.
- **Transactions table:** the 50 newest, filter by status or search, open a row for details.
- **Request log** (button in the header): every HTTP call the page made, with status, time and body, useful when something looks wrong.

The dashboard sends **unsigned** webhooks, so it only works against a backend with `SIGNATURE_REQUIRED=false` (the default). Never put a webhook secret in the frontend.

## Commands

```powershell
npm run dev       # dev server on http://localhost:5173
npm run lint      # oxlint
npm run build     # production build into dist/
npm run preview   # serve the built dist/ locally
```

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Health badge shows DOWN | Backend not running, wrong `VITE_API_BASE_URL`, or the Render free tier is cold-starting (first request can take 30 s+). |
| CORS error in the browser console | The page origin is not in the backend's `CORS_ORIGINS`. Open `http://localhost:5173`, or add the origin to the backend and restart it. |
| Data looks fake / nothing reaches the server | Mock mode is on. See the Settings note above. |
| Changes to `.env` do nothing | Restart `npm run dev` (or redeploy the static site). |
| Webhook form returns `401` | The backend has `SIGNATURE_REQUIRED=true`; the dashboard cannot sign requests. |

## Project layout

```
src/pages/        Dashboard.jsx · Settings.jsx
src/components/   WebhookForm · IdempotencyTest · LoadTest · LiveStats · LivePipeline · LiveLatency
                  TransactionsTable · TransactionTracker · RequestLog · CurrencyPickerModal · HealthBadge · ui/
src/lib/          api.js (HTTP client) · mockApi.js · prefsStore.js · requestLog.js · sentStore.js · format.js
src/hooks/        useApi.js (polling queries) · useStores.js
src/config/       app.js (limits, budget) · currency.js · theme.js
```

Specification and acceptance criteria: [../docs/frontend.md](../docs/frontend.md).
