# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Adaptive Network Control (ANC) via ISE ERS API.

ERS paths:
    GET  /ers/config/ancpolicy                              — list policies
    POST /ers/config/ancendpoint/apply                      — apply (quarantine)
    POST /ers/config/ancendpoint/clear                      — clear quarantine
    GET  /ers/config/ancendpoint?filter=macAddress.EQ.{mac} — check status
    GET  /ers/config/ancendpoint/{id}                       — get policy name

apply and clear return HTTP 204 on success (no body).
ISE maps errors to HTTP 500 with an ERSResponse body.
"""
from __future__ import annotations

import logging

from app.core.exceptions import IseApiError

logger = logging.getLogger(__name__)

_POLICY_PATH = "/ers/config/ancpolicy"
_ENDPOINT_PATH = "/ers/config/ancendpoint"


def _normalize_mac(mac: str) -> str:
    return mac.replace("-", ":").strip().upper()


def _extract_message(exc: IseApiError) -> str:
    payload = getattr(exc, "payload", None)
    if isinstance(payload, dict):
        title = (
            payload.get("ERSResponse", {})
            .get("messages", [{}])[0]
            .get("title", "")
        )
        if title:
            return title
    return str(exc)


async def list_policies(client) -> list[str]:
    """Return all ANC policy names configured in ISE."""
    data = await client.get(_POLICY_PATH, params={"size": 100})
    resources = data.get("SearchResult", {}).get("resources", []) if data else []
    return [r["name"] for r in resources if r.get("name")]


async def apply(client, mac: str, policy_name: str) -> tuple[bool, str]:
    """Apply an ANC policy to an endpoint by MAC. Returns (ok, message)."""
    mac_n = _normalize_mac(mac)
    payload = {
        "OperationAdditionalData": {
            "additionalData": [
                {"name": "macAddress", "value": mac_n},
                {"name": "policyName", "value": policy_name},
            ]
        }
    }
    try:
        await client.post(f"{_ENDPOINT_PATH}/apply", json=payload)
        logger.info("ANC apply ok mac=%s policy=%s", mac_n, policy_name)
        return True, f"ANC policy '{policy_name}' sat på {mac_n}"
    except IseApiError as exc:
        logger.warning("ANC apply failed mac=%s policy=%s: %s", mac_n, policy_name, exc)
        return False, _extract_message(exc)


async def clear(client, mac: str) -> tuple[bool, str]:
    """Clear all ANC policies from an endpoint by MAC. Returns (ok, message)."""
    mac_n = _normalize_mac(mac)
    payload = {
        "OperationAdditionalData": {
            "additionalData": [
                {"name": "macAddress", "value": mac_n},
            ]
        }
    }
    try:
        await client.post(f"{_ENDPOINT_PATH}/clear", json=payload)
        logger.info("ANC clear ok mac=%s", mac_n)
        return True, f"ANC karantæne fjernet fra {mac_n}"
    except IseApiError as exc:
        logger.warning("ANC clear failed mac=%s: %s", mac_n, exc)
        return False, _extract_message(exc)


async def get_endpoint_status(client, mac: str) -> str | None:
    """Return the ANC policy currently applied to the MAC, or None if free.

    Two ISE calls: list (filter by MAC) → detail (get policyName).
    Returns None on any error so callers can treat unknown status gracefully.
    """
    mac_n = _normalize_mac(mac)
    try:
        data = await client.get(
            _ENDPOINT_PATH,
            params={"filter": f"macAddress.EQ.{mac_n}", "size": 1},
        )
        resources = data.get("SearchResult", {}).get("resources", []) if data else []
        if not resources:
            return None
        entry_id = resources[0].get("id", "")
        if not entry_id:
            return None
        detail = await client.get(f"{_ENDPOINT_PATH}/{entry_id}")
        return detail.get("ErsAncEndpoint", {}).get("policyName") if detail else None
    except IseApiError as exc:
        logger.debug("ANC get_status mac=%s: %s", mac_n, exc)
        return None
