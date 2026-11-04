# Webhook Testing Dashboard (frontend)

A React 19 + Vite 8 + Tailwind dashboard for the Transaction Webhook Service. Send test webhooks, watch them go from `PROCESSING` to `PROCESSED`, check idempotency and measure response times against the 500 ms limit.

How to run the backend and database is in the **[main README](../README.md)**; deployment is in [../docs/deployment.md](../docs/deployment.md) and every setting in [../docs/configuration.md](../docs/configuration.md). This file is the reference for the dashboard itself, including a guided tour.

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

## Mock mode versus the live backend

| Mode | When | Notes |
|---|---|---|
| **Mock** (`VITE_USE_MOCK=true`, the default) | Working on the UI without a backend | Everything is simulated in the browser; no request reaches the server. Mock timings mean nothing for latency. Processing delay is `VITE_MOCK_PROCESSING_SECONDS` (default 30). |
| **Live** (`VITE_USE_MOCK=false`) | Testing the real service | Calls `VITE_API_BASE_URL`. |

## Dashboard areas

On first visit a **currency picker** asks which currency to display (INR, USD, EUR or GBP). Change it later in **Settings**. Amounts are converted by the backend; the browser never does money arithmetic.

| Area | What it shows or does |
|---|---|
| Header | Health badge (is the backend reachable), links to Dashboard and Settings, and the **request log** button that opens every HTTP call the page made (status, time, body). |
| Status strip | Live counts of processing / processed / failed transactions, and DB pool use, from `GET /v1/stats`. |
| Pipeline board | The newest transactions grouped as Processing / Processed / Failed. Processing ones count down towards ~30 s, then move across. |
| Latency panel | Time per webhook as seen by the browser versus the server's own `X-Response-Time-Ms`; the median gap is the network overhead. Also shows the share of webhooks the server answered in over 500 ms. |
| **Send webhook** tab | A form for one webhook (id, source, destination, amount, currency). Shows the HTTP status, the response and the latency, then tracks the transaction until it is `PROCESSED` or `FAILED`. |
| **Idempotency** tab | Two scenarios, chosen from a dropdown. *Identical*: sends the same webhook N times; expect one accepted, the rest `duplicate`, and the transaction processed once. *Conflict*: sends an original, then the same id with changed fields; expect `409` for each change and the original kept. |
| **Load test** tab | Sends N distinct webhooks (up to the page's batch limit) at a chosen concurrency and reports min / average / p95 latency, coloured against the 500 ms budget. |
| Transactions table | The 50 newest transactions, filterable by status and searchable, with a detail panel per row. Refreshes automatically while anything is processing. |
| Settings | Currency, theme (light / dark / system), the **mock API** switch, and a button to clear mock data. |

The dashboard sends **unsigned** webhooks, so it only works against a backend with `SIGNATURE_REQUIRED=false` (the default). Never put a webhook secret in the frontend.

## Guided tour (best way to use the whole program)

Start the three pieces in this order, each in its own terminal: the database (Docker), the backend (`uvicorn` in `backend/`), then the dashboard (`npm run dev` here). Open **http://localhost:5173** and work through this once; it covers every part of the system.

1. **Check the health badge.** Green "Healthy" means the dashboard reaches the backend. Red means it does not: see Troubleshooting below.
2. **Pick a display currency** in the first-visit picker. It is saved in the browser and can be changed later in **Settings**.
3. **Send one webhook** from the **Send webhook** tab. Note the `202` status and the latency. The Latency panel shows that number next to the 500 ms line.
4. **Watch it move.** The pipeline board shows the transaction under *Processing* with a countdown. After about 30 s it moves to *Processed*, and the table shows its INR amount. The status strip counts it along the way.
5. **Test idempotency.** In the **Idempotency** tab run *Identical*: expect one `accepted` and the rest `duplicate`, with the transaction processed once. Then run *Conflict*: expect `409` for the changed fields and the original kept.
6. **Measure under load.** In the **Load test** tab run 20 webhooks at concurrency 1, then at concurrency 20, and compare p95 with the 500 ms line. Concurrency 20 sits near the line on a local machine, so repeat it about three times and read the median.
7. **Explore the data.** The transactions table filters by status, searches by id, and opens a detail panel per row. Switch currency in **Settings** and the same row shows USD, EUR or GBP, with the original amount as secondary text.
8. **Debug from the request log.** The **request log** button in the header lists every HTTP call the page made, with status, time and response body. Check it first when something looks wrong.
9. **Script it if you want.** Open **http://127.0.0.1:8000/docs** for the interactive API reference, or use `scripts/send_webhook.py` from a terminal.

Tips:

- Open the dashboard at `http://localhost:5173` and point the backend URL at `127.0.0.1:8000`. Opening it at `127.0.0.1:5173` fails CORS.
- Use the live backend, not mock mode, for any latency check.
- On Render the first load can take about 40 s; wait before measuring.

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
