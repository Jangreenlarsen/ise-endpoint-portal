"""Periodic background worker that keeps the endpoint cache warm.

Strategy: every ``cache_sync_interval_seconds`` seconds, iterate the ids
currently in the detail cache and re-fetch those that are past half-TTL.
We only refresh what's already cached — no full-scan pre-warm — so cost
scales with what the UI is actually looking at, not with ISE's endpoint
count.

Lifecycle is tied to the FastAPI lifespan so it starts with the app and
stops cleanly on shutdown. Interval <= 0 disables the worker entirely;
the cache still serves reads normally via its TTL + SWR semantics.
"""
from __future__ import annotations

import asyncio
import logging

from app.core import config
from app.core.endpoint_cache import get_cache
from app.ise.client import get_ise_client
from app.services.endpoint_service import EndpointService

logger = logging.getLogger(__name__)


class CacheSyncWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="cache-sync-worker")
        logger.info("cache sync worker started")

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop.set()
        try:
            await asyncio.wait_for(self._task, timeout=5.0)
        except asyncio.TimeoutError:
            self._task.cancel()
            logger.warning("cache sync worker did not stop in 5s — cancelled")
        finally:
            self._task = None

    async def _run(self) -> None:
        while not self._stop.is_set():
            interval = float(
                getattr(config.settings, "cache_sync_interval_seconds", 300.0)
            )
            if interval <= 0:
                # Disabled — sleep a short, configurable-free interval and
                # re-check so a live settings change can re-enable us.
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=30.0)
                except asyncio.TimeoutError:
                    continue
                return
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
                return  # stop requested
            except asyncio.TimeoutError:
                pass
            if not get_cache().enabled():
                continue
            try:
                await self._sync_once()
                get_cache().mark_sync_ok()
            except Exception as exc:  # noqa: BLE001
                logger.warning("cache sync failed: %s", exc)
                get_cache().mark_sync_error(str(exc))

    async def _sync_once(self) -> None:
        cache = get_cache()
        ids = cache.detail_ids()
        if not ids:
            return
        ttl = float(getattr(config.settings, "cache_ttl_seconds", 60.0))
        threshold = ttl / 2.0
        due: list[str] = [
            i for i in ids
            if (age := cache.detail_age(i)) is not None and age >= threshold
        ]
        if not due:
            return
        logger.info(
            "cache sync: refreshing %d/%d entries past half-TTL", len(due), len(ids)
        )
        service = EndpointService(get_ise_client())
        # Bound concurrency to stay under ISE's ~5-10 req/sec ceiling.
        sem = asyncio.Semaphore(5)

        async def refresh_one(endpoint_id: str) -> None:
            async with sem:
                try:
                    # Bypass cache: fetch fresh and re-seat the entry.
                    detail = await service._fetch_endpoint_detail(endpoint_id)
                    cache.put_detail(endpoint_id, detail)
                except Exception as exc:  # noqa: BLE001
                    # Individual refresh failures are tolerable — we'll
                    # retry next cycle. Drop the stale entry so next read
                    # fetches fresh from ISE.
                    logger.debug(
                        "cache sync: refresh failed id=%s err=%s", endpoint_id, exc
                    )
                    cache.invalidate_detail(endpoint_id)

        await asyncio.gather(*(refresh_one(i) for i in due))


_worker = CacheSyncWorker()


def get_worker() -> CacheSyncWorker:
    return _worker
