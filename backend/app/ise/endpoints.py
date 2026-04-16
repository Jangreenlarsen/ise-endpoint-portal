from __future__ import annotations

from typing import Any

from app.ise.client import IseClient

ERS_ENDPOINTS = "/ers/config/endpoint"
ERS_ENDPOINT_GROUPS = "/ers/config/endpointgroup"


class IseEndpointRepository:
    """ERS calls for endpoint objects."""

    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_page(self, page: int = 1, size: int = 100) -> list[dict[str, Any]]:
        data = await self.client.get(
            ERS_ENDPOINTS, params={"page": page, "size": size}
        )
        return data.get("SearchResult", {}).get("resources", []) if data else []

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
    ) -> None:
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
        await self.client.post(ERS_ENDPOINTS, json={"ERSEndPoint": ers})

    async def update(
        self,
        endpoint_id: str,
        *,
        description: str | None = None,
        group_id: str | None = None,
        custom_attributes: dict[str, str] | None = None,
    ) -> None:
        fields: dict[str, Any] = {"id": endpoint_id}
        if description is not None:
            fields["description"] = description
        if group_id is not None:
            fields["groupId"] = group_id
            fields["staticGroupAssignment"] = True
        if custom_attributes:
            non_empty = {k: v for k, v in custom_attributes.items() if v}
            if non_empty:
                fields["customAttributes"] = {"customAttributes": non_empty}
        payload = {"ERSEndPoint": fields}
        await self.client.put(f"{ERS_ENDPOINTS}/{endpoint_id}", json=payload)

    async def delete(self, endpoint_id: str) -> None:
        await self.client.delete(f"{ERS_ENDPOINTS}/{endpoint_id}")


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
