# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""ISE Open API — RADIUS Network Access Policy Sets and Authorization Rules.

Open API paths (ISE 3.1+):
    GET  /api/v1/policy/network-access/policy-set
    GET  /api/v1/policy/network-access/policy-set/{id}
    GET  /api/v1/policy/network-access/policy-set/{id}/authorization
    POST /api/v1/policy/network-access/policy-set/{id}/authorization
    PUT  /api/v1/policy/network-access/policy-set/{id}/authorization/{rule_id}
    DELETE /api/v1/policy/network-access/policy-set/{id}/authorization/{rule_id}

Response envelope: { "response": [...], "version": "1.0.0" }
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.exceptions import IseApiError

logger = logging.getLogger(__name__)

_BASE = "/api/v1/policy/network-access/policy-set"


def _unwrap(data: Any) -> list[dict]:
    if data is None:
        return []
    if isinstance(data, dict):
        r = data.get("response", data)
        if isinstance(r, list):
            return r
        if isinstance(r, dict):
            return [r]
    return []


async def list_policy_sets(client) -> list[dict]:
    """Return all RADIUS network-access policy sets."""
    data = await client.get(_BASE)
    return _unwrap(data)


async def get_policy_set(client, policy_set_id: str) -> dict:
    """Return a single policy set by ID."""
    data = await client.get(f"{_BASE}/{policy_set_id}")
    result = _unwrap(data)
    return result[0] if result else (data or {})


async def list_authorization_rules(client, policy_set_id: str) -> list[dict]:
    """Return all authorization rules for a policy set, sorted by rank."""
    data = await client.get(f"{_BASE}/{policy_set_id}/authorization")
    rules = _unwrap(data)
    return sorted(rules, key=lambda r: (r.get("rule") or r).get("rank", 0))


async def create_authorization_rule(
    client,
    policy_set_id: str,
    name: str,
    rank: int,
    condition: dict,
    profiles: list[str],
    state: str = "enabled",
) -> dict:
    """Create an authorization rule in a policy set. Returns created rule dict."""
    payload = {
        "rule": {
            "name": name,
            "rank": rank,
            "state": state,
            "condition": condition,
        },
        "profile": profiles,
        "securityGroup": None,
    }
    data = await client.post(f"{_BASE}/{policy_set_id}/authorization", json=payload)
    result = _unwrap(data)
    return result[0] if result else (data or {})


async def update_authorization_rule(
    client,
    policy_set_id: str,
    rule_id: str,
    name: str,
    rank: int,
    condition: dict,
    profiles: list[str],
    state: str = "enabled",
) -> dict:
    """Update an existing authorization rule."""
    payload = {
        "rule": {
            "id": rule_id,
            "name": name,
            "rank": rank,
            "state": state,
            "condition": condition,
        },
        "profile": profiles,
        "securityGroup": None,
    }
    data = await client.put(
        f"{_BASE}/{policy_set_id}/authorization/{rule_id}", json=payload
    )
    result = _unwrap(data)
    return result[0] if result else (data or {})


async def delete_authorization_rule(
    client, policy_set_id: str, rule_id: str
) -> None:
    """Delete an authorization rule by ID."""
    await client.delete(f"{_BASE}/{policy_set_id}/authorization/{rule_id}")
    logger.info("Deleted authz rule %s from policy set %s", rule_id, policy_set_id)
