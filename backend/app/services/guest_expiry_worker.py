# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Periodisk baggrunds-worker der overvåger GuestExperyDate og sætter
GuestAccessExpire=true i ISE når udløbstidspunktet er nået.

Workflow:
  1. Spørg guest_expiry_store om endpoints med passeret udløbsdato.
  2. For hvert udløbet endpoint: skriv GuestAccessExpire=true til ISE via ERS.
  3. Invalider cache-entry så næste Browse-fetch viser den opdaterede CA.
  4. Fjern endpoint fra store (én-gangs handling — ISE er nu autoritativ).
  5. Log handlingen til app.log.

Interval styres af settings.guest_expiry_check_interval_seconds (default 60s).
Sæt til 0 for at deaktivere workeren helt.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from app.core import config
from app.core.endpoint_cache import get_cache
from app.core.guest_expiry_store import list_expired, remove
from app.ise.client import get_ise_client
from app.ise.endpoints import IseEndpointRepository

logger = logging.getLogger(__name__)


class GuestExpiryWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop = asyncio.Event()
        self._task = asyncio.create_task(self._run(), name="guest-expiry-worker")
        logger.info("guest expiry worker started")

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop.set()
        try:
            await asyncio.wait_for(self._task, timeout=5.0)
        except asyncio.TimeoutError:
            self._task.cancel()
            logger.warning("guest expiry worker stoppede ikke inden 5s — annulleret")
        finally:
            self._task = None

    async def _run(self) -> None:
        while not self._stop.is_set():
            interval = float(
                getattr(config.settings, "guest_expiry_check_interval_seconds", 60.0)
            )
            if interval <= 0:
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
            try:
                await self._check_once()
            except Exception as exc:  # noqa: BLE001
                logger.warning("guest expiry check fejlede: %s", exc)

    async def _check_once(self) -> None:
        now = datetime.now()
        expired = list_expired(now)
        if not expired:
            return
        logger.info("guest expiry: %d udløbne endpoints fundet", len(expired))
        client = get_ise_client()
        repo = IseEndpointRepository(client)
        for ep in expired:
            ep_id = ep["endpoint_id"]
            mac   = ep["mac"]
            exp   = ep["expiry_str"]
            try:
                await repo.update(ep_id, custom_attributes={"GuestAccessExpire": "true"})
                get_cache().invalidate_detail(ep_id)
                remove(ep_id)
                logger.info(
                    "guest expiry: GuestAccessExpire=true sat for mac=%s id=%s (udløb=%s)",
                    mac, ep_id, exp,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "guest expiry: fejlede opdatering af %s (mac=%s): %s",
                    ep_id, mac, exc,
                )


_worker: GuestExpiryWorker | None = None


def get_worker() -> GuestExpiryWorker:
    global _worker
    if _worker is None:
        _worker = GuestExpiryWorker()
    return _worker
