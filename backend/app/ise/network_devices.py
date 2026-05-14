"""ISE Network Device cache — IP → name + device type (NDG).

Fetches all network devices from ERS and builds an IP-keyed map so
session enrichment can resolve nas_ip → device name + device type
without blocking on ISE round-trips.

Follows the same pattern as profiler.py:
  - Background async load, never blocks callers
  - Sync cache-only lookup for hot path (STOMP events, reconcile)
  - ``ensure_loaded()`` is idempotent — safe to call repeatedly
  - ``invalidate()`` clears cache on settings change
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

ERS_NETWORK_DEVICES = "/ers/config/networkdevice"


@dataclass(frozen=True)
class DeviceInfo:
    name: str = ""
    device_type: str = ""       # last NDG segment — used for platform_types.normalize()
    device_type_path: str = ""  # full NDG path for display fallback, e.g. "Wireless > WLC"
    location: str = ""          # from NDG "Location#..." path


_by_ip: dict[str, DeviceInfo] = {}
_all_loaded: bool = False
_loading: bool = False


def get_device_info(ip: str) -> DeviceInfo | None:
    """Sync, cache-only lookup. Returns None if not loaded or IP unknown."""
    if not ip:
        return None
    return _by_ip.get(ip)


def ensure_loaded() -> None:
    """Kick off background load if not already running or done."""
    global _loading, _all_loaded
    if _all_loaded or _loading:
        return
    _loading = True
    asyncio.ensure_future(_load_all())


async def _load_all() -> None:
    global _all_loaded, _loading
    try:
        from app.ise.client import get_ise_client
        client = get_ise_client()

        # Step 1: collect all device IDs from paginated list.
        ids: list[str] = []
        page = 1
        while True:
            data = await client.get(ERS_NETWORK_DEVICES, params=[("page", page), ("size", 100)])
            sr = (data or {}).get("SearchResult", {})
            resources: list[dict] = sr.get("resources", [])
            total = int(sr.get("total", len(resources)))
            for r in resources:
                if r.get("id"):
                    ids.append(r["id"])
            if not resources or len(ids) >= total:
                break
            page += 1

        if not ids:
            logger.debug("network device cache: ingen devices fundet i ISE ERS")
            _all_loaded = True
            return

        # Step 2: fetch each device for IP list + NDG.
        ip_count = 0
        for device_id in ids:
            try:
                data = await client.get(f"{ERS_NETWORK_DEVICES}/{device_id}")
                nd = (data or {}).get("NetworkDevice", {})
                name = str(nd.get("name", ""))
                groups: list[str] = nd.get("NetworkDeviceGroupList", [])
                ip_list: list[dict] = nd.get("NetworkDeviceIPList", [])
                dtype, dpath = _device_type_from_groups(groups)
                info = DeviceInfo(
                    name=name,
                    device_type=dtype,
                    device_type_path=dpath,
                    location=_location_from_groups(groups),
                )
                for entry in ip_list:
                    ip = (entry.get("ipaddress") or "").strip()
                    if ip:
                        _by_ip[ip] = info
                        ip_count += 1
            except Exception as exc:  # noqa: BLE001
                logger.debug("network device %s fetch fejlede: %s", device_id, exc)

        _all_loaded = True
        logger.info(
            "network device cache loaded: %d devices, %d IP-entries",
            len(ids), ip_count,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("network device cache load fejlede: %s", exc)
    finally:
        _loading = False


def _device_type_from_groups(groups: list[str]) -> tuple[str, str]:
    """Extract device type from NDG list.

    Returns (last_segment, full_path) so callers can:
      - pass last_segment to platform_types.normalize() for local-label lookup
      - fall back to full_path for display when no local mapping exists

    E.g. "Device Type#All Device Types#Wireless#WLC"
         → ("WLC", "Wireless > WLC")
         "Device Type#All Device Types#Switch#IOS"
         → ("IOS", "Switch > IOS")
         "Device Type#All Device Types"
         → ("", "")
    """
    for g in groups:
        if not g.startswith("Device Type#"):
            continue
        parts = [p.strip() for p in g.split("#")]
        specific = [p for p in parts[2:] if p and not p.lower().startswith("all ")]
        if specific:
            return specific[-1], " > ".join(specific)
    return "", ""


def _location_from_groups(groups: list[str]) -> str:
    for g in groups:
        if not g.startswith("Location#"):
            continue
        parts = [p.strip() for p in g.split("#")]
        specific = [p for p in parts[2:] if p and not p.lower().startswith("all ")]
        if specific:
            return " > ".join(specific)
    return ""


def invalidate() -> None:
    """Clear cache — call after ISE settings change."""
    global _all_loaded, _loading
    _by_ip.clear()
    _all_loaded = False
    _loading = False
