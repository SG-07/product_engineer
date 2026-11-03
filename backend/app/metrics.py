"""In-memory webhook metrics for GET /v1/stats.

Pure memory: recording is O(1) with no await and no database, so it cannot
slow the webhook path. Numbers reset when the process restarts.
"""

from __future__ import annotations

import math
import time
from collections import deque

OUTCOMES = ("accepted", "duplicate", "conflict", "rejected")


def percentile(sorted_values: list[float], pct: float) -> float | None:
    """Nearest-rank percentile of an already sorted list."""
    if not sorted_values:
        return None
    rank = max(1, math.ceil(pct / 100 * len(sorted_values)))
    return sorted_values[rank - 1]


class Metrics:
    WINDOW = 200

    def __init__(self, budget_ms: float = 500.0) -> None:
        self.budget_ms = budget_ms
        self.started_at = time.time()
        self._acks: deque[tuple[float, float]] = deque(maxlen=self.WINDOW)  # (monotonic ts, ms)
        self._outcomes = dict.fromkeys(OUTCOMES, 0)

    def record_ack(self, ms: float) -> None:
        self._acks.append((time.monotonic(), ms))

    def note(self, outcome: str) -> None:
        self._outcomes[outcome] += 1

    def uptime_seconds(self) -> float:
        return time.time() - self.started_at

    def snapshot(self) -> dict:
        values = sorted(ms for _, ms in self._acks)
        now = time.monotonic()
        over = sum(1 for v in values if v > self.budget_ms)
        return {
            "window": len(values),
            **self._outcomes,
            "ack_ms": {
                "p50": percentile(values, 50),
                "p95": percentile(values, 95),
                "max": values[-1] if values else None,
            },
            "over_budget_pct": round(100 * over / len(values), 1) if values else 0.0,
            "per_minute": sum(1 for ts, _ in self._acks if now - ts <= 60),
        }
