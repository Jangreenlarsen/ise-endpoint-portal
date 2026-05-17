# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Authorization Profile Service.

Manages ISE authorization profiles — primarily the 4 standard profiles
referenced by the portal's policy creation wizard:

  Endpoint_VLAN       — dynamic VLAN via EndPoints:AuthzVlan
  Endpoint_DACL       — dynamic DACL via EndPoints:AuthzACL
  Endpoint_PSK-KEY    — PSK key via cisco-av-pair + EndPoints:PSK_Key
  Endpoint_AirSpaceACL — Airespace ACL via EndPoints:AuthzACL
"""
from __future__ import annotations

import logging
from typing import Any

from app.ise.authz_profiles import IseAuthzProfileRepository
from app.schemas.authz_profile import (
    AuthzProfileStatus,
    AuthzProfileSummary,
    StandardProfilesResult,
)

logger = logging.getLogger(__name__)

# ── Standard profile definitions ────────────────────────────────────────────

STANDARD_PROFILES: list[dict[str, Any]] = [
    {
        "name": "Endpoint_VLAN",
        "description": "Dynamic VLAN from EndPoints:AuthzVlan attribute",
        "accessType": "ACCESS_ACCEPT",
        "authzProfileType": "SWITCH",
        "advancedAttributes": [
            {
                "leftHandSideDictionaryAttribue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "Radius",
                    "attributeName": "Tunnel-Type",
                },
                "rightHandSideAttribueValue": {
                    "AdvancedAttributeValueType": "AttributeValue",
                    "value": "1:13",
                },
            },
            {
                "leftHandSideDictionaryAttribue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "Radius",
                    "attributeName": "Tunnel-Medium-Type",
                },
                "rightHandSideAttribueValue": {
                    "AdvancedAttributeValueType": "AttributeValue",
                    "value": "1:6",
                },
            },
            {
                "leftHandSideDictionaryAttribue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "Radius",
                    "attributeName": "Tunnel-Private-Group-ID",
                },
                "rightHandSideAttribueValue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "EndPoints",
                    "attributeName": "AuthzVlan",
                },
            },
        ],
    },
    {
        "name": "Endpoint_DACL",
        "description": "Dynamic DACL from EndPoints:AuthzACL attribute",
        "accessType": "ACCESS_ACCEPT",
        "authzProfileType": "SWITCH",
        "daclName": "EndPoints:AuthzACL",
    },
    {
        "name": "Endpoint_PSK-KEY",
        "description": "Dynamic PSK key from EndPoints:PSK_Key attribute",
        "accessType": "ACCESS_ACCEPT",
        "authzProfileType": "SWITCH",
        "advancedAttributes": [
            {
                "leftHandSideDictionaryAttribue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "Cisco",
                    "attributeName": "cisco-av-pair",
                },
                "rightHandSideAttribueValue": {
                    "AdvancedAttributeValueType": "AttributeValue",
                    "value": "psk-mode=ascii",
                },
            },
            {
                "leftHandSideDictionaryAttribue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "Cisco",
                    "attributeName": "cisco-av-pair",
                },
                "rightHandSideAttribueValue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "EndPoints",
                    "attributeName": "PSK_Key",
                },
            },
        ],
    },
    {
        "name": "Endpoint_AirSpaceACL",
        "description": "Dynamic Airespace ACL from EndPoints:AuthzACL attribute",
        "accessType": "ACCESS_ACCEPT",
        "authzProfileType": "SWITCH",
        "advancedAttributes": [
            {
                "leftHandSideDictionaryAttribue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "Airespace",
                    "attributeName": "Airespace-ACL-Name",
                },
                "rightHandSideAttribueValue": {
                    "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
                    "dictionaryName": "EndPoints",
                    "attributeName": "AuthzACL",
                },
            },
        ],
    },
]

# Human-readable summary of what each profile configures
STANDARD_PROFILE_DETAILS: dict[str, str] = {
    "Endpoint_VLAN":
        "Access-Type: ACCESS_ACCEPT · Tunnel-Type = 13 (VLAN) · Tunnel-Medium-Type = 6 (802) · Tunnel-Private-Group-ID = EndPoints:AuthzVlan",
    "Endpoint_DACL":
        "Access-Type: ACCESS_ACCEPT · DACL = EndPoints:AuthzACL",
    "Endpoint_PSK-KEY":
        "Access-Type: ACCESS_ACCEPT · cisco-av-pair = psk-mode=ascii · cisco-av-pair = EndPoints:PSK_Key",
    "Endpoint_AirSpaceACL":
        "Access-Type: ACCESS_ACCEPT · Airespace-ACL-Name = EndPoints:AuthzACL",
}


# ── Service ──────────────────────────────────────────────────────────────────

class AuthzProfileService:
    def __init__(self, client) -> None:
        self._repo = IseAuthzProfileRepository(client)

    async def list_all(self) -> list[AuthzProfileSummary]:
        resources = await self._repo.list_all()
        return [
            AuthzProfileSummary(
                id=r.get("id", ""),
                name=r.get("name", ""),
                description=r.get("description", ""),
            )
            for r in resources
        ]

    async def check_standard_profiles(self) -> list[AuthzProfileStatus]:
        results: list[AuthzProfileStatus] = []
        for profile_def in STANDARD_PROFILES:
            name = profile_def["name"]
            existing = await self._repo.get_by_name(name)
            results.append(AuthzProfileStatus(
                name=name,
                exists=existing is not None,
                profile_id=existing.get("id") if existing else None,
                description=STANDARD_PROFILE_DETAILS.get(name, ""),
            ))
        return results

    async def ensure_standard_profiles(self) -> StandardProfilesResult:
        created: list[str] = []
        already_existed: list[str] = []
        errors: list[str] = []

        for profile_def in STANDARD_PROFILES:
            name = profile_def["name"]
            try:
                existing = await self._repo.get_by_name(name)
                if existing is not None:
                    already_existed.append(name)
                    logger.info("authz-profile '%s' already exists in ISE", name)
                else:
                    await self._repo.create(profile_def.copy())
                    created.append(name)
                    logger.info("authz-profile '%s' created in ISE", name)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{name}: {exc}")
                logger.error("authz-profile create '%s' failed: %s", name, exc)

        return StandardProfilesResult(
            created=created,
            already_existed=already_existed,
            errors=errors,
            ok=len(errors) == 0,
        )
