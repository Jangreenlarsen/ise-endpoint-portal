from __future__ import annotations

import logging
from typing import Any

from app.core.custom_attr_store import (
    ALL_ATTRS,
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
    RemoveValueResult,
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

    async def remove_value(self, attr_name: str, value: str) -> RemoveValueResult:
        """Remove an allowed value locally AND clear it on every ISE endpoint
        that currently holds it. Endpoints using the value are updated so the
        attribute becomes empty; other custom attributes on those endpoints
        are preserved."""
        if attr_name not in MANAGED_ATTRS:
            raise ValueError(f"Unknown attribute: {attr_name}")
        logger.info(
            "removing value '%s' from attribute '%s' — scanning ISE for usages",
            value, attr_name,
        )

        scanned = 0
        cleared = 0
        page = 1
        while True:
            resources, total = await self.endpoints.list_page(page=page, size=100)
            if not resources:
                break
            for r in resources:
                ep = await self.endpoints.get(r["id"])
                ca = _extract_custom_attrs(ep)
                if ca.get(attr_name) == value:
                    new_attrs = {k: v for k, v in ca.items() if k != attr_name}
                    await self.endpoints.set_custom_attributes(r["id"], new_attrs)
                    cleared += 1
                    logger.info(
                        "cleared %s='%s' on endpoint id=%s mac=%s",
                        attr_name, value, r["id"], r.get("name", ""),
                    )
                scanned += 1
            if scanned >= total or len(resources) < 100:
                break
            page += 1

        remove_value(attr_name, value)
        logger.info(
            "remove_value done: attr=%s value='%s' scanned=%d cleared=%d",
            attr_name, value, scanned, cleared,
        )
        all_attrs = self.list_all()
        return RemoveValueResult(
            attributes=all_attrs.attributes,
            scanned_endpoints=scanned,
            cleared_endpoints=cleared,
        )

    async def sync_from_ise(self) -> SyncResult:
        """Scan ISE endpoints to discover custom attribute values in use,
        and ensure attribute definitions exist in ISE."""
        logger.info("syncing custom attributes from ISE")

        # 1. Ensure attribute definitions exist in ISE (including hidden)
        defs = await self.attrs.ensure_definitions(ALL_ATTRS)

        # 2. Scan endpoint pages to discover used values
        discovered: dict[str, set[str]] = {a: set() for a in MANAGED_ATTRS}
        scanned = 0
        page = 1
        while True:
            resources, total = await self.endpoints.list_page(page=page, size=100)
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
            if scanned >= total or len(resources) < 100:
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
