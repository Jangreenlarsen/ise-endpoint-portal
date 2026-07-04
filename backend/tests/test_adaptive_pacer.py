# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Tests for AdaptivePacer — AIMD ISE-congestion control for drip-loopen."""
from app.services.cache_prewarm import AdaptivePacer


def test_range_defines_clamp_bounds():
    p = AdaptivePacer(range_pct=50, enabled=True)
    assert p.min_factor == 0.5
    assert p.max_factor == 1.5
    assert p.factor == 1.0


def test_additive_increase_on_success():
    p = AdaptivePacer(range_pct=50, enabled=True)
    p.record(True)
    p.record(True)
    assert p.update() == 1.05  # +_INCREASE, uanset antal successer


def test_multiplicative_decrease_on_any_failure():
    p = AdaptivePacer(range_pct=50, enabled=True)
    # Selv med flere successer: én fejl i vinduet → halvér.
    p.record(True)
    p.record(True)
    p.record(False)
    assert abs(p.update() - 0.5) < 1e-9


def test_factor_clamped_to_min():
    p = AdaptivePacer(range_pct=50, enabled=True)
    for _ in range(20):
        p.record(False)
        p.update()
    assert p.factor == 0.5


def test_factor_clamped_to_max():
    p = AdaptivePacer(range_pct=50, enabled=True)
    for _ in range(50):
        p.record(True)
        p.update()
    assert p.factor == 1.5


def test_penalize_halves_and_clamps():
    p = AdaptivePacer(range_pct=50, enabled=True)
    p.factor = 1.5
    p.penalize()
    assert p.factor == 0.75
    for _ in range(10):
        p.penalize()
    assert p.factor == 0.5  # klampet til min


def test_apply_sleep_scales_inversely():
    p = AdaptivePacer(range_pct=50, enabled=True)
    p.factor = 0.5              # langsommere
    assert p.apply_sleep(2.0) == 4.0
    p.factor = 1.5              # hurtigere
    assert abs(p.apply_sleep(3.0) - 2.0) < 1e-9


def test_apply_sleep_has_floor():
    p = AdaptivePacer(range_pct=50, enabled=True)
    p.factor = 1.5
    assert p.apply_sleep(0.5) == 0.5  # gulv _MIN_SLEEP, ikke 0.33


def test_disabled_is_noop():
    p = AdaptivePacer(range_pct=50, enabled=False)
    p.record(False)
    assert p.update() == 1.0
    assert p.apply_sleep(3.0) == 3.0


def test_range_zero_locks_baseline():
    p = AdaptivePacer(range_pct=0, enabled=True)
    assert p.min_factor == 1.0
    assert p.max_factor == 1.0
    p.record(True)
    assert p.update() == 1.0


def test_configure_hot_reload_reclamps_factor():
    p = AdaptivePacer(range_pct=50, enabled=True)
    p.factor = 1.5
    # Skru spændet ned til ±10 % → nuværende factor klampes ind i [0.9, 1.1].
    p.configure(range_pct=10, enabled=True)
    assert p.factor == 1.1
    assert p.min_factor == 0.9 and p.max_factor == 1.1


def test_range_pct_clamped_to_90():
    p = AdaptivePacer(range_pct=200, enabled=True)  # urealistisk høj
    assert abs(p.min_factor - 0.1) < 1e-9  # 1 - 0.9
    assert abs(p.max_factor - 1.9) < 1e-9  # 1 + 0.9
