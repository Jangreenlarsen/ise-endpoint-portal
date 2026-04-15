from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core import config
from app.core.exceptions import IseApiError

logger = logging.getLogger(__name__)


class IseClient:
    """Async wrapper around the Cisco ISE 3.4 REST APIs (ERS + Open API).

    Reads connection settings from `app.core.config.settings` at init time,
    so recreate the client after settings changes.
    """

    def __init__(self) -> None:
        s = config.settings
        self._http = httpx.AsyncClient(
            base_url=s.ise_base_url.rstrip("/"),
            auth=(s.ise_username, s.ise_password),
            verify=s.ise_verify_tls,
            timeout=s.ise_timeout,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
    ) -> Any:
        logger.info("ISE %s %s params=%s", method, path, params)
        try:
            response = await self._http.request(method, path, params=params, json=json)
        except httpx.HTTPError as exc:
            logger.error("ISE transport error on %s %s: %s", method, path, exc)
            raise IseApiError(0, f"transport error: {exc}") from exc

        if response.status_code >= 400:
            message = response.text
            payload: Any = response.text
            try:
                payload = response.json()
                message = (
                    payload.get("ERSResponse", {})
                    .get("messages", [{}])[0]
                    .get("title", message)
                )
            except Exception:
                pass
            logger.warning(
                "ISE %s %s -> %s: %s", method, path, response.status_code, message
            )
            raise IseApiError(response.status_code, message, payload)

        if response.status_code == 204 or not response.content:
            return None
        return response.json()

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
