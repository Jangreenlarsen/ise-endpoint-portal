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
from app.core.tls import build_httpx_verify
from app.ise.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)

_CB_STATE_MAP = {"closed": 0, "half_open": 1, "open": 2}


class IseClient:
    """Async wrapper around the Cisco ISE 3.5 REST APIs (ERS + Open API).

    Reads connection settings from `app.core.config.settings` at init time,
    so recreate the client after settings changes.

    **Læs/skriv-node-split:** når `ise_read_base_url` er sat (og ≠ `ise_base_url`)
    routes GET-kald til den host (typisk Secondary PAN, read-replika), mens
    POST/PUT/DELETE altid går til `ise_base_url` (Primary PAN, autoritativ).
    Hver host har sin egen circuit breaker, så et Secondary-nedbrud ikke blokerer
    skrivning. Fejler/CB-open'er read-hosten, falder GET automatisk tilbage til
    Primary (usynligt for kalderen). Tom read-url ⇒ ét delt klient-objekt og
    uændret enkelt-host-adfærd.
    """

    def __init__(self) -> None:
        s = config.settings
        max_conn = int(getattr(s, "ise_max_connections", 15))
        use_http2 = getattr(s, "ise_http2", True)
        # ISE ERS (Tomcat) lukker idle HTTP-forbindelser typisk efter ~12-15s —
        # observeret ved ReadTimeout-fejl med idle_before≈18s i log (drip_sleep=18s
        # → ISE lukker forbindelsen i mellemtiden). keepalive_expiry=10s sikrer at
        # httpx lukker forbindelser FØR ISE gør det, så stale connections aldrig
        # genbruges og forveksles med ReadTimeout/CB-fejl.
        keepalive_expiry_s = float(getattr(s, "ise_keepalive_expiry_s", 10.0))
        verify = build_httpx_verify(s.ise_ca_bundle, s.ise_verify_tls)

        def _make_client(http2: bool, base_url: str) -> httpx.AsyncClient:
            return httpx.AsyncClient(
                base_url=base_url.rstrip("/"),
                auth=(s.ise_username, s.ise_password),
                verify=verify,
                timeout=s.ise_timeout,
                http2=http2,
                limits=httpx.Limits(
                    max_connections=max_conn,
                    max_keepalive_connections=max(1, max_conn // 2),
                    keepalive_expiry=keepalive_expiry_s,
                ),
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                },
            )

        write_url = s.ise_base_url
        http2_effective = use_http2
        if use_http2:
            try:
                self._http = _make_client(True, write_url)
                logger.info(
                    "ISE HTTP klient initialiseret med HTTP/2 "
                    "(max_connections=%d, keepalive_expiry=%.0fs)",
                    max_conn, keepalive_expiry_s,
                )
            except ImportError:
                http2_effective = False
                self._http = _make_client(False, write_url)
                logger.warning(
                    "h2-pakken mangler — HTTP/2 deaktiveret, kører HTTP/1.1. "
                    "Installer ved at køre OTA-opdatering eller manuelt: "
                    "venv/bin/pip install 'httpx[http2]'"
                )
        else:
            self._http = _make_client(False, write_url)
            logger.info(
                "ISE HTTP klient initialiseret med HTTP/1.1 "
                "(max_connections=%d, keepalive_expiry=%.0fs)",
                max_conn, keepalive_expiry_s,
            )

        # Læs/skriv-split: separat read-klient + CB kun når en distinkt read-host er sat.
        read_url = (getattr(s, "ise_read_base_url", "") or "").strip()
        self._split = bool(read_url) and read_url.rstrip("/") != write_url.rstrip("/")
        if self._split:
            self._http_read = _make_client(http2_effective, read_url)
            logger.info(
                "ISE læs/skriv-split AKTIV: GET→%s (Secondary), skriv→%s (Primary)",
                read_url.rstrip("/"), write_url.rstrip("/"),
            )
        else:
            self._http_read = self._http

        self._retry_attempts = int(getattr(s, "ise_retry_attempts", 3))
        self._cb = CircuitBreaker(
            failure_threshold=int(getattr(s, "ise_cb_failure_threshold", 5)),
            recovery_timeout=float(getattr(s, "ise_cb_recovery_timeout_s", 60.0)),
        )
        # Separat CB for read-hosten, så et Secondary-nedbrud ikke tripper primary-CB
        # (og dermed ikke blokerer skrivning). Uden split deles CB-objektet.
        self._cb_read = (
            CircuitBreaker(
                failure_threshold=int(getattr(s, "ise_cb_failure_threshold", 5)),
                recovery_timeout=float(getattr(s, "ise_cb_recovery_timeout_s", 60.0)),
            )
            if self._split
            else self._cb
        )
        self._consecutive_401s = 0
        self._auth_locked_since: float | None = None  # tid for første 401 i nuværende sekvens
        self._last_request_at: float = 0.0  # til idle-tid-logning
        CIRCUIT_STATE.set(0)  # start closed

    async def close(self) -> None:
        await self._http.aclose()
        if self._http_read is not self._http:
            await self._http_read.aclose()

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

        GET routes til read-hosten når læs/skriv-split er aktiv; alt andet til
        Primary. Fejler/CB-open'er read-hosten (transport-fejl eller CB), falder
        GET automatisk tilbage til Primary. HTTP 4xx/5xx fra ISE er autoritative
        svar og udløser IKKE fallback.

        Transport-level errors (timeout, connection reset) retryes op til
        `ise_retry_attempts` gange med eksponentiel back-off (1s → 8s).
        HTTP 4xx/5xx retryes ikke — de passeres videre som IseApiError.
        """
        is_read = method.upper() == "GET"
        if is_read and self._split:
            try:
                return await self._request_on(
                    self._http_read, self._cb_read, "read",
                    method, path, params=params, json=json,
                    return_response=return_response,
                )
            except IseApiError as exc:
                # Kun host-tilgængeligheds-fejl udløser fallback: 0 = transport,
                # 503 = CB-open. Autoritative ISE-svar (401/4xx/5xx) bobler op.
                if exc.status_code in (0, 503):
                    logger.warning(
                        "ISE læse-host utilgængelig (%s) — fallback til Primary for %s %s",
                        exc.status_code, method, path,
                    )
                    return await self._request_on(
                        self._http, self._cb, "primary",
                        method, path, params=params, json=json,
                        return_response=return_response,
                    )
                raise
        return await self._request_on(
            self._http, self._cb, "primary",
            method, path, params=params, json=json,
            return_response=return_response,
        )

    async def _request_on(
        self,
        client: httpx.AsyncClient,
        cb: CircuitBreaker,
        label: str,
        method: str,
        path: str,
        *,
        params: Any = None,
        json: Any | None = None,
        return_response: bool = False,
    ) -> Any:
        """Udfør ét request mod en bestemt host/CB. Se `request` for routing."""
        _is_primary = cb is self._cb

        # Mål idle-tid siden sidst succesfulde request — nyttigt til diagnose af
        # stale-connection-fejl: lange idle-pauser efterfulgt af transport-fejl
        # indikerer at ISE har lukket forbindelsen i mellemtiden.
        _now = time.time()
        _idle_s = _now - self._last_request_at if self._last_request_at > 0 else 0.0
        if _idle_s > 300:
            logger.info(
                "ISE klient: første request efter %.0fs inaktivitet (%s %s [%s])",
                _idle_s, method, path, label,
            )
        else:
            logger.info("ISE %s %s params=%s [%s]", method, path, params, label)

        if cb.is_open():
            if _is_primary:
                CIRCUIT_STATE.set(2)
            raise IseApiError(
                503,
                f"Circuit breaker open ({label}) — ISE er utilgængelig, prøv igen om "
                f"{cb.stats()['recovery_remaining_s']:.0f}s",
            )

        _t0 = time.perf_counter()

        def _on_retry(retry_state: Any) -> None:
            ISE_RETRIES.inc()
            logger.warning(
                "ISE retry #%d: %s %s [%s]", retry_state.attempt_number, method, path, label
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
                    response = await client.request(
                        method, path, params=params, json=json
                    )
                    if attempt.retry_state.attempt_number > 1:
                        logger.info(
                            "ISE retry #%d succeeded: %s %s [%s]",
                            attempt.retry_state.attempt_number, method, path, label,
                        )
        except httpx.TransportError as exc:
            ISE_REQUEST_DURATION.observe(time.perf_counter() - _t0)
            ISE_REQUESTS.labels(method=method, outcome="error").inc()
            _prev_cb_state = cb.state
            cb.record_failure()
            if _is_primary:
                CIRCUIT_STATE.set(_CB_STATE_MAP.get(cb.state, 0))
            if cb.state == "open" and _prev_cb_state != "open":
                audit_store.record_sync(
                    "ise_circuit_open", "system", None,
                    after={"host": label,
                           "failures": cb.stats()["failure_count"],
                           "recovery_timeout_s": cb.stats()["recovery_timeout_s"],
                           "last_error": str(exc)[:200]},
                )
            # Inkluder exception-type i logning — str(exc) kan være tom for
            # RemoteProtocolError/ConnectionResetError ved server-side close.
            # Idle-tid afslører om fejlen skyldes stale forbindelser.
            logger.error(
                "ISE transport error on %s %s [%s]: %s (%s) [idle_before=%.0fs]",
                method, path, label, exc or "(ingen besked)", type(exc).__name__, _idle_s,
            )
            raise IseApiError(0, f"transport error: {type(exc).__name__}: {exc}") from exc

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
            cb.record_failure()
            if _is_primary:
                CIRCUIT_STATE.set(_CB_STATE_MAP.get(cb.state, 0))
            if self._consecutive_401s == 1:
                logger.warning(
                    "ISE auth fejl (401) på %s %s [%s] — kontroller brugernavn/password i portal settings",
                    method, path, label,
                )
            else:
                logger.error(
                    "ISE auth fejl (401) %d gange i træk — ISE-kontoen kan være LÅST. "
                    "Tjek ISE > Administration > Admin Access > Authentication og "
                    "genaktiver kontoen hvis den er deaktiveret. "
                    "Circuit breaker failures: %d/%d",
                    self._consecutive_401s,
                    cb.stats()["failure_count"],
                    cb.stats()["failure_threshold"],
                )
            ISE_REQUESTS.labels(method=method, outcome="4xx").inc()
            raise IseApiError(response.status_code, message, payload)

        # Non-401 response (2xx, other 4xx, 5xx) — mark CB success and reset 401 counter.
        self._last_request_at = time.time()
        _prev_cb_state = cb.state
        cb.record_success()
        self._consecutive_401s = 0
        self._auth_locked_since = None
        if _prev_cb_state != "closed":
            audit_store.record_sync(
                "ise_circuit_closed", "system", None,
                after={"host": label, "recovered_from": _prev_cb_state},
            )
        if _is_primary:
            CIRCUIT_STATE.set(0)

        if response.status_code >= 400:
            logger.warning(
                "ISE %s %s [%s] -> %s: %s", method, path, label, response.status_code, message
            )
            status_bucket = "4xx" if response.status_code < 500 else "5xx"
            ISE_REQUESTS.labels(method=method, outcome=status_bucket).inc()
            raise IseApiError(response.status_code, message, payload)

        ISE_REQUESTS.labels(method=method, outcome="2xx").inc()
        logger.info("ISE %s %s [%s] -> %d", method, path, label, response.status_code)
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

    def cb_is_open(self) -> bool:
        """True hvis primary-CB er OPEN. Ingen sideeffekt — trigrer ikke OPEN→HALF_OPEN."""
        return self._cb.state == "open"

    def cb_recovery_remaining_s(self) -> float:
        """Sekunder til primary-CB er klar til probe. 0.0 hvis ikke OPEN."""
        return float(self._cb.stats()["recovery_remaining_s"])

    async def ping(self) -> bool:
        """Billig ISE-probe: GET /ers/config/endpointgroup?size=1 mod PRIMARY.
        Opdaterer primary-CB-state som sideeffekt. Returnerer True hvis ISE svarer."""
        try:
            await self._request_on(
                self._http, self._cb, "primary", "GET",
                "/ers/config/endpointgroup", params={"size": "1", "page": "1"},
            )
            return True
        except Exception:
            return False

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
