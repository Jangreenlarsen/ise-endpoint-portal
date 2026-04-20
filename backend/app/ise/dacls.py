"""ISE integration for Downloadable ACLs (DACLs).

A DACL ("Downloadable ACL", also called Port ACL in this portal's UI) is a
named Cisco IOS-style access-list stored centrally in ISE and pushed to
authenticator devices (switches/WLCs) at authentication time.

Two API surfaces exist:
- ERS (legacy): /ers/config/downloadableacl
- Open API: /api/v1/downloadable-acl (ISE 3.1+)

Both expose the same fields. We use ERS by default to match the rest of the
portal; Open API is selected when `ise_api_type=openapi`.

Payload shape (ERS, double-wrapper convention):
    {
      "DownloadableAcl": {
        "id": "<uuid>",
        "name": "PERMIT_ALL",
        "description": "...",
        "dacl": "permit ip any any\\ndeny ip any any log",
        "daclType": "IPV4" | "IPV6" | "IP_AGNOSTIC"
      }
    }

Open API uses the same field names but with no wrapper (flat JSON).
"""
from __future__ import annotations

import logging
from typing import Any

from app.ise.client import IseClient

logger = logging.getLogger(__name__)

ERS_DACLS = "/ers/config/downloadableacl"
OPENAPI_DACLS = "/api/v1/downloadable-acl"


def _id_from_location(location: str) -> str:
    if not location:
        return ""
    return location.rstrip("/").rsplit("/", 1)[-1]


class IseDaclRepository:
    """ERS calls for downloadable ACL objects."""

    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_all(self) -> list[dict[str, Any]]:
        """Fetch every DACL across all ISE pages."""
        all_resources: list[dict[str, Any]] = []
        page = 1
        while True:
            data = await self.client.get(
                ERS_DACLS, params=[("page", page), ("size", 100)]
            )
            sr = data.get("SearchResult", {}) if data else {}
            resources = sr.get("resources", [])
            total = sr.get("total", len(resources))
            all_resources.extend(resources)
            if len(all_resources) >= total or not resources:
                break
            page += 1
        return all_resources

    async def get(self, dacl_id: str) -> dict[str, Any]:
        data = await self.client.get(f"{ERS_DACLS}/{dacl_id}")
        return data.get("DownloadableAcl", {}) if data else {}

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        # ERS exposes /name/{n} for DACLs (same convention as endpointgroup).
        try:
            data = await self.client.get(f"{ERS_DACLS}/name/{name}")
        except Exception:
            return None
        return data.get("DownloadableAcl") if data else None

    async def create(
        self,
        *,
        name: str,
        dacl: str,
        description: str = "",
        dacl_type: str = "IPV4",
    ) -> str:
        body = {
            "DownloadableAcl": {
                "name": name,
                "description": description,
                "dacl": dacl,
                "daclType": dacl_type,
            }
        }
        _, response = await self.client.request(
            "POST", ERS_DACLS, json=body, return_response=True
        )
        new_id = _id_from_location(response.headers.get("Location", ""))
        if not new_id:
            logger.warning("create DACL returned no Location header")
        return new_id

    async def update(
        self,
        dacl_id: str,
        *,
        name: str | None = None,
        dacl: str | None = None,
        description: str | None = None,
        dacl_type: str | None = None,
    ) -> None:
        fields: dict[str, Any] = {"id": dacl_id}
        if name is not None:
            fields["name"] = name
        if dacl is not None:
            fields["dacl"] = dacl
        if description is not None:
            fields["description"] = description
        if dacl_type is not None:
            fields["daclType"] = dacl_type
        await self.client.put(
            f"{ERS_DACLS}/{dacl_id}", json={"DownloadableAcl": fields}
        )

    async def delete(self, dacl_id: str) -> None:
        await self.client.delete(f"{ERS_DACLS}/{dacl_id}")


class OpenApiDaclRepository:
    """Open API (`/api/v1/downloadable-acl`) calls for DACL objects.

    Mirrors `IseDaclRepository` so the service can dispatch based on api_type.
    """

    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_all(self) -> list[dict[str, Any]]:
        all_resources: list[dict[str, Any]] = []
        page = 1
        while True:
            data = await self.client.get(
                OPENAPI_DACLS, params=[("page", page), ("size", 100)]
            )
            resources, total = _normalize_list(data)
            all_resources.extend(resources)
            if len(all_resources) >= total or not resources:
                break
            page += 1
        return all_resources

    async def get(self, dacl_id: str) -> dict[str, Any]:
        data = await self.client.get(f"{OPENAPI_DACLS}/{dacl_id}")
        if isinstance(data, dict):
            inner = data.get("response", data)
            if isinstance(inner, dict):
                return inner
        return data or {}

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        data = await self.client.get(
            OPENAPI_DACLS, params=[("filter", f"name.EQ.{name}")]
        )
        resources, _ = _normalize_list(data)
        return resources[0] if resources else None

    async def create(
        self,
        *,
        name: str,
        dacl: str,
        description: str = "",
        dacl_type: str = "IPV4",
    ) -> str:
        body = {
            "name": name,
            "description": description,
            "dacl": dacl,
            "daclType": dacl_type,
        }
        data, response = await self.client.request(
            "POST", OPENAPI_DACLS, json=body, return_response=True
        )
        new_id = ""
        if isinstance(data, dict):
            inner = data.get("response", data)
            if isinstance(inner, dict):
                new_id = inner.get("id", "") or ""
        if not new_id:
            new_id = _id_from_location(response.headers.get("Location", ""))
        return new_id

    async def update(
        self,
        dacl_id: str,
        *,
        name: str | None = None,
        dacl: str | None = None,
        description: str | None = None,
        dacl_type: str | None = None,
    ) -> None:
        body: dict[str, Any] = {"id": dacl_id}
        if name is not None:
            body["name"] = name
        if dacl is not None:
            body["dacl"] = dacl
        if description is not None:
            body["description"] = description
        if dacl_type is not None:
            body["daclType"] = dacl_type
        await self.client.put(f"{OPENAPI_DACLS}/{dacl_id}", json=body)

    async def delete(self, dacl_id: str) -> None:
        await self.client.delete(f"{OPENAPI_DACLS}/{dacl_id}")


def _normalize_list(data: Any) -> tuple[list[dict[str, Any]], int]:
    if isinstance(data, list):
        return data, len(data)
    if isinstance(data, dict):
        if "SearchResult" in data:
            sr = data["SearchResult"]
            res = sr.get("resources", [])
            return res, sr.get("total", len(res))
        inner = data.get("response", data.get("resources", []))
        if isinstance(inner, list):
            total = data.get("total") or data.get("totalCount") or len(inner)
            return inner, int(total)
    return [], 0
