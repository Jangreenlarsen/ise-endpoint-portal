# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Regelbaseret anomali-detektion på pxGrid session-stream.

Registrerer sig som observer på SessionCache og sætter/rydder alerts
i alert_store når usædvanlige mønstre detekteres.

Mønstre der detekteres:
  bulk_disconnect  — >BULK_THRESHOLD disconnects inden for BULK_WINDOW_S sekunder.
  nas_ip_churn     — samme MAC skifter NAS-IP >CHURN_THRESHOLD gange inden for
                     CHURN_WINDOW_S sekunder. Én alert pr. MAC.
"""
from __future__ import annotations

import time
from collections import deque

BULK_THRESHOLD = 10
BULK_WINDOW_S  = 30
CHURN_THRESHOLD = 3
CHURN_WINDOW_S  = 60
# Max antal churn-alerts i hukommelsen på én gang (undgår ubegrænset vækst)
MAX_CHURN_MACS = 50


class AnomalyDetector:
    def __init__(self, session_cache) -> None:
        self._disconnect_times: deque[float] = deque()
        # mac -> deque of (ts, nas_ip)
        self._nas_history: dict[str, deque] = {}
        session_cache.register_observer(self._on_event)

    def _on_event(self, event: dict) -> None:
        t = event.get("type")
        if t == "remove":
            self._handle_disconnect(event)
        elif t == "upsert":
            self._handle_upsert(event)
        elif t == "clear":
            self._handle_bulk_clear(event)

    def _handle_disconnect(self, event: dict) -> None:
        from app.core.alert_store import clear_alert, set_alert

        now = time.time()
        cutoff = now - BULK_WINDOW_S
        self._disconnect_times.append(now)
        while self._disconnect_times and self._disconnect_times[0] < cutoff:
            self._disconnect_times.popleft()

        count = len(self._disconnect_times)
        if count >= BULK_THRESHOLD:
            set_alert(
                "anomaly_bulk_disconnect",
                "warning",
                "Bulk-disconnect detekteret",
                f"{count} endpoints disconnectet inden for {BULK_WINDOW_S}s. "
                "Mulig switch-fejl, ISE-genstart eller angreb.",
            )
        else:
            clear_alert("anomaly_bulk_disconnect")

    def _handle_upsert(self, event: dict) -> None:
        from app.core.alert_store import clear_alert, set_alert

        mac    = event.get("mac", "")
        nas_ip = event.get("nas_ip", "")
        if not mac or not nas_ip:
            return

        now    = time.time()
        cutoff = now - CHURN_WINDOW_S

        if mac not in self._nas_history:
            if len(self._nas_history) >= MAX_CHURN_MACS:
                # Drop oldest tracked MAC to cap memory
                oldest = next(iter(self._nas_history))
                del self._nas_history[oldest]
            self._nas_history[mac] = deque()

        hist = self._nas_history[mac]
        hist.append((now, nas_ip))
        while hist and hist[0][0] < cutoff:
            hist.popleft()

        unique_ips = len({ip for _, ip in hist})
        alert_id   = f"anomaly_nas_churn_{mac}"
        if unique_ips >= CHURN_THRESHOLD:
            set_alert(
                alert_id,
                "warning",
                "NAS-IP churn detekteret",
                f"MAC {mac} har skiftet NAS-IP {unique_ips} gange inden for "
                f"{CHURN_WINDOW_S}s — mulig MAC-spoofing eller roaming-fejl.",
            )
        else:
            clear_alert(alert_id)

    def _handle_bulk_clear(self, _event: dict) -> None:
        # Clear clears alll sessions — reset disconnect window too
        self._disconnect_times.clear()
