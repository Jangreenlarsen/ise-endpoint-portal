"""Baggrunds pre-warm worker: scanner ALLE ISE endpoints og holder cachen varm.

Lifecycle:
  1. start() → load_from_disk() → status vises øjeblikkeligt fra gammel cache
  2. Baggrundstask: full ISE-scan (list all IDs + fetch details parallelt)
  3. Efter hvert fuldt scan: save_to_disk() så næste restart er hurtig
  4. Hot-queue: prioritize(id) sætter et endpoint forrest i køen —
     bruges af edit-modal så brugeren altid ser friske ISE-data
  5. Gentag scan hvert cache_prewarm_interval_s sekunder (default 30 min)

Concurrency styres af cache_prewarm_concurrency (default 10 parallelle
ISE-kald). Det er højere end listview-semaphoren (5) fordi pre-warm kører
i baggrunden og ikke blokerer UI-requests.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core import config
from app.core.endpoint_cache import get_cache
from app.ise.client import get_ise_client

logger = logging.getLogger(__name__)


@dataclass
class PrewarmStatus:
    running: bool = False
    scanning: bool = False
    scan_number: int = 0
    total_endpoints: int = 0
    scanned: int = 0
    last_full_scan_at: float | None = None
    last_disk_save_at: float | None = None
    disk_loaded: int = 0
    last_error: str = ""
    hot_queue_size: int = 0
    started_at: float = 0.0


class PrewarmWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._hot: asyncio.Queue[str] = asyncio.Queue()
        self.status = PrewarmStatus()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self.status = PrewarmStatus(running=True, started_at=time.time())
        self._task = asyncio.create_task(self._run(), name="cache-prewarm-worker")
        logger.info("cache prewarm worker started")

    async def stop(self) -> None:
        if not self._task:
            return
        # Gem til disk ved shutdown
        self._save_to_disk()
        self._stop.set()
        try:
            await asyncio.wait_for(self._task, timeout=10.0)
        except asyncio.TimeoutError:
            self._task.cancel()
            logger.warning("cache prewarm worker did not stop in 10s — cancelled")
        finally:
            self._task = None
            self.status.running = False

    def prioritize(self, endpoint_id: str) -> None:
        """Sæt et endpoint forrest i pre-warm køen (edit-modal trigger)."""
        self._hot.put_nowait(endpoint_id)
        self.status.hot_queue_size = self._hot.qsize()

    async def _run(self) -> None:
        # Trin 1: Load disk cache øjeblikkeligt
        self._load_from_disk()

        # Trin 2: Første fulde scan (bag scenen, blokerer ikke UI)
        await self._full_scan()

        # Trin 3: Behandl hot-queue løbende + periodisk rescan
        interval = float(getattr(config.settings, "cache_prewarm_interval_s", 1800.0))
        while not self._stop.is_set():
            # Tøm hot-queue mellem scans
            await self._drain_hot_queue()

            if interval <= 0:
                # Kun ét scan ved startup; sov og hop til stop
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=60.0)
                except asyncio.TimeoutError:
                    continue
                break

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
                break  # stop requested
            except asyncio.TimeoutError:
                pass

            if self._stop.is_set():
                break
            await self._full_scan()

        self.status.running = False

    async def _full_scan(self) -> None:
        """Hent alle endpoint IDs fra ISE og refresh details i baggrunden."""
        self.status.scanning = True
        self.status.scan_number += 1
        self.status.scanned = 0
        scan_start = time.time()
        logger.info("prewarm: starter fuldt ISE-scan #%d", self.status.scan_number)
        try:
            from app.services.endpoint_service import EndpointService
            service = EndpointService(get_ise_client())
            # Hent alle endpoint IDs (kun ID + navn, billig liste-kald)
            all_ids = await self._fetch_all_ids(service)
            self.status.total_endpoints = len(all_ids)
            logger.info(
                "prewarm: scan #%d — %d endpoints fundet, starter detail-fetch",
                self.status.scan_number, len(all_ids),
            )

            # Sæt hot-queue IDs forrest
            hot_first: list[str] = []
            remaining: list[str] = list(all_ids)
            while not self._hot.empty():
                try:
                    h = self._hot.get_nowait()
                    if h in remaining:
                        remaining.remove(h)
                    hot_first.append(h)
                except asyncio.QueueEmpty:
                    break
            ordered = hot_first + remaining

            concurrency = int(getattr(config.settings, "cache_prewarm_concurrency", 10))
            sem = asyncio.Semaphore(concurrency)
            cache = get_cache()

            async def fetch_one(ep_id: str) -> None:
                if self._stop.is_set():
                    return
                async with sem:
                    try:
                        detail = await service._fetch_endpoint_detail(ep_id)
                        detail.cache_stale = False
                        cache.put_detail(ep_id, detail, from_disk=False)
                        self.status.scanned += 1
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("prewarm: fetch fejlede id=%s: %s", ep_id, exc)

            await asyncio.gather(*(fetch_one(i) for i in ordered))

            elapsed = time.time() - scan_start
            self.status.last_full_scan_at = time.time()
            logger.info(
                "prewarm: scan #%d færdig — %d/%d endpoints refreshet på %.1fs",
                self.status.scan_number,
                self.status.scanned,
                self.status.total_endpoints,
                elapsed,
            )
            self._save_to_disk()
        except Exception as exc:  # noqa: BLE001
            self.status.last_error = str(exc)
            logger.warning("prewarm: fuldt scan fejlede: %s", exc)
        finally:
            self.status.scanning = False
            self.status.hot_queue_size = self._hot.qsize()

    async def _drain_hot_queue(self) -> None:
        """Tøm hot-queue uden at vente — behandl prioriterede endpoints."""
        if self._hot.empty():
            return
        from app.services.endpoint_service import EndpointService
        service = EndpointService(get_ise_client())
        cache = get_cache()
        concurrency = int(getattr(config.settings, "cache_prewarm_concurrency", 10))
        sem = asyncio.Semaphore(min(concurrency, 5))
        hot_ids: list[str] = []
        while not self._hot.empty():
            try:
                hot_ids.append(self._hot.get_nowait())
            except asyncio.QueueEmpty:
                break

        async def fetch_hot(ep_id: str) -> None:
            async with sem:
                try:
                    detail = await service._fetch_endpoint_detail(ep_id)
                    detail.cache_stale = False
                    cache.put_detail(ep_id, detail, from_disk=False)
                    logger.debug("prewarm: hot-refresh færdig id=%s", ep_id)
                except Exception as exc:  # noqa: BLE001
                    logger.debug("prewarm: hot-refresh fejlede id=%s: %s", ep_id, exc)

        if hot_ids:
            logger.info("prewarm: hot-queue flush — %d endpoints", len(hot_ids))
            await asyncio.gather(*(fetch_hot(i) for i in hot_ids))
        self.status.hot_queue_size = self._hot.qsize()

    async def _fetch_all_ids(self, service: Any) -> list[str]:
        """Hent alle endpoint IDs fra ISE (pagineret liste, kun ID)."""
        from app.ise.client import get_ise_client
        client = get_ise_client()
        all_ids: list[str] = []
        page = 1
        while True:
            try:
                resources, total = await service.endpoints.list_page(
                    page=page, size=100
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("prewarm: list_page fejlede side %d: %s", page, exc)
                break
            for r in resources:
                ep_id = r.get("id", "")
                if ep_id:
                    all_ids.append(ep_id)
            if len(all_ids) >= total or not resources:
                break
            page += 1
        return all_ids

    def _get_disk_path(self) -> Path | None:
        disk_path_str = getattr(config.settings, "cache_disk_path", "")
        if not disk_path_str:
            return None
        p = Path(disk_path_str)
        if not p.is_absolute():
            # Relativ til backend-mappen (to niveauer op fra denne fil)
            p = Path(__file__).resolve().parents[2] / p
        return p

    def _load_from_disk(self) -> None:
        path = self._get_disk_path()
        if not path:
            return
        cache = get_cache()
        loaded = cache.load_from_disk(path)
        self.status.disk_loaded = loaded

    def _save_to_disk(self) -> None:
        path = self._get_disk_path()
        if not path:
            return
        cache = get_cache()
        saved = cache.save_to_disk(path)
        if saved > 0:
            self.status.last_disk_save_at = time.time()


_worker: PrewarmWorker | None = None


def get_worker() -> PrewarmWorker:
    global _worker
    if _worker is None:
        _worker = PrewarmWorker()
    return _worker
