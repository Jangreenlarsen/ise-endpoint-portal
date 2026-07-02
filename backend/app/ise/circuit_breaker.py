# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Circuit-breaker for ISE API calls.

States:
  CLOSED   — normal; alle requests tillades. Fejltæller nulstilles ved succes.
  OPEN     — ISE er nede; requests fast-failer øjeblikkeligt med IseApiError(503).
             Efter `recovery_timeout` sekunder skifter til HALF_OPEN.
  HALF_OPEN — én probe-request tillades igennem. Succes → CLOSED, fejl → OPEN igen.

Asyncio-sikkerhed: alle state-opdateringer er synkrone og sker kun i
cooperative yield-points (ingen awaits internt), så der er ingen race-betingelser
i ét uvicorn-worker.
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

CLOSED = "closed"
OPEN = "open"
HALF_OPEN = "half_open"


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 60.0) -> None:
        self._threshold = max(1, failure_threshold)
        self._recovery_timeout = max(1.0, recovery_timeout)
        self._state = CLOSED
        self._failures = 0
        self._opened_at: float = 0.0

    # ------------------------------------------------------------------ #
    # Public interface                                                     #
    # ------------------------------------------------------------------ #

    @property
    def state(self) -> str:
        return self._state

    def is_open(self) -> bool:
        """Return True if this request should be blocked (circuit is open).

        Side-effect: transitions OPEN → HALF_OPEN after recovery_timeout
        so the *first* caller after the timeout gets False (allowed through
        as a probe), while subsequent callers still get True (blocked) until
        the probe result is recorded via record_success / record_failure.
        """
        if self._state == CLOSED:
            return False
        if self._state == HALF_OPEN:
            # Probe already in flight — block all others until resolved.
            return True
        # OPEN: check if recovery window has elapsed.
        if time.time() - self._opened_at >= self._recovery_timeout:
            self._state = HALF_OPEN
            logger.info("circuit breaker: HALF_OPEN — sending probe to ISE")
            return False  # Let this request through as the probe.
        return True

    def record_success(self) -> None:
        """Call after a successful ISE request."""
        if self._state != CLOSED:
            logger.info("circuit breaker: CLOSED (ISE recovered)")
        self._state = CLOSED
        self._failures = 0
        self._opened_at = 0.0

    def record_failure(self) -> None:
        """Call after all retry attempts have been exhausted for a request."""
        self._failures += 1
        if self._failures >= self._threshold or self._state == HALF_OPEN:
            previous = self._state
            self._state = OPEN
            self._opened_at = time.time()
            if previous == HALF_OPEN:
                logger.warning("circuit breaker: OPEN (half-open probe failed)")
            elif previous != OPEN:
                # Log kun ved første CLOSED→OPEN transition.
                # Samtidige requests der rammer threshold+1,+2… logger ikke igen
                # så open_count i log-analysen svarer til faktiske CB-åbninger.
                logger.warning(
                    "circuit breaker: OPEN after %d consecutive failures — "
                    "fast-failing ISE requests for %.0fs",
                    self._failures, self._recovery_timeout,
                )

    def stats(self) -> dict[str, object]:
        remaining = max(
            0.0, self._recovery_timeout - (time.time() - self._opened_at)
        ) if self._state == OPEN else 0.0
        return {
            "state": self._state,
            "failure_count": self._failures,
            "failure_threshold": self._threshold,
            "recovery_timeout_s": self._recovery_timeout,
            "recovery_remaining_s": round(remaining, 1),
        }
