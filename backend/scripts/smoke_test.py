"""End-to-end check of a running service (local or deployed). Takes ~35 s because the
service really waits 30 s before marking a transaction PROCESSED.

    python scripts/smoke_test.py --base-url https://<your-app>.onrender.com

Covers the four success criteria from the task: single transaction processed after
~30 s, duplicate prevention, fast acknowledgement, graceful errors.
"""

from __future__ import annotations

import argparse
import sys
import time
import uuid
from datetime import datetime

import httpx

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}{('  - ' + detail) if detail and not condition else ''}")
    if not condition:
        failures.append(name)


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--timeout", type=float, default=90, help="max seconds to wait for PROCESSED")
    args = ap.parse_args()

    txn = f"smoke_{uuid.uuid4().hex[:10]}"
    body = {"transaction_id": txn, "source_account": "acc_user_789", "destination_account": "acc_merchant_456",
            "amount": 100, "currency": "USD"}
    url = "/v1/webhooks/transactions"

    with httpx.Client(base_url=args.base_url, timeout=60) as c:
        print(f"Smoke test against {args.base_url}  (transaction {txn})")

        print("1. Health")
        t = time.perf_counter(); r = c.get("/"); health_ms = (time.perf_counter() - t) * 1000  # also wakes a cold instance
        check("GET / returns 200 HEALTHY", r.status_code == 200 and r.json().get("status") == "HEALTHY", r.text)
        t = time.perf_counter(); r = c.get("/"); warm_ms = (time.perf_counter() - t) * 1000
        print(f"     first call {health_ms:.0f}ms, second call {warm_ms:.0f}ms")

        print("2. Webhook acknowledgement")
        t = time.perf_counter(); r = c.post(url, json=body); ack_ms = (time.perf_counter() - t) * 1000
        check("returns 202", r.status_code == 202, r.text)
        check(f"responds within 500ms ({ack_ms:.0f}ms)", ack_ms < 500)
        sent_at = time.time()

        print("3. Duplicate prevention")
        dups = [c.post(url, json=body) for _ in range(4)]
        check("4 duplicates all return 202", all(d.status_code == 202 for d in dups))
        check("duplicates reported as 'duplicate'", all(d.json().get("status") == "duplicate" for d in dups))
        r = c.post(url, json={**body, "amount": 999})
        check("same id + different amount returns 409", r.status_code == 409, r.text)

        print("4. Status while processing")
        r = c.get(f"/v1/transactions/{txn}")
        j = r.json()[0] if r.status_code == 200 and r.json() else {}
        check("status is PROCESSING, processed_at is null", j.get("status") == "PROCESSING" and j.get("processed_at") is None, r.text)

        print("5. Waiting for processing (~30 s)...")
        j = {}
        while time.time() - sent_at < args.timeout:
            rows = c.get(f"/v1/transactions/{txn}?currency=INR").json()
            j = rows[0] if isinstance(rows, list) and rows else {}
            if j.get("status") in ("PROCESSED", "FAILED"):
                break
            time.sleep(2)
        elapsed = time.time() - sent_at
        check(f"reaches PROCESSED ({elapsed:.0f}s after send)", j.get("status") == "PROCESSED", str(j))
        if j.get("status") == "PROCESSED":
            took = (parse(j["processed_at"]) - parse(j["created_at"])).total_seconds()
            check(f"processing took >= 29s ({took:.0f}s)", took >= 29)
            check("processed exactly once (attempts == 1)", j["attempts"] == 1)
            check("converted to INR (100 USD -> amount_inr set)", j["amount_inr"] is not None and j["currency"] == "INR", str(j))

        print("6. Display currency + errors")
        r = c.get(f"/v1/transactions/{txn}?currency=EUR")
        check("?currency=EUR returns EUR", r.status_code == 200 and r.json()[0]["currency"] == "EUR", r.text)
        check("unknown id returns 404", c.get("/v1/transactions/does_not_exist_xyz").status_code == 404)
        check("invalid payload returns 422", c.post(url, json={**body, "amount": -1}).status_code == 422)
        check("unsupported currency returns 422", c.post(url, json={**body, "currency": "JPY"}).status_code == 422)

    print("\nRESULT:", "ALL PASSED" if not failures else f"{len(failures)} FAILED -> {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
