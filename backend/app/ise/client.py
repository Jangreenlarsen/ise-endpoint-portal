# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core import audit_store, config
from app.core.exceptions import IseApiError
from app.core.metrics import CIRCUIT_STATE, ISE_REQUEST_DURATION, ISE_REQUESTS, ISE_RETRIES
from app.ise.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)


class IseClient:
    """Async wrapper around the Cisco ISE 3.5 REST APIs (ERS + Open API).

    Reads connection settings from `app.core.config.settings` at init time,
    so recreate the client after settings changes.
    """

    def __init__(self) -> None:
        s = config.settings
        max_conn = int(getattr(s, "ise_max_connections", 15))
        use_http2 = getattr(s, "ise_http2", True)

        def _make_client(http2: bool) -> httpx.AsyncClient:
            return httpx.AsyncClient(
                base_url=s.ise_base_url.rstrip("/"),
                auth=(s.ise_username, s.ise_password),
                verify=s.ise_ca_bundle or s.ise_verify_tls,
                timeout=s.ise_timeout,
                http2=http2,
                # Explicit connection limits prevent ISE connection-reset errors under load.
                # With HTTP/2, a single connection multiplexes many requests, so the pool
                # needs fewer entries. HTTP/1.1 fallback still benefits from a larger pool.
                limits=httpx.Limits(
                    max_connections=max_conn,
                    max_keepalive_connections=max(1, max_conn // 2),
                ),
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                },
            )

        if use_http2:
            try:
                self._http = _make_client(http2=True)
                logger.info("ISE HTTP klient initialiseret med HTTP/2 (max_connections=%d)", max_conn)
            except ImportError:
                # h2-pakken er ikke installeret endnu — fald tilbage til HTTP/1.1.
                # Installeres automatisk ved næste OTA-pull (pip install -e .).
                self._http = _make_client(http2=False)
                logger.warning(
                    "h2-pakken mangler — HTTP/2 deaktiveret, kører HTTP/1.1. "
                    "Installer ved at køre OTA-opdatering eller manuelt: "
                    "venv/bin/pip install 'httpx[http2]'"
                )
        else:
            self._http = _make_client(http2=False)
            logger.info("ISE HTTP klient initialiseret med HTTP/1.1 (max_connections=%d)", max_conn)
        self._retry_attempts = int(getattr(s, "ise_retry_attempts", 3))
        self._cb = CircuitBreaker(
            failure_threshold=int(getattr(s, "ise_cb_failure_threshold", 5)),
            recovery_timeout=float(getattr(s, "ise_cb_recovery_timeout_s", 60.0)),
        )
        self._consecutive_401s = 0
        self._auth_locked_since: float | None = None  # tid for første 401 i nuværende sekvens
        CIRCUIT_STATE.set(0)  # start closed

    async def close(self) -> None:
        await self._http.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Any = None,
        json: Any | None = None,
        return_response: bool = False,
    ) -> Any:
        """Make an ISE request. If `return_response` is True, return (data, response).

        Transport-level errors (timeout, connection reset) are retried up to
        `ise_retry_attempts` times with exponential back-off (1s → 8s).
        HTTP 4xx/5xx are NOT retried — they are passed through as IseApiError.
        """
        logger.info("ISE %s %s params=%s", method, path, params)

        if self._cb.is_open():
            CIRCUIT_STATE.set(2)
            raise IseApiError(
                503,
                "Circuit breaker open — ISE er utilgængelig, prøv igen om "
                f"{self._cb.stats()['recovery_remaining_s']:.0f}s",
            )

        _t0 = time.perf_counter()

        def _on_retry(retry_state: Any) -> None:
            ISE_RETRIES.inc()
            logger.warning(
                "ISE retry #%d: %s %s", retry_state.attempt_number, method, path
            )

        try:
            async for attempt in AsyncRetrying(
                retry=retry_if_exception_type(httpx.TransportError),
                stop=stop_after_attempt(max(1, self._retry_attempts)),
                wait=wait_exponential(multiplier=1, min=1, max=8),
                before_sleep=_on_retry,
                reraise=True,
            ):
                with attempt:
                    response = await self._http.request(
                        method, path, params=params, json=json
                    )
                    if attempt.retry_state.attempt_number > 1:
                        logger.info(
                            "ISE retry #%d succeeded: %s %s",
                            attempt.retry_state.attempt_number, method, path,
                        )
        except httpx.TransportError as exc:
            ISE_REQUEST_DURATION.observe(time.perf_counter() - _t0)
            ISE_REQUESTS.labels(method=method, outcome="error").inc()
            _prev_cb_state = self._cb.state
            self._cb.record_failure()
            _cb_state_map = {"closed": 0, "half_open": 1, "open": 2}
            CIRCUIT_STATE.set(_cb_state_map.get(self._cb.state, 0))
            if self._cb.state == "open" and _prev_cb_state != "open":
                audit_store.record_sync(
                    "ise_circuit_open", "system", None,
                    after={"failures": self._cb.stats()["failure_count"],
                           "recovery_timeout_s": self._cb.stats()["recovery_timeout_s"],
                           "last_error": str(exc)[:200]},
                )
            logger.error("ISE transport error on %s %s: %s", method, path, exc)
            raise IseApiError(0, f"transport error: {exc}") from exc

        ISE_REQUEST_DURATION.observe(time.perf_counter() - _t0)

        # Parse error body before branching so it's available in all paths.
        message = response.text
        payload: Any = response.text
        if response.status_code >= 400:
            try:
                payload = response.json()
                # ERS format: {"ERSResponse": {"messages": [{"title": "..."}]}}
                ers_title = (
                    payload.get("ERSResponse", {})
                    .get("messages", [{}])[0]
                    .get("title", "")
                )
                # Open API format: {"message": "...", "code": 400}
                open_api_msg = payload.get("message", "")
                message = ers_title or open_api_msg or message
            except Exception:
                pass

        if response.status_code == 401:
            # Auth failure — treat as circuit-breaker failure so repeated 401s
            # eventually open the circuit and stop hammering ISE with bad credentials.
            # ISE disables accounts after N consecutive failed logins (default 3-5)
            # and a blind CB that resets on any HTTP response would let the pre-warm
            # send hundreds of auth failures before the account gets locked out.
            self._consecutive_401s += 1
            if self._auth_locked_since is None:
                self._auth_locked_since = time.time()
            self._cb.record_failure()
            _cb_state_map = {"closed": 0, "half_open": 1, "open": 2}
            CIRCUIT_STATE.set(_cb_state_map.get(self._cb.state, 0))
            if self._consecutive_401s == 1:
                logger.warning(
                    "ISE auth fejl (401) på %s %s — kontroller brugernavn/password i portal settings",
                    method, path,
                )
            else:
                logger.error(
                    "ISE auth fejl (401) %d gange i træk — ISE-kontoen kan være LÅST. "
                    "Tjek ISE > Administration > Admin Access > Authentication og "
                    "genaktiver kontoen hvis den er deaktiveret. "
                    "Circuit breaker failures: %d/%d",
                    self._consecutive_401s,
                    self._cb.stats()["failure_count"],
                    self._cb.stats()["failure_threshold"],
                )
            ISE_REQUESTS.labels(method=method, outcome="4xx").inc()
            raise IseApiError(response.status_code, message, payload)

        # Non-401 response (2xx, other 4xx, 5xx) — mark CB success and reset 401 counter.
        _prev_cb_state = self._cb.state
        self._cb.record_success()
        self._consecutive_401s = 0
        self._auth_locked_since = None
        if _prev_cb_state != "closed":
            audit_store.record_sync(
                "ise_circuit_closed", "system", None,
                after={"recovered_from": _prev_cb_state},
            )
        CIRCUIT_STATE.set(0)

        if response.status_code >= 400:
            logger.warning(
                "ISE %s %s -> %s: %s", method, path, response.status_code, message
            )
            status_bucket = "4xx" if response.status_code < 500 else "5xx"
            ISE_REQUESTS.labels(method=method, outcome=status_bucket).inc()
            raise IseApiError(response.status_code, message, payload)

        ISE_REQUESTS.labels(method=method, outcome="2xx").inc()
        data = None if response.status_code == 204 or not response.content else response.json()
        if return_response:
            return data, response
        return data

    async def get(self, path: str, **kwargs: Any) -> Any:
        return await self.request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Any:
        return await self.request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs: Any) -> Any:
        return await self.request("PUT", path, **kwargs)

    async def delete(self, path: str, **kwargs: Any) -> Any:
        return await self.request("DELETE", path, **kwargs)

    def auth_status(self) -> dict:
        """Returnér ISE auth-status baseret på seneste 401-sekvens.

        status: "ok" | "warning" (1-2 401s) | "locked" (3+ 401s i træk)
        """
        n = self._consecutive_401s
        since = self._auth_locked_since
        if n == 0:
            return {"status": "ok", "consecutive_401s": 0, "locked_since": None}
        if n < 3:
            return {"status": "warning", "consecutive_401s": n, "locked_since": since}
        return {"status": "locked", "consecutive_401s": n, "locked_since": since}


_client: IseClient | None = None


def get_ise_client() -> IseClient:
    global _client
    if _client is None:
        _client = IseClient()
    return _client


async def close_ise_client() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None
    # Reset custom attribute definitions flag so they're re-checked with new client
    from app.services import endpoint_service
    endpoint_service._ca_definitions_ensured = False
