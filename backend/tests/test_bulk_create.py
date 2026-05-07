"""Tests for EndpointService.bulk_create.

Dækker: alle 4 outcome-typer (succeeded/skipped/overwritten/failed),
mixed outcomes, cache-invalidation kun ved succeeded/overwritten,
semaphore-concurrency, og CA-definition pre-ensure logik.
Ingen ISE-forbindelser — create_endpoint og _overwrite_existing er mocks.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import IseApiError
from app.schemas.endpoint import BulkCreateRequest, CreateEndpointRequest
from app.services.endpoint_service import EndpointService


# ------------------------------------------------------------------ #
# Helpers                                                              #
# ------------------------------------------------------------------ #

def make_service() -> EndpointService:
    """EndpointService med mock ISE-klient — ingen netværkskald."""
    with patch("app.core.config.settings.ise_api_type", "ers"):
        return EndpointService(MagicMock())


def make_req(macs: list[str], overwrite: bool = False, **item_kwargs) -> BulkCreateRequest:
    return BulkCreateRequest(
        items=[CreateEndpointRequest(mac=m, **item_kwargs) for m in macs],
        overwrite=overwrite,
    )


def err(status: int, msg: str = "error") -> IseApiError:
    return IseApiError(status, msg)


MACS = [f"AA:BB:CC:DD:EE:{i:02X}" for i in range(16)]


# ------------------------------------------------------------------ #
# Alle succeeds                                                        #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_bulk_all_succeed():
    svc = make_service()
    svc.create_endpoint = AsyncMock()

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        result = await svc.bulk_create(make_req([MACS[0], MACS[1]]))

    assert set(result.succeeded) == {MACS[0], MACS[1]}
    assert result.skipped == []
    assert result.overwritten == []
    assert result.failed == []
    mock_cache.invalidate_all.assert_called_once()


# ------------------------------------------------------------------ #
# Skip ved conflict, overwrite=False                                   #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_bulk_skip_on_409_no_overwrite():
    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=err(409, "Endpoint already exists"))

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        result = await svc.bulk_create(make_req([MACS[2]], overwrite=False))

    assert result.skipped == [MACS[2]]
    assert result.succeeded == []
    assert result.failed == []
    mock_cache.invalidate_all.assert_not_called()


@pytest.mark.asyncio
async def test_bulk_skip_on_500_already_exists():
    # ISE ERS 3.4 returnerer 500 med "already exists" i stedet for 409
    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=err(500, "already exists in the system"))

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        result = await svc.bulk_create(make_req([MACS[3]], overwrite=False))

    assert result.skipped == [MACS[3]]
    mock_cache.invalidate_all.assert_not_called()


# ------------------------------------------------------------------ #
# Overwrite ved conflict                                               #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_bulk_overwrite_on_conflict():
    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=err(409, "conflict"))
    svc._overwrite_existing = AsyncMock()

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        result = await svc.bulk_create(make_req([MACS[4]], overwrite=True))

    assert result.overwritten == [MACS[4]]
    assert result.succeeded == []
    assert result.skipped == []
    assert result.failed == []
    svc._overwrite_existing.assert_awaited_once()
    mock_cache.invalidate_all.assert_called_once()


@pytest.mark.asyncio
async def test_bulk_overwrite_fails_with_ise_error():
    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=err(409, "conflict"))
    svc._overwrite_existing = AsyncMock(side_effect=err(500, "update failed"))

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        result = await svc.bulk_create(make_req([MACS[5]], overwrite=True))

    assert len(result.failed) == 1
    assert result.failed[0].mac == MACS[5]
    assert "overwrite fejlede" in result.failed[0].error
    mock_cache.invalidate_all.assert_not_called()


@pytest.mark.asyncio
async def test_bulk_overwrite_fails_not_found():
    # _overwrite_existing kaster ValueError når MAC ikke kan slås op
    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=err(409, "conflict"))
    svc._overwrite_existing = AsyncMock(side_effect=ValueError("MAC ikke fundet"))

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        result = await svc.bulk_create(make_req([MACS[6]], overwrite=True))

    assert result.failed[0].mac == MACS[6]
    assert "ikke fundet" in result.failed[0].error
    mock_cache.invalidate_all.assert_not_called()


# ------------------------------------------------------------------ #
# Non-conflict fejl → failed                                           #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_bulk_non_conflict_error_goes_to_failed():
    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=err(400, "bad MAC format"))

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        result = await svc.bulk_create(make_req([MACS[7]]))

    assert result.failed[0].mac == MACS[7]
    assert result.skipped == []
    mock_cache.invalidate_all.assert_not_called()


# ------------------------------------------------------------------ #
# Mixed outcomes                                                       #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_bulk_mixed_outcomes():
    # overwrite=True: 1 success, 1 overwritten, 1 overwrite→failed, 1 non-conflict→failed
    mac_ok = MACS[8]
    mac_ow = MACS[9]
    mac_ow_fail = MACS[10]
    mac_err = MACS[11]

    async def create_side(item, **_kw):
        m = item.mac
        if m == mac_ok:
            return
        elif m in (mac_ow, mac_ow_fail):
            raise IseApiError(409, "conflict")
        else:
            raise IseApiError(400, "bad request")

    async def overwrite_side(item, **_kw):
        if item.mac == mac_ow:
            return
        raise IseApiError(500, "overwrite error")

    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=create_side)
    svc._overwrite_existing = AsyncMock(side_effect=overwrite_side)

    req = BulkCreateRequest(
        items=[CreateEndpointRequest(mac=m) for m in [mac_ok, mac_ow, mac_ow_fail, mac_err]],
        overwrite=True,
    )
    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        result = await svc.bulk_create(req)

    assert set(result.succeeded) == {mac_ok}
    assert set(result.overwritten) == {mac_ow}
    assert len(result.failed) == 2
    assert {f.mac for f in result.failed} == {mac_ow_fail, mac_err}
    assert result.skipped == []
    mock_cache.invalidate_all.assert_called_once()


# ------------------------------------------------------------------ #
# Cache invalidation kun ved succeeded/overwritten                    #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_bulk_no_cache_invalidation_when_all_skipped():
    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=err(409, "conflict"))

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        await svc.bulk_create(make_req([MACS[12], MACS[13]], overwrite=False))

    mock_cache.invalidate_all.assert_not_called()


@pytest.mark.asyncio
async def test_bulk_no_cache_invalidation_when_all_failed():
    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=err(500, "server error"))

    with patch("app.services.endpoint_service.get_cache") as mock_get_cache:
        mock_cache = MagicMock()
        mock_get_cache.return_value = mock_cache
        await svc.bulk_create(make_req([MACS[14]]))

    mock_cache.invalidate_all.assert_not_called()


# ------------------------------------------------------------------ #
# Semaphore begrænser concurrency                                      #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_bulk_semaphore_caps_concurrency():
    max_active = 0
    active = 0
    concurrency_limit = 2

    async def slow_create(item, **_kw):
        nonlocal max_active, active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.02)
        active -= 1

    svc = make_service()
    svc.create_endpoint = AsyncMock(side_effect=slow_create)

    macs = [f"BB:BB:BB:BB:BB:{i:02X}" for i in range(6)]
    with patch("app.services.endpoint_service.get_cache"):
        with patch("app.core.config.settings.bulk_create_concurrency", concurrency_limit):
            await svc.bulk_create(make_req(macs))

    assert max_active <= concurrency_limit


# ------------------------------------------------------------------ #
# CA-definition pre-ensure                                             #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_bulk_ensures_ca_definitions_when_custom_attrs_present():
    svc = make_service()
    svc.create_endpoint = AsyncMock()
    svc._ensure_ca_definitions = AsyncMock()

    req = BulkCreateRequest(
        items=[CreateEndpointRequest(mac=MACS[15], custom_attributes={"HyperVisionRoles": "netops"})],
        overwrite=False,
    )
    with patch("app.services.endpoint_service.get_cache"):
        await svc.bulk_create(req)

    svc._ensure_ca_definitions.assert_awaited_once()


@pytest.mark.asyncio
async def test_bulk_skips_ca_ensure_when_no_custom_attrs():
    svc = make_service()
    svc.create_endpoint = AsyncMock()
    svc._ensure_ca_definitions = AsyncMock()

    with patch("app.services.endpoint_service.get_cache"):
        await svc.bulk_create(make_req([MACS[0]]))

    svc._ensure_ca_definitions.assert_not_called()
