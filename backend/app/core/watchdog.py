# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Threading-based watchdog timer til FastAPI/asyncio backend.

Problemet: asyncio event loop'et kan hænge ved blocking ISE-kald,
frossen WebSocket-forbindelse eller en task der ikke yielder. En
asyncio-task kan ikke opdage dette — den er selv en del af det hængte
loop. En daemon-tråd kører derimod udenfor event loop'et og kan
uafhængigt detektere at loopet er ophørt med at reagere.

Mønster:
    1. asyncio-task kalder ``beat()`` hvert ~10s (trivielt cheap).
    2. Watchdog-tråd tjekker hvert ``poll_s`` om heartbeat er opdateret
       inden for ``timeout_s``. Hvis ikke → ``os._exit(1)``.
    3. Service-manager (systemd, Docker restart-policy, pm2 m.m.)
       opdager exit-koden og genstarter processen.

Brug (main.py):
    from app.core.watchdog import start_watchdog, beat as watchdog_beat

    # I lifespan startup:
    start_watchdog(timeout_s=120)
    _heartbeat_task = asyncio.create_task(_heartbeat_loop(), name="watchdog-heartbeat")

    async def _heartbeat_loop():
        while True:
            watchdog_beat()
            await asyncio.sleep(10)

    # I lifespan shutdown:
    _heartbeat_task.cancel()
"""
from __future__ import annotations

import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

_last_beat: float = 0.0
_beat_lock = threading.Lock()
_started = False


def beat() -> None:
    """Opdatér heartbeat-timestamp. Kald fra asyncio-task hvert ~10s."""
    global _last_beat
    with _beat_lock:
        _last_beat = time.monotonic()


def _loop(timeout_s: float, poll_s: float) -> None:
    # Giv applikationen timeout_s til at starte inden første tjek.
    time.sleep(timeout_s)
    while True:
        time.sleep(poll_s)
        with _beat_lock:
            age = time.monotonic() - _last_beat
        if age > timeout_s:
            logger.critical(
                "WATCHDOG: asyncio event loop ingen heartbeat i %.0fs "
                "(grænse=%.0fs) — tvinger genstart (os._exit(1))",
                age,
                timeout_s,
            )
            # Flush log til disk inden exit
            logging.shutdown()
            os._exit(1)  # noqa: SLF001 — intentional hard exit


def start_watchdog(timeout_s: float = 120.0, poll_s: float = 15.0) -> None:
    """Start watchdog daemon-tråd. Idempotent — virkning kun ved første kald.

    Args:
        timeout_s: Sekunder uden heartbeat før tvungen genstart (default 120s).
                   Bør være > max forventet ISE-svartid × antal parallelle kald.
        poll_s:    Tjek-interval i sekunden (default 15s). Sæt lavere hvis
                   hurtigere reaktion ønskes (øger ikke CPU mærkbart).
    """
    global _started
    if _started:
        return
    beat()  # sæt initial timestamp så startup ikke straks trigger
    t = threading.Thread(
        target=_loop,
        args=(timeout_s, poll_s),
        daemon=True,   # tråden dør automatisk når main-processen afslutter
        name="hypervision-watchdog",
    )
    t.start()
    _started = True
    logger.info(
        "Watchdog startet — timeout=%.0fs, poll=%.0fs",
        timeout_s,
        poll_s,
    )
