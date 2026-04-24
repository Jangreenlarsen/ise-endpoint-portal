from __future__ import annotations

import logging
from typing import Any

from app.core import audit_store
from app.core.custom_attr_store import (
    ALL_ATTRS,
    MANAGED_ATTRS,
    add_value,
    load_values,
    merge_values,
    remove_value,
    save_values,
)
from app.core.endpoint_cache import get_cache
from app.core.platform_mapping_store import (
    load_mapping as load_platform_mapping,
    raw_to_local as platform_raw_to_local,
    save_mapping as save_platform_mapping,
)
from app.core.platform_types import KNOWN_PLATFORM_TYPES
from app.ise import mnt_sessions
from app.ise.client import IseClient
from app.ise.custom_attributes import IseCustomAttributeRepository
from app.ise.endpoints import IseEndpointRepository
from app.schemas.custom_attribute import (
    AddValueRequest,
    AllCustomAttributes,
    CustomAttributeValues,
    PlatformMapping,
    PlatformMappingRow,
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

    async def add_value(
        self, attr_name: str, req: AddValueRequest
    ) -> AllCustomAttributes:
        if attr_name not in MANAGED_ATTRS:
            raise ValueError(f"Unknown attribute: {attr_name}")
        logger.info("adding value '%s' to attribute '%s'", req.value, attr_name)
        before = load_values().get(attr_name, [])
        add_value(attr_name, req.value)
        after = load_values().get(attr_name, [])
        await audit_store.record(
            "value_added",
            "custom_attribute",
            attr_name,
            before={"values": before},
            after={"values": after, "added": req.value},
        )
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
                    # ISE ERS merges customAttributes on PUT — omitting the
                    # key leaves the old value in place, so next sync re-adds
                    # the "deleted" value. Explicitly send it as empty string.
                    new_attrs = dict(ca)
                    new_attrs[attr_name] = ""
                    await self.endpoints.set_custom_attributes(r["id"], new_attrs)
                    get_cache().invalidate_detail(r["id"])
                    cleared += 1
                    logger.info(
                        "cleared %s='%s' on endpoint id=%s mac=%s",
                        attr_name, value, r["id"], r.get("name", ""),
                    )
                scanned += 1
            if scanned >= total or len(resources) < 100:
                break
            page += 1

        before_vals = load_values().get(attr_name, [])
        remove_value(attr_name, value)
        after_vals = load_values().get(attr_name, [])
        logger.info(
            "remove_value done: attr=%s value='%s' scanned=%d cleared=%d",
            attr_name, value, scanned, cleared,
        )
        await audit_store.record(
            "value_removed",
            "custom_attribute",
            attr_name,
            before={"values": before_vals},
            after={
                "values": after_vals,
                "removed": value,
                "scanned_endpoints": scanned,
                "cleared_endpoints": cleared,
            },
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

        For ``PlatformType`` this means discovering whatever local labels
        are already on endpoints (no canonicalisation, no clearing) — the
        canonical raw values live in :data:`KNOWN_PLATFORM_TYPES` and are
        only used by the MnT sync, which translates raw → local via the
        platform mapping store.
        """
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
            "sync done: scanned=%d, new_values=%s", scanned, new_vals,
        )
        return SyncResult(
            scanned_endpoints=scanned,
            new_values_found=new_vals,
            definitions_ensured=defs,
        )

    async def sync_platform_from_mnt(
        self, *, overwrite: bool = False
    ) -> PlatformSyncResult:
        """Pull active sessions from MnT, derive raw PlatformType per endpoint,
        translate raw → local via the platform mapping store, and write the
        *local* label to the endpoint.

        Default: only fill empty PlatformType — manual values win. Set
        ``overwrite=True`` to force. Endpoints whose derived raw has no
        mapping row (or maps to an empty local label) are skipped and
        reported in ``unmapped_raw``.
        """
        logger.info(
            "PlatformType MnT sync starting (overwrite=%s)", overwrite,
        )
        # 1. Pull MnT sessions.
        sessions = await mnt_sessions.fetch_active_sessions()
        mac_to_raw = mnt_sessions.index_by_mac(sessions)
        logger.info(
            "MnT sync: %d sessions, %d with derivable platform",
            len(sessions), len(mac_to_raw),
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

        # 3. Load raw → local mapping (skips rows with empty local).
        mapping = platform_raw_to_local()
        logger.info("PlatformType mapping: %d raw values mapped", len(mapping))

        # 4. Update endpoints whose MnT-derived platform translates to a
        # mapped local label. Unmapped raws are tracked but not written.
        matched = 0
        updated = 0
        skipped = 0
        skipped_unmapped = 0
        unmatched = 0
        new_values: set[str] = set()
        unmapped_raw: set[str] = set()
        for mac, raw in mac_to_raw.items():
            ep_meta = mac_to_endpoint.get(mac)
            if not ep_meta:
                unmatched += 1
                continue
            matched += 1
            local = mapping.get(raw, "")
            if not local:
                skipped_unmapped += 1
                unmapped_raw.add(raw)
                continue
            ep = await self.endpoints.get(ep_meta["id"])
            ca = _extract_custom_attrs(ep)
            existing = ca.get("PlatformType", "")
            if existing and not overwrite:
                skipped += 1
                continue
            if existing == local:
                skipped += 1
                continue
            new_attrs = dict(ca)
            new_attrs["PlatformType"] = local
            await self.endpoints.set_custom_attributes(ep_meta["id"], new_attrs)
            get_cache().invalidate_detail(ep_meta["id"])
            updated += 1
            new_values.add(local)
            logger.info(
                "PlatformType: set '%s' (raw=%s, was '%s') on endpoint mac=%s",
                local, raw, existing or "—", mac,
            )

        # 5. Merge any newly written local labels into the local PlatformType
        # value store so they show up in the dropdown without needing a
        # separate sync_from_ise pass.
        if new_values:
            current = load_values()
            existing_pt = set(current.get("PlatformType", []))
            current["PlatformType"] = sorted(existing_pt | new_values)
            save_values(current)

        result = PlatformSyncResult(
            active_sessions=len(sessions),
            matched_endpoints=matched,
            updated_endpoints=updated,
            skipped_existing=skipped,
            skipped_unmapped=skipped_unmapped,
            new_values_found=sorted(new_values),
            unmapped_raw=sorted(unmapped_raw),
            unmatched_macs=unmatched,
        )
        logger.info("PlatformType MnT sync done: %s", result.model_dump())
        return result

    def get_platform_mapping(self) -> PlatformMapping:
        """Return the current raw→local PlatformType mapping, padded with
        empty rows for any KNOWN raw value the user hasn't bound yet so the
        editor always shows one row per known raw."""
        rows = {r["raw"]: r for r in load_platform_mapping()}
        out: list[PlatformMappingRow] = []
        for raw in KNOWN_PLATFORM_TYPES:
            r = rows.get(raw, {"raw": raw, "local": "", "coa": "reauth"})
            out.append(PlatformMappingRow(
                raw=r["raw"], local=r.get("local", ""),
                coa=r.get("coa", "reauth"),
            ))
        return PlatformMapping(mappings=out)

    async def set_platform_mapping(
        self, payload: PlatformMapping
    ) -> PlatformMapping:
        """Persist a new raw→local mapping. Validates raws against
        KNOWN_PLATFORM_TYPES and CoA against (reauth, disconnect)."""
        before = load_platform_mapping()
        rows = [r.model_dump() for r in payload.mappings]
        saved = save_platform_mapping(rows)
        logger.info("PlatformType mapping saved: %d rows", len(saved))
        await audit_store.record(
            "mapping_updated",
            "platform_mapping",
            None,
            before={"rows": before},
            after={"rows": saved},
        )
        return self.get_platform_mapping()


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
