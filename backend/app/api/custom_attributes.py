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


@router.get(
    "/PlatformType/nas-devices",
    dependencies=[Depends(require_any)],
)
async def get_nas_devices_by_platform() -> dict:
    """Return ISE network devices grouped by raw platform type.

    Triggers background cache load if not already running. Returns
    {devices: {raw: [{name,ip,device_type_path}]}, loaded: bool, loading: bool}
    so the frontend can show a loading state while the cache warms up.
    """
    import app.ise.network_devices as _nd
    from app.core.platform_types import normalize as _normalize

    # Trigger load if not started yet — safe to call from any async context.
    _nd.ensure_loaded()

    grouped: dict[str, list[dict]] = {}
    unmatched: list[dict] = []
    seen: set[tuple] = set()
    for ip, dev in _nd._by_ip.items():
        entry = (dev.name, ip)
        if entry in seen:
            continue
        seen.add(entry)
        norm = _normalize(dev.device_type) if dev.device_type else None
        if norm:
            grouped.setdefault(norm, []).append({
                "name": dev.name,
                "ip": ip,
                "device_type_path": dev.device_type_path,
            })
        else:
            unmatched.append({
                "name": dev.name,
                "ip": ip,
                "device_type": dev.device_type,
                "device_type_path": dev.device_type_path,
            })

    logger.info(
        "nas-devices: loaded=%s devices=%d matched=%d unmatched=%d unmatched_types=%s",
        _nd._all_loaded, len(_nd._by_ip),
        sum(len(v) for v in grouped.values()),
        len(unmatched),
        [d["device_type"] for d in unmatched],
    )
    return {
        "devices": grouped,
        "unmatched": unmatched,
        "loaded": _nd._all_loaded,
        "loading": _nd._loading,
    }
