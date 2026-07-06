"""Tests for policy condition matching — evaluator-funktioner og PolicyService.

Dækker: alle _eval_operator-typer, IdentityGroup-hierarki, _get_ep_value,
_collect_radius_attrs, _condition_summary, match_endpoint (ingen match,
simpelt match, AND/OR-blokke, catch-all default, Radius-skip).
Ingen ISE-netværkskald — policy_api-kald mockes.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.policy_service import (
    PolicyService,
    _collect_radius_attrs,
    _condition_summary,
    _eval_condition,
    _eval_identity_group,
    _eval_operator,
    _get_ep_value,
)
from app.services import policy_service as _ps_mod


@pytest.fixture(autouse=True)
def _clear_policy_cache():
    """Ryd den modul-globale policy-cache (SWR) før/efter hver test, så mockede
    policy_api-returns ikke lækker på tværs af tests via _ps_cache/_rules_cache."""
    _ps_mod.invalidate_policy_cache()
    yield
    _ps_mod.invalidate_policy_cache()


# ------------------------------------------------------------------ #
# Helpers                                                              #
# ------------------------------------------------------------------ #

def make_service() -> PolicyService:
    return PolicyService(MagicMock())


def _attr_cond(
    dictionary: str,
    attribute: str,
    operator: str,
    value: str,
) -> dict:
    return {
        "conditionType": "ConditionAttributes",
        "dictionaryName": dictionary,
        "attributeName": attribute,
        "operator": operator,
        "attributeValue": value,
    }


def _and_block(*children) -> dict:
    return {"conditionType": "ConditionAndBlock", "children": list(children)}


def _or_block(*children) -> dict:
    return {"conditionType": "ConditionOrBlock", "children": list(children)}


def _ref_cond(name: str = "SharedCondition") -> dict:
    return {"conditionType": "ConditionReference", "name": name}


def _rule(rule_id: str, rank: int, cond: dict | None, profiles: list[str], state: str = "enabled") -> dict:
    return {
        "rule": {"id": rule_id, "name": f"Rule-{rule_id}", "rank": rank, "state": state, "condition": cond},
        "profile": profiles,
    }


def _ps(ps_id: str = "ps-1") -> dict:
    return {"id": ps_id, "name": "Test PS", "rank": 0, "state": "enabled", "serviceName": "Default"}


# ------------------------------------------------------------------ #
# _eval_operator                                                       #
# ------------------------------------------------------------------ #

@pytest.mark.parametrize("op,ep_val,rule_val,expected", [
    ("equals",      "printer",   "printer",   True),
    ("equals",      "Printer",   "printer",   True),   # case-insensitive
    ("equals",      "camera",    "printer",   False),
    ("notEquals",   "camera",    "printer",   True),
    ("notEquals",   "printer",   "printer",   False),
    ("contains",    "ap-floor2", "floor",     True),
    ("contains",    "ap-floor2", "FLOOR",     True),   # case-insensitive
    ("contains",    "ap-lobby",  "floor",     False),
    ("notContains", "ap-lobby",  "floor",     True),
    ("startsWith",  "ADM-Apple", "ADM",       True),
    ("startsWith",  "ADM-Apple", "adm",       True),   # case-insensitive
    ("startsWith",  "ADM-Apple", "Apple",     False),
    ("endsWith",    "iPhone-SE", "SE",        True),
    ("endsWith",    "iPhone-SE", "se",        True),   # case-insensitive
    ("endsWith",    "iPhone-SE", "Pro",       False),
    ("matches",     "AA:BB:CC",  "AA:.*",     True),
    ("matches",     "AA:BB:CC",  "ZZ:.*",     False),
    ("matches",     "test",      "[invalid",  False),  # ugyldig regex → False
    ("unknown_op",  "any",       "value",     False),  # ukendt operator → False
])
def test_eval_operator(op, ep_val, rule_val, expected):
    assert _eval_operator(op, ep_val, rule_val) is expected


# ------------------------------------------------------------------ #
# _eval_identity_group                                                 #
# ------------------------------------------------------------------ #

@pytest.mark.parametrize("ep_val,op,rule_val,expected", [
    # Nøjagtig match
    ("endpoint identity groups:profiled", "equals", "endpoint identity groups:profiled", True),
    # Hierarkisk: ep er descendant
    ("endpoint identity groups:profiled:apple-iphone", "equals", "endpoint identity groups:profiled", True),
    # Kortnavns-fallback: ep har ikke ISE-prefix
    ("apple-iphone", "equals", "endpoint identity groups:profiled:apple-iphone", True),
    # Ingen match
    ("endpoint identity groups:unknown", "equals", "endpoint identity groups:profiled", False),
    # notEquals returnerer invers
    ("endpoint identity groups:profiled", "notEquals", "endpoint identity groups:profiled", False),
    ("endpoint identity groups:other", "notEquals", "endpoint identity groups:profiled", True),
    # Other operators delegerer til _eval_operator
    ("endpoint identity groups:ADM", "contains", "adm", True),
])
def test_eval_identity_group(ep_val, op, rule_val, expected):
    assert _eval_identity_group(ep_val, op, rule_val) is expected


# ------------------------------------------------------------------ #
# _get_ep_value                                                        #
# ------------------------------------------------------------------ #

def test_get_ep_value_endpoint_attr():
    ep = {"owner": "netops", "endpoint_type": "Printer"}
    assert _get_ep_value(ep, "EndPoints", "Owner") == "netops"
    assert _get_ep_value(ep, "EndPoints", "Type") == "printer"  # lowercased


def test_get_ep_value_unknown_endpoint_attr_returns_none():
    ep = {}
    assert _get_ep_value(ep, "EndPoints", "NonExistentField") is None


def test_get_ep_value_identity_group():
    ep = {"group_name": "ADM-Apple-iPhone"}
    assert _get_ep_value(ep, "IdentityGroup", "Name") == "adm-apple-iphone"


def test_get_ep_value_radius_provided():
    ep = {"radius_attrs": {"NAS-Port-Type": "Wireless-802.11"}}
    assert _get_ep_value(ep, "Radius", "NAS-Port-Type") == "Wireless-802.11"


def test_get_ep_value_radius_missing_returns_none():
    ep = {}
    assert _get_ep_value(ep, "Radius", "NAS-Port-Type") is None


def test_get_ep_value_unknown_dictionary_returns_none():
    ep = {}
    assert _get_ep_value(ep, "Network", "SomeAttr") is None


# ------------------------------------------------------------------ #
# _collect_radius_attrs                                                #
# ------------------------------------------------------------------ #

def test_collect_radius_attrs_single():
    cond = _attr_cond("Radius", "NAS-Port-Type", "equals", "Wireless-802.11")
    assert _collect_radius_attrs(cond) == {"NAS-Port-Type"}


def test_collect_radius_attrs_non_radius():
    cond = _attr_cond("EndPoints", "Owner", "equals", "netops")
    assert _collect_radius_attrs(cond) == set()


def test_collect_radius_attrs_nested_and():
    cond = _and_block(
        _attr_cond("Radius", "NAS-Port-Type", "equals", "Wireless-802.11"),
        _attr_cond("EndPoints", "Owner", "equals", "netops"),
        _attr_cond("Radius", "Called-Station-SSID", "contains", "corp"),
    )
    assert _collect_radius_attrs(cond) == {"NAS-Port-Type", "Called-Station-SSID"}


def test_collect_radius_attrs_none():
    assert _collect_radius_attrs(None) == set()


# ------------------------------------------------------------------ #
# _condition_summary                                                   #
# ------------------------------------------------------------------ #

def test_condition_summary_none():
    assert _condition_summary(None) == "—"


def test_condition_summary_attr():
    cond = _attr_cond("EndPoints", "Owner", "equals", "netops")
    summary = _condition_summary(cond)
    assert "EndPoints.Owner" in summary
    assert "netops" in summary


def test_condition_summary_reference():
    cond = _ref_cond("MySharedCond")
    assert "MySharedCond" in _condition_summary(cond)


def test_condition_summary_and_block():
    cond = _and_block(
        _attr_cond("EndPoints", "Owner", "equals", "a"),
        _attr_cond("EndPoints", "Type", "equals", "b"),
    )
    summary = _condition_summary(cond)
    assert "AND" in summary


# ------------------------------------------------------------------ #
# _eval_condition                                                      #
# ------------------------------------------------------------------ #

def test_eval_condition_none_returns_true():
    ok, details = _eval_condition(None, {})
    assert ok is True
    assert details == []


def test_eval_condition_simple_match():
    cond = _attr_cond("EndPoints", "Owner", "equals", "netops")
    ok, details = _eval_condition(cond, {"owner": "netops"})
    assert ok is True
    assert len(details) == 1
    assert details[0].matched is True


def test_eval_condition_simple_no_match():
    cond = _attr_cond("EndPoints", "Owner", "equals", "netops")
    ok, details = _eval_condition(cond, {"owner": "marketing"})
    assert ok is False
    assert details[0].matched is False


def test_eval_condition_and_block_all_match():
    cond = _and_block(
        _attr_cond("EndPoints", "Owner", "equals", "netops"),
        _attr_cond("EndPoints", "Type", "equals", "printer"),
    )
    ep = {"owner": "netops", "endpoint_type": "Printer"}
    ok, _ = _eval_condition(cond, ep)
    assert ok is True


def test_eval_condition_and_block_one_fails():
    cond = _and_block(
        _attr_cond("EndPoints", "Owner", "equals", "netops"),
        _attr_cond("EndPoints", "Type", "equals", "printer"),
    )
    ep = {"owner": "netops", "endpoint_type": "Camera"}
    ok, _ = _eval_condition(cond, ep)
    assert ok is False


def test_eval_condition_or_block_one_matches():
    cond = _or_block(
        _attr_cond("EndPoints", "Owner", "equals", "netops"),
        _attr_cond("EndPoints", "Owner", "equals", "itops"),
    )
    ep = {"owner": "itops"}
    ok, _ = _eval_condition(cond, ep)
    assert ok is True


def test_eval_condition_or_block_none_match():
    cond = _or_block(
        _attr_cond("EndPoints", "Owner", "equals", "netops"),
        _attr_cond("EndPoints", "Owner", "equals", "itops"),
    )
    ep = {"owner": "marketing"}
    ok, _ = _eval_condition(cond, ep)
    assert ok is False


def test_eval_condition_reference_skipped():
    cond = _ref_cond("SharedCond")
    ok, details = _eval_condition(cond, {})
    assert ok is True
    assert details[0].skipped is True


def test_eval_condition_radius_skipped_when_missing():
    cond = _attr_cond("Radius", "NAS-Port-Type", "equals", "Wireless-802.11")
    ok, details = _eval_condition(cond, {})  # ingen radius_attrs
    assert ok is True  # benefit of doubt
    assert details[0].skipped is True


# ------------------------------------------------------------------ #
# PolicyService.match_endpoint                                         #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_match_endpoint_no_rules():
    """match_endpoint returnerer no_rules=True når policy sættet er tomt."""
    svc = make_service()

    with patch("app.services.policy_service.policy_api") as mock_api:
        mock_api.get_policy_set = AsyncMock(return_value=_ps())
        mock_api.list_authorization_rules = AsyncMock(return_value=[])
        result = await svc.match_endpoint("ps-1", {"owner": "netops"})

    assert result.no_rules is True


@pytest.mark.asyncio
async def test_match_endpoint_first_rule_matches():
    """match_endpoint returnerer første matchende regel."""
    svc = make_service()
    rules = [
        _rule("r1", 0, _attr_cond("EndPoints", "Owner", "equals", "netops"), ["Allow-Printers"]),
        _rule("r2", 1, _attr_cond("EndPoints", "Owner", "equals", "itops"), ["Allow-Cameras"]),
    ]

    with patch("app.services.policy_service.policy_api") as mock_api:
        mock_api.get_policy_set = AsyncMock(return_value=_ps())
        mock_api.list_authorization_rules = AsyncMock(return_value=rules)
        result = await svc.match_endpoint("ps-1", {"owner": "netops"})

    assert result.matched_rule_name == "Rule-r1"
    assert "Allow-Printers" in result.profiles


@pytest.mark.asyncio
async def test_match_endpoint_no_rule_matches():
    """match_endpoint returnerer intet match når ingen regler matcher."""
    svc = make_service()
    rules = [
        _rule("r1", 0, _attr_cond("EndPoints", "Owner", "equals", "netops"), ["Allow-Printers"]),
    ]

    with patch("app.services.policy_service.policy_api") as mock_api:
        mock_api.get_policy_set = AsyncMock(return_value=_ps())
        mock_api.list_authorization_rules = AsyncMock(return_value=rules)
        result = await svc.match_endpoint("ps-1", {"owner": "marketing"})

    assert result.matched_rule_name is None


@pytest.mark.asyncio
async def test_match_endpoint_catch_all_default():
    """match_endpoint matcher catch-all regel (ingen condition) som fallback."""
    svc = make_service()
    rules = [
        _rule("r1", 0, _attr_cond("EndPoints", "Owner", "equals", "netops"), ["Allow-Printers"]),
        _rule("default", 999, None, ["DenyAll"]),  # catch-all
    ]

    with patch("app.services.policy_service.policy_api") as mock_api:
        mock_api.get_policy_set = AsyncMock(return_value=_ps())
        mock_api.list_authorization_rules = AsyncMock(return_value=rules)
        result = await svc.match_endpoint("ps-1", {"owner": "marketing"})

    assert result.matched_rule_name == "Rule-default"


@pytest.mark.asyncio
async def test_match_endpoint_radius_needed_reported():
    """match_endpoint rapporterer radius_attrs_needed for uopfyldte Radius-betingelser."""
    svc = make_service()
    rules = [
        _rule("r1", 0, _attr_cond("Radius", "NAS-Port-Type", "equals", "Wireless-802.11"), ["Allow"]),
    ]

    with patch("app.services.policy_service.policy_api") as mock_api:
        mock_api.get_policy_set = AsyncMock(return_value=_ps())
        mock_api.list_authorization_rules = AsyncMock(return_value=rules)
        result = await svc.match_endpoint("ps-1", {})  # ingen radius_attrs

    assert "NAS-Port-Type" in result.radius_attrs_needed


@pytest.mark.asyncio
async def test_match_endpoint_disabled_rule_skipped():
    """match_endpoint springer disabled-regler over."""
    svc = make_service()
    rules = [
        _rule("r1", 0, _attr_cond("EndPoints", "Owner", "equals", "netops"), ["Allow"], state="disabled"),
        _rule("r2", 1, _attr_cond("EndPoints", "Owner", "equals", "netops"), ["Fallback"], state="enabled"),
    ]

    with patch("app.services.policy_service.policy_api") as mock_api:
        mock_api.get_policy_set = AsyncMock(return_value=_ps())
        mock_api.list_authorization_rules = AsyncMock(return_value=rules)
        result = await svc.match_endpoint("ps-1", {"owner": "netops"})

    assert result.matched_rule_name == "Rule-r2"
