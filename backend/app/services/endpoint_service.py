from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.core import config
from app.core.custom_attr_store import ALL_ATTRS, HIDDEN_ATTR
from app.core.exceptions import IseApiError
from app.ise import coa as coa_module
from app.ise import mnt_sessions
from app.ise.client import IseClient
from app.ise.custom_attributes import IseCustomAttributeRepository
from app.ise.endpoints import IseEndpointGroupRepository, IseEndpointRepository
from app.ise.openapi_endpoints import (
    OpenApiEndpointGroupRepository,
    OpenApiEndpointRepository,
)
from app.schemas.endpoint import (
    BulkCreateRequest,
    BulkFailure,
    BulkResult,
    CreateEndpointRequest,
    EndpointDetail,
    EndpointGroupSummary,
    EndpointSummary,
    EndpointUpdate,
    PaginatedEndpointDetails,
)

logger = logging.getLogger(__name__)

# Module-level flag: have we ensured custom attribute definitions in ISE this session?
_ca_definitions_ensured = False


class EndpointService:
    def __init__(self, client: IseClient) -> None:
        api_type = (config.settings.ise_api_type or "ers").lower()
        if api_type == "openapi":
            logger.info("EndpointService using Open API (/api/v1/endpoint)")
            self.endpoints = OpenApiEndpointRepository(client)
            self.groups = OpenApiEndpointGroupRepository(client)
        else:
            logger.info("EndpointService using ERS (/ers/config/endpoint)")
            self.endpoints = IseEndpointRepository(client)
            self.groups = IseEndpointGroupRepository(client)
        self.api_type = api_type
        self.custom_attrs = IseCustomAttributeRepository(client)

    async def _ensure_ca_definitions(self) -> None:
        """Ensure all custom attribute definitions exist in ISE (once per session)."""
        global _ca_definitions_ensured
        if _ca_definitions_ensured:
            return
        logger.info("ensuring custom attribute definitions exist in ISE (via Open API)")
        results = await self.custom_attrs.ensure_definitions(ALL_ATTRS)
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

    async def list_endpoints(
        self,
        page: int = 1,
        size: int = 100,
        search: str | None = None,
        filters: list[str] | None = None,
    ) -> list[EndpointSummary]:
        filters = _combine_filters(search, filters)
        raw, _ = await self.endpoints.list_page(page=page, size=size, filters=filters)
        logger.info(
            "listed %d endpoints (page=%d, search=%s)",
            len(raw), page, search or "",
        )
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
            static_group=bool(raw.get("staticGroupAssignment", False)),
            endpoint_type=ca.get("Type", ""),
            owner=ca.get("Owner", ""),
            lokation=ca.get("Lokation", ""),
            authz_vlan=ca.get("AuthzVlan", ""),
            authz_acl=ca.get("AuthzACL", ""),
            platform_type=ca.get("PlatformType", ""),
            hypervision=ca.get("HypervisionISEPortal", ""),
            profile_id=raw.get("profileId", "") or "",
            static_profile=bool(raw.get("staticProfileAssignment", False)),
            portal_user=raw.get("portalUser", "") or "",
            identity_store=raw.get("identityStore", "") or "",
            identity_store_id=raw.get("identityStoreId", "") or "",
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
        self,
        page: int = 1,
        size: int = 100,
        search: str | None = None,
        filters: list[str] | None = None,
    ) -> PaginatedEndpointDetails:
        """List endpoints with full details (concurrent fetches, max 5 parallel)."""
        filters = _combine_filters(search, filters)
        resources, total = await self.endpoints.list_page(
            page=page, size=size, filters=filters
        )
        logger.info(
            "fetching details for %d endpoints concurrently "
            "(page=%d, total=%d, search=%s)",
            len(resources), page, total, search or "",
        )
        sem = asyncio.Semaphore(5)

        async def fetch_one(r: dict[str, Any]) -> EndpointDetail:
            async with sem:
                try:
                    return await self.get_endpoint(r["id"])
                except IseApiError:
                    return EndpointDetail(
                        id=r.get("id", ""),
                        name=r.get("name", ""),
                        mac=r.get("name", ""),
                        description=r.get("description"),
                    )

        details = await asyncio.gather(*(fetch_one(r) for r in resources))
        return PaginatedEndpointDetails(
            items=list(details), total=total, page=page, size=size
        )

    async def list_all_endpoint_details(
        self,
        search: str | None = None,
        filters: list[str] | None = None,
    ) -> list[EndpointDetail]:
        """Fetch ALL endpoints with full details (all ISE pages, concurrent)."""
        filters = _combine_filters(search, filters)
        resources = await self.endpoints.list_all(filters=filters)
        logger.info(
            "fetching details for ALL %d endpoints concurrently (search=%s)",
            len(resources), search or "",
        )
        sem = asyncio.Semaphore(5)

        async def fetch_one(r: dict[str, Any]) -> EndpointDetail:
            async with sem:
                try:
                    return await self.get_endpoint(r["id"])
                except IseApiError:
                    return EndpointDetail(
                        id=r.get("id", ""),
                        name=r.get("name", ""),
                        mac=r.get("name", ""),
                        description=r.get("description"),
                    )

        details = await asyncio.gather(*(fetch_one(r) for r in resources))
        return list(details)

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

    async def create_endpoint(self, req: CreateEndpointRequest) -> str:
        """Create an endpoint and return the new ISE endpoint id."""
        logger.info(
            "creating endpoint mac=%s group=%s static=%s",
            req.mac, req.group_id, req.static_group_assignment,
        )
        ca = req.custom_attributes.model_dump() if req.custom_attributes else {}
        # Always stamp endpoints created by this portal
        ca[HIDDEN_ATTR] = "true"
        await self._ensure_ca_definitions()
        # Bevar eksplicit staticGroupAssignment hvis angivet (fx fra CSV-import),
        # ellers default til True som ISE forventer når groupId er sat.
        static_flag = (
            req.static_group_assignment
            if req.static_group_assignment is not None
            else True
        )
        new_id = await self.endpoints.create(
            mac=req.mac,
            group_id=req.group_id,
            description=req.description,
            static=static_flag,
            custom_attributes=ca,
        )
        logger.info("created endpoint mac=%s id=%s", req.mac, new_id)
        return new_id

    async def delete_endpoint(self, endpoint_id: str) -> None:
        logger.info("deleting endpoint id=%s", endpoint_id)
        await self.endpoints.delete(endpoint_id)

    async def coa_reauth(self, endpoint_id: str) -> tuple[bool, str, str]:
        """Trigger CoA reauth for an endpoint. Returns (ok, mac, message)."""
        raw = await self.endpoints.get(endpoint_id)
        mac = raw.get("mac") or raw.get("name") or ""
        if not mac:
            return False, "", "Endpoint har ingen MAC-adresse"
        ok, msg = await coa_module.reauth(mac)
        return ok, mac, msg

    async def list_active_session_macs(self) -> list[str]:
        """Return normalised MAC list for all endpoints with an active RADIUS
        session in ISE MnT. Used by Browse/Edit to color row checkboxes
        green (active session / auth in access) vs red (no active session).
        """
        sessions = await mnt_sessions.fetch_active_sessions()
        macs: set[str] = set()
        for sess in sessions:
            raw = (
                sess.get("calling_station_id", "")
                or sess.get("callingstationid", "")
                or sess.get("user_name", "")
                or sess.get("username", "")
                or ""
            )
            mac = raw.replace("-", ":").strip().upper()
            if len(mac) == 17 and mac.count(":") == 5:
                macs.add(mac)
        return sorted(macs)

    async def coa_disconnect(self, endpoint_id: str) -> tuple[bool, str, str]:
        """Trigger CoA disconnect (deauth) for an endpoint. Returns (ok, mac, message)."""
        raw = await self.endpoints.get(endpoint_id)
        mac = raw.get("mac") or raw.get("name") or ""
        if not mac:
            return False, "", "Endpoint har ingen MAC-adresse"
        ok, msg = await coa_module.disconnect(mac)
        return ok, mac, msg

    async def update_endpoint(self, endpoint_id: str, update: EndpointUpdate) -> None:
        logger.info(
            "updating endpoint id=%s fields=%s",
            endpoint_id,
            update.model_dump(exclude_unset=True),
        )
        ca = update.custom_attributes.model_dump() if update.custom_attributes else {}
        # Always stamp endpoints edited through this portal
        ca[HIDDEN_ATTR] = "true"
        await self._ensure_ca_definitions()
        await self.endpoints.update(
            endpoint_id,
            description=update.description,
            group_id=update.group_id,
            static_group_assignment=update.static_group_assignment,
            custom_attributes=ca,
        )

    async def bulk_create(self, req: BulkCreateRequest) -> BulkResult:
        logger.info(
            "bulk creating %d endpoints (overwrite=%s)",
            len(req.items), req.overwrite,
        )
        # Pre-ensure definitions if any item has custom attributes
        if any(item.custom_attributes for item in req.items):
            await self._ensure_ca_definitions()
        succeeded: list[str] = []
        skipped: list[str] = []
        overwritten: list[str] = []
        failed: list[BulkFailure] = []
        for idx, item in enumerate(req.items):
            try:
                await self.create_endpoint(item)
                succeeded.append(item.mac)
            except IseApiError as exc:
                # ISE signalerer "findes allerede" som 409 ELLER som 500
                # med "already exists" i fejlteksten (ERS-adfærd i 3.4).
                is_conflict = exc.status_code == 409 or (
                    exc.status_code == 500
                    and "already exist" in str(exc).lower()
                )
                if is_conflict:
                    if req.overwrite:
                        try:
                            await self._overwrite_existing(item)
                            overwritten.append(item.mac)
                        except IseApiError as update_exc:
                            failed.append(
                                BulkFailure(
                                    mac=item.mac,
                                    error=f"overwrite fejlede: {update_exc}",
                                )
                            )
                        except ValueError as not_found_exc:
                            failed.append(
                                BulkFailure(mac=item.mac, error=str(not_found_exc))
                            )
                    else:
                        skipped.append(item.mac)
                else:
                    failed.append(BulkFailure(mac=item.mac, error=str(exc)))
            # Throttle: 150ms between ISE calls to stay within Cisco's 5-10 req/sec limit
            if idx < len(req.items) - 1:
                await asyncio.sleep(0.15)
        logger.info(
            "bulk done: %d ok, %d skipped, %d overwritten, %d failed",
            len(succeeded), len(skipped), len(overwritten), len(failed),
        )
        return BulkResult(
            succeeded=succeeded,
            skipped=skipped,
            overwritten=overwritten,
            failed=failed,
        )

    async def _overwrite_existing(self, item: CreateEndpointRequest) -> None:
        """Locate an existing endpoint by MAC and overwrite its fields with
        the values from the import item. Raises ValueError if not found."""
        existing = await self.endpoints.get_by_mac(item.mac)
        if not existing:
            raise ValueError(
                f"409 ved create, men endpoint med MAC {item.mac} blev ikke fundet"
            )
        endpoint_id = existing.get("id", "") or ""
        if not endpoint_id:
            raise ValueError(
                f"eksisterende endpoint for {item.mac} har intet id"
            )
        # Bevar eksplicit staticGroupAssignment hvis angivet (fx fra CSV),
        # ellers afled af om gruppen er sat — så vi ikke utilsigtet skifter
        # Statisk↔Dynamisk ved re-import.
        static_flag = (
            item.static_group_assignment
            if item.static_group_assignment is not None
            else bool(item.group_id)
        )
        update = EndpointUpdate(
            description=item.description,
            group_id=item.group_id or None,
            static_group_assignment=static_flag,
            custom_attributes=item.custom_attributes,
        )
        await self.update_endpoint(endpoint_id, update)


def _extract_custom_attrs(endpoint: dict[str, Any]) -> dict[str, str]:
    """Extract custom attributes from an ERSEndPoint response."""
    ca = endpoint.get("customAttributes", {})
    if isinstance(ca, dict):
        inner = ca.get("customAttributes", ca)
        if isinstance(inner, dict):
            return {k: str(v) for k, v in inner.items()}
    return {}


def _build_search_filters(search: str | None) -> list[str] | None:
    """Convert a free-text search string into ERS filter expressions.

    A non-empty search is mapped to `mac.CONTAINS.<value>` which is the
    most common lookup. ERS only supports filtering on a fixed set of
    fields (mac, name, description, groupId, profileId, ...); any richer
    multi-field OR needs to be handled with multiple calls — out of scope
    here.
    """
    if not search or not search.strip():
        return None
    value = search.strip()
    return [f"mac.CONTAINS.{value}"]


def _combine_filters(
    search: str | None, explicit: list[str] | None
) -> list[str] | None:
    """Merge explicit ERS filter expressions with a free-text search shortcut.

    Explicit filters take precedence. If only `search` is provided, it is
    expanded via `_build_search_filters` (mac.CONTAINS). Both can be used
    together — they're ANDed by ERS.
    """
    filters: list[str] = []
    if explicit:
        filters.extend(f for f in explicit if f and f.strip())
    search_filters = _build_search_filters(search)
    if search_filters:
        filters.extend(search_filters)
    return filters or None
