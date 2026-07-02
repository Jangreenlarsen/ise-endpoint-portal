# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
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
from app.core.metrics import (
    CACHE_AVG_AGE_S,
    CACHE_DRIP_CYCLE_S,
    CACHE_DRIP_REFRESHED,
    CACHE_DRIP_SKIPPED,
    CACHE_DRIP_SLEEP_S,
    CACHE_OLDEST_AGE_S,
    CACHE_STALE_COUNT,
    CACHE_STALE_PCT,
)
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
    first_scan_done: bool = False
    last_error: str = ""
    hot_queue_size: int = 0
    started_at: float = 0.0
    # Drip-refresh metrics
    drip_refreshed_total: int = 0
    drip_skipped_total: int = 0
    drip_current_sleep_s: float = 0.0
    drip_estimated_full_cycle_s: float | None = None


class PrewarmWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._hot: asyncio.Queue[str] = asyncio.Queue()
        self._hot_set: set[str] = set()  # dedup-sæt: forhindrer samme ID i køen to gange
        self._rescan_event = asyncio.Event()  # trigger-signal til _list_scan_loop
        self.status = PrewarmStatus()

    @property
    def cache_ready(self) -> bool:
        """True når cachen er populeret fra disk eller første scan er færdig."""
        return self.status.disk_loaded > 0 or self.status.first_scan_done

    def preload_disk_cache(self) -> None:
        """Indlæs disk-cachen synkront. Kald FØR start() i lifespan så
        alle entries er tilgængelige fra første HTTP-request."""
        self._load_from_disk()

    def trigger_rescan(self) -> None:
        """Signalér workeren om at køre en fuld ISE-scan øjeblikkeligt.

        Returnerer straks — scan kører i baggrunden. Kalder _list_scan_loop
        ud af sin interval-søvn via _rescan_event så den starter næste
        _full_scan() uden at afvente det normale interval (default 30 min).
        """
        if self.status.running:
            self._rescan_event.set()
            logger.info("prewarm: øjeblikkelig rescan signaleret af bruger")

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop = asyncio.Event()
        self._rescan_event = asyncio.Event()
        self._hot = asyncio.Queue()
        self._hot_set = set()
        self.status = PrewarmStatus(
            running=True,
            started_at=time.time(),
            disk_loaded=self.status.disk_loaded,  # bevar disk_loaded fra preload
        )
        self._task = asyncio.create_task(self._run_with_retry(), name="cache-prewarm-worker")
        logger.info("cache prewarm worker started")

    async def _run_with_retry(self) -> None:
        """Wrapper der genstarter _run() automatisk ved uhåndteret exception.

        Vent 60s før genstart så ISE/netværk kan restabilisere sig.
        Stopper kun permanent når self._stop er sat.
        """
        _RESTART_DELAY = 60.0
        while not self._stop.is_set():
            try:
                await self._run()
            except Exception as exc:
                self.status.last_error = str(exc)
                logger.error(
                    "prewarm worker crashed: %s — genstart om %.0fs",
                    exc, _RESTART_DELAY,
                )
            if self._stop.is_set():
                break
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=_RESTART_DELAY)
            except asyncio.TimeoutError:
                pass
            if not self._stop.is_set():
                logger.info("prewarm worker genstarter")
                self.status.running = True
        self.status.running = False

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
        """Sæt et endpoint forrest i pre-warm køen (edit-modal trigger).
        Deduplicerer via _hot_set: samme ID kan ikke stå i køen to gange.
        """
        if endpoint_id not in self._hot_set:
            self._hot.put_nowait(endpoint_id)
            self._hot_set.add(endpoint_id)
        self.status.hot_queue_size = self._hot.qsize()

    async def _run(self) -> None:
        # Trin 1: Load disk cache (kun hvis preload_disk_cache() ikke allerede kørte)
        if self.status.disk_loaded == 0:
            self._load_from_disk()

        # Trin 2: Første fulde scan (bag scenen, blokerer ikke UI)
        await self._full_scan()

        # Trin 3: Drip-refresh + periodisk liste-scan kører parallelt
        interval = float(getattr(config.settings, "cache_prewarm_interval_s", 1800.0))

        async def _list_scan_loop() -> None:
            """Periodisk: hent ISE-liste og invalider slettede endpoints.

            Venter normalt `interval` sekunder (default 30 min), men vågner
            straks hvis trigger_rescan() sætter _rescan_event — bruges af
            Refresh-knappen i Browse-view så brugeren ikke skal vente.
            """
            while not self._stop.is_set():
                if interval <= 0:
                    return
                # Vent på timeout, stop-signal eller manuelt rescan-trigger
                stop_t   = asyncio.ensure_future(self._stop.wait())
                rescan_t = asyncio.ensure_future(self._rescan_event.wait())
                try:
                    await asyncio.wait(
                        {stop_t, rescan_t},
                        timeout=interval,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                finally:
                    stop_t.cancel()
                    rescan_t.cancel()
                self._rescan_event.clear()
                if self._stop.is_set():
                    return
                await self._drain_hot_queue()
                await self._full_scan()

        await asyncio.gather(
            _list_scan_loop(),
            self._drip_loop(),
        )
        self.status.running = False

    async def _drip_loop(self) -> None:
        """Kontinuerlig baggrunds-drip: refresh stale endpoints løbende.

        Sprint-mode (> 25% stale): batch_size skalerer med antal endpoints
        (max(3, total//200), cap 20) — design-mål: fuld cycle < TTL uanset deployment-størrelse.
        Normal mode: 1 fetch spredt jævnt over intervallet.
        Config re-læses hvert 10. iteration for hot-reload uden per-iteration overhead.
        Bruger public cache-metoder (stale_count_for_ttl, inflight_ids, set_fetch_backoff,
        ages_seconds) for at undgå direkte adgang til private _details/_inflight_detail.
        """
        from app.services.endpoint_service import EndpointService
        cache = get_cache()

        # Config læses én gang og genopfriskes hvert 10. iteration.
        _iter = 0
        interval = float(getattr(config.settings, "cache_prewarm_interval_s", 1800.0))
        ttl = float(getattr(config.settings, "cache_ttl_seconds", 300.0))
        _cb_logged = False  # undgå gentagne WARNING-logs når CB er OPEN (A)

        while not self._stop.is_set():
            # A: CB-aware pause — forhindrer 36K WARNING-logs/t ved CB OPEN.
            # D: billig endpoint-gruppe probe frem for tung endpoint-detail-fetch.
            client = get_ise_client()
            if client.cb_is_open():
                remaining = max(5.0, client.cb_recovery_remaining_s())
                if not _cb_logged:
                    logger.warning(
                        "drip: circuit breaker OPEN — pauser %.0fs derefter billig ISE-probe",
                        remaining,
                    )
                    _cb_logged = True
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=remaining)
                    break  # stop-signal
                except asyncio.TimeoutError:
                    pass
                logger.info("drip: sender billig ISE-probe (endpoint-gruppe liste)")
                await client.ping()
                continue
            if _cb_logged:
                logger.info("drip: circuit breaker genåbnet — genoptager drip")
                _cb_logged = False

            _iter += 1
            if _iter % 10 == 0:
                interval = float(getattr(config.settings, "cache_prewarm_interval_s", 1800.0))
                ttl = float(getattr(config.settings, "cache_ttl_seconds", 300.0))

            total = cache.detail_count()
            if total == 0:
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=10.0)
                except asyncio.TimeoutError:
                    pass
                continue

            stale_count = cache.stale_count_for_ttl(ttl)
            if stale_count > total // 4:
                # Sprint: batch_size skalerer med deployment-størrelse.
                # max(3, total//200) → 3 @ 100, 5 @ 1000, 10 @ 2000, 20 @ 4000+
                # Sikrer at cycle < TTL også ved 10K+ endpoints.
                batch_size = min(max(3, total // 200), 20)
                drip_sleep = max(0.5, ttl / total / 2)
            else:
                # Normal: 1 fetch spredt jævnt over intervallet.
                batch_size = 1
                drip_sleep = max(0.5, interval / total)
            self.status.drip_current_sleep_s = drip_sleep
            cycle_s = drip_sleep * total / batch_size
            self.status.drip_estimated_full_cycle_s = cycle_s
            CACHE_DRIP_SLEEP_S.set(drip_sleep)
            CACHE_DRIP_CYCLE_S.set(cycle_s)

            # 3-tier prioriteret kø via public API (undgår direkte _inflight_detail-adgang).
            priority_ids = cache.get_priority_stale_ids(ttl, cache.inflight_ids())
            to_fetch = priority_ids[:batch_size]

            if to_fetch:
                service = EndpointService(get_ise_client())

                async def _drip_one(ep_id: str) -> None:
                    try:
                        detail = await service._fetch_endpoint_detail(ep_id)
                        detail.cache_stale = False
                        cache.put_detail(ep_id, detail, from_disk=False)
                        self.status.drip_refreshed_total += 1
                        CACHE_DRIP_REFRESHED.inc()
                        logger.debug("drip: refreshed %s", ep_id)
                    except Exception as exc:  # noqa: BLE001
                        # RuntimeError("closed") opstår når httpx-klienten lukkes under
                        # restart/settings-ændring mens gather stadig kører — forventet,
                        # ikke en reel fejl. Log på DEBUG så det ikke fylder i analysen.
                        if isinstance(exc, RuntimeError) and "closed" in str(exc).lower():
                            logger.debug("drip: afbrudt id=%s (klient lukket ved genstart)", ep_id)
                        else:
                            logger.warning("drip: fetch fejlede id=%s: %s", ep_id, exc)
                        # Back-off via public API: undgår direkte fetched_at-manipulation.
                        cache.set_fetch_backoff(ep_id)

                await asyncio.gather(*[_drip_one(ep_id) for ep_id in to_fetch])
            else:
                self.status.drip_skipped_total += 1
                CACHE_DRIP_SKIPPED.inc()

            # Opdater staleness-gauges via public ages_seconds() i stedet for _details-adgang.
            ages = cache.ages_seconds()
            if ages:
                n_ages = len(ages)
                CACHE_OLDEST_AGE_S.set(max(ages))
                CACHE_AVG_AGE_S.set(sum(ages) / n_ages)
                stale = sum(1 for a in ages if a > ttl)
                CACHE_STALE_COUNT.set(stale)
                CACHE_STALE_PCT.set(stale / n_ages * 100)

            # Periodisk INFO-status så drip-metrics er synlige i logfilen.
            # Hvert 100. iteration (≈ 90s ved 1 endpoint/s) skrives en linje
            # der kan matches af log-analysen uden at give per-endpoint log-støj.
            if _iter % 100 == 0:
                logger.info(
                    "drip: status — refreshed=%d skipped=%d sleep=%.1fs cycle=%.0fs",
                    self.status.drip_refreshed_total,
                    self.status.drip_skipped_total,
                    drip_sleep,
                    cycle_s,
                )

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=drip_sleep)
                break
            except asyncio.TimeoutError:
                pass

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

            # Invalider endpoints slettet fra ISE siden sidst scan.
            # Ryd også _tier_emas for at forhindre ubegrænset hukommelsesvækst.
            from app.core import first_seen_store
            ise_ids_set = set(all_ids)
            cached_ids_set = set(cache.detail_ids())
            deleted_ids = cached_ids_set - ise_ids_set
            for ep_id in deleted_ids:
                entry = cache._details.get(ep_id)
                if entry and entry.value:
                    mac = getattr(entry.value, "mac", None) or getattr(entry.value, "name", None)
                    if mac:
                        first_seen_store.delete(mac)
                cache.invalidate_detail(ep_id)
                cache.forget_tier_ema(ep_id)  # ryd EMA-historik for permanent slettede endpoints
            self.status.deleted = len(deleted_ids)
            if deleted_ids:
                logger.info(
                    "prewarm: %d endpoints slettet fra ISE — invalideret i cache og first_seen ryddet",
                    len(deleted_ids),
                )

            # Sæt hot-queue IDs forrest. Brug set-subtraktion (O(n)) frem for
            # list.remove() (O(n²)) til at fjerne hot-IDs fra remaining.
            hot_first: list[str] = []
            while not self._hot.empty():
                try:
                    hot_first.append(self._hot.get_nowait())
                except asyncio.QueueEmpty:
                    break
            self._hot_set -= set(hot_first)  # ryd dedup-sæt for drænede IDs
            hot_set_local: set[str] = set(hot_first)
            # O(n) set-opslag i stedet for O(n²) list.remove() per hot-element
            remaining: list[str] = [ep_id for ep_id in all_ids if ep_id not in hot_set_local]
            ordered = hot_first + remaining

            # Inkrementel filtrering med tier-justeret skip_threshold.
            # Hot endpoints (lav effective_skip) springes sjældnere over ved fuld-scan.
            # Hot-queue IDs fetches altid. skip_threshold=0 → klassisk fuld-scan.
            skip_threshold = float(
                getattr(config.settings, "cache_prewarm_skip_fresh_s", 1800.0)
            )

            def should_fetch(ep_id: str) -> bool:
                if ep_id in hot_set_local:
                    return True
                if skip_threshold <= 0:
                    return True
                age = cache.detail_age(ep_id)
                if age is None:
                    return True  # ikke i cache — altid fetch
                if cache.is_from_disk(ep_id):
                    return True  # disk-loaded entries er stale
                # Tier-justeret skip: hot endpoints har lavere eff_skip → refreshes oftere
                eff_skip = cache.effective_skip_threshold(ep_id, skip_threshold)
                return age > eff_skip

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
            self.status.first_scan_done = True
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
        self._hot_set -= set(hot_ids)  # ryd dedup-sæt så samme IDs kan re-prioriteres
        self.status.hot_queue_size = self._hot.qsize()

    async def _fetch_all_ids(self, service: Any) -> list[str]:
        """Hent alle endpoint IDs fra ISE (pagineret liste, kun ID)."""
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
