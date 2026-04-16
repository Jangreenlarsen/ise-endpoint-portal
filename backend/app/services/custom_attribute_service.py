from __future__ import annotations

import logging
from typing import Any

from app.core.custom_attr_store import (
    MANAGED_ATTRS,
    add_value,
    load_values,
    merge_values,
    remove_value,
)
from app.ise.client import IseClient
from app.ise.custom_attributes import IseCustomAttributeRepository
from app.ise.endpoints import IseEndpointRepository
from app.schemas.custom_attribute import (
    AddValueRequest,
    AllCustomAttributes,
    CustomAttributeValues,
    SyncResult,
)

logger = logging.getLogger(__name__)


class CustomAttributeService:
    def __init__(self, client: IseClient) -> None:
        self.attrs = IseCustomAttributeRepository(client)
        self.endpoints = IseEndpointRepository(client)

    def list_all(self) -> AllCustomAttributes:
        data = load_values()
        return AllCustomAttributes(
            attributes=[
                CustomAttributeValues(name=name, values=vals)
                for name, vals in data.items()
            ]
        )

    def add_value(self, attr_name: str, req: AddValueRequest) -> AllCustomAttributes:
        if attr_name not in MANAGED_ATTRS:
            raise ValueError(f"Unknown attribute: {attr_name}")
        logger.info("adding value '%s' to attribute '%s'", req.value, attr_name)
        add_value(attr_name, req.value)
        return self.list_all()

    def remove_value(self, attr_name: str, value: str) -> AllCustomAttributes:
        if attr_name not in MANAGED_ATTRS:
            raise ValueError(f"Unknown attribute: {attr_name}")
        logger.info("removing value '%s' from attribute '%s'", value, attr_name)
        remove_value(attr_name, value)
        return self.list_all()

    async def sync_from_ise(self) -> SyncResult:
        """Scan ISE endpoints to discover custom attribute values in use,
        and ensure attribute definitions exist in ISE."""
        logger.info("syncing custom attributes from ISE")

        # 1. Ensure attribute definitions exist in ISE
        defs = await self.attrs.ensure_definitions(MANAGED_ATTRS)

        # 2. Scan endpoint pages to discover used values
        discovered: dict[str, set[str]] = {a: set() for a in MANAGED_ATTRS}
        scanned = 0
        page = 1
        while True:
            resources = await self.endpoints.list_page(page=page, size=100)
            if not resources:
                break
            for r in resources:
                ep = await self.endpoints.get(r["id"])
                ca = _extract_custom_attrs(ep)
                for attr in MANAGED_ATTRS:
                    val = ca.get(attr, "")
                    if val:
                        discovered[attr].add(val)
                scanned += 1
            if len(resources) < 100:
                break
            page += 1

        # 3. Merge discovered values into local store
        discovered_lists = {k: sorted(v) for k, v in discovered.items()}
        old = load_values()
        merge_values(discovered_lists)
        new_vals: dict[str, list[str]] = {}
        updated = load_values()
        for attr in MANAGED_ATTRS:
            diff = set(updated.get(attr, [])) - set(old.get(attr, []))
            if diff:
                new_vals[attr] = sorted(diff)

        logger.info(
            "sync done: scanned=%d, new_values=%s", scanned, new_vals
        )
        return SyncResult(
            scanned_endpoints=scanned,
            new_values_found=new_vals,
            definitions_ensured=defs,
        )


def _extract_custom_attrs(endpoint: dict[str, Any]) -> dict[str, str]:
    """Extract custom attributes from an ERSEndPoint response.

    Handles both double-nested and single-nested formats.
    """
    ca = endpoint.get("customAttributes", {})
    if isinstance(ca, dict):
        inner = ca.get("customAttributes", ca)
        if isinstance(inner, dict):
            return {k: str(v) for k, v in inner.items()}
    return {}
