"""Tests for ISE client retry + connection-limit behaviour.

Bruger unittest.mock til at patche httpx.AsyncClient.request direkte —
ingen rigtig netværksforbindelse.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.core.exceptions import IseApiError
from app.ise.client import IseClient


def _make_response(status: int, body: dict | None = None) -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.content = b"{}" if body is not None else b""
    r.text = str(body or "")
    r.json.return_value = body or {}
    return r


# ------------------------------------------------------------------ #
# Retry på transport-fejl                                              #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_retry_succeeds_on_third_attempt():
    """Klient retrier ved ConnectError og returnerer data ved 3. forsøg."""
    client = IseClient()
    call_count = 0

    async def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise httpx.ConnectError("connection refused")
        return _make_response(200, {"ok": True})

    try:
        with patch.object(client._http, "request", AsyncMock(side_effect=side_effect)):
            result = await client.get("/ers/config/endpoint")
        assert result == {"ok": True}
        assert call_count == 3
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_retry_exhausted_raises_ise_api_error():
    """Når alle retry-forsøg er opbrugt, hæves IseApiError."""
    client = IseClient()

    async def always_fail(*args, **kwargs):
        raise httpx.ConnectError("connection refused")

    try:
        with patch.object(client._http, "request", AsyncMock(side_effect=always_fail)):
            with pytest.raises(IseApiError) as exc_info:
                await client.get("/ers/config/endpoint")
        assert "transport error" in str(exc_info.value).lower()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_timeout_triggers_retry():
    """ReadTimeout (subtype af TransportError) udløser retry."""
    client = IseClient()
    call_count = 0

    async def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise httpx.ReadTimeout("read timeout")
        return _make_response(200, {"data": "ok"})

    try:
        with patch.object(client._http, "request", AsyncMock(side_effect=side_effect)):
            result = await client.get("/ers/test")
        assert result == {"data": "ok"}
        assert call_count == 2
    finally:
        await client.close()


# ------------------------------------------------------------------ #
# Ingen retry på HTTP 4xx / 5xx                                        #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_no_retry_on_404():
    """404 HTTP-svar retries IKKE — ISE-fejlen propageres med det samme."""
    client = IseClient()
    call_count = 0

    async def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _make_response(
            404,
            {"ERSResponse": {"messages": [{"title": "endpoint not found"}]}},
        )

    try:
        with patch.object(client._http, "request", AsyncMock(side_effect=side_effect)):
            with pytest.raises(IseApiError) as exc_info:
                await client.get("/ers/config/endpoint/nonexistent")
        assert exc_info.value.status_code == 404
        assert call_count == 1  # præcis ét forsøg
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_no_retry_on_500():
    """ISE 500 retries IKKE — kun transport-fejl retries."""
    client = IseClient()
    call_count = 0

    async def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _make_response(500, {"error": "internal"})

    try:
        with patch.object(client._http, "request", AsyncMock(side_effect=side_effect)):
            with pytest.raises(IseApiError) as exc_info:
                await client.post("/ers/config/endpoint", json={})
        assert exc_info.value.status_code == 500
        assert call_count == 1
    finally:
        await client.close()


# ------------------------------------------------------------------ #
# httpx.Limits + retry-konfiguration                                   #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_retry_attempts_configured():
    """IseClient læser ise_retry_attempts fra settings (default 3)."""
    client = IseClient()
    try:
        assert client._retry_attempts >= 1
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_connection_pool_is_async_client():
    """IseClient bruger httpx.AsyncClient (ikke sync Client)."""
    client = IseClient()
    try:
        assert isinstance(client._http, httpx.AsyncClient)
    finally:
        await client.close()
