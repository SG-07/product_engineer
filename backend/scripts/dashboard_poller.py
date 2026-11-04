"""Mimic the dashboard's polling (intervals from frontend/src/config/app.js) for N seconds.

list every 3 s, stats every 3 s, health every 10 s, one GET per tracked txn every 2 s.
Usage: python dashboard_poller.py <base_url> <seconds>
"""
import asyncio
import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 90
TRACKED = 5


async def every(interval, fn, end):
    while time.monotonic() < end:
        try:
            await fn()
        except Exception as exc:  # keep polling even if one call fails
            print("poll error:", exc, flush=True)
        await asyncio.sleep(interval)


async def main():
    end = time.monotonic() + DURATION
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as c:
        ids: list[str] = []

        async def refresh_ids():
            r = await c.get("/v1/transactions", params={"limit": 50, "currency": "INR"})
            items = r.json().get("items", [])
            ids[:] = [t["transaction_id"] for t in items[:TRACKED]]

        async def list_():
            await c.get("/v1/transactions", params={"limit": 50, "currency": "INR"})

        async def stats():
            await c.get("/v1/stats")

        async def health():
            await c.get("/")

        async def tracked():
            if not ids:
                await refresh_ids()
            for tid in ids:
                await c.get(f"/v1/transactions/{tid}", params={"currency": "INR"})

        await asyncio.gather(
            every(3, list_, end),
            every(3, stats, end),
            every(10, health, end),
            every(2, tracked, end),
        )
    print("poller finished", flush=True)


asyncio.run(main())
