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
    save_values,
)
from app.core.platform_types import KNOWN_PLATFORM_TYPES
from app.core.platform_types import normalize as normalize_platform
from app.ise import mnt_sessions
from app.ise.client import IseClient
from app.ise.custom_attributes import IseCustomAttributeRepository
from app.ise.endpoints import IseEndpointRepository
from app.schemas.custom_attribute import (
    AddValueRequest,
    AllCustomAttributes,
    CustomAttributeValues,
    PlatformSyncResult,
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
        and ensure attribute definitions exist in ISE.

        ``PlatformType`` is special-cased: only canonical values
        (:data:`KNOWN_PLATFORM_TYPES`) are accepted. Endpoints that hold a
        non-canonical value get ``PlatformType`` cleared on ISE during the
        same scan, and only canonical values land in the local store.
        """
        logger.info("syncing custom attributes from ISE")

        # 1. Ensure attribute definitions exist in ISE (including hidden)
        defs = await self.attrs.ensure_definitions(ALL_ATTRS)

        # 2. Scan endpoint pages to discover used values
        discovered: dict[str, set[str]] = {a: set() for a in MANAGED_ATTRS}
        scanned = 0
        cleared_platform = 0
        normalised_platform = 0
        page = 1
        while True:
            resources, total = await self.endpoints.list_page(page=page, size=100)
            if not resources:
                break
            for r in resources:
                ep = await self.endpoints.get(r["id"])
                ca = _extract_custom_attrs(ep)
                # PlatformType: canonicalise or clear on ISE.
                raw_pt = ca.get("PlatformType", "")
                if raw_pt:
                    canonical = normalize_platform(raw_pt)
                    if canonical is None:
                        # Clear non-canonical value from the endpoint.
                        new_attrs = {k: v for k, v in ca.items() if k != "PlatformType"}
                        await self.endpoints.set_custom_attributes(r["id"], new_attrs)
                        cleared_platform += 1
                        logger.info(
                            "PlatformType: cleared non-canonical '%s' on endpoint mac=%s",
                            raw_pt, r.get("name", ""),
                        )
                    else:
                        if canonical != raw_pt:
                            # Rewrite endpoint with canonical form (e.g. "9800" → "iosxe").
                            new_attrs = dict(ca)
                            new_attrs["PlatformType"] = canonical
                            await self.endpoints.set_custom_attributes(r["id"], new_attrs)
                            normalised_platform += 1
                            logger.info(
                                "PlatformType: normalised '%s' -> '%s' on endpoint mac=%s",
                                raw_pt, canonical, r.get("name", ""),
                            )
                        discovered["PlatformType"].add(canonical)
                # Other managed attributes: free-text, just record values.
                for attr in MANAGED_ATTRS:
                    if attr == "PlatformType":
                        continue
                    val = ca.get(attr, "")
                    if val:
                        discovered[attr].add(val)
                scanned += 1
            if scanned >= total or len(resources) < 100:
                break
            page += 1

        # 3. Replace PlatformType store with canonical-only set.
        # Other attributes: merge as before.
        discovered_lists = {k: sorted(v) for k, v in discovered.items()}
        old = load_values()
        # PlatformType: replace, never accumulate stale values
        current = load_values()
        canonical_seen = discovered["PlatformType"]
        # Keep only canonical entries that are also in KNOWN_PLATFORM_TYPES.
        current["PlatformType"] = sorted(
            v for v in canonical_seen if v in KNOWN_PLATFORM_TYPES
        )
        save_values(current)
        # Merge non-PlatformType discoveries.
        non_pt = {k: v for k, v in discovered_lists.items() if k != "PlatformType"}
        merge_values(non_pt)
        new_vals: dict[str, list[str]] = {}
        updated = load_values()
        for attr in MANAGED_ATTRS:
            diff = set(updated.get(attr, [])) - set(old.get(attr, []))
            if diff:
                new_vals[attr] = sorted(diff)

        logger.info(
            "sync done: scanned=%d, new_values=%s, "
            "platform_cleared=%d, platform_normalised=%d",
            scanned, new_vals, cleared_platform, normalised_platform,
        )
        return SyncResult(
            scanned_endpoints=scanned,
            new_values_found=new_vals,
            definitions_ensured=defs,
        )

    async def sync_platform_from_mnt(
        self, *, overwrite: bool = False
    ) -> PlatformSyncResult:
        """Pull active sessions from MnT, derive PlatformType per endpoint
        and store it. Default: only fill empty PlatformType — manual values
        win. Set ``overwrite=True`` to force.
        """
        logger.info(
            "PlatformType MnT sync starting (overwrite=%s)", overwrite,
        )
        # 1. Pull MnT sessions.
        sessions = await mnt_sessions.fetch_active_sessions()
        mac_to_platform = mnt_sessions.index_by_mac(sessions)
        logger.info(
            "MnT sync: %d sessions, %d with derivable platform",
            len(sessions), len(mac_to_platform),
        )

        # 2. Build {MAC: endpoint_id} from ERS endpoint list.
        mac_to_endpoint: dict[str, dict[str, object]] = {}
        page = 1
        while True:
            resources, total = await self.endpoints.list_page(page=page, size=100)
            if not resources:
                break
            for r in resources:
                mac = (r.get("name", "") or r.get("mac", "")).strip().upper()
                if mac:
                    mac_to_endpoint[mac] = r
            scanned_so_far = (page - 1) * 100 + len(resources)
            if scanned_so_far >= total or len(resources) < 100:
                break
            page += 1

        # 3. Update endpoints whose MnT-derived platform differs.
        matched = 0
        updated = 0
        skipped = 0
        unmatched = 0
        new_values: set[str] = set()
        for mac, canonical in mac_to_platform.items():
            ep_meta = mac_to_endpoint.get(mac)
            if not ep_meta:
                unmatched += 1
                continue
            matched += 1
            ep = await self.endpoints.get(ep_meta["id"])
            ca = _extract_custom_attrs(ep)
            existing = ca.get("PlatformType", "")
            if existing and not overwrite:
                skipped += 1
                continue
            if existing == canonical:
                skipped += 1
                continue
            new_attrs = dict(ca)
            new_attrs["PlatformType"] = canonical
            await self.endpoints.set_custom_attributes(ep_meta["id"], new_attrs)
            updated += 1
            new_values.add(canonical)
            logger.info(
                "PlatformType: set '%s' (was '%s') on endpoint mac=%s",
                canonical, existing or "—", mac,
            )

        # 4. Refresh PlatformType store: keep only canonical values seen now
        # plus any canonical values already on endpoints we didn't touch.
        # Simplest: union the new_values with any canonical values already
        # known from a prior sync_from_ise.
        current = load_values()
        existing_pt = set(current.get("PlatformType", []))
        merged = {v for v in (existing_pt | new_values) if v in KNOWN_PLATFORM_TYPES}
        current["PlatformType"] = sorted(merged)
        save_values(current)

        result = PlatformSyncResult(
            active_sessions=len(sessions),
            matched_endpoints=matched,
            updated_endpoints=updated,
            skipped_existing=skipped,
            new_values_found=sorted(new_values),
            unmatched_macs=unmatched,
        )
        logger.info("PlatformType MnT sync done: %s", result.model_dump())
        return result


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
