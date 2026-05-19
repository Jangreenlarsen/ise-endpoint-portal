# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""In-memory alert store: sæt/ryd advarsler fra baggrundstasks.

Alerts er tilstandsbaserede: set_alert er idempotent (opdaterer kun
severity/body hvis alerten allerede eksisterer, bevarer 'since').
clear_alert fjerner alerten. get_alerts returnerer aktive alerts.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class Alert:
    id: str
    severity: str       # "error" | "warning" | "info"
    title: str
    body: str
    since: float = field(default_factory=time.time)


_alerts: dict[str, Alert] = {}


def set_alert(alert_id: str, severity: str, title: str, body: str) -> None:
    if alert_id in _alerts:
        a = _alerts[alert_id]
        a.severity = severity
        a.title = title
        a.body = body
    else:
        _alerts[alert_id] = Alert(id=alert_id, severity=severity, title=title, body=body)


def clear_alert(alert_id: str) -> None:
    _alerts.pop(alert_id, None)


def get_alerts() -> list[Alert]:
    return sorted(_alerts.values(), key=lambda a: a.since)


def check_conditions() -> None:
    """Tjek alle alert-betingelser og opdatér alert-state.
    Kaldes periodisk fra baggrundstask i main.py.
    """
    _check_circuit_breaker()
    _check_cache_drip()
    _check_stale_pct()


def _check_circuit_breaker() -> None:
    try:
        from app.core.metrics import CIRCUIT_STATE
        cb_state = 0
        for mf in CIRCUIT_STATE.collect():
            for sample in mf.samples:
                cb_state = int(sample.value)
        if cb_state == 2:
            set_alert(
                "circuit_open",
                "error",
                "ISE forbindelse afbrudt",
                "Circuit breaker er OPEN — ISE-kald fejler. Portalen serverer cached data.",
            )
        elif cb_state == 1:
            set_alert(
                "circuit_open",
                "warning",
                "ISE forbindelse ustabil",
                "Circuit breaker er HALF-OPEN — ISE-forbindelsen er ved at genoprettes.",
            )
        else:
            clear_alert("circuit_open")
    except Exception:  # noqa: BLE001
        pass


def _check_cache_drip() -> None:
    try:
        from app.services.cache_prewarm import get_worker
        from app.core import config
        pw = get_worker().status
        if pw.drip_estimated_full_cycle_s and pw.drip_estimated_full_cycle_s > 0:
            interval = float(getattr(config.settings, "cache_prewarm_interval_s", 1800.0))
            if pw.drip_estimated_full_cycle_s > interval * 1.2:
                set_alert(
                    "drip_behind",
                    "warning",
                    "Cache-vedligehold kan ikke følge med",
                    f"Drip-refresh estimerer {pw.drip_estimated_full_cycle_s/60:.0f} min pr. rotation "
                    f"vs. {interval/60:.0f} min interval. Cache opdateres for langsomt.",
                )
            else:
                clear_alert("drip_behind")
    except Exception:  # noqa: BLE001
        pass


def _check_stale_pct() -> None:
    try:
        from app.core.endpoint_cache import get_cache
        stats = get_cache().stats()
        sl = stats.get("staleness", {})
        pct = sl.get("stale_pct", 0.0)
        if pct and pct > 50.0:
            set_alert(
                "high_stale",
                "warning",
                "Mange stale cache-entries",
                f"{pct:.0f}% af endpoints er stale (ældre end TTL). "
                "Overvej at justere cache_prewarm_interval_s.",
            )
        else:
            clear_alert("high_stale")
    except Exception:  # noqa: BLE001
        pass
