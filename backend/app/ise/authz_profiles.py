# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""ISE repository for Authorization Profiles.

ERS endpoint:     /ers/config/authorizationprofile
Open API endpoint: /api/v1/policy/network-access/authorization-profiles

list_all() tries Open API first (ISE 3.1+, preferred in ISE 3.4); falls back
to ERS if Open API is unavailable or returns no results.
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.exceptions import IseApiError
from app.ise.client import IseClient

logger = logging.getLogger(__name__)

ERS_PATH = "/ers/config/authorizationprofile"
OPENAPI_PATH = "/api/v1/policy/network-access/authorization-profiles"


def _id_from_location(location: str) -> str:
    if not location:
        return ""
    return location.rstrip("/").rsplit("/", 1)[-1]


def _unwrap_openapi(data: Any) -> list[dict[str, Any]]:
    """Normalise Open API response to a flat list of profile dicts."""
    if data is None:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        inner = data.get("response", data.get("resources", data))
        if isinstance(inner, list):
            return inner
    return []


class IseAuthzProfileRepository:
    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_all(self) -> list[dict[str, Any]]:
        # Try Open API first — it's the preferred path in ISE 3.4 and avoids
        # transport errors that can occur on the ERS list endpoint.
        try:
            data = await self.client.get(OPENAPI_PATH)
            profiles = _unwrap_openapi(data)
            if profiles:
                logger.debug("authz-profiles: loaded %d via Open API", len(profiles))
                return profiles
        except IseApiError as exc:
            logger.warning("authz-profiles Open API list failed (%s), trying ERS", exc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("authz-profiles Open API list error (%s), trying ERS", exc)

        # ERS fallback — paginated
        all_resources: list[dict[str, Any]] = []
        page = 1
        while True:
            data = await self.client.get(
                ERS_PATH, params=[("page", page), ("size", 100)]
            )
            sr = data.get("SearchResult", {}) if data else {}
            resources = sr.get("resources", [])
            total = sr.get("total", len(resources))
            all_resources.extend(resources)
            if len(all_resources) >= total or not resources:
                break
            page += 1
        logger.debug("authz-profiles: loaded %d via ERS", len(all_resources))
        return all_resources

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        try:
            data = await self.client.get(f"{ERS_PATH}/name/{name}")
        except Exception as exc:  # noqa: BLE001
            logger.warning("authz-profile get_by_name('%s') failed: %s", name, exc)
            return None
        return data.get("AuthorizationProfile") if data else None

    async def get(self, profile_id: str) -> dict[str, Any]:
        data = await self.client.get(f"{ERS_PATH}/{profile_id}")
        return data.get("AuthorizationProfile", {}) if data else {}

    async def create(self, profile: dict[str, Any]) -> str:
        body = {"AuthorizationProfile": profile}
        _, response = await self.client.request(
            "POST", ERS_PATH, json=body, return_response=True
        )
        new_id = _id_from_location(response.headers.get("Location", ""))
        if not new_id:
            logger.warning("create AuthzProfile '%s' returned no Location header", profile.get("name"))
        return new_id
