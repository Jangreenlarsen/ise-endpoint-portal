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

    ISE ERS /ancendpoint does not support macAddress as a filter field (returns 400).
    Instead: paginate through all ANC assignments and match client-side.
    ANC assignments are typically very few so this is efficient in practice.
    """
    mac_n = _normalize_mac(mac)
    try:
        page = 1
        while True:
            data = await client.get(_ENDPOINT_PATH, params={"size": 100, "page": page})
            if not data:
                return None
            result = data.get("SearchResult", {})
            resources = result.get("resources", [])
            total = result.get("total", 0)
            for r in resources:
                if _normalize_mac(r.get("name", "")) == mac_n:
                    entry_id = r.get("id", "")
                    if not entry_id:
                        return None
                    detail = await client.get(f"{_ENDPOINT_PATH}/{entry_id}")
                    return detail.get("ErsAncEndpoint", {}).get("policyName") if detail else None
            if not resources or page * 100 >= total:
                return None
            page += 1
    except IseApiError as exc:
        logger.debug("ANC get_status mac=%s: %s", mac_n, exc)
        return None
