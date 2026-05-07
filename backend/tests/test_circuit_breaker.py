"""Unit tests for CircuitBreaker.

Ingen ISE-forbindelser — tester state-maskinen direkte.
"""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from app.ise.circuit_breaker import CLOSED, HALF_OPEN, OPEN, CircuitBreaker


def make_cb(threshold: int = 3, recovery: float = 60.0) -> CircuitBreaker:
    return CircuitBreaker(failure_threshold=threshold, recovery_timeout=recovery)


# ------------------------------------------------------------------ #
# CLOSED state                                                         #
# ------------------------------------------------------------------ #

def test_starts_closed():
    cb = make_cb()
    assert cb.state == CLOSED
    assert not cb.is_open()


def test_success_keeps_closed():
    cb = make_cb()
    cb.record_success()
    cb.record_success()
    assert cb.state == CLOSED


def test_failures_below_threshold_stay_closed():
    cb = make_cb(threshold=3)
    cb.record_failure()
    cb.record_failure()
    assert cb.state == CLOSED
    assert not cb.is_open()


# ------------------------------------------------------------------ #
# OPEN state                                                           #
# ------------------------------------------------------------------ #

def test_trips_open_at_threshold():
    cb = make_cb(threshold=3)
    for _ in range(3):
        cb.record_failure()
    assert cb.state == OPEN
    assert cb.is_open()


def test_open_blocks_immediately():
    cb = make_cb(threshold=1)
    cb.record_failure()
    assert cb.is_open()


def test_success_resets_failure_count():
    cb = make_cb(threshold=3)
    cb.record_failure()
    cb.record_failure()
    cb.record_success()  # Reset
    cb.record_failure()  # Starter forfra
    assert cb.state == CLOSED  # Endnu ikke nået threshold


# ------------------------------------------------------------------ #
# HALF_OPEN state                                                      #
# ------------------------------------------------------------------ #

def _advance_time(cb: CircuitBreaker, seconds: float = 120.0):
    """Patch time.time() i circuit_breaker-modulet til at returnere
    opened_at + seconds, så recovery-vinduet simuleres uden rigtig sleep."""
    return patch(
        "app.ise.circuit_breaker.time",
        **{"time.return_value": cb._opened_at + seconds},
    )


def test_transitions_to_half_open_after_recovery():
    cb = make_cb(threshold=1)
    cb.record_failure()
    assert cb.state == OPEN

    with _advance_time(cb):
        assert not cb.is_open()  # Første kald efter recovery → HALF_OPEN
    assert cb.state == HALF_OPEN


def test_half_open_blocks_concurrent_requests():
    cb = make_cb(threshold=1)
    cb.record_failure()

    with _advance_time(cb):
        cb.is_open()  # Første kald → HALF_OPEN, returnerer False
        # Efterfølgende kald i HALF_OPEN → blokeret
        assert cb.is_open()
        assert cb.is_open()


def test_half_open_probe_success_closes():
    cb = make_cb(threshold=1)
    cb.record_failure()

    with _advance_time(cb):
        cb.is_open()  # Transition til HALF_OPEN

    cb.record_success()
    assert cb.state == CLOSED
    assert not cb.is_open()


def test_half_open_probe_failure_reopens():
    cb = make_cb(threshold=1)
    cb.record_failure()

    with _advance_time(cb):
        cb.is_open()  # Transition til HALF_OPEN

    cb.record_failure()  # Probe fejler
    assert cb.state == OPEN
    assert cb.is_open()


# ------------------------------------------------------------------ #
# Stats                                                                #
# ------------------------------------------------------------------ #

def test_stats_contains_all_fields():
    cb = make_cb(threshold=5, recovery=30.0)
    s = cb.stats()
    assert s["state"] == CLOSED
    assert s["failure_count"] == 0
    assert s["failure_threshold"] == 5
    assert s["recovery_timeout_s"] == 30.0
    assert s["recovery_remaining_s"] == 0.0


def test_stats_remaining_decreases_when_open():
    cb = make_cb(threshold=1, recovery=60.0)
    cb.record_failure()
    s = cb.stats()
    assert s["state"] == OPEN
    assert 0 < s["recovery_remaining_s"] <= 60.0
