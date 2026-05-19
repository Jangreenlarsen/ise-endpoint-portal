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

    # Trigger load if not started yet — safe to call from any async context.
    _nd.ensure_loaded()

    # All raw keys the user has already mapped (case-insensitive).
    all_mapped_raws: set[str] = {r["raw"].lower() for r in _load_mapping()}

    # Collect all unique NDG device type paths from ISE.
    # Each path is presented as-is so the user can decide the mapping.
    # Devices with empty path (NDG "All Device Types") are skipped — they carry
    # no device-type information worth mapping.
    path_counts: dict[str, int] = {}  # original_path → device count
    for dev in _nd._all_devices:
        path = dev.device_type_path or dev.device_type or ""
        if not path:
            continue
        path_counts[path] = path_counts.get(path, 0) + 1

    # Split into:
    #   grouped   — paths that already have a mapping row (raw == path, case-insensitive)
    #   unmatched — paths with no mapping row yet → shown as pre-filled suggestions
    grouped: dict[str, list[dict]] = {}
    unmatched: list[dict] = []

    for path, count in path_counts.items():
        path_lower = path.lower()
        if path_lower in all_mapped_raws:
            grouped.setdefault(path_lower, []).append({"path": path, "count": count})
        else:
            unmatched.append({"path": path, "count": count})

    logger.info(
        "nas-devices: loaded=%s total_devices=%d unique_paths=%d matched=%d unmatched=%d",
        _nd._all_loaded, len(_nd._all_devices), len(path_counts),
        len(grouped), len(unmatched),
    )
    return {
        "devices": grouped,
        "unmatched": unmatched,
        "loaded": _nd._all_loaded,
        "loading": _nd._loading,
    }
