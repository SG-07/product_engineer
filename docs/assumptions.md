# Assumptions

Things the task description did not say and that I filled in. **None of these are facts about the grader** - if one is wrong, it is a small, localised change. "Owner-confirmed" items are listed in `decisions.md` instead.

| # | Assumption | Why I assumed it | If wrong |
|---|---|---|---|
| A1 | Unknown transaction id → `404` with `{"detail":"Transaction not found"}` (a known id returns the one-element array `[{...}]`, as in the spec) | Standard REST; the spec is silent | Return `200 []` in `routers/transactions.py` (a one-line change plus the 404 tests) |
| A2 | Test graders send **unsigned** webhooks | Spec shows no signature/header | Set `SIGNATURE_REQUIRED=true` |
| A3 | Signature rule: present-and-wrong → 401; missing → allowed unless `SIGNATURE_REQUIRED` | Owner said "check it" but not how strict | One flag |
| A4 | Signature format = RazorPay's: hex HMAC-SHA256 of raw body in `X-Razorpay-Signature` | Spec mentions RazorPay | Header name is configurable (`SIGNATURE_HEADER`); algorithm in `security.py`. **Never tested against a real RazorPay signature.** |
| A5 | FX rates (owner-supplied, 2026-11-03): 1 USD = 94.75 INR, 1 EUR = 106.08 INR, 1 GBP = 127.14 INR. Fixed - they do not update themselves | Provided by the owner. **Owner-confirmed 2026-11-04:** a fixed snapshot for this task; source and time of the quote not recorded; no refresh schedule | Update `FX_RATES_TO_INR` / `FX_RATES_AS_OF` - no code change |
| A6 | Webhooks arrive only in INR/USD/EUR/GBP | Owner chose these four | Add a code to `SUPPORTED_CURRENCIES`, the DB check constraint and the schema |
| A7 | `amount` is a positive JSON **number** with ≤ 4 decimals, ≤ 18 digits; strings and booleans rejected | Prevents silent coercion bugs with money | Relax in `schemas.py` |
| A8 | `transaction_id`, account ids: non-empty, ≤ 64 chars | Sample ids are ~16 chars; need *some* bound | Change `Identifier` and the column length |
| A9 | Extra JSON fields in the webhook are ignored (not stored) | Real processors add fields | Switch `extra="ignore"` to `forbid` |
| A10 | Amount is the value in the **major unit** (rupees, not paise) | Sample `1500` INR / `150.50` USD | Divide by 100 in conversion if processors send minor units |
| A11 | Without `?currency=`, GET returns the amount/currency exactly as received | Matches the spec's sample response | Frontend always passes `?currency=` |
| A12 | While `PROCESSING`, display conversion uses current config rates; after `PROCESSED` it uses the stored INR amount | Stored amount is the audited value | - |
| A13 | A `FAILED` transaction stays failed; duplicates do not retry it | Avoid surprise reprocessing of money movements | Add an admin retry endpoint |
| A14 | Retry policy: 3 attempts, 2 s then 4 s backoff | Reasonable default | `MAX_ATTEMPTS`, `RETRY_BACKOFF_SECONDS` |
| A15 | "Processing" is simulated: a 30 s sleep (+ optional injected failures) - no real payment logic | Spec says "simulate external API calls" | - |
| A16 | One running instance is the normal case; multiple instances are *safe* (lease + conditional updates) but untested | Free tier = 1 instance | Test with 2 instances before scaling out |
| A17 | Timestamps are UTC, ISO-8601 with a `Z` suffix, second precision | Matches the spec's examples | `_iso_z` in `schemas.py` |
| A18 | The `frontend/` folder (Vite + React, plain JS) belongs to the other developer; backend does not modify it | Owner said someone else builds it | - |
| A19 | Supabase **session pooler** (port 5432) will be used from Render | Direct host is IPv6-only; Render has no IPv6 egress (from provider docs, **not tested by me**) | Use the transaction pooler (6543) - URL handling for it is implemented but untested |
| A20 | A keep-alive pinger or paid instance is acceptable to avoid Render free-tier cold starts | Otherwise the first request after idle can exceed 500 ms | Pay for an always-on instance |

## Settled by the owner (2026-11-04)
- **FX rates (A5):** a fixed snapshot supplied by the owner on 2026-11-03; source not recorded; no refresh schedule needed for this task.
- **Unknown transaction id (A1):** stays `404` ("do what is standard"). A known id returns the one-element array from `backend.md`.
- **Deployed URLs:** backend `https://txn-webhooks.onrender.com`, frontend `https://product-engineer.onrender.com`.

## Still open (assumed, not answered)
1. Will test webhooks be signed? Is there a secret to share? (A2, A3, A4) - assumed **unsigned**, `SIGNATURE_REQUIRED=false`.
2. Are amounts major units or minor units (paise/cents)? (A10) - assumed **major units**, as in the spec's `1500` INR / `150.50` USD samples.
3. Which region will the database use? Render is in Singapore and Supabase in Seoul; the owner will move it later (`risks.md` R18).
