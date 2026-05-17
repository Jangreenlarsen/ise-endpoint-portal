from __future__ import annotations

import asyncio
import logging
import math
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
        """Fetch all endpoints across all ISE pages (ERS max 100 per page).

        Page 1 is fetched first to learn the total count. Remaining pages are
        fetched in parallel (Semaphore=5) — reduces 10K endpoint scan from
        ~20s serial to ~5s parallel.
        """
        resources, total = await self.list_page(page=1, size=100, filters=filters)
        if not resources or len(resources) >= total:
            return resources

        total_pages = math.ceil(total / 100)
        if total_pages <= 1:
            return resources

        sem = asyncio.Semaphore(5)

        async def _fetch_page(page: int) -> list[dict[str, Any]]:
            async with sem:
                result, _ = await self.list_page(page=page, size=100, filters=filters)
                return result

        remaining = await asyncio.gather(
            *[_fetch_page(p) for p in range(2, total_pages + 1)],
            return_exceptions=False,
        )
        for page_resources in remaining:
            resources.extend(page_resources)
        return resources

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
            # Preserve empty-string values: ISE ERS merges the customAttributes
            # block on PUT, so to clear a specific attribute we must include the
            # key with an empty string. Filtering empty strings would leave the
            # previous ISE value in place.
            fields["customAttributes"] = {"customAttributes": custom_attributes}
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

    async def _list_groups_page(self, page: int) -> tuple[list[dict[str, Any]], int]:
        data = await self.client.get(
            ERS_ENDPOINT_GROUPS,
            params=[("size", 100), ("page", page)],
        )
        sr = data.get("SearchResult", {}) if data else {}
        return sr.get("resources", []), sr.get("total", 0)

    async def _fetch_group_detail(self, group_id: str) -> dict[str, Any]:
        """GET individual group to retrieve parentId and full name."""
        try:
            data = await self.client.get(f"{ERS_ENDPOINT_GROUPS}/{group_id}")
            return (data or {}).get("EndPointGroup", {})
        except Exception:
            return {}

    async def list_all(self) -> list[dict[str, Any]]:
        """Fetch all endpoint groups with full hierarchical paths.

        1. List all pages to collect {id, name} summaries.
        2. GET each group individually (parallel, sem=8) to get parentId.
        3. Build full path for every group by following the parent chain.
           Example: "ADM-Apple-iPhone" → "Endpoint Identity Groups:Profiled:ADM-Apple-iPhone"
        """
        # ── Step 1: collect all group summaries ──────────────────────────────
        resources, total = await self._list_groups_page(1)
        if resources and len(resources) < total:
            total_pages = math.ceil(total / 100)
            sem_pages = asyncio.Semaphore(5)

            async def _fetch_page(page: int) -> list[dict[str, Any]]:
                async with sem_pages:
                    result, _ = await self._list_groups_page(page)
                    return result

            remaining = await asyncio.gather(
                *[_fetch_page(p) for p in range(2, total_pages + 1)],
                return_exceptions=False,
            )
            for page_resources in remaining:
                resources.extend(page_resources)

        if not resources:
            return []

        # ── Step 2: GET each group for parentId ──────────────────────────────
        sem_detail = asyncio.Semaphore(8)

        async def _detail(r: dict[str, Any]) -> dict[str, Any]:
            async with sem_detail:
                detail = await self._fetch_group_detail(r["id"])
                # Merge: prefer detail fields, fall back to list summary
                return {**r, **detail} if detail else r

        detailed: list[dict[str, Any]] = list(
            await asyncio.gather(*[_detail(r) for r in resources])
        )

        # ── Step 3: build full hierarchical paths ────────────────────────────
        by_id: dict[str, dict[str, Any]] = {g["id"]: g for g in detailed if g.get("id")}

        def _full_path(g: dict[str, Any], visited: set[str]) -> str:
            gid = g.get("id", "")
            if gid in visited:
                return g.get("name", "")
            visited.add(gid)
            parent_id = g.get("parentId", "")
            name = g.get("name", "")
            if not parent_id or parent_id not in by_id:
                return name
            parent_name = _full_path(by_id[parent_id], visited)
            return f"{parent_name}:{name}" if parent_name else name

        for g in detailed:
            g["_full_path"] = _full_path(g, set())

        return detailed

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        data = await self.client.get(f"{ERS_ENDPOINT_GROUPS}/name/{name}")
        return data.get("EndPointGroup") if data else None
