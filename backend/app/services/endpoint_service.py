# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

from app.core import audit_store, config, first_seen_store, guest_expiry_store
from app.core.metrics import BULK_ITEMS
from app.core.custom_attr_store import (
    ACTIVE_ATTR,
    ALL_ATTRS,
    HIDDEN_ATTR,
    PSK_KEY_ATTR,
    PSK_MODE_ATTR,
    REGISTERED_AT_ATTR,
    ROLES_ATTR,
    STATUS_ATTR,
    auto_discover_values as _discover_ca_values,
)
from app.core.endpoint_cache import get_cache
from app.core.exceptions import IseApiError
from app.core.oui_lookup import lookup as oui_lookup
from app.ise import anc as anc_module
from app.ise import coa as coa_module
from app.ise import mnt_sessions
from app.ise import profiler as profiler_module
from app.ise.client import IseClient
from app.ise.custom_attributes import IseCustomAttributeRepository
from app.ise.endpoints import IseEndpointGroupRepository, IseEndpointRepository
from app.ise.openapi_endpoints import (
    OpenApiEndpointGroupRepository,
    OpenApiEndpointRepository,
)
from app.schemas.endpoint import (
    BulkApplyTemplateRequest,
    BulkCreateRequest,
    BulkDecommissionRequest,
    BulkFailure,
    BulkResult,
    CreateEndpointRequest,
    EndpointDetail,
    EndpointGroupSummary,
    EndpointSummary,
    EndpointUpdate,
    PaginatedEndpointDetails,
)
from app.services._endpoint_helpers import (
    PSK_MASKED,
    PSK_IPSK_PREFIX,
    _apply_auto_tag,
    _combine_filters,
    _endpoint_visible,
    _extract_custom_attrs,
    _full_text_filter,
    _mask_psk,
    _parse_roles_csv,
    _psk_decode,
    _psk_encode,
    _psk_encode_ca,
    _validate_psk,
)

logger = logging.getLogger(__name__)


def _parse_iso_ts(iso: str) -> float | None:
    """Parse ISO 8601 UTC string to Unix timestamp. Returns None on failure."""
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


# Module-level flag: have we ensured custom attribute definitions in ISE this session?
_ca_definitions_ensured = False


def _sync_guest_expiry(endpoint_id: str, mac: str, ca: dict[str, str]) -> None:
    """Opdatér guest expiry tracking ud fra de CustomAttributes der netop er gemt.

    Registrerer endpoint hvis GuestRegistration=true og GuestExperyDate er sat.
    Fjerner det fra tracking hvis gæsteregistrering er slukket eller dato er fjernet.
    """
    try:
        guest_reg   = ca.get("GuestRegistration", "").lower()
        expiry_str  = ca.get("GuestExperyDate", "").strip()
        if guest_reg == "true" and expiry_str:
            guest_expiry_store.upsert(endpoint_id, mac, expiry_str)
        else:
            guest_expiry_store.remove(endpoint_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("guest expiry sync fejlede for %s: %s", endpoint_id, exc)


# --------------------------------------------------------------------------- #
# Shared endpoint-group name cache                                            #
# --------------------------------------------------------------------------- #
# id -> short group name, shared across ALL EndpointService instances.
#
# Root cause of the long-standing ISE `/ers/config/endpointgroup` ReadTimeout /
# circuit-breaker storm (BUGS.md 6.21.0721): the drip-refresh loop recreates an
# EndpointService every tick, so the previous *per-instance* _group_cache was
# always empty and _resolve_group_name fell through to groups.list_all() — a
# 1 + N-call fetch of the whole group hierarchy — on essentially every drip
# refresh. At ~1 refresh/5s that sustained thousands of ISE ERS calls/hour on
# the group endpoint, which ISE cannot service → timeouts → retries → the CB
# cycling OPEN/CLOSED all day.
#
# Sharing the map at module level (TTL'd, coalesced via one lock) means the
# hierarchy is fetched at most once per cache_ttl_seconds no matter how many
# services are created. Short names are preserved (identical to old behaviour).
# A failed refresh keeps serving the previous map and backs off ~30s.
_shared_group_names: dict[str, str] = {}
_shared_group_names_at: float = 0.0
_shared_group_names_lock: asyncio.Lock | None = None


def invalidate_group_names() -> None:
    """Force the next group-name lookup to refetch from ISE.

    Call after a group create/delete/rename so the change is reflected
    immediately instead of waiting for the TTL to expire.
    """
    global _shared_group_names_at
    _shared_group_names_at = 0.0


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
        self.client = client

    async def _ensure_ca_definitions(self) -> None:
        """Ensure all custom attribute definitions exist in ISE (once per session)."""
        global _ca_definitions_ensured
        if _ca_definitions_ensured:
            return
        logger.info("ensuring custom attribute definitions exist in ISE (via Open API)")
        results = await self.custom_attrs.ensure_definitions(ALL_ATTRS)
        logger.info("custom attribute definitions: %s", results)
        failed = [name for name, status in results.items() if status == "failed"]
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
        effective_roles: list[str] | None = None,
    ) -> list[EndpointSummary]:
        if effective_roles is not None:
            # Non-admin: filtrér via detail-fetch så vi kan inspicere
            # HypervisionRoles-CA. Lidt langsommere, men den eneste
            # pålidelige måde: ERS understøtter ikke CA-filter på 3.4.
            details = await self.list_endpoint_details(
                page=page,
                size=size,
                search=search,
                filters=filters,
                effective_roles=effective_roles,
            )
            return [
                EndpointSummary(
                    id=d.id,
                    name=d.name,
                    description=d.description,
                    vendor=d.vendor,
                )
                for d in details.items
            ]
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
                vendor=profiler_module.resolve_name_sync(r.get("profileId", "")) or oui_lookup(r.get("name", "")),
            )
            for r in raw
        ]

    async def get_endpoint(
        self,
        endpoint_id: str,
        effective_roles: list[str] | None = None,
        is_psk_editor: bool = False,
        force_fresh: bool = False,
    ) -> EndpointDetail:
        """Fetch full endpoint details from ISE including custom attributes.

        Cache-backed: repeated reads within TTL return from memory; stale
        entries can be served while a background refresh runs (see
        ``endpoint_cache``).

        force_fresh=True bypasser cachen (eller disk-stale entries) og
        henter direkte fra ISE — bruges af edit-modal så brugeren altid
        ser aktuelle data på det endpoint de er ved at redigere.

        Hvis ``effective_roles`` er sat (non-admin), tjekkes synlighed mod
        endpointets ``HypervisionRoles``. Out-of-scope rejses som
        ``IseApiError(404)`` så API-laget kan returnere 404 (ikke 403,
        så scope-grænsen ikke leakes).

        PSK_Key maskeres til ``PSK_MASKED`` medmindre ``is_psk_editor=True``.
        """
        cache = get_cache()
        detail = await cache.get_detail(
            endpoint_id,
            lambda: self._fetch_endpoint_detail(endpoint_id),
            force_fresh=force_fresh,
        )
        # Sæt cache_stale flag baseret på om entry er fra disk
        if cache.is_from_disk(endpoint_id):
            detail = detail.model_copy(update={"cache_stale": True})
        elif detail.cache_stale:
            detail = detail.model_copy(update={"cache_stale": False})
        if effective_roles is not None and not _endpoint_visible(detail, effective_roles):
            raise IseApiError(404, f"Endpoint {endpoint_id} not found")
        if not is_psk_editor:
            detail = _mask_psk(detail)
        return detail

    async def _fetch_endpoint_detail(self, endpoint_id: str) -> EndpointDetail:
        raw = await self.endpoints.get(endpoint_id)
        ca = _extract_custom_attrs(raw)
        _discover_ca_values(ca)
        group_id = raw.get("groupId", "")
        profile_id = (
            raw.get("profileId", "")
            or raw.get("endpointProfileId", "")
            or ""
        )

        group_name = await self._resolve_group_name(group_id) if group_id else ""

        # Open API returnerer profil-navn som streng direkte i "endpointProfile".
        # Brug det hvis tilgængeligt — ingen ISE-kald nødvendig.
        # ERS returnerer kun profileId (UUID); lazy fetch henter navnet derfra.
        inline_name: str = raw.get("endpointProfile", "") or ""
        if inline_name and profile_id:
            profiler_module.store(profile_id, inline_name)
        profiler_name = inline_name or await profiler_module.resolve_name_lazy(self.client, profile_id)

        mac_val = raw.get("mac", "") or raw.get("name", "")

        # Timestamps: Open API returnerer createTime/updateTime direkte.
        # ERS returnerer ikke timestamps — brug HypervisionRegisteredAt CA,
        # og som sidste udvej audit-loggens ældste 'created'-event for endpoint'et.
        create_time = (
            raw.get("createTime", "")
            or raw.get("createdAt", "")
            or ca.get(REGISTERED_AT_ATTR, "")
            or audit_store.get_endpoint_create_time(endpoint_id)
            or ""
        )
        update_time = raw.get("updateTime", "") or raw.get("updatedAt", "") or ""

        return EndpointDetail(
            id=raw.get("id", endpoint_id),
            name=raw.get("name", ""),
            mac=mac_val,
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
            registret_by=ca.get("RegistretBy", ""),
            guest_registration=ca.get("GuestRegistration", ""),
            hypervision=ca.get("HypervisionISEPortal", ""),
            roles=_parse_roles_csv(ca.get(ROLES_ATTR, "")),
            profile_id=profile_id,
            profiler_name=profiler_name,
            static_profile=bool(raw.get("staticProfileAssignment", False)),
            portal_user=raw.get("portalUser", "") or "",
            identity_store=raw.get("identityStore", "") or "",
            identity_store_id=raw.get("identityStoreId", "") or "",
            vendor=profiler_name or oui_lookup(mac_val),
            psk_mode=ca.get(PSK_MODE_ATTR, "").lower() == "true",
            psk_key=_psk_decode(ca.get(PSK_KEY_ATTR, "")),
            status=ca.get(STATUS_ATTR, ""),
            active_status=ca.get(ACTIVE_ATTR, ""),
            guest_expery_date=ca.get("GuestExperyDate", ""),
            guest_access_expire=ca.get("GuestAccessExpire", ""),
            create_time=create_time,
            update_time=update_time,
            first_seen_at=first_seen_store.record(
                mac_val, endpoint_id,
                seed_ts=_parse_iso_ts(ca.get(REGISTERED_AT_ATTR, "")),
            ),
        )

    async def _resolve_group_name(self, group_id: str) -> str:
        """Look up an endpoint-group's short name by ID. Empty string on failure.

        Resolves via the shared, TTL'd group-name cache (_shared_group_names) so
        repeated lookups — drip refresh, full scan, request paths — share a single
        ISE fetch instead of each calling groups.list_all().
        """
        if not group_id:
            return ""
        names = await self._get_group_names()
        return names.get(group_id, "")

    async def _get_group_names(self, force: bool = False) -> dict[str, str]:
        """Return the shared id->short-name map, refreshing from ISE at most once
        per cache_ttl_seconds. Concurrent callers coalesce on one lock so only a
        single groups.list_all() runs per refresh window. On ISE failure the
        previous map is served and the next attempt is backed off ~30s.
        """
        global _shared_group_names, _shared_group_names_at, _shared_group_names_lock
        ttl = float(getattr(config.settings, "cache_ttl_seconds", 300.0))
        if not force and (time.time() - _shared_group_names_at) <= ttl:
            return _shared_group_names
        if _shared_group_names_lock is None:
            _shared_group_names_lock = asyncio.Lock()
        async with _shared_group_names_lock:
            # Re-check inside the lock: another coroutine may have refreshed while
            # we were waiting, in which case we serve its result without refetching.
            if not force and (time.time() - _shared_group_names_at) <= ttl:
                return _shared_group_names
            try:
                raw = await self.groups.list_all()
                _shared_group_names = {g.get("id", ""): g.get("name", "") for g in raw}
                _shared_group_names_at = time.time()
                logger.info("group-name cache refreshed (%d groups)", len(_shared_group_names))
            except IseApiError:
                # ISE unavailable — keep the previous map (possibly empty on cold
                # start) and back off ~30s before retrying, rather than refetching
                # on every lookup. The circuit breaker independently fast-fails.
                _shared_group_names_at = time.time() - ttl + 30.0
        return _shared_group_names

    async def list_endpoint_details(
        self,
        page: int = 1,
        size: int = 100,
        search: str | None = None,
        filters: list[str] | None = None,
        effective_roles: list[str] | None = None,
        is_psk_editor: bool = False,
    ) -> PaginatedEndpointDetails:
        """List endpoints with full details (concurrent fetches, max 5 parallel).

        Hvis ``effective_roles`` er sat (non-admin) og cachen er varm, bruges
        roles-indekset: O(1) opslag giver de synlige endpoint-IDs direkte fra
        cache uden at hente alle ISE-endpoints. Kold cache falder tilbage til
        ISE list_page + post-filter (samme som admins sti).
        """
        cache = get_cache()
        if cache.detail_count() > 0:
            if effective_roles is not None:
                return await self._list_from_roles_index(
                    effective_roles, page, size, is_psk_editor, search=search
                )
            # Admin med varm cache: server alle endpoints fra cache — undgår ISE size-begrænsning (max 100)
            return await self._list_all_from_cache(page, size, is_psk_editor, search=search)
        filters = _combine_filters(search, filters)
        # ISE ERS accepterer max 100 per side — cap og paginér internt ved større requests
        ise_size = min(size, 100)
        resources, total = await self.endpoints.list_page(
            page=page, size=ise_size, filters=filters
        )
        logger.info(
            "fetching details for %d endpoints concurrently "
            "(page=%d, total=%d, search=%s)",
            len(resources), page, total, search or "",
        )
        sem = asyncio.Semaphore(8)

        async def fetch_one(r: dict[str, Any]) -> EndpointDetail:
            async with sem:
                try:
                    return await self.get_endpoint(r["id"], is_psk_editor=is_psk_editor)
                except IseApiError:
                    return EndpointDetail(
                        id=r.get("id", ""),
                        name=r.get("name", ""),
                        mac=r.get("name", ""),
                        description=r.get("description"),
                        vendor=profiler_module.resolve_name_sync(r.get("profileId", "")) or oui_lookup(r.get("name", "")),
                    )

        details = await asyncio.gather(*(fetch_one(r) for r in resources))
        items = list(details)
        if effective_roles is not None:
            visible = [d for d in items if _endpoint_visible(d, effective_roles)]
            logger.info(
                "role-filter (cold-cache fallback): %d → %d endpoints (effective_roles=%s)",
                len(items), len(visible), effective_roles,
            )
            items = visible
            total = len(items)
        return PaginatedEndpointDetails(
            items=items, total=total, page=page, size=size
        )

    async def _list_from_roles_index(
        self,
        effective_roles: list[str],
        page: int,
        size: int,
        is_psk_editor: bool,
        search: str | None = None,
    ) -> PaginatedEndpointDetails:
        """Non-admin Browse: synkron snapshot fra cache, filtreret på roller.

        Bruger cache.snapshot_details_for_roles() — ingen asyncio.gather,
        ingen ISE-kald, ingen baggrundstasks. Pre-warm håndterer refresh.
        """
        cache = get_cache()
        raw = cache.snapshot_details_for_roles(effective_roles)
        result = self._build_detail_page(raw, page, size, is_psk_editor, search)
        logger.info(
            "roles-index list (snapshot): %d total visible, page=%d → %d items (effective_roles=%s)",
            result.total, page, len(result.items), effective_roles,
        )
        return result

    async def _list_all_from_cache(
        self,
        page: int,
        size: int,
        is_psk_editor: bool,
        search: str | None = None,
    ) -> PaginatedEndpointDetails:
        """Admin Browse: synkron snapshot af alle cachede endpoints — ingen ISE-kald.

        Bruger cache.snapshot_all_details() i stedet for asyncio.gather() +
        get_endpoint() per entry. Den gamle impl. spawner N baggrundstasks for
        stale entries (N up to 1000+) som rammer ISE simultant → timeout-fejl
        og langsom reload. Synkron læsning er O(N) dict-lookup, typisk < 5ms.
        Pre-warm drip-loop håndterer gradvis refresh af stale entries.
        """
        cache = get_cache()
        raw = cache.snapshot_all_details()
        result = self._build_detail_page(raw, page, size, is_psk_editor, search)
        logger.info(
            "cache-all list (snapshot, admin): %d total, page=%d → %d items",
            result.total, page, len(result.items),
        )
        return result

    def _build_detail_page(
        self,
        raw: list[tuple[str, Any, bool]],
        page: int,
        size: int,
        is_psk_editor: bool,
        search: str | None,
    ) -> PaginatedEndpointDetails:
        """Byg en PaginatedEndpointDetails fra (ep_id, value, is_stale) tuples.

        Anvender PSK-masking og cache_stale-flag. Ingen async/ISE-kald.
        """
        items: list[EndpointDetail] = []
        for _ep_id, val, is_stale in raw:
            if is_stale:
                if hasattr(val, "model_copy"):
                    val = val.model_copy(update={"cache_stale": True})
            elif getattr(val, "cache_stale", False):
                val = val.model_copy(update={"cache_stale": False})
            if not is_psk_editor:
                val = _mask_psk(val)
            items.append(val)
        if search:
            low = search.strip().lower()
            items = [
                d for d in items
                if low in (d.mac or "").lower() or low in (d.description or "").lower()
            ]
        items.sort(key=lambda d: d.mac or d.name)
        total = len(items)
        start = (page - 1) * size
        return PaginatedEndpointDetails(items=items[start : start + size], total=total, page=page, size=size)

    async def list_all_endpoint_details(
        self,
        search: str | None = None,
        filters: list[str] | None = None,
        effective_roles: list[str] | None = None,
        is_psk_editor: bool = False,
        full_text_q: str | None = None,
    ) -> list[EndpointDetail]:
        """Fetch ALL endpoints with full details (all ISE pages, concurrent).

        Hvis ``effective_roles`` er sat (non-admin) og cachen er varm, bruges
        roles-indekset til at returnere kun brugerens endpoints uden ISE-scan.
        Kold cache falder tilbage til fuld ISE list_all + post-filter.

        Admin fast-path: hvis cachen er varm og ingen ISE ERS-filtre er sat,
        serveres alle endpoints direkte fra cache — ingen ISE round-trip.
        """
        cache = get_cache()

        # Admin fast-path: serve from cache when no ERS column-filters force an ISE scan.
        # Avoids list_all() + N individual fetches when chips/filter-mode triggers this call.
        if effective_roles is None and not filters and cache.detail_count() > 0:
            items: list[EndpointDetail] = cache.get_all_details()
            if not is_psk_editor:
                items = [_mask_psk(d) for d in items]
            if search:
                low = search.strip().lower()
                items = [
                    d for d in items
                    if low in (d.mac or "").lower() or low in (d.description or "").lower()
                ]
            if full_text_q:
                items = _full_text_filter(items, full_text_q)
            items.sort(key=lambda d: d.mac or d.name)
            logger.info("admin list_all cache fast-path: %d endpoints from cache", len(items))
            return items

        if effective_roles is not None and cache.detail_count() > 0:
            cache = get_cache()
            all_ids = list(cache.get_ids_for_roles(effective_roles))
            sem = asyncio.Semaphore(8)

            async def fetch_indexed(ep_id: str) -> EndpointDetail | None:
                async with sem:
                    try:
                        return await self.get_endpoint(ep_id, is_psk_editor=is_psk_editor)
                    except IseApiError:
                        return None

            results = await asyncio.gather(*(fetch_indexed(i) for i in all_ids))
            items: list[EndpointDetail] = [r for r in results if r is not None]
            if search:
                low = search.strip().lower()
                items = [
                    d for d in items
                    if low in d.mac.lower() or low in (d.description or "").lower()
                ]
            if full_text_q:
                items = _full_text_filter(items, full_text_q)
            items.sort(key=lambda d: d.mac or d.name)
            logger.info(
                "roles-index list_all: %d endpoints (effective_roles=%s)",
                len(items), effective_roles,
            )
            return items

        filters = _combine_filters(search, filters)
        resources = await self.endpoints.list_all(filters=filters)
        logger.info(
            "fetching details for ALL %d endpoints concurrently (search=%s)",
            len(resources), search or "",
        )
        sem = asyncio.Semaphore(8)

        async def fetch_one(r: dict[str, Any]) -> EndpointDetail:
            async with sem:
                try:
                    return await self.get_endpoint(r["id"], is_psk_editor=is_psk_editor)
                except IseApiError:
                    return EndpointDetail(
                        id=r.get("id", ""),
                        name=r.get("name", ""),
                        mac=r.get("name", ""),
                        description=r.get("description"),
                        vendor=profiler_module.resolve_name_sync(r.get("profileId", "")) or oui_lookup(r.get("name", "")),
                    )

        details = await asyncio.gather(*(fetch_one(r) for r in resources))
        all_items = list(details)
        if effective_roles is not None:
            visible = [d for d in all_items if _endpoint_visible(d, effective_roles)]
            logger.info(
                "role-filter (all, cold-cache fallback): %d → %d endpoints (effective_roles=%s)",
                len(all_items), len(visible), effective_roles,
            )
            all_items = visible
        if full_text_q:
            all_items = _full_text_filter(all_items, full_text_q)
        return all_items

    async def list_groups(self) -> list[EndpointGroupSummary]:
        return await get_cache().get_groups(self._fetch_groups)

    async def create_group(self, name: str, description: str = "", parent_id: str = "") -> str:
        new_id = await self.groups.create(name, description, parent_id)
        get_cache().invalidate_groups()
        invalidate_group_names()  # shared id->name map must see the new group immediately
        logger.info("created endpoint group name=%s parent=%s id=%s", name, parent_id or "root", new_id)
        return new_id

    async def _fetch_groups(self) -> list[EndpointGroupSummary]:
        raw = await self.groups.list_all()
        logger.info("listed %d endpoint groups", len(raw))
        return [
            EndpointGroupSummary(
                id=r.get("id", ""),
                # Use the full hierarchical path built by list_all(); fall back
                # to the short name if parentId resolution was unavailable.
                name=r.get("_full_path") or r.get("name", ""),
                description=r.get("description"),
            )
            for r in raw
        ]

    async def create_endpoint(
        self,
        req: CreateEndpointRequest,
        auto_tag_username: str | None = None,
    ) -> str:
        """Create an endpoint and return the new ISE endpoint id.

        Hvis ``auto_tag_username`` er sat (non-admin oprettelse) og
        ``HypervisionRoles`` er tom i requesten, auto-tagges endpointet
        med brugerens username så de straks kan se deres egen
        oprettelse via read-path-filteret (Phase 4).
        """
        logger.info(
            "creating endpoint mac=%s group=%s static=%s",
            req.mac, req.group_id, req.static_group_assignment,
        )
        ca = req.custom_attributes.model_dump(exclude_none=True) if req.custom_attributes else {}
        # Always stamp endpoints created by this portal
        ca[HIDDEN_ATTR] = "true"
        _apply_auto_tag(ca, auto_tag_username)
        # ERS-mode: stamp registreringsdato da ISE ikke returnerer createTime via ERS.
        # Open API-mode: createTime returneres direkte af ISE — CA er overflødig men
        # harmless (fungerer som fallback og giver konsistens ved eventuel API-skift).
        if not ca.get(REGISTERED_AT_ATTR):
            ca[REGISTERED_AT_ATTR] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        _validate_psk(ca)
        _psk_encode_ca(ca)
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
        if new_id:
            _sync_guest_expiry(new_id, req.mac, ca)
        await audit_store.record(
            "created",
            "endpoint",
            new_id or req.mac,
            after={
                "mac": req.mac,
                "group_id": req.group_id,
                "description": req.description,
                "static_group_assignment": static_flag,
                "custom_attributes": ca,
            },
        )
        # Opdatér in-memory create-time cache så nye endpoints straks viser alder.
        audit_store.record_endpoint_create_time(new_id or req.mac, ca[REGISTERED_AT_ATTR])
        return new_id

    async def delete_endpoint(self, endpoint_id: str) -> None:
        logger.info("deleting endpoint id=%s", endpoint_id)
        # Capture before-state for rollback while it still exists in ISE.
        before: dict[str, Any] | None = None
        try:
            before = (await self.get_endpoint(endpoint_id, is_psk_editor=True)).model_dump()
        except IseApiError as exc:
            logger.warning("audit: could not snapshot endpoint %s before delete: %s",
                           endpoint_id, exc)
        await self.endpoints.delete(endpoint_id)
        get_cache().mark_changed(endpoint_id)
        get_cache().invalidate_detail(endpoint_id)
        guest_expiry_store.remove(endpoint_id)
        if before:
            mac = before.get("mac") or before.get("name") or ""
            if mac:
                from app.core import first_seen_store
                first_seen_store.delete(mac)
        await audit_store.record(
            "deleted",
            "endpoint",
            endpoint_id,
            before=before,
        )

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

    # ------------------------------------------------------------------ #
    # ANC (Adaptive Network Control)                                       #
    # ------------------------------------------------------------------ #

    async def list_anc_policies(self) -> list[str]:
        """Return all ANC policy names configured in ISE."""
        return await anc_module.list_policies(self.client)

    async def anc_status(self, endpoint_id: str) -> tuple[str, str | None]:
        """Return (mac, policy_name) for the endpoint. policy_name is None if not quarantined."""
        raw = await self.endpoints.get(endpoint_id)
        mac = raw.get("mac") or raw.get("name") or ""
        if not mac:
            return "", None
        policy = await anc_module.get_endpoint_status(self.client, mac)
        return mac, policy

    async def anc_quarantine(self, endpoint_id: str, policy_name: str) -> tuple[bool, str, str]:
        """Apply ANC policy to an endpoint. Returns (ok, mac, message)."""
        raw = await self.endpoints.get(endpoint_id)
        mac = raw.get("mac") or raw.get("name") or ""
        if not mac:
            return False, "", "Endpoint har ingen MAC-adresse"
        ok, msg = await anc_module.apply(self.client, mac, policy_name)
        if ok:
            await audit_store.record(
                "anc_quarantine",
                "endpoint",
                endpoint_id,
                after={"mac": mac, "anc_policy": policy_name},
            )
        return ok, mac, msg

    async def anc_clear(self, endpoint_id: str) -> tuple[bool, str, str]:
        """Clear ANC policy from an endpoint. Returns (ok, mac, message)."""
        raw = await self.endpoints.get(endpoint_id)
        mac = raw.get("mac") or raw.get("name") or ""
        if not mac:
            return False, "", "Endpoint har ingen MAC-adresse"
        ok, msg = await anc_module.clear(self.client, mac)
        if ok:
            await audit_store.record(
                "anc_clear",
                "endpoint",
                endpoint_id,
                after={"mac": mac},
            )
        return ok, mac, msg

    async def update_endpoint(
        self,
        endpoint_id: str,
        update: EndpointUpdate,
        auto_tag_username: str | None = None,
    ) -> None:
        logger.info(
            "updating endpoint id=%s fields=%s",
            endpoint_id,
            update.model_dump(exclude_unset=True),
        )
        ca = update.custom_attributes.model_dump(exclude_none=True) if update.custom_attributes else {}
        # Always stamp endpoints edited through this portal
        ca[HIDDEN_ATTR] = "true"
        _apply_auto_tag(ca, auto_tag_username)
        _validate_psk(ca)
        _psk_encode_ca(ca)
        await self._ensure_ca_definitions()
        # Snapshot before-state for audit + rollback.
        before: dict[str, Any] | None = None
        try:
            before = (await self.get_endpoint(endpoint_id, is_psk_editor=True)).model_dump()
        except IseApiError as exc:
            logger.warning(
                "audit: could not snapshot endpoint %s before update: %s",
                endpoint_id, exc,
            )
        # Auto-sæt HypervisionActive=Aktiv hvis endpointet er portal-managed
        # og active_status ikke allerede er sat (Aktiv eller Inaktiv).
        if ACTIVE_ATTR not in ca and before and not before.get("active_status"):
            ca[ACTIVE_ATTR] = "Aktiv"
        # Stamp HypervisionRegisteredAt ved første portal-touch af pre-existing endpoints.
        # create_endpoint() sætter det ved oprettelse; her er fallback for endpoints
        # der eksisterede i ISE inden portalen og aldrig har fået CA'en sat.
        # Prioritet: ISE createTime (Open API) > audit-tid > first_seen_store > now.
        if not ca.get(REGISTERED_AT_ATTR):
            reg_ts = (before or {}).get("create_time") or ""
            if not reg_ts:
                _mac = (before or {}).get("mac", "")
                _stored = first_seen_store.get(_mac) if _mac else None
                if _stored:
                    reg_ts = datetime.fromtimestamp(_stored, tz=timezone.utc).strftime(
                        "%Y-%m-%dT%H:%M:%SZ"
                    )
            if not reg_ts:
                reg_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            ca[REGISTERED_AT_ATTR] = reg_ts
        await self.endpoints.update(
            endpoint_id,
            description=update.description,
            group_id=update.group_id,
            static_group_assignment=update.static_group_assignment,
            custom_attributes=ca,
        )
        # Invalidate cache so the next read reflects the new ISE state.
        get_cache().mark_changed(endpoint_id)
        get_cache().invalidate_detail(endpoint_id)

        # Opdatér guest expiry tracking baseret på de nye CA-værdier.
        _sync_guest_expiry(endpoint_id, (before or {}).get("mac", ""), ca)

        # "after"-snapshot og audit køres i baggrunden så HTTP-svaret
        # returneres straks efter PUT+invalidation (sparer ét ISE-kald på hot path).
        _before = before
        _ep_id = endpoint_id
        _svc = self

        async def _audit_after() -> None:
            after: dict[str, Any] | None = None
            try:
                after = (await _svc.get_endpoint(_ep_id, is_psk_editor=True)).model_dump()
            except IseApiError:
                pass
            await audit_store.record("updated", "endpoint", _ep_id, before=_before, after=after)

        asyncio.create_task(_audit_after(), name=f"audit-after-update-{endpoint_id[:8]}")

    async def bulk_create(
        self,
        req: BulkCreateRequest,
        auto_tag_username: str | None = None,
    ) -> BulkResult:
        logger.info(
            "bulk creating %d endpoints (overwrite=%s)",
            len(req.items), req.overwrite,
        )
        # Pre-ensure definitions if any item has custom attributes
        if any(item.custom_attributes for item in req.items):
            await self._ensure_ca_definitions()

        concurrency = int(getattr(config.settings, "bulk_create_concurrency", 3))
        sem = asyncio.Semaphore(concurrency)

        # Result categories — appended from concurrent tasks; lists are safe
        # because asyncio is cooperative (no true parallelism within one thread).
        succeeded: list[str] = []
        skipped: list[str] = []
        overwritten: list[str] = []
        failed: list[BulkFailure] = []

        async def _process_one(item: CreateEndpointRequest) -> None:
            async with sem:
                try:
                    await self.create_endpoint(item, auto_tag_username=auto_tag_username)
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
                                await self._overwrite_existing(
                                    item, auto_tag_username=auto_tag_username
                                )
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

        await asyncio.gather(*[_process_one(item) for item in req.items])

        logger.info(
            "bulk done: %d ok, %d skipped, %d overwritten, %d failed",
            len(succeeded), len(skipped), len(overwritten), len(failed),
        )
        if succeeded:
            BULK_ITEMS.labels(outcome="succeeded").inc(len(succeeded))
        if skipped:
            BULK_ITEMS.labels(outcome="skipped").inc(len(skipped))
        if overwritten:
            BULK_ITEMS.labels(outcome="overwritten").inc(len(overwritten))
        if failed:
            BULK_ITEMS.labels(outcome="failed").inc(len(failed))
        if succeeded or overwritten:
            # Bulk ops can touch many ids — clear everything rather than
            # tracking per-id invalidation.
            get_cache().invalidate_all()
        return BulkResult(
            succeeded=succeeded,
            skipped=skipped,
            overwritten=overwritten,
            failed=failed,
        )

    async def _overwrite_existing(
        self,
        item: CreateEndpointRequest,
        auto_tag_username: str | None = None,
    ) -> None:
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
        await self.update_endpoint(
            endpoint_id, update, auto_tag_username=auto_tag_username
        )

    # ------------------------------------------------------------------ #
    # Decommission                                                         #
    # ------------------------------------------------------------------ #

    async def decommission_endpoint(self, endpoint_id: str) -> None:
        """Sæt HypervisionStatus='Decommissioned' på et endpoint (soft-delete).

        Kun custom-attribute-feltet opdateres — gruppe, beskrivelse og øvrige
        felter bevares. Cachen invalideres og handlingen auditeres.
        """
        ca: dict[str, Any] = {
            STATUS_ATTR: "Decommissioned",
            ACTIVE_ATTR: "Inaktiv",
            HIDDEN_ATTR: "true",
        }
        audit_after: dict[str, Any] = {"status": "Decommissioned", "active_status": "Inaktiv"}
        if config.settings.decomm_set_authz:
            authz_vlan = config.settings.decomm_authz_vlan
            authz_acl  = config.settings.decomm_authz_acl
            ca["AuthzVlan"] = authz_vlan
            ca["AuthzACL"]  = authz_acl
            audit_after["authz_vlan"] = authz_vlan
            audit_after["authz_acl"]  = authz_acl
        await self._ensure_ca_definitions()
        before: dict[str, Any] | None = None
        try:
            before = (await self.get_endpoint(endpoint_id, is_psk_editor=True)).model_dump()
        except IseApiError as exc:
            logger.warning("audit: could not snapshot %s before decommission: %s", endpoint_id, exc)
        await self.endpoints.update(endpoint_id, custom_attributes=ca)
        get_cache().mark_changed(endpoint_id)
        get_cache().invalidate_detail(endpoint_id)
        await audit_store.record(
            "decommissioned",
            "endpoint",
            endpoint_id,
            before=before,
            after=audit_after,
        )
        logger.info("decommissioned endpoint id=%s", endpoint_id)

    async def bulk_decommission(self, req: BulkDecommissionRequest) -> dict[str, Any]:
        """Decommission op til 200 endpoints parallelt (Semaphore=3)."""
        sem = asyncio.Semaphore(5)

        async def _one(ep_id: str) -> dict[str, Any]:
            async with sem:
                try:
                    await self.decommission_endpoint(ep_id)
                    return {"id": ep_id, "ok": True}
                except Exception as exc:  # noqa: BLE001
                    return {"id": ep_id, "ok": False, "error": str(exc)}

        results = list(await asyncio.gather(*(_one(i) for i in req.endpoint_ids[:200])))
        return {"results": results, "ok_count": sum(1 for r in results if r["ok"])}

    async def undecommission_endpoint(self, endpoint_id: str) -> None:
        """Ryd HypervisionStatus på et dekommissioneret endpoint (genaktivering).

        Sætter STATUS_ATTR til tom streng (ISE modtager eksplicit clearing).
        HIDDEN_ATTR beholdes 'true' — endpointet er stadig portal-managed.
        Cachen invalideres og handlingen auditeres.
        """
        ca: dict[str, Any] = {
            STATUS_ATTR: "",
            ACTIVE_ATTR: "Aktiv",
            HIDDEN_ATTR: "true",
        }
        await self._ensure_ca_definitions()
        before: dict[str, Any] | None = None
        try:
            before = (await self.get_endpoint(endpoint_id, is_psk_editor=True)).model_dump()
        except IseApiError as exc:
            logger.warning("audit: could not snapshot %s before undecommission: %s", endpoint_id, exc)
        await self.endpoints.update(endpoint_id, custom_attributes=ca)
        get_cache().invalidate_detail(endpoint_id)
        await audit_store.record(
            "undecommissioned",
            "endpoint",
            endpoint_id,
            before=before,
            after={"status": "", "active_status": "Aktiv"},
        )
        logger.info("undecommissioned endpoint id=%s", endpoint_id)

    async def bulk_undecommission(self, req: BulkDecommissionRequest) -> dict[str, Any]:
        """Genaktiver op til 200 endpoints parallelt (Semaphore=3)."""
        sem = asyncio.Semaphore(5)

        async def _one(ep_id: str) -> dict[str, Any]:
            async with sem:
                try:
                    await self.undecommission_endpoint(ep_id)
                    return {"id": ep_id, "ok": True}
                except Exception as exc:  # noqa: BLE001
                    return {"id": ep_id, "ok": False, "error": str(exc)}

        results = list(await asyncio.gather(*(_one(i) for i in req.endpoint_ids[:200])))
        return {"results": results, "ok_count": sum(1 for r in results if r["ok"])}

    async def set_active_status(self, endpoint_id: str, active_status: str) -> None:
        """Sæt HypervisionActive på et endpoint manuelt ("Aktiv" eller "Inaktiv").

        Kun ACTIVE_ATTR opdateres — alle øvrige CA-felter bevares uændret.
        """
        if active_status not in ("Aktiv", "Inaktiv"):
            raise ValueError(f"Ugyldig active_status: {active_status!r}")
        ca: dict[str, Any] = {
            ACTIVE_ATTR: active_status,
            HIDDEN_ATTR: "true",
        }
        await self._ensure_ca_definitions()
        before: dict[str, Any] | None = None
        try:
            before = (await self.get_endpoint(endpoint_id, is_psk_editor=True)).model_dump()
        except IseApiError as exc:
            logger.warning("audit: could not snapshot %s before set_active_status: %s", endpoint_id, exc)
        await self.endpoints.update(endpoint_id, custom_attributes=ca)
        get_cache().invalidate_detail(endpoint_id)
        await audit_store.record(
            "updated",
            "endpoint",
            endpoint_id,
            before=before,
            after={"active_status": active_status},
        )
        logger.info("set active_status=%s on endpoint id=%s", active_status, endpoint_id)

    # ------------------------------------------------------------------ #
    # Bulk template-apply                                                  #
    # ------------------------------------------------------------------ #

    async def bulk_apply_template(self, req: BulkApplyTemplateRequest) -> dict[str, Any]:
        """Anvend en skabelon på op til 200 endpoints parallelt (Semaphore=3).

        Kun felter der er sat i skabelonens ``fields``-blok overskrives;
        felter med tom streng sættes eksplicit (clearing af CA-værdi).
        Cachen invalideres per endpoint og handlingen auditeres.
        """
        from app.core import template_store as _ts

        template = _ts.get_template(req.template_id)
        if not template:
            raise ValueError(f"Skabelon {req.template_id!r} ikke fundet")

        fields = template.get("fields", {})
        t_group_id = fields.get("group_id") or None
        t_description = fields.get("description") or None
        t_static_ga = fields.get("static_group_assignment")
        t_ca: dict[str, str] = dict(fields.get("custom_attributes") or {})
        t_ca[HIDDEN_ATTR] = "true"

        await self._ensure_ca_definitions()
        sem = asyncio.Semaphore(5)

        async def _one(ep_id: str) -> dict[str, Any]:
            async with sem:
                try:
                    before: dict[str, Any] | None = None
                    try:
                        before = (await self.get_endpoint(ep_id, is_psk_editor=True)).model_dump()
                    except IseApiError as exc:
                        logger.warning("audit: could not snapshot %s before template_applied: %s", ep_id, exc)
                    await self.endpoints.update(
                        ep_id,
                        description=t_description,
                        group_id=t_group_id,
                        static_group_assignment=t_static_ga,
                        custom_attributes=t_ca,
                    )
                    get_cache().invalidate_detail(ep_id)
                    await audit_store.record(
                        "template_applied",
                        "endpoint",
                        ep_id,
                        before=before,
                        after={"template_id": req.template_id, "template_name": template.get("name", "")},
                    )
                    return {"id": ep_id, "ok": True}
                except Exception as exc:  # noqa: BLE001
                    return {"id": ep_id, "ok": False, "error": str(exc)}

        results = list(await asyncio.gather(*(_one(i) for i in req.endpoint_ids[:200])))
        logger.info(
            "bulk_apply_template: template=%s endpoints=%d ok=%d",
            req.template_id, len(req.endpoint_ids), sum(1 for r in results if r["ok"]),
        )
        return {"results": results, "ok_count": sum(1 for r in results if r["ok"])}

