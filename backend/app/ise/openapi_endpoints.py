"""Cisco ISE Open API integration for endpoints and endpoint identity groups.

Parallel to `app.ise.endpoints` which speaks ERS. Exposes the same interface
so `EndpointService` can dispatch based on `config.settings.ise_api_type`.

Normalization: all list/get responses are shaped like their ERS counterparts
(`{id, name, mac, description, groupId, staticGroupAssignment, profileId, ...,
customAttributes: {customAttributes: {...}}}`) so the service layer can share
code paths. Open API returns flat JSON with single-level `customAttributes`
— we wrap it here.

Filter syntax: ISE Open API uses the same dotted `field.OP.value` convention
as ERS for the common endpoint filterable fields (mac, name, description).
"""
from __future__ import annotations

import logging
from typing import Any

from app.ise.client import IseClient

logger = logging.getLogger(__name__)

OPENAPI_ENDPOINTS = "/api/v1/endpoint"
OPENAPI_ENDPOINT_GROUPS = "/api/v1/endpoint-identity-group"


def _id_from_location(location: str) -> str:
    if not location:
        return ""
    return location.rstrip("/").rsplit("/", 1)[-1]


def _normalize_endpoint(raw: dict[str, Any]) -> dict[str, Any]:
    """Re-shape an Open API endpoint object to match the ERS shape used by the service."""
    if not raw:
        return {}
    normalized = dict(raw)
    ca = raw.get("customAttributes")
    if isinstance(ca, dict) and "customAttributes" not in ca:
        normalized["customAttributes"] = {"customAttributes": dict(ca)}
    return normalized


def _normalize_list(data: Any) -> tuple[list[dict[str, Any]], int]:
    """Extract (resources, total) from an Open API list response.

    Open API responses vary: some return `{response: [...], total: N}`,
    some return a flat list, some wrap in `SearchResult`. Handle all three.
    """
    if isinstance(data, list):
        resources = [_normalize_endpoint(r) for r in data]
        return resources, len(resources)
    if isinstance(data, dict):
        if "SearchResult" in data:
            sr = data["SearchResult"]
            resources = [_normalize_endpoint(r) for r in sr.get("resources", [])]
            return resources, sr.get("total", len(resources))
        inner = data.get("response", data.get("resources", []))
        if isinstance(inner, list):
            resources = [_normalize_endpoint(r) for r in inner]
            total = data.get("total") or data.get("totalCount") or len(resources)
            return resources, int(total)
    return [], 0


class OpenApiEndpointRepository:
    """Open API (`/api/v1/endpoint`) calls for endpoint objects."""

    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_page(
        self,
        page: int = 1,
        size: int = 100,
        filters: list[str] | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        params: list[tuple[str, Any]] = [("page", page), ("size", size)]
        if filters:
            for f in filters:
                params.append(("filter", f))
        data = await self.client.get(OPENAPI_ENDPOINTS, params=params)
        return _normalize_list(data)

    async def list_all(
        self, filters: list[str] | None = None
    ) -> list[dict[str, Any]]:
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
        data = await self.client.get(f"{OPENAPI_ENDPOINTS}/{endpoint_id}")
        if not data:
            return {}
        # Some deployments wrap the single-resource response
        if isinstance(data, dict):
            if "response" in data and isinstance(data["response"], dict):
                data = data["response"]
            elif "ERSEndPoint" in data and isinstance(data["ERSEndPoint"], dict):
                data = data["ERSEndPoint"]
        return _normalize_endpoint(data)

    async def get_by_mac(self, mac: str) -> dict[str, Any] | None:
        resources, _ = await self.list_page(
            page=1, size=1, filters=[f"mac.EQ.{mac}"]
        )
        return resources[0] if resources else None

    async def create(
        self,
        mac: str,
        group_id: str = "",
        *,
        description: str = "",
        static: bool = True,
        custom_attributes: dict[str, str] | None = None,
    ) -> str:
        """Create an endpoint via Open API. Returns the new endpoint id."""
        body: dict[str, Any] = {
            "name": mac,
            "description": description,
            "mac": mac,
        }
        if group_id:
            body["groupId"] = group_id
            body["staticGroupAssignment"] = static
        if custom_attributes:
            non_empty = {k: v for k, v in custom_attributes.items() if v}
            if non_empty:
                # Open API uses a flat customAttributes map (single-nested).
                body["customAttributes"] = non_empty
        data, response = await self.client.request(
            "POST",
            OPENAPI_ENDPOINTS,
            json=body,
            return_response=True,
        )
        # Open API returns the created object in the body OR a Location header.
        new_id = ""
        if isinstance(data, dict):
            inner = data.get("response", data)
            if isinstance(inner, dict):
                new_id = inner.get("id", "") or ""
        if not new_id:
            new_id = _id_from_location(response.headers.get("Location", ""))
        if not new_id:
            logger.warning(
                "Open API create endpoint returned no id in body or Location header"
            )
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
        body: dict[str, Any] = {"id": endpoint_id}
        if description is not None:
            body["description"] = description
        if group_id is not None:
            body["groupId"] = group_id
            body["staticGroupAssignment"] = (
                static_group_assignment if static_group_assignment is not None else True
            )
        elif static_group_assignment is not None:
            body["staticGroupAssignment"] = static_group_assignment
        if custom_attributes:
            non_empty = {k: v for k, v in custom_attributes.items() if v}
            if non_empty:
                body["customAttributes"] = non_empty
        await self.client.put(f"{OPENAPI_ENDPOINTS}/{endpoint_id}", json=body)

    async def delete(self, endpoint_id: str) -> None:
        await self.client.delete(f"{OPENAPI_ENDPOINTS}/{endpoint_id}")


class OpenApiEndpointGroupRepository:
    """Open API calls for endpoint identity groups."""

    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_all(self) -> list[dict[str, Any]]:
        data = await self.client.get(
            OPENAPI_ENDPOINT_GROUPS, params={"size": 100}
        )
        resources, _ = _normalize_list(data)
        return resources

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        # Open API doesn't always expose /name/{n}; look up via filter.
        data = await self.client.get(
            OPENAPI_ENDPOINT_GROUPS, params=[("filter", f"name.EQ.{name}")]
        )
        resources, _ = _normalize_list(data)
        return resources[0] if resources else None
