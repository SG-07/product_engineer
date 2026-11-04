"""Check a running service against backend.md, using the spec's own request bodies.

    python scripts/spec_check.py                          # http://127.0.0.1:8000
    python scripts/spec_check.py --base-url https://txn-webhooks.onrender.com

Takes about 40 s (it waits for the real 30 s processing). Each run uses a fresh transaction
id, so it can be repeated against a database that already contains data. Pass
--spec-id to use the exact id from the spec (txn_abc123def456) on an empty database.

Exit code 0 = every requirement passed; 1 = at least one failure. (The script can also list
"known deviations" - differences from backend.md that were decided on purpose - which are
shown but do not fail the run. There are currently none.)
"""

from __future__ import annotations

import argparse
import sys
import time
import uuid
from datetime import datetime

import httpx

LIMIT_MS = 500
results: list[bool] = []
deviations: list[str] = []


def check(name: str, ok: bool, detail: str = "", known_deviation: str = "") -> None:
    if not ok and known_deviation:
        deviations.append(name)
        print(f"[DEVIATION] {name}" + (f"  -> {detail}" if detail else ""))
        print(f"            known: {known_deviation}")
        return
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  -> {detail}" if detail else ""))


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def first(data):
    return data[0] if isinstance(data, list) and data else data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--spec-id", action="store_true", help="use the spec's transaction_id (empty database only)")
    args = ap.parse_args()

    tid = "txn_abc123def456" if args.spec_id else f"txn_spec_{uuid.uuid4().hex[:10]}"
    body = {
        "transaction_id": tid,
        "source_account": "acc_user_789",
        "destination_account": "acc_merchant_456",
        "amount": 1500,
        "currency": "INR",
    }
    c = httpx.Client(base_url=args.base_url, timeout=30)
    print(f"Spec check against {args.base_url}  (transaction {tid})\n")

    c.get("/")  # open the connection first, as any real sender would have

    print("1. Health check: GET /")
    r = c.get("/")
    data = r.json()
    check("returns 200", r.status_code == 200)
    check('body is {"status", "current_time"} with status HEALTHY', set(data) == {"status", "current_time"} and data.get("status") == "HEALTHY", r.text)
    try:
        parse(data["current_time"])
        check("current_time is an ISO-8601 UTC timestamp (like 2024-01-15T10:30:00Z)", data["current_time"].endswith("Z"), data["current_time"])
    except Exception as exc:  # noqa: BLE001
        check("current_time is an ISO-8601 UTC timestamp", False, str(exc))

    print("\n2. Webhook: POST /v1/webhooks/transactions with the spec's body")
    t0 = time.perf_counter()
    r = c.post("/v1/webhooks/transactions", json=body)
    ms = (time.perf_counter() - t0) * 1000
    check("returns 202 Accepted", r.status_code == 202, f"{r.status_code} {r.text}")
    check(f"responds within {LIMIT_MS} ms", ms < LIMIT_MS, f"{ms:.0f} ms")

    print("\n3. Query: GET /v1/transactions/{id} right after (processing)")
    r = c.get(f"/v1/transactions/{tid}")
    raw = r.json()
    obj = first(raw)
    check("returns 200", r.status_code == 200)
    check(
        "response is a JSON array with one element [{...}] as sketched in backend.md",
        isinstance(raw, list) and len(raw) == 1,
        f"actual: JSON {type(raw).__name__}",
    )
    for f in ("transaction_id", "source_account", "destination_account", "amount", "currency", "status", "created_at", "processed_at"):
        check(f"field present: {f}", isinstance(obj, dict) and f in obj)
    if isinstance(obj, dict):
        check('status is "PROCESSING"', obj.get("status") == "PROCESSING", str(obj.get("status")))
        check("processed_at is null while processing", obj.get("processed_at") is None)

    print("\n4. Duplicate prevention: same webhook 5 more times while processing")
    codes, lat = [], []
    for _ in range(5):
        t0 = time.perf_counter()
        codes.append(c.post("/v1/webhooks/transactions", json=body).status_code)
        lat.append((time.perf_counter() - t0) * 1000)
    check("all duplicates return 202 (no errors)", codes == [202] * 5, str(codes))
    check(f"duplicates answer within {LIMIT_MS} ms", max(lat) < LIMIT_MS, f"max {max(lat):.0f} ms")
    items = c.get("/v1/transactions", params={"limit": 100}).json().get("items", [])
    check("exactly one stored transaction for that id", sum(1 for t in items if t["transaction_id"] == tid) == 1)

    print("\n5. Performance: 40 other webhooks while the 30 s job is running")
    lat = []
    ok202 = True
    for i in range(40):
        t0 = time.perf_counter()
        rr = c.post("/v1/webhooks/transactions", json={**body, "transaction_id": f"{tid}_load_{i}"})
        lat.append((time.perf_counter() - t0) * 1000)
        ok202 &= rr.status_code == 202
    lat.sort()
    check("all 40 return 202", ok202)
    check(f"all 40 answer within {LIMIT_MS} ms", lat[-1] < LIMIT_MS, f"p95 {lat[int(len(lat) * 0.95) - 1]:.0f} ms, max {lat[-1]:.0f} ms")

    print("\n6. Background processing: waiting for the 30 s delay")
    final = None
    deadline = time.time() + 120
    while time.time() < deadline:
        d = first(c.get(f"/v1/transactions/{tid}").json())
        if d["status"] == "PROCESSED":
            final = d
            break
        time.sleep(1)
    check("reaches PROCESSED", final is not None)
    if final:
        secs = (parse(final["processed_at"]) - parse(final["created_at"])).total_seconds()
        check("processed_at - created_at is about 30 s (29 to 40)", 29 <= secs <= 40, f"{secs:.1f} s")
        check("processed exactly once (attempts == 1)", final.get("attempts") == 1, str(final.get("attempts")))
        check("amount and currency stored as sent", float(final["amount"]) == 1500 and final["currency"] == "INR", f'{final["amount"]} {final["currency"]}')

    print("\n7. Duplicate after processing")
    rr = c.post("/v1/webhooks/transactions", json=body)
    check("still returns 202", rr.status_code == 202, rr.text)
    d = first(c.get(f"/v1/transactions/{tid}").json())
    check("still PROCESSED with attempts == 1", d["status"] == "PROCESSED" and d.get("attempts") == 1)

    print("\n8. Errors are handled gracefully")
    check("unknown id -> 404", c.get("/v1/transactions/does_not_exist").status_code == 404)
    check("incomplete body -> 422", c.post("/v1/webhooks/transactions", json={"transaction_id": "x"}).status_code == 422)
    rr = c.post("/v1/webhooks/transactions", content=b"not json", headers={"content-type": "application/json"})
    check("malformed JSON -> 4xx, not 500", 400 <= rr.status_code < 500, str(rr.status_code))
    check("negative amount -> 422", c.post("/v1/webhooks/transactions", json={**body, "transaction_id": f"{tid}_neg", "amount": -5}).status_code == 422)
    check("same id with a different amount -> 409", c.post("/v1/webhooks/transactions", json={**body, "amount": 1000}).status_code == 409)

    passed = sum(results)
    print(f"\nRESULT: {passed}/{len(results)} checks passed, {len(deviations)} known deviation(s)")
    for name in deviations:
        print(f"  deviation: {name}")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
