"""Send a transaction webhook (optionally signed) to a running service.

    python scripts/send_webhook.py                          # one random INR webhook to localhost
    python scripts/send_webhook.py --amount 100 --currency USD --id txn_demo --repeat 5
    python scripts/send_webhook.py --base-url https://<app>.onrender.com --secret $WEBHOOK_SECRET
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import time
import uuid

import httpx


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--id", default=f"txn_{uuid.uuid4().hex[:12]}")
    ap.add_argument("--source", default="acc_user_789")
    ap.add_argument("--destination", default="acc_merchant_456")
    ap.add_argument("--amount", type=float, default=1500)
    ap.add_argument("--currency", default="INR")
    ap.add_argument("--repeat", type=int, default=1, help="send the identical webhook N times")
    ap.add_argument("--secret", help="sign the body with this secret (X-Razorpay-Signature)")
    args = ap.parse_args()

    body = {
        "transaction_id": args.id,
        "source_account": args.source,
        "destination_account": args.destination,
        "amount": args.amount,
        "currency": args.currency,
    }
    raw = json.dumps(body).encode()
    headers = {"content-type": "application/json"}
    if args.secret:
        headers["X-Razorpay-Signature"] = hmac.new(args.secret.encode(), raw, hashlib.sha256).hexdigest()

    with httpx.Client(base_url=args.base_url, timeout=30) as client:
        for i in range(args.repeat):
            start = time.perf_counter()
            r = client.post("/v1/webhooks/transactions", content=raw, headers=headers)
            ms = (time.perf_counter() - start) * 1000
            print(f"#{i + 1}: {r.status_code} in {ms:.0f}ms  {r.text}")
    print(f"\nCheck status:  curl '{args.base_url}/v1/transactions/{args.id}?currency=USD'")


if __name__ == "__main__":
    main()
