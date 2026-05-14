"""ISE ERS repository for Authorization Profiles.

ERS endpoint: /ers/config/authorizationprofile
Payload wrapper: AuthorizationProfile
"""
from __future__ import annotations

import logging
from typing import Any

from app.ise.client import IseClient

logger = logging.getLogger(__name__)

ERS_PATH = "/ers/config/authorizationprofile"


def _id_from_location(location: str) -> str:
    if not location:
        return ""
    return location.rstrip("/").rsplit("/", 1)[-1]


class IseAuthzProfileRepository:
    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_all(self) -> list[dict[str, Any]]:
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
        return all_resources

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        try:
            data = await self.client.get(f"{ERS_PATH}/name/{name}")
        except Exception:  # noqa: BLE001
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
