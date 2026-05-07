"""Unit tests for _SlidingWindow rate limiter.

Tester vindues-logikken direkte — ingen HTTP-stack involveret.
"""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from app.core.rate_limiter import _SlidingWindow


def make_window() -> _SlidingWindow:
    return _SlidingWindow()


# ------------------------------------------------------------------ #
# Grundlæggende allow / block                                          #
# ------------------------------------------------------------------ #

def test_allows_requests_within_limit():
    w = make_window()
    for _ in range(10):
        assert w.is_allowed("ip-1", limit=10)


def test_blocks_request_over_limit():
    w = make_window()
    for _ in range(5):
        w.is_allowed("ip-2", limit=5)
    # Den 6. request skal blokeres
    assert not w.is_allowed("ip-2", limit=5)


def test_different_ips_are_independent():
    w = make_window()
    for _ in range(5):
        w.is_allowed("ip-a", limit=5)
    # ip-a er opbrugt, men ip-b er upåvirket
    assert not w.is_allowed("ip-a", limit=5)
    assert w.is_allowed("ip-b", limit=5)


# ------------------------------------------------------------------ #
# Vindue-udløb                                                         #
# ------------------------------------------------------------------ #

def test_requests_allowed_after_window_expires():
    """Timestamps ældre end 60s fjernes — grænsen nulstilles."""
    w = make_window()
    now = time.time()
    # Simuler 5 requests der er 61s gamle
    for i in range(5):
        w._buckets["ip-c"].append(now - 61.0 - i)

    # Vinduet er tomt (alle for gamle) — ny request skal tillades
    assert w.is_allowed("ip-c", limit=5)


# ------------------------------------------------------------------ #
# Remaining-counter                                                    #
# ------------------------------------------------------------------ #

def test_remaining_decrements():
    w = make_window()
    assert w.remaining("ip-d", limit=10) == 10
    w.is_allowed("ip-d", limit=10)
    assert w.remaining("ip-d", limit=10) == 9
    w.is_allowed("ip-d", limit=10)
    assert w.remaining("ip-d", limit=10) == 8


def test_remaining_zero_when_at_limit():
    w = make_window()
    for _ in range(5):
        w.is_allowed("ip-e", limit=5)
    assert w.remaining("ip-e", limit=5) == 0
