# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import logging

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)

from app.api.deps import (
    get_custom_attribute_service,
    require_any,
    require_editor,
    require_register_lookup,
)
from app.core.exceptions import IseApiError
from app.schemas.custom_attribute import (
    AddValueRequest,
    AllCustomAttributes,
    PlatformMapping,
    PlatformSyncResult,
    RemoveValueResult,
    SyncResult,
)
from app.services.custom_attribute_service import CustomAttributeService

router = APIRouter(prefix="/custom-attributes", tags=["custom-attributes"])


@router.get("", response_model=AllCustomAttributes, dependencies=[Depends(require_register_lookup)])
async def list_custom_attributes(
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> AllCustomAttributes:
    return service.list_all()


@router.post("/{attr_name}/values", response_model=AllCustomAttributes, dependencies=[Depends(require_editor)])
async def add_value(
    attr_name: str,
    req: AddValueRequest,
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> AllCustomAttributes:
    try:
        return await service.add_value(attr_name, req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{attr_name}/values/{value}", response_model=RemoveValueResult, dependencies=[Depends(require_editor)])
async def remove_value(
    attr_name: str,
    value: str,
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> RemoveValueResult:
    try:
        return await service.remove_value(attr_name, value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sync", response_model=SyncResult, dependencies=[Depends(require_editor)])
async def sync_from_ise(
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> SyncResult:
    return await service.sync_from_ise()


@router.post(
    "/PlatformType/sync-mnt",
    response_model=PlatformSyncResult,
    dependencies=[Depends(require_editor)],
)
async def sync_platform_from_mnt(
    overwrite: bool = False,
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> PlatformSyncResult:
    """Pull active sessions from ISE MnT and derive PlatformType per endpoint.

    Default ``overwrite=false`` only fills empty PlatformType (manual values
    win). Pass ``?overwrite=true`` to force re-derivation on every match.
    """
    try:
        return await service.sync_platform_from_mnt(overwrite=overwrite)
    except IseApiError as exc:
        raise HTTPException(
            status_code=502 if exc.status_code == 0 else exc.status_code,
            detail=str(exc),
        ) from exc


@router.get(
    "/PlatformType/mapping",
    response_model=PlatformMapping,
    dependencies=[Depends(require_any)],
)
async def get_platform_mapping(
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> PlatformMapping:
    """Return the raw→local PlatformType mapping (one row per known raw)."""
    return service.get_platform_mapping()


@router.put(
    "/PlatformType/mapping",
    response_model=PlatformMapping,
    dependencies=[Depends(require_editor)],
)
async def set_platform_mapping(
    payload: PlatformMapping,
    service: CustomAttributeService = Depends(get_custom_attribute_service),
) -> PlatformMapping:
    """Replace the raw→local PlatformType mapping. Each row binds an ISE
    raw value to a local label and a CoA action (reauth | disconnect)."""
    return await service.set_platform_mapping(payload)


@router.post(
    "/PlatformType/nas-devices/refresh",
    dependencies=[Depends(require_editor)],
)
async def refresh_nas_devices() -> dict:
    """Force-reload the NAS device cache from ISE ERS.

    Use this after adding or modifying network devices in ISE so that the
    Raw → local mapping editor picks up the new device types.
    """
    import app.ise.network_devices as _nd
    _nd.force_reload()
    return {"status": "refreshing", "message": "NAS device cache reload started"}


@router.get(
    "/PlatformType/nas-devices",
    dependencies=[Depends(require_any)],
)
async def get_nas_devices_by_platform() -> dict:
    """Return ISE network devices grouped by raw platform type.

    Triggers background cache load if not already running. Returns
    {devices: {raw: [{path,count}]}, loaded: bool, loading: bool,
     unmatched: [{path,count}]}
    """
    import app.ise.network_devices as _nd
    from app.core.platform_mapping_store import load_mapping as _load_mapping
    from app.core.platform_types import KNOWN_PLATFORM_TYPES, normalize as _normalize

    # Trigger load if not started yet — safe to call from any async context.
    _nd.ensure_loaded()

    # Build set of user-added raw keys (NDG paths stored as raw in mapping)
    user_raws: set[str] = {
        r["raw"] for r in _load_mapping()
        if r["raw"] not in KNOWN_PLATFORM_TYPES
    }

    # Group ALL loaded devices by raw platform type → unique NDG paths with counts.
    # Uses _all_devices (per-device list) instead of _by_ip so devices without
    # IP addresses are also included.
    # Devices with device_type="" AND path="" have NDG "All Device Types" (the
    # default/unspecified group in ISE) — these are excluded from both matched and
    # unmatched because they carry no platform-type information worth mapping.
    matched_paths: dict[str, dict[str, int]] = {}  # raw → {path → count}
    unmatched_paths: dict[str, int] = {}            # path → count (no raw match)

    for dev in _nd._all_devices:
        norm = _normalize(dev.device_type) if dev.device_type else None
        path = dev.device_type_path or dev.device_type or ""
        raw_key = norm
        if not raw_key and dev.device_type:
            dt_lower = dev.device_type.strip().lower()
            if dt_lower in user_raws:
                raw_key = dt_lower
        if raw_key:
            matched_paths.setdefault(raw_key, {})
            matched_paths[raw_key][path] = matched_paths[raw_key].get(path, 0) + 1
        elif path:
            # Only show in unmatched when there IS a path — devices with no
            # specific Device Type NDG ("All Device Types") are silently skipped.
            unmatched_paths[path] = unmatched_paths.get(path, 0) + 1

    # Convert to list form for JSON serialisation.
    grouped = {
        raw: [{"path": p, "count": c} for p, c in paths.items()]
        for raw, paths in matched_paths.items()
    }
    unmatched = [{"path": p, "count": c} for p, c in unmatched_paths.items()]

    logger.info(
        "nas-devices: loaded=%s total_devices=%d matched_raw=%s unmatched_paths=%s",
        _nd._all_loaded, len(_nd._all_devices),
        {r: sum(x["count"] for x in v) for r, v in grouped.items()},
        unmatched,
    )
    return {
        "devices": grouped,
        "unmatched": unmatched,
        "loaded": _nd._all_loaded,
        "loading": _nd._loading,
    }
