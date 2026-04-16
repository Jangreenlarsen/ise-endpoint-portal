from __future__ import annotations

import logging
from typing import Any

from app.core.custom_attr_store import MANAGED_ATTRS
from app.core.exceptions import IseApiError
from app.ise.client import IseClient
from app.ise.custom_attributes import IseCustomAttributeRepository
from app.ise.endpoints import IseEndpointGroupRepository, IseEndpointRepository
from app.schemas.endpoint import (
    BulkCreateRequest,
    BulkFailure,
    BulkResult,
    CreateEndpointRequest,
    EndpointDetail,
    EndpointGroupSummary,
    EndpointSummary,
    EndpointUpdate,
)

logger = logging.getLogger(__name__)

# Module-level flag: have we ensured custom attribute definitions in ISE this session?
_ca_definitions_ensured = False


class EndpointService:
    def __init__(self, client: IseClient) -> None:
        self.endpoints = IseEndpointRepository(client)
        self.groups = IseEndpointGroupRepository(client)
        self.custom_attrs = IseCustomAttributeRepository(client)

    async def _ensure_ca_definitions(self) -> None:
        """Ensure Owner/Location/AuthzVlan definitions exist in ISE (once per session)."""
        global _ca_definitions_ensured
        if _ca_definitions_ensured:
            return
        logger.info("ensuring custom attribute definitions exist in ISE (via Open API)")
        results = await self.custom_attrs.ensure_definitions(MANAGED_ATTRS)
        logger.info("custom attribute definitions: %s", results)
        failed = [name for name, ok in results.items() if not ok]
        if failed:
            logger.error(
                "COULD NOT CREATE custom attribute definitions: %s. "
                "Custom attributes will NOT be saved on endpoints until these "
                "definitions exist in ISE. Create them manually: "
                "Administration > Identity Management > Settings > "
                "Endpoint Custom Attributes (type: String)",
                failed,
            )
        _ca_definitions_ensured = True

    async def list_endpoints(self, page: int = 1, size: int = 100) -> list[EndpointSummary]:
        raw = await self.endpoints.list_page(page=page, size=size)
        logger.info("listed %d endpoints (page=%d)", len(raw), page)
        return [
            EndpointSummary(
                id=r.get("id", ""),
                name=r.get("name", ""),
                description=r.get("description"),
            )
            for r in raw
        ]

    async def get_endpoint(self, endpoint_id: str) -> EndpointDetail:
        """Fetch full endpoint details from ISE including custom attributes."""
        raw = await self.endpoints.get(endpoint_id)
        ca = _extract_custom_attrs(raw)
        group_id = raw.get("groupId", "")
        group_name = await self._resolve_group_name(group_id) if group_id else ""
        return EndpointDetail(
            id=raw.get("id", endpoint_id),
            name=raw.get("name", ""),
            mac=raw.get("mac", ""),
            description=raw.get("description"),
            group_id=group_id,
            group_name=group_name,
            owner=ca.get("Owner", ""),
            lokation=ca.get("Lokation", ""),
            authz_vlan=ca.get("AuthzVlan", ""),
        )

    async def _resolve_group_name(self, group_id: str) -> str:
        """Look up group name by ID. Returns empty string on failure."""
        if not group_id:
            return ""
        if not hasattr(self, "_group_cache"):
            self._group_cache: dict[str, str] = {}
        if group_id in self._group_cache:
            return self._group_cache[group_id]
        # Populate cache from group list
        try:
            raw = await self.groups.list_all()
            for g in raw:
                self._group_cache[g.get("id", "")] = g.get("name", "")
        except IseApiError:
            pass
        return self._group_cache.get(group_id, "")

    async def list_endpoint_details(
        self, page: int = 1, size: int = 100
    ) -> list[EndpointDetail]:
        """List endpoints with full details (fetches each individually for custom attrs)."""
        resources = await self.endpoints.list_page(page=page, size=size)
        logger.info("fetching details for %d endpoints (page=%d)", len(resources), page)
        details: list[EndpointDetail] = []
        for r in resources:
            try:
                detail = await self.get_endpoint(r["id"])
                details.append(detail)
            except IseApiError:
                details.append(
                    EndpointDetail(
                        id=r.get("id", ""),
                        name=r.get("name", ""),
                        mac=r.get("name", ""),
                        description=r.get("description"),
                    )
                )
        return details

    async def list_groups(self) -> list[EndpointGroupSummary]:
        raw = await self.groups.list_all()
        logger.info("listed %d endpoint groups", len(raw))
        return [
            EndpointGroupSummary(
                id=r.get("id", ""),
                name=r.get("name", ""),
                description=r.get("description"),
            )
            for r in raw
        ]

    async def create_endpoint(self, req: CreateEndpointRequest) -> None:
        logger.info("creating endpoint mac=%s group=%s", req.mac, req.group_id)
        ca = req.custom_attributes.model_dump() if req.custom_attributes else None
        if ca:
            await self._ensure_ca_definitions()
        await self.endpoints.create(
            mac=req.mac,
            group_id=req.group_id,
            description=req.description,
            custom_attributes=ca,
        )

    async def delete_endpoint(self, endpoint_id: str) -> None:
        logger.info("deleting endpoint id=%s", endpoint_id)
        await self.endpoints.delete(endpoint_id)

    async def update_endpoint(self, endpoint_id: str, update: EndpointUpdate) -> None:
        logger.info(
            "updating endpoint id=%s fields=%s",
            endpoint_id,
            update.model_dump(exclude_unset=True),
        )
        ca = update.custom_attributes.model_dump() if update.custom_attributes else None
        if ca:
            await self._ensure_ca_definitions()
        await self.endpoints.update(
            endpoint_id,
            description=update.description,
            group_id=update.group_id,
            static_group_assignment=update.static_group_assignment,
            custom_attributes=ca,
        )

    async def bulk_create(self, req: BulkCreateRequest) -> BulkResult:
        logger.info("bulk creating %d endpoints", len(req.items))
        # Pre-ensure definitions if any item has custom attributes
        if any(item.custom_attributes for item in req.items):
            await self._ensure_ca_definitions()
        succeeded: list[str] = []
        failed: list[BulkFailure] = []
        for item in req.items:
            try:
                await self.create_endpoint(item)
                succeeded.append(item.mac)
            except IseApiError as exc:
                failed.append(BulkFailure(mac=item.mac, error=str(exc)))
        logger.info("bulk done: %d ok, %d failed", len(succeeded), len(failed))
        return BulkResult(succeeded=succeeded, failed=failed)


def _extract_custom_attrs(endpoint: dict[str, Any]) -> dict[str, str]:
    """Extract custom attributes from an ERSEndPoint response."""
    ca = endpoint.get("customAttributes", {})
    if isinstance(ca, dict):
        inner = ca.get("customAttributes", ca)
        if isinstance(inner, dict):
            return {k: str(v) for k, v in inner.items()}
    return {}
