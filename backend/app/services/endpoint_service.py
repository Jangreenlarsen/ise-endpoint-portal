from __future__ import annotations

import logging

from app.ise.client import IseClient
from app.ise.endpoints import IseEndpointGroupRepository, IseEndpointRepository
from app.schemas.endpoint import (
    CreateEndpointRequest,
    EndpointGroupSummary,
    EndpointSummary,
)

logger = logging.getLogger(__name__)


class EndpointService:
    def __init__(self, client: IseClient) -> None:
        self.endpoints = IseEndpointRepository(client)
        self.groups = IseEndpointGroupRepository(client)

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
        await self.endpoints.create(
            mac=req.mac,
            group_id=req.group_id,
            description=req.description,
        )

    async def delete_endpoint(self, endpoint_id: str) -> None:
        logger.info("deleting endpoint id=%s", endpoint_id)
        await self.endpoints.delete(endpoint_id)
