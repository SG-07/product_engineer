"""Recovery sweeper: the safety net that makes sure no transaction is ever lost.

Runs once at startup and then every SWEEPER_INTERVAL_SECONDS. It finds rows that
are still PROCESSING but that nobody is working on (lease expired, or never
claimed) and hands them back to the processor.
"""

from __future__ import annotations

import asyncio
import logging

from app import repository as repo
from app.config import Settings
from app.db import Database
from app.processor import Processor

log = logging.getLogger("app.recovery")


class RecoverySweeper:
    def __init__(self, settings: Settings, db: Database, processor: Processor) -> None:
        self.settings = settings
        self.db = db
        self.processor = processor
        self._task: asyncio.Task | None = None

    async def sweep_once(self) -> int:
        async with self.db.sessionmaker() as session:
            ids = await repo.find_stale(session, unclaimed_after=self.settings.stale_unclaimed_seconds)
        scheduled = 0
        for tid in ids:
            if not self.processor.is_running(tid) and self.processor.schedule(tid):
                scheduled += 1
        if scheduled:
            log.info("recovery sweeper rescheduled %d transaction(s)", scheduled)
        return scheduled

    async def _loop(self) -> None:
        while True:
            try:
                await self.sweep_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - keep sweeping even if the DB blips
                log.exception("recovery sweep failed; will retry")
            await asyncio.sleep(self.settings.sweeper_interval_seconds)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="recovery-sweeper")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
