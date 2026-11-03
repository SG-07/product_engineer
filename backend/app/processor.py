"""Background transaction processing.

Lifecycle of one transaction:
    claim lease -> wait PROCESSING_DELAY_SECONDS (simulated external call)
    -> convert to INR -> mark PROCESSED
On error: retry with exponential backoff, then mark FAILED after MAX_ATTEMPTS.
If the process dies mid-way, the row stays PROCESSING and the recovery sweeper
(app/recovery.py) reschedules it once the lease expires.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime

from app import repository as repo
from app.config import Settings
from app.currency import to_inr
from app.db import Database

log = logging.getLogger("app.processor")


class SimulatedProcessingError(RuntimeError):
    pass


class Processor:
    def __init__(self, settings: Settings, db: Database) -> None:
        self.settings = settings
        self.db = db
        self._tasks: dict[str, asyncio.Task] = {}  # strong refs, keyed by transaction_id
        self._held: dict[str, datetime] = {}  # transaction_id -> lease we currently hold
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self._closing = False

    # ------------------------------------------------------------------ public
    def schedule(self, transaction_id: str) -> bool:
        """Start processing in the background. No-op if already running here."""
        if self._closing:
            return False
        existing = self._tasks.get(transaction_id)
        if existing is not None and not existing.done():
            return False
        task = asyncio.create_task(self._run(transaction_id), name=f"process:{transaction_id}")
        self._tasks[transaction_id] = task
        task.add_done_callback(lambda t, tid=transaction_id: self._forget(tid, t))
        return True

    def is_running(self, transaction_id: str) -> bool:
        task = self._tasks.get(transaction_id)
        return task is not None and not task.done()

    @property
    def in_flight(self) -> int:
        return sum(1 for t in self._tasks.values() if not t.done())

    async def shutdown(self, timeout: float = 5.0) -> None:
        """Cancel in-flight work; each task releases its lease so a restart resumes it."""
        self._closing = True
        tasks = [t for t in self._tasks.values() if not t.done()]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.wait(tasks, timeout=timeout)
        log.info("processor stopped; %d task(s) handed back for recovery", len(tasks))

    # ----------------------------------------------------------------- internal
    def _forget(self, transaction_id: str, task: asyncio.Task) -> None:
        if self._tasks.get(transaction_id) is task:
            del self._tasks[transaction_id]
        if not task.cancelled() and task.exception() is not None:
            log.error("task for %s crashed: %r", transaction_id, task.exception())

    async def _run(self, transaction_id: str) -> None:
        async with self._semaphore:
            try:
                await self._process_with_retries(transaction_id)
            except asyncio.CancelledError:
                await self._release_quietly(transaction_id)
                raise
            except Exception:
                self._held.pop(transaction_id, None)
                # e.g. database unreachable. The row is still PROCESSING in the DB,
                # so the sweeper will pick it up again later - nothing is lost.
                log.exception("processing %s aborted; will be recovered by sweeper", transaction_id)

    async def _process_with_retries(self, transaction_id: str) -> None:
        s = self.settings
        while True:
            async with self.db.sessionmaker() as session:
                claim = await repo.claim(session, transaction_id, s.lease_seconds)
            if claim is None:
                log.debug("%s not claimable (done or owned elsewhere)", transaction_id)
                return
            self._held[transaction_id] = claim.locked_until
            log.info("processing %s (attempt %d/%d)", transaction_id, claim.attempts, s.max_attempts)
            try:
                await self._simulate_external_call()
                amount_inr, rate = to_inr(claim.original_amount, claim.original_currency, s.fx_rates_to_inr)
                async with self.db.sessionmaker() as session:
                    done = await repo.mark_processed(
                        session,
                        transaction_id,
                        amount_inr=amount_inr,
                        fx_rate_to_inr=rate,
                        fx_rate_as_of=s.fx_rates_as_of,
                    )
                self._held.pop(transaction_id, None)
                log.info("processed %s -> %s INR (updated=%s)", transaction_id, amount_inr, done)
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - any failure of the external step is retryable
                error = f"{type(exc).__name__}: {exc}"
                if claim.attempts >= s.max_attempts:
                    async with self.db.sessionmaker() as session:
                        await repo.mark_failed(session, transaction_id, error)
                    self._held.pop(transaction_id, None)
                    log.error("%s FAILED after %d attempts: %s", transaction_id, claim.attempts, error)
                    return
                backoff = s.retry_backoff_seconds * (2 ** (claim.attempts - 1))
                async with self.db.sessionmaker() as session:
                    self._held[transaction_id] = await repo.schedule_retry(
                        session, transaction_id, error, backoff, claim.locked_until
                    )
                log.warning("%s attempt %d failed (%s); retrying in %.1fs", transaction_id, claim.attempts, error, backoff)
                await asyncio.sleep(backoff)

    async def _simulate_external_call(self) -> None:
        # No DB connection is held while we wait.
        await asyncio.sleep(self.settings.processing_delay_seconds)
        if self.settings.simulated_failure_rate and random.random() < self.settings.simulated_failure_rate:
            raise SimulatedProcessingError("simulated external API failure")

    async def _release_quietly(self, transaction_id: str) -> None:
        lease = self._held.pop(transaction_id, None)
        if lease is None:
            return  # we never claimed it (e.g. cancelled while queued)
        try:
            async with self.db.sessionmaker() as session:
                await asyncio.wait_for(repo.release_lease(session, transaction_id, lease), timeout=2)
        except Exception:  # noqa: BLE001 - best effort; lease expiry is the fallback
            log.warning("could not release lease for %s; it will expire on its own", transaction_id)
