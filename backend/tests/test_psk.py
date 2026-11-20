"""Regressionstests for PSK-validering (BUGS.md P-4, P-5).

- P-4: WPA-passphrase skal være 8-63 printbare ASCII-tegn uanset politik,
       og en nøgle valideres også når PSK_Mode ikke sendes med.
- P-5: en ugyldig nøgle på gæstesiden giver 422 med forklaring, ikke 500.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

import pytest
from pydantic import ValidationError

from app.schemas.settings import PskPolicy
from app.services._endpoint_helpers import _validate_psk
from app.services.settings_service import (
    generate_psk_key,
    psk_policy_hint,
    validate_psk_key,
)

POLICY = PskPolicy(min_length=8)


def test_accepts_valid_key():
    assert validate_psk_key("Abcdefgh12", POLICY) == []


def test_accepts_exactly_63_chars():
    assert validate_psk_key("a" * 63, POLICY) == []


def test_rejects_64_chars():
    errs = validate_psk_key("a" * 64, POLICY)
    assert any("63" in e for e in errs)


@pytest.mark.parametrize("key", ["nøglenøgle", "abcdefghæ", "abc\tdefghij", "abcdefgh€"])
def test_rejects_non_ascii_and_control_chars(key):
    assert validate_psk_key(key, POLICY)


def test_policy_min_length_capped_at_63():
    with pytest.raises(ValidationError):
        PskPolicy(min_length=64)


def test_generated_keys_are_valid_wpa():
    p = PskPolicy(min_length=63, require_uppercase=True, require_numbers=True, require_special=True)
    for _ in range(20):
        key = generate_psk_key(p).key
        assert validate_psk_key(key, p) == [], key


def test_key_without_mode_is_still_validated():
    """En nøgle sendt uden PSK_Mode må ikke slippe uden om valideringen."""
    with pytest.raises(ValueError):
        _validate_psk({"PSK_Key": "x" * 70})


def test_key_with_mode_false_is_not_validated():
    _validate_psk({"PSK_Mode": "false", "PSK_Key": "kort"})


def test_hint_mentions_limits():
    hint = psk_policy_hint(PskPolicy(min_length=10, require_numbers=True))
    assert "10-63" in hint and "tal" in hint


# ── P-6: nøgleskift træder i kraft (CoA-Disconnect) ───────────────────────────

from unittest.mock import AsyncMock, MagicMock, patch  # noqa: E402

from app.core import config  # noqa: E402
from app.schemas.endpoint import CustomAttrs, EndpointDetail, EndpointUpdate  # noqa: E402
from app.services._endpoint_helpers import _psk_changed  # noqa: E402
from app.services.endpoint_service import EndpointService  # noqa: E402


def test_psk_changed_detects_new_key():
    before = {"psk_key": "GammelNøgle1", "psk_mode": True}
    assert _psk_changed({"PSK_Key": "psk=NyNoegle123"}, before)


def test_psk_changed_ignores_same_key_with_prefix():
    before = {"psk_key": "SammeNoegle1", "psk_mode": True}
    assert not _psk_changed({"PSK_Key": "psk=SammeNoegle1", "PSK_Mode": "true"}, before)


def test_psk_changed_detects_mode_toggle():
    assert _psk_changed({"PSK_Mode": "false"}, {"psk_key": "x", "psk_mode": True})


def test_psk_changed_false_without_snapshot():
    assert not _psk_changed({"PSK_Key": "NyNoegle123"}, None)


async def _run_update(ca: CustomAttrs, before_key: str, setting: bool):
    with patch("app.core.config.settings.ise_api_type", "ers"):
        svc = EndpointService(MagicMock())
    svc._ensure_ca_definitions = AsyncMock()
    svc.endpoints.update = AsyncMock()
    svc.get_endpoint = AsyncMock(return_value=EndpointDetail(
        id="ep", name="AA:BB:CC:DD:EE:01", mac="AA:BB:CC:DD:EE:01",
        psk_mode=True, psk_key=before_key, active_status="Aktiv"))
    svc.coa_disconnect = AsyncMock(return_value=(True, "AA:BB:CC:DD:EE:01", "ok"))
    cache = MagicMock()
    with (
        patch("app.services.endpoint_service.audit_store") as audit,
        patch("app.services.endpoint_service.get_cache", return_value=cache),
        patch("asyncio.create_task"),
        patch.object(config.settings, "psk_disconnect_on_change", setting),
    ):
        audit.record = AsyncMock()
        res = await svc.update_endpoint("ep", EndpointUpdate(custom_attributes=ca))
    return svc, res


@pytest.mark.asyncio
async def test_key_change_sends_disconnect():
    svc, res = await _run_update(CustomAttrs(PSK_Mode="true", PSK_Key="NyNoegle123"), "Gammel123", True)
    svc.coa_disconnect.assert_awaited_once_with("ep")
    assert res["psk_changed"] and res["psk_coa"]["ok"]


@pytest.mark.asyncio
async def test_unchanged_key_sends_nothing():
    svc, res = await _run_update(CustomAttrs(PSK_Mode="true", PSK_Key="Gammel123"), "Gammel123", True)
    svc.coa_disconnect.assert_not_awaited()
    assert not res["psk_changed"]


@pytest.mark.asyncio
async def test_disconnect_can_be_disabled():
    svc, res = await _run_update(CustomAttrs(PSK_Mode="true", PSK_Key="NyNoegle123"), "Gammel123", False)
    svc.coa_disconnect.assert_not_awaited()
    assert res["psk_changed"] and res["psk_coa"] is None
