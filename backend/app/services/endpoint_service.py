from __future__ import annotations

import logging

from app.core.exceptions import IseApiError
from app.ise.client import IseClient
from app.ise.endpoints import IseEndpointGroupRepository, IseEndpointRepository
from app.schemas.endpoint import (
    BulkCreateRequest,
    BulkFailure,
    BulkResult,
    CreateEndpointRequest,
    EndpointGroupSummary,
    EndpointSummary,
    EndpointUpdate,
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

    async def update_endpoint(self, endpoint_id: str, update: EndpointUpdate) -> None:
        logger.info(
            "updating endpoint id=%s fields=%s",
            endpoint_id,
            update.model_dump(exclude_unset=True),
        )
        await self.endpoints.update(
            endpoint_id,
            description=update.description,
            group_id=update.group_id,
        )

    async def bulk_create(self, req: BulkCreateRequest) -> BulkResult:
        logger.info("bulk creating %d endpoints", len(req.items))
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
