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

from app.core import config
from app.core.exceptions import IseApiError
from app.core.metrics import CIRCUIT_STATE, ISE_REQUEST_DURATION, ISE_REQUESTS, ISE_RETRIES
from app.ise.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)


class IseClient:
    """Async wrapper around the Cisco ISE 3.4 REST APIs (ERS + Open API).

    Reads connection settings from `app.core.config.settings` at init time,
    so recreate the client after settings changes.
    """

    def __init__(self) -> None:
        s = config.settings
        max_conn = int(getattr(s, "ise_max_connections", 10))
        self._http = httpx.AsyncClient(
            base_url=s.ise_base_url.rstrip("/"),
            auth=(s.ise_username, s.ise_password),
            verify=s.ise_verify_tls,
            timeout=s.ise_timeout,
            # Explicit connection limits prevent ISE connection-reset errors under load.
            # ISE ERS accepts ~5-10 simultaneous connections per client.
            limits=httpx.Limits(
                max_connections=max_conn,
                max_keepalive_connections=max(1, max_conn // 2),
            ),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        self._retry_attempts = int(getattr(s, "ise_retry_attempts", 3))
        self._cb = CircuitBreaker(
            failure_threshold=int(getattr(s, "ise_cb_failure_threshold", 5)),
            recovery_timeout=float(getattr(s, "ise_cb_recovery_timeout_s", 60.0)),
        )
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
            self._cb.record_failure()
            _cb_state_map = {"closed": 0, "half_open": 1, "open": 2}
            CIRCUIT_STATE.set(_cb_state_map.get(self._cb.state, 0))
            logger.error("ISE transport error on %s %s: %s", method, path, exc)
            raise IseApiError(0, f"transport error: {exc}") from exc

        ISE_REQUEST_DURATION.observe(time.perf_counter() - _t0)
        self._cb.record_success()
        CIRCUIT_STATE.set(0)

        if response.status_code >= 400:
            message = response.text
            payload: Any = response.text
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
