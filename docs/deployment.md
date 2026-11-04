# Deployment (Supabase + Render)

The public endpoint is live at **https://txn-webhooks.onrender.com** (interactive docs at `/docs`); the dashboard is at **https://product-engineer.onrender.com**. This page records how they were deployed and how to repeat it. For settings see [configuration.md](configuration.md); for the latency picture on Render see [test-results.md](test-results.md) §5.6–5.8 and [risks.md](risks.md) R1, R3, R18, R23.

## 1. Database (Supabase)

Create a free project at supabase.com **in the same region as your Render service** (Render free services here run in Singapore, so choose Southeast Asia (Singapore)). A region mismatch is the largest source of latency (see [test-results.md](test-results.md), B1). Then *Project Settings → Database → Connection string → **Session pooler*** (port 5432). Use the pooler, not the "Direct connection": Render cannot reach Supabase's IPv6-only direct host. Tables are created automatically on first start.

## 2. Backend (Render Blueprint)

1. Push the repo to GitHub.
2. On render.com: *New → Blueprint* → select the repo (uses [render.yaml](../render.yaml), which builds from `backend/`).
3. Set the environment variables:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Supabase **Session pooler** string (secret) |
   | `CORS_ORIGINS` | `https://product-engineer.onrender.com,http://localhost:5173` (your frontend's exact origin) |
   | `FRONTEND_URL` | `https://product-engineer.onrender.com` |
   | `PROCESSING_DELAY_SECONDS` | `30` |
   | `SIGNATURE_REQUIRED` | `false` (the dashboard sends unsigned requests) |
   | `WEBHOOK_SECRET` | leave empty unless signatures are enabled |

   `render.yaml` also sets `API_DB_POOL_SIZE=2` and `API_DB_MAX_OVERFLOW=1`. The distance experiment ([test-results.md](test-results.md) §5.7) recommends **5 and 5**; this is not applied yet.

4. **Verify** the live service (see section 4).
5. **Keep it awake.** Render's free tier sleeps after ~15 min idle and the first request after that can take 30 s or more (measured: 42 s), which breaks the 500 ms rule. Point a free pinger (cron-job.org or UptimeRobot) at `GET /` every 10 minutes, or use a paid instance. See [risks.md](risks.md) R3.

The live service is named `txn-webhooks`; the blueprint's default name in `render.yaml` is `transaction-webhook-service`.

## 3. Frontend (Render Static Site)

The frontend is not part of `render.yaml`; create it as a **Static Site** on Render:

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npm install && npm run build` |
| Publish directory | `dist` |
| `VITE_API_BASE_URL` | `https://txn-webhooks.onrender.com` (no trailing slash) |
| `VITE_USE_MOCK` | `false` |

`VITE_*` values are baked into the bundle at build time: after changing them, trigger a manual deploy. Then add the site's exact URL to the backend's `CORS_ORIGINS` and `FRONTEND_URL`, and open the site. A visitor who previously used mock mode may need to switch it off in **Settings** (the choice is saved in their browser).

## 4. Verify the live service

Send one request and wait first: after an idle period the first request can take 40 s or more, which would skew any timing.

```powershell
curl.exe https://txn-webhooks.onrender.com/                  # {"status":"HEALTHY",...}
curl.exe https://txn-webhooks.onrender.com/health/ready      # also pings the database
cd backend
python scripts/send_webhook.py --base-url https://txn-webhooks.onrender.com --id txn_live1 --amount 1500 --currency INR --repeat 3
curl.exe "https://txn-webhooks.onrender.com/v1/transactions/txn_live1"      # PROCESSING, then PROCESSED after ~30 s
python scripts/smoke_test.py --base-url https://txn-webhooks.onrender.com   # end to end, ~35 s
python scripts/load_test.py  --base-url https://txn-webhooks.onrender.com --n 50 --concurrency 1
```

`scripts/spec_check.py --base-url …` checks every requirement in [backend_task.md](../backend_task.md) but writes about 42 test transactions to the live database.

Known result: the smoke test passes 14 of 15 checks; the failing one is "responds within 500 ms", because of the distance between Render and its database (see [test-results.md](test-results.md) §5.8).
