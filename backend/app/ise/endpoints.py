from __future__ import annotations

import logging
from typing import Any

from app.ise.client import IseClient

logger = logging.getLogger(__name__)

ERS_ENDPOINTS = "/ers/config/endpoint"
ERS_ENDPOINT_GROUPS = "/ers/config/endpointgroup"


def _id_from_location(location: str) -> str:
    """Extract the trailing UUID from an ERS `Location` header.

    Example: `https://ise:9060/ers/config/endpoint/abc-123` -> `abc-123`.
    """
    if not location:
        return ""
    return location.rstrip("/").rsplit("/", 1)[-1]


class IseEndpointRepository:
    """ERS calls for endpoint objects."""

    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_page(
        self,
        page: int = 1,
        size: int = 100,
        filters: list[str] | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """Return (resources, total_count) for the requested page.

        filters: list of ERS filter strings like "mac.CONTAINS.AA:BB"
                 (multiple = AND).
        """
        params: list[tuple[str, Any]] = [("page", page), ("size", size)]
        if filters:
            for f in filters:
                params.append(("filter", f))
        data = await self.client.get(ERS_ENDPOINTS, params=params)
        sr = data.get("SearchResult", {}) if data else {}
        resources = sr.get("resources", [])
        total = sr.get("total", len(resources))
        return resources, total

    async def list_all(
        self, filters: list[str] | None = None
    ) -> list[dict[str, Any]]:
        """Fetch all endpoints across all ISE pages (ERS max 100 per page)."""
        all_resources: list[dict[str, Any]] = []
        page = 1
        while True:
            resources, total = await self.list_page(
                page=page, size=100, filters=filters
            )
            all_resources.extend(resources)
            if len(all_resources) >= total or not resources:
                break
            page += 1
        return all_resources

    async def get(self, endpoint_id: str) -> dict[str, Any]:
        data = await self.client.get(f"{ERS_ENDPOINTS}/{endpoint_id}")
        return data.get("ERSEndPoint", {}) if data else {}

    async def get_by_mac(self, mac: str) -> dict[str, Any] | None:
        data = await self.client.get(f"{ERS_ENDPOINTS}/name/{mac}")
        return data.get("ERSEndPoint") if data else None

    async def create(
        self,
        mac: str,
        group_id: str = "",
        *,
        description: str = "",
        static: bool = True,
        custom_attributes: dict[str, str] | None = None,
    ) -> str:
        """Create an endpoint. Returns the new endpoint id (parsed from Location header)."""
        ers: dict[str, Any] = {
            "name": mac,
            "description": description,
            "mac": mac,
        }
        if group_id:
            ers["groupId"] = group_id
            ers["staticGroupAssignment"] = static
        if custom_attributes:
            non_empty = {k: v for k, v in custom_attributes.items() if v}
            if non_empty:
                ers["customAttributes"] = {"customAttributes": non_empty}
        _, response = await self.client.request(
            "POST",
            ERS_ENDPOINTS,
            json={"ERSEndPoint": ers},
            return_response=True,
        )
        new_id = _id_from_location(response.headers.get("Location", ""))
        if not new_id:
            logger.warning("create endpoint returned no Location header")
        return new_id

    async def update(
        self,
        endpoint_id: str,
        *,
        description: str | None = None,
        group_id: str | None = None,
        static_group_assignment: bool | None = None,
        custom_attributes: dict[str, str] | None = None,
    ) -> None:
        fields: dict[str, Any] = {"id": endpoint_id}
        if description is not None:
            fields["description"] = description
        if group_id is not None:
            fields["groupId"] = group_id
            fields["staticGroupAssignment"] = (
                static_group_assignment if static_group_assignment is not None else True
            )
        elif static_group_assignment is not None:
            fields["staticGroupAssignment"] = static_group_assignment
        if custom_attributes:
            non_empty = {k: v for k, v in custom_attributes.items() if v}
            if non_empty:
                fields["customAttributes"] = {"customAttributes": non_empty}
        payload = {"ERSEndPoint": fields}
        await self.client.put(f"{ERS_ENDPOINTS}/{endpoint_id}", json=payload)

    async def delete(self, endpoint_id: str) -> None:
        await self.client.delete(f"{ERS_ENDPOINTS}/{endpoint_id}")

    async def set_custom_attributes(
        self, endpoint_id: str, attrs: dict[str, str]
    ) -> None:
        """Replace the full customAttributes block on an endpoint.

        Empty-string values are preserved in the payload: ISE ERS merges
        the customAttributes block on PUT, so to clear a specific attribute
        the caller must include it with an empty string. Omitting the key
        leaves the previous value in place.
        """
        payload = {
            "ERSEndPoint": {
                "id": endpoint_id,
                "customAttributes": {"customAttributes": attrs},
            }
        }
        await self.client.put(f"{ERS_ENDPOINTS}/{endpoint_id}", json=payload)


class IseEndpointGroupRepository:
    """ERS calls for endpoint identity groups."""

    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_all(self) -> list[dict[str, Any]]:
        data = await self.client.get(ERS_ENDPOINT_GROUPS, params={"size": 100})
        return data.get("SearchResult", {}).get("resources", []) if data else []

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        data = await self.client.get(f"{ERS_ENDPOINT_GROUPS}/name/{name}")
        return data.get("EndPointGroup") if data else None
