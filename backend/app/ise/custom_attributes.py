"""ISE ERS integration for custom endpoint attribute definitions."""
from __future__ import annotations

import logging
from typing import Any

from app.core.exceptions import IseApiError
from app.ise.client import IseClient

logger = logging.getLogger(__name__)

ERS_CUSTOM_ATTR = "/ers/config/endpointcustomattribute"


class IseCustomAttributeRepository:
    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_definitions(self) -> list[dict[str, Any]]:
        """List all custom endpoint attribute definitions from ISE."""
        try:
            data = await self.client.get(ERS_CUSTOM_ATTR, params={"size": 100})
            return data.get("SearchResult", {}).get("resources", []) if data else []
        except IseApiError:
            logger.warning("Could not list custom attribute definitions from ISE")
            return []

    async def create_definition(self, name: str, attr_type: str = "String") -> bool:
        """Create a custom attribute definition in ISE. Returns True on success."""
        payload = {
            "ERSEndPointCustomAttribute": {
                "attributeName": name,
                "attributeType": attr_type,
            }
        }
        try:
            await self.client.post(ERS_CUSTOM_ATTR, json=payload)
            logger.info("created custom attribute definition: %s (%s)", name, attr_type)
            return True
        except IseApiError as exc:
            if exc.status_code == 409:
                logger.info("custom attribute %s already exists in ISE", name)
                return True
            logger.warning("failed to create custom attribute %s: %s", name, exc)
            return False

    async def ensure_definitions(self, names: list[str]) -> dict[str, bool]:
        """Ensure all named attributes exist as definitions in ISE."""
        results: dict[str, bool] = {}
        for name in names:
            results[name] = await self.create_definition(name)
        return results
