"""Measure webhook acknowledgement latency (the 500 ms requirement).

    python scripts/load_test.py --base-url http://127.0.0.1:8000 --n 200 --concurrency 20

Every request is a *new* transaction, so each one leaves a 30 s background job
running - i.e. the endpoint is measured while the service is under processing load.
Exits with status 1 if p95 exceeds --limit-ms or any request is not a 202.
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
import uuid
from collections import Counter

import httpx


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--concurrency", type=int, default=20)
    ap.add_argument("--limit-ms", type=float, default=500)
    args = ap.parse_args()

    run = uuid.uuid4().hex[:8]
    sem = asyncio.Semaphore(args.concurrency)
    latencies: list[float] = []
    codes: Counter = Counter()

    async with httpx.AsyncClient(base_url=args.base_url, timeout=30) as client:
        await client.get("/")  # warm up connection (and wake a sleeping free-tier instance)

        async def send(i: int) -> None:
            body = {
                "transaction_id": f"load_{run}_{i}",
                "source_account": "acc_load",
                "destination_account": "acc_merchant",
                "amount": 10 + i,
                "currency": "INR",
            }
            async with sem:
                start = time.perf_counter()
                try:
                    r = await client.post("/v1/webhooks/transactions", json=body)
                    codes[r.status_code] += 1
                except httpx.HTTPError as exc:
                    codes[type(exc).__name__] += 1
                latencies.append((time.perf_counter() - start) * 1000)

        wall = time.perf_counter()
        await asyncio.gather(*[send(i) for i in range(args.n)])
        wall = time.perf_counter() - wall

    latencies.sort()
    p95 = latencies[int(len(latencies) * 0.95) - 1]
    print(f"requests={args.n} concurrency={args.concurrency} wall={wall:.1f}s ({args.n / wall:.0f} req/s)")
    print(f"status codes: {dict(codes)}")
    print(f"latency ms: p50={statistics.median(latencies):.0f} p95={p95:.0f} p99={latencies[int(len(latencies) * 0.99) - 1]:.0f} max={latencies[-1]:.0f}")
    ok = codes.get(202, 0) == args.n and p95 <= args.limit_ms
    print("PASS" if ok else f"FAIL (need all 202 and p95 <= {args.limit_ms:.0f}ms)")
    print(f"note: {args.n} jobs will finish processing in ~30 s (prefix load_{run}_)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
