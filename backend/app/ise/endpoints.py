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
        group_id: str,
        *,
        description: str = "",
        static: bool = True,
    ) -> None:
        payload = {
            "ERSEndPoint": {
                "name": mac,
                "description": description,
                "mac": mac,
                "groupId": group_id,
                "staticGroupAssignment": static,
            }
        }
        await self.client.post(ERS_ENDPOINTS, json=payload)

    async def update_group(self, endpoint_id: str, group_id: str) -> None:
        payload = {
            "ERSEndPoint": {
                "id": endpoint_id,
                "groupId": group_id,
                "staticGroupAssignment": True,
            }
        }
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
