"""ISE integration for custom endpoint attribute definitions.

ERS API does NOT support creating custom attribute definitions (returns 404).
ISE Open API (/api/v1/endpoint-custom-attribute) is used instead.
If Open API is unavailable, the user must create definitions manually in ISE GUI:
  Administration > Identity Management > Settings > Endpoint Custom Attributes
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.exceptions import IseApiError
from app.ise.client import IseClient

logger = logging.getLogger(__name__)

# Open API path for custom attribute definitions (ISE 3.1+)
OPENAPI_CUSTOM_ATTR = "/api/v1/endpoint-custom-attribute"


class IseCustomAttributeRepository:
    def __init__(self, client: IseClient) -> None:
        self.client = client

    async def list_definitions(self) -> list[dict[str, Any]]:
        """List all custom endpoint attribute definitions from ISE via Open API."""
        try:
            data = await self.client.get(OPENAPI_CUSTOM_ATTR)
            # Open API returns a flat list or a wrapped response
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                return data.get("response", data.get("SearchResult", {}).get("resources", []))
            return []
        except IseApiError as exc:
            logger.warning(
                "Could not list custom attribute definitions (status=%s): %s",
                exc.status_code, exc,
            )
            return []

    async def create_definition(self, name: str, attr_type: str = "String") -> bool:
        """Create a custom attribute definition in ISE via Open API.

        Returns True on success or if the attribute already exists.
        """
        payload = {
            "attributeName": name,
            "attributeType": attr_type,
        }
        try:
            await self.client.post(OPENAPI_CUSTOM_ATTR, json=payload)
            logger.info("created custom attribute definition: %s (%s)", name, attr_type)
            return True
        except IseApiError as exc:
            # 400 or 409 = attribute already exists
            if exc.status_code in (400, 409):
                logger.info("custom attribute '%s' already exists in ISE", name)
                return True
            if exc.status_code == 404:
                logger.error(
                    "Open API endpoint %s not found (404). "
                    "Ensure Open API is enabled in ISE: "
                    "Administration > System > Settings > API Settings > Open API. "
                    "Or create attribute '%s' manually: "
                    "Administration > Identity Management > Settings > "
                    "Endpoint Custom Attributes",
                    OPENAPI_CUSTOM_ATTR, name,
                )
                return False
            logger.warning("failed to create custom attribute '%s': %s", name, exc)
            return False

    async def ensure_definitions(self, names: list[str]) -> dict[str, bool]:
        """Ensure all named attributes exist as definitions in ISE.

        First checks which definitions already exist, then creates missing ones.
        Returns a dict of name -> success.
        """
        # Check what already exists
        existing = set()
        definitions = await self.list_definitions()
        for d in definitions:
            attr_name = d.get("attributeName") or d.get("name", "")
            if attr_name:
                existing.add(attr_name)
        logger.info("existing custom attribute definitions in ISE: %s", existing)

        results: dict[str, bool] = {}
        for name in names:
            if name in existing:
                logger.info("custom attribute '%s' already defined in ISE", name)
                results[name] = True
            else:
                results[name] = await self.create_definition(name)
        return results
