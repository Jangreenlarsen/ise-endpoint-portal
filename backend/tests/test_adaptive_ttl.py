# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Tests for aktivitetsstyret cache-TTL (EndpointCache.effective_ttl + portal_activity)."""
import time

import pytest

from app.core import config, portal_activity
from app.core.endpoint_cache import ADAPTIVE_TTL_RAMP_WINDOWS, EndpointCache


def _restore_activity():
    portal_activity._last_activity_at = time.time()


def test_touch_role_gating():
    portal_activity._last_activity_at = 0.0
    portal_activity.touch("registrant")          # ikke en portal-rolle
    assert portal_activity._last_activity_at == 0.0
    portal_activity.touch("viewer")              # portal-rolle → opdaterer
    assert portal_activity._last_activity_at > 0.0
    _restore_activity()


def test_touch_none_always_updates():
    portal_activity._last_activity_at = 0.0
    portal_activity.touch(None)
    assert portal_activity._last_activity_at > 0.0
    _restore_activity()


def test_idle_seconds_monotonic():
    portal_activity._last_activity_at = time.time() - 100
    idle = portal_activity.idle_seconds()
    assert 99 <= idle <= 102
    _restore_activity()


def test_effective_ttl_ramps_between_base_and_max():
    c = EndpointCache()
    base = c._ttl()
    enabled = getattr(config.settings, "adaptive_ttl_enabled", True)
    max_ttl = float(getattr(config.settings, "adaptive_ttl_max_seconds", 3600.0))
    if not enabled or max_ttl <= base:
        pytest.skip("adaptiv TTL deaktiveret eller max<=base i denne config")
    ramp = base * ADAPTIVE_TTL_RAMP_WINDOWS
    now = time.time()

    # Aktiv (idle ~0) → base
    portal_activity._last_activity_at = now
    assert abs(c.effective_ttl() - base) < 1.0

    # Fuldt idle (>= ramp) → max
    portal_activity._last_activity_at = now - ramp - 10
    assert abs(c.effective_ttl() - max_ttl) < 1.0

    # Halvvejs → midtpunkt (med lille tolerance for tid der går)
    portal_activity._last_activity_at = now - ramp / 2
    mid = base + 0.5 * (max_ttl - base)
    assert abs(c.effective_ttl() - mid) < (max_ttl - base) * 0.02

    # Aldrig over max
    portal_activity._last_activity_at = now - ramp * 100
    assert c.effective_ttl() <= max_ttl + 1e-6
    _restore_activity()


def test_effective_ttl_disabled_returns_base(monkeypatch):
    c = EndpointCache()
    base = c._ttl()
    monkeypatch.setattr(config.settings, "adaptive_ttl_enabled", False, raising=False)
    portal_activity._last_activity_at = time.time() - 999999  # meget idle
    assert c.effective_ttl() == base
    _restore_activity()


def test_effective_ttl_max_le_base_returns_base(monkeypatch):
    c = EndpointCache()
    base = c._ttl()
    monkeypatch.setattr(config.settings, "adaptive_ttl_enabled", True, raising=False)
    monkeypatch.setattr(config.settings, "adaptive_ttl_max_seconds", base, raising=False)
    portal_activity._last_activity_at = time.time() - 999999
    assert c.effective_ttl() == base
    _restore_activity()


def test_effective_ttl_equals_base_when_active():
    c = EndpointCache()
    base = c._ttl()
    portal_activity._last_activity_at = time.time()  # aktiv nu → base
    assert abs(c.effective_ttl() - base) < 1.0
    _restore_activity()


def test_base_ttl_unaffected_by_idle():
    # _ttl() (freshness/UI) må IKKE ramme op ved idle — kun effective_ttl() gør.
    c = EndpointCache()
    base = c._ttl()
    portal_activity._last_activity_at = time.time() - 999999
    assert c._ttl() == base
    _restore_activity()


def test_effective_scan_interval_ramps_between_base_and_max():
    from app.services.cache_prewarm import PrewarmWorker

    w = PrewarmWorker()
    base = 1800.0
    enabled = getattr(config.settings, "adaptive_ttl_enabled", True)
    max_iv = float(getattr(config.settings, "adaptive_scan_max_seconds", 14400.0))
    if not enabled or max_iv <= base:
        pytest.skip("scan-adaptation deaktiveret eller max<=base i denne config")
    ttl = float(getattr(config.settings, "cache_ttl_seconds", 300.0))
    ramp = ttl * 10.0
    now = time.time()

    portal_activity._last_activity_at = now                    # aktiv → base
    assert abs(w._effective_scan_interval(base) - base) < 1.0
    portal_activity._last_activity_at = now - ramp - 10        # fuldt idle → max
    assert abs(w._effective_scan_interval(base) - max_iv) < 1.0
    portal_activity._last_activity_at = now - ramp * 100       # aldrig over max
    assert w._effective_scan_interval(base) <= max_iv + 1e-6
    _restore_activity()


def test_effective_scan_interval_disabled_returns_base(monkeypatch):
    from app.services.cache_prewarm import PrewarmWorker

    w = PrewarmWorker()
    monkeypatch.setattr(config.settings, "adaptive_ttl_enabled", False, raising=False)
    portal_activity._last_activity_at = time.time() - 999999
    assert w._effective_scan_interval(1800.0) == 1800.0
    _restore_activity()
