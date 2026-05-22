"""Tests for EndpointService CRUD — create, get, update, delete.

Dækker: create succes, CA-auto-stamp, 409-konflikt, get via cache, get 404,
update succes + cache-invalidation, update 404, delete succes + cache-invalidation,
delete 404. Ingen ISE-netværkskald — repository-metoder og cache mockes.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import IseApiError
from app.schemas.endpoint import (
    CreateEndpointRequest,
    EndpointDetail,
    EndpointUpdate,
)
from app.services.endpoint_service import EndpointService


# ------------------------------------------------------------------ #
# Helpers                                                              #
# ------------------------------------------------------------------ #

def make_service() -> EndpointService:
    """EndpointService med mock ISE-klient — ingen netværkskald."""
    with patch("app.core.config.settings.ise_api_type", "ers"):
        svc = EndpointService(MagicMock())
    svc._ensure_ca_definitions = AsyncMock()
    return svc


def make_detail(endpoint_id: str = "ep-001", mac: str = "AA:BB:CC:DD:EE:01") -> EndpointDetail:
    return EndpointDetail(id=endpoint_id, name=mac, mac=mac)


def _mock_cache(cache_return: EndpointDetail | None = None, from_disk: bool = False):
    """Returnér (patcher, mock_cache) til brug i `with` blok."""
    mock_cache = MagicMock()
    if cache_return is not None:
        mock_cache.get_detail = AsyncMock(return_value=cache_return)
    mock_cache.is_from_disk.return_value = from_disk
    mock_cache.invalidate_detail = MagicMock()
    mock_cache.invalidate_all = MagicMock()
    return mock_cache


def _err(status: int, msg: str = "error") -> IseApiError:
    return IseApiError(status, msg)


# ------------------------------------------------------------------ #
# create_endpoint                                                      #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_create_endpoint_success():
    """create_endpoint returnerer ny ISE-id fra repository."""
    svc = make_service()
    svc.endpoints.create = AsyncMock(return_value="new-id-123")

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache") as mock_gc,
    ):
        mock_audit.record = AsyncMock()
        mock_audit.record_endpoint_create_time = MagicMock()
        mock_gc.return_value = _mock_cache()
        new_id = await svc.create_endpoint(CreateEndpointRequest(mac="AA:BB:CC:DD:EE:01"))

    assert new_id == "new-id-123"
    svc.endpoints.create.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_endpoint_stamps_hidden_attr():
    """create_endpoint sætter altid HypervisionHidden=true i custom attributes."""
    svc = make_service()
    captured_ca: dict = {}

    async def capture_create(**kwargs):
        captured_ca.update(kwargs.get("custom_attributes", {}))
        return "ep-stamped"

    svc.endpoints.create = capture_create

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache") as mock_gc,
    ):
        mock_audit.record = AsyncMock()
        mock_audit.record_endpoint_create_time = MagicMock()
        mock_gc.return_value = _mock_cache()
        await svc.create_endpoint(CreateEndpointRequest(mac="AA:BB:CC:DD:EE:02"))

    assert "HypervisionISEPortal" in captured_ca
    assert captured_ca["HypervisionISEPortal"] == "true"


@pytest.mark.asyncio
async def test_create_endpoint_auto_tags_non_admin():
    """create_endpoint sætter HypervisionRoles=username når auto_tag_username er sat."""
    svc = make_service()
    captured_ca: dict = {}

    async def capture_create(**kwargs):
        captured_ca.update(kwargs.get("custom_attributes", {}))
        return "ep-tagged"

    svc.endpoints.create = capture_create

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache") as mock_gc,
    ):
        mock_audit.record = AsyncMock()
        mock_audit.record_endpoint_create_time = MagicMock()
        mock_gc.return_value = _mock_cache()
        await svc.create_endpoint(
            CreateEndpointRequest(mac="AA:BB:CC:DD:EE:03"),
            auto_tag_username="netops_user",
        )

    assert captured_ca.get("HypervisionRoles") == "netops_user"


@pytest.mark.asyncio
async def test_create_endpoint_ensures_ca_definitions():
    """create_endpoint kalder _ensure_ca_definitions præcis én gang."""
    svc = make_service()
    svc.endpoints.create = AsyncMock(return_value="ep-x")

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache") as mock_gc,
    ):
        mock_audit.record = AsyncMock()
        mock_audit.record_endpoint_create_time = MagicMock()
        mock_gc.return_value = _mock_cache()
        await svc.create_endpoint(CreateEndpointRequest(mac="AA:BB:CC:DD:EE:04"))

    svc._ensure_ca_definitions.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_endpoint_propagates_ise_error():
    """IseApiError fra repository propageres uændret til kalderen."""
    svc = make_service()
    svc.endpoints.create = AsyncMock(side_effect=_err(400, "Invalid MAC format"))

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache") as mock_gc,
    ):
        mock_audit.record = AsyncMock()
        mock_gc.return_value = _mock_cache()
        with pytest.raises(IseApiError) as exc_info:
            await svc.create_endpoint(CreateEndpointRequest(mac="INVALID"))

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_endpoint_409_propagates():
    """409-konflikt fra ISE propageres som IseApiError(409)."""
    svc = make_service()
    svc.endpoints.create = AsyncMock(side_effect=_err(409, "Endpoint already exists"))

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache") as mock_gc,
    ):
        mock_audit.record = AsyncMock()
        mock_gc.return_value = _mock_cache()
        with pytest.raises(IseApiError) as exc_info:
            await svc.create_endpoint(CreateEndpointRequest(mac="AA:BB:CC:DD:EE:05"))

    assert exc_info.value.status_code == 409


# ------------------------------------------------------------------ #
# get_endpoint                                                         #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_get_endpoint_returns_cached_detail():
    """get_endpoint returnerer EndpointDetail fra cache uden ISE-kald."""
    svc = make_service()
    cached = make_detail("ep-cached", "AA:BB:CC:DD:EE:06")
    mock_cache = _mock_cache(cache_return=cached)

    with patch("app.services.endpoint_service.get_cache", return_value=mock_cache):
        result = await svc.get_endpoint("ep-cached")

    assert result.id == "ep-cached"
    assert result.mac == "AA:BB:CC:DD:EE:06"
    mock_cache.get_detail.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_endpoint_sets_cache_stale_flag():
    """get_endpoint sætter cache_stale=True når entry er fra disk."""
    svc = make_service()
    cached = make_detail("ep-disk")
    mock_cache = _mock_cache(cache_return=cached, from_disk=True)

    with patch("app.services.endpoint_service.get_cache", return_value=mock_cache):
        result = await svc.get_endpoint("ep-disk")

    assert result.cache_stale is True


@pytest.mark.asyncio
async def test_get_endpoint_raises_404_for_out_of_scope():
    """get_endpoint kaster IseApiError(404) når endpoint ikke er synligt for roller."""
    svc = make_service()
    # Endpoint har roles=["admin_only"], bruger har roles=["netops"]
    cached = make_detail("ep-hidden")
    cached = cached.model_copy(update={"roles": ["admin_only"]})
    mock_cache = _mock_cache(cache_return=cached)

    with patch("app.services.endpoint_service.get_cache", return_value=mock_cache):
        with pytest.raises(IseApiError) as exc_info:
            await svc.get_endpoint("ep-hidden", effective_roles=["netops"])

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_get_endpoint_masks_psk_for_non_editor():
    """get_endpoint maskerer PSK_Key til '****' når is_psk_editor=False."""
    svc = make_service()
    cached = make_detail("ep-psk")
    cached = cached.model_copy(update={"psk_key": "secret123", "psk_mode": True})
    mock_cache = _mock_cache(cache_return=cached)

    with patch("app.services.endpoint_service.get_cache", return_value=mock_cache):
        result = await svc.get_endpoint("ep-psk", is_psk_editor=False)

    assert result.psk_key == "****"


@pytest.mark.asyncio
async def test_get_endpoint_reveals_psk_for_editor():
    """get_endpoint returnerer rå PSK_Key når is_psk_editor=True."""
    svc = make_service()
    cached = make_detail("ep-psk2")
    cached = cached.model_copy(update={"psk_key": "secret123", "psk_mode": True})
    mock_cache = _mock_cache(cache_return=cached)

    with patch("app.services.endpoint_service.get_cache", return_value=mock_cache):
        result = await svc.get_endpoint("ep-psk2", is_psk_editor=True)

    assert result.psk_key == "secret123"


# ------------------------------------------------------------------ #
# update_endpoint                                                      #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_update_endpoint_success_invalidates_cache():
    """update_endpoint opdaterer ISE og invaliderer cache for endpoint."""
    svc = make_service()
    svc.endpoints.update = AsyncMock()
    svc.get_endpoint = AsyncMock(return_value=make_detail("ep-upd"))
    mock_cache = _mock_cache()

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache", return_value=mock_cache),
        patch("asyncio.create_task"),  # undgår baggrunds-audit-task i test
    ):
        mock_audit.record = AsyncMock()
        await svc.update_endpoint("ep-upd", EndpointUpdate(description="ny beskrivelse"))

    svc.endpoints.update.assert_awaited_once()
    mock_cache.invalidate_detail.assert_called_once_with("ep-upd")


@pytest.mark.asyncio
async def test_update_endpoint_propagates_ise_error():
    """IseApiError fra repository.update propageres uændret."""
    svc = make_service()
    svc.endpoints.update = AsyncMock(side_effect=_err(404, "Not found"))
    svc.get_endpoint = AsyncMock(return_value=make_detail("ep-missing"))
    mock_cache = _mock_cache()

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache", return_value=mock_cache),
    ):
        mock_audit.record = AsyncMock()
        with pytest.raises(IseApiError) as exc_info:
            await svc.update_endpoint("ep-missing", EndpointUpdate(description="x"))

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_endpoint_calls_ensure_ca_definitions():
    """update_endpoint kalder _ensure_ca_definitions præcis én gang."""
    svc = make_service()
    svc.endpoints.update = AsyncMock()
    svc.get_endpoint = AsyncMock(return_value=make_detail("ep-ca"))
    mock_cache = _mock_cache()

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache", return_value=mock_cache),
        patch("asyncio.create_task"),
    ):
        mock_audit.record = AsyncMock()
        await svc.update_endpoint("ep-ca", EndpointUpdate(description="test"))

    svc._ensure_ca_definitions.assert_awaited_once()


# ------------------------------------------------------------------ #
# delete_endpoint                                                      #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_delete_endpoint_success_invalidates_cache():
    """delete_endpoint sletter fra ISE og invaliderer cache for endpoint."""
    svc = make_service()
    svc.endpoints.delete = AsyncMock()
    svc.get_endpoint = AsyncMock(return_value=make_detail("ep-del"))
    mock_cache = _mock_cache()

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache", return_value=mock_cache),
    ):
        mock_audit.record = AsyncMock()
        await svc.delete_endpoint("ep-del")

    svc.endpoints.delete.assert_awaited_once_with("ep-del")
    mock_cache.invalidate_detail.assert_called_once_with("ep-del")


@pytest.mark.asyncio
async def test_delete_endpoint_records_audit_with_before_state():
    """delete_endpoint optager audit-record med before-state snapshot."""
    svc = make_service()
    svc.endpoints.delete = AsyncMock()
    before_detail = make_detail("ep-del2", "AA:BB:CC:DD:EE:07")
    svc.get_endpoint = AsyncMock(return_value=before_detail)
    mock_cache = _mock_cache()
    recorded: list[dict] = []

    async def capture_record(action, entity, entity_id, **kwargs):
        recorded.append({"action": action, "before": kwargs.get("before")})

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache", return_value=mock_cache),
    ):
        mock_audit.record = capture_record
        await svc.delete_endpoint("ep-del2")

    assert len(recorded) == 1
    assert recorded[0]["action"] == "deleted"
    assert recorded[0]["before"] is not None
    assert recorded[0]["before"]["mac"] == "AA:BB:CC:DD:EE:07"


@pytest.mark.asyncio
async def test_delete_endpoint_proceeds_when_snapshot_fails():
    """delete_endpoint gennemfører sletning selv om before-snapshot fejler."""
    svc = make_service()
    svc.endpoints.delete = AsyncMock()
    svc.get_endpoint = AsyncMock(side_effect=_err(404, "Already gone"))
    mock_cache = _mock_cache()

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache", return_value=mock_cache),
    ):
        mock_audit.record = AsyncMock()
        # Skal ikke kaste trods snapshot-fejl
        await svc.delete_endpoint("ep-gone")

    svc.endpoints.delete.assert_awaited_once_with("ep-gone")


@pytest.mark.asyncio
async def test_delete_endpoint_propagates_ise_error():
    """IseApiError fra repository.delete propageres uændret."""
    svc = make_service()
    svc.endpoints.delete = AsyncMock(side_effect=_err(404, "Not found"))
    svc.get_endpoint = AsyncMock(return_value=make_detail("ep-404"))
    mock_cache = _mock_cache()

    with (
        patch("app.services.endpoint_service.audit_store") as mock_audit,
        patch("app.services.endpoint_service.get_cache", return_value=mock_cache),
    ):
        mock_audit.record = AsyncMock()
        with pytest.raises(IseApiError) as exc_info:
            await svc.delete_endpoint("ep-404")

    assert exc_info.value.status_code == 404
