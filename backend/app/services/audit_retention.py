"""Daily retention-prune worker for the audit log (2.9.0).

Runs once at startup and then every 24 h, removing events older than
``audit_retention_days``. Guarded by ``audit_enabled`` — when auditing is
disabled the worker idles instead of pruning.
"""
from __future__ import annotations

import asyncio
import logging

from app.core import audit_store, config

logger = logging.getLogger(__name__)

_INTERVAL_SECONDS = 24 * 3600.0


class AuditRetentionWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="audit-retention")
        logger.info("audit-retention worker started")

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop.set()
        try:
            await asyncio.wait_for(self._task, timeout=5.0)
        except asyncio.TimeoutError:
            self._task.cancel()
            logger.warning("audit-retention worker did not stop within 5s")
        self._task = None
        logger.info("audit-retention worker stopped")

    async def _run(self) -> None:
        while not self._stop.is_set():
            await self._prune_once()
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=_INTERVAL_SECONDS
                )
                break
            except asyncio.TimeoutError:
                continue

    async def _prune_once(self) -> None:
        if not getattr(config.settings, "audit_enabled", True):
            return
        days = int(getattr(config.settings, "audit_retention_days", 90))
        if days <= 0:
            return
        try:
            removed = await audit_store.prune_older_than(days)
            if removed:
                logger.info("audit-retention: pruned %d events", removed)
        except Exception as exc:  # noqa: BLE001
            logger.exception("audit-retention prune failed: %s", exc)


_worker: AuditRetentionWorker | None = None


def get_worker() -> AuditRetentionWorker:
    global _worker
    if _worker is None:
        _worker = AuditRetentionWorker()
    return _worker
