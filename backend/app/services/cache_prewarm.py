"""Baggrunds pre-warm worker: holder cachen varm med inkrementel ISE-scan.

Lifecycle:
  1. start() → load_from_disk() → status vises øjeblikkeligt fra gammel cache
  2. Baggrundstask: inkrementel ISE-scan (list all IDs + fetch kun stale/nye)
  3. Efter hvert fuldt scan: save_to_disk() så næste restart er hurtig
  4. Hot-queue: prioritize(id) sætter et endpoint forrest i køen —
     bruges af edit-modal så brugeren altid ser friske ISE-data
  5. Gentag scan hvert cache_prewarm_interval_s sekunder (default 30 min)

Inkrementel adfærd (cache_prewarm_skip_fresh_s, default 1800s):
  - Endpoints slettet fra ISE siden sidst scan invalideres i cachen.
  - Detail-fetch springes over for entries friskere end skip-tærsklen.
  - Kun nye (ikke i cache) og stale (for gamle) endpoints detail-hentes.

Concurrency styres af cache_prewarm_concurrency (default 5 parallelle
ISE-kald) — ISE ERS accepterer ca. 5 samtidige forbindelser pr. klient.
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
    skipped: int = 0
    deleted: int = 0
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
        await self._save_to_disk()
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
        """Inkrementel ISE-scan: hent ID-liste, invalider slettede, skip friske."""
        self.status.scanning = True
        self.status.scan_number += 1
        self.status.scanned = 0
        self.status.skipped = 0
        self.status.deleted = 0
        scan_start = time.time()
        logger.info("prewarm: starter scan #%d", self.status.scan_number)
        try:
            from app.services.endpoint_service import EndpointService
            service = EndpointService(get_ise_client())

            # Pre-warm group-name cache med ét enkelt kald FØR parallel scan.
            # Uden dette vil N parallelle _fetch_endpoint_detail-kald hver
            # kalde groups.list_all() når de ikke finder gruppen i _group_cache
            # — ISE afviser forbindelserne ved for mange samtidige kald.
            try:
                raw_groups = await service.groups.list_all()
                service._group_cache = {
                    g.get("id", ""): g.get("name", "") for g in raw_groups
                }
                logger.info("prewarm: group-cache pre-warmet (%d grupper)", len(service._group_cache))
            except Exception as exc:  # noqa: BLE001
                service._group_cache = {}
                logger.warning("prewarm: group pre-warm fejlede (fortsætter): %s", exc)

            # Hent alle endpoint IDs fra ISE (kun ID, billige liste-kald)
            all_ids = await self._fetch_all_ids(service)
            self.status.total_endpoints = len(all_ids)

            cache = get_cache()

            # Invalider endpoints slettet fra ISE siden sidst scan
            ise_ids_set = set(all_ids)
            cached_ids_set = set(cache.detail_ids())
            deleted_ids = cached_ids_set - ise_ids_set
            for ep_id in deleted_ids:
                cache.invalidate_detail(ep_id)
            self.status.deleted = len(deleted_ids)
            if deleted_ids:
                logger.info(
                    "prewarm: %d endpoints slettet fra ISE — invalideret i cache",
                    len(deleted_ids),
                )

            # Sæt hot-queue IDs forrest og markér dem til force-fetch
            hot_set: set[str] = set()
            hot_first: list[str] = []
            remaining: list[str] = list(all_ids)
            while not self._hot.empty():
                try:
                    h = self._hot.get_nowait()
                    if h in remaining:
                        remaining.remove(h)
                    hot_first.append(h)
                    hot_set.add(h)
                except asyncio.QueueEmpty:
                    break
            ordered = hot_first + remaining

            # Inkrementel filtrering: spring over entries der er friske nok.
            # Hot-queue IDs fetchets altid. 0 = klassisk fuld-scan.
            skip_threshold = float(
                getattr(config.settings, "cache_prewarm_skip_fresh_s", 1800.0)
            )

            def should_fetch(ep_id: str) -> bool:
                if ep_id in hot_set:
                    return True
                if skip_threshold <= 0:
                    return True
                age = cache.detail_age(ep_id)
                if age is None:
                    return True  # ikke i cache — altid fetch
                if cache.is_from_disk(ep_id):
                    return True  # disk-loaded entries er stale
                return age > skip_threshold

            to_fetch = [ep_id for ep_id in ordered if should_fetch(ep_id)]
            self.status.skipped = len(ordered) - len(to_fetch)

            logger.info(
                "prewarm: scan #%d — %d endpoints: %d fetches, %d skipped (friske), %d slettet",
                self.status.scan_number,
                len(all_ids),
                len(to_fetch),
                self.status.skipped,
                self.status.deleted,
            )

            concurrency = int(getattr(config.settings, "cache_prewarm_concurrency", 5))
            sem = asyncio.Semaphore(concurrency)

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

            await asyncio.gather(*(fetch_one(i) for i in to_fetch))

            elapsed = time.time() - scan_start
            self.status.last_full_scan_at = time.time()
            logger.info(
                "prewarm: scan #%d færdig — %d fetched, %d skipped, %d slettet på %.1fs",
                self.status.scan_number,
                self.status.scanned,
                self.status.skipped,
                self.status.deleted,
                elapsed,
            )
            await self._save_to_disk()
        except Exception as exc:  # noqa: BLE001
            self.status.last_error = str(exc)
            logger.warning("prewarm: scan fejlede: %s", exc)
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

    async def _save_to_disk(self) -> None:
        """Async wrapper: runs save_to_disk in a thread-pool executor so the
        event loop is not blocked by json.dumps + file write at large scale."""
        path = self._get_disk_path()
        if not path:
            return
        cache = get_cache()
        saved = await cache.save_to_disk_async(path)
        if saved > 0:
            self.status.last_disk_save_at = time.time()

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

_worker: PrewarmWorker | None = None


def get_worker() -> PrewarmWorker:
    global _worker
    if _worker is None:
        _worker = PrewarmWorker()
    return _worker
