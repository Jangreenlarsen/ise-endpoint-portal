# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Henter rå probe-attributter for et endpoint fra ISE Open API.

ISE Open API `/api/v1/endpoint/{id}` returnerer alle probe-indsamlede
attributter (DHCP, HTTP, MDM, netværk osv.) som ikke er tilgængelige via ERS.
Resultatet organiseres i navngivne sektioner til visning i portalen.
"""
from __future__ import annotations

import logging
from typing import Any

from app.ise.client import IseClient

logger = logging.getLogger(__name__)

OPENAPI_ENDPOINT = "/api/v1/endpoint"

# Kendte probe-attributter pr. kategori
_DHCP = {
    "dhcpClassIdentifier", "dhcpHostName", "dhcpParameterRequestList",
    "dhcpv6ClassIdentifier", "dhcpRequestedAddress", "dhcpMessageType",
    "dhcpClientIdentifier", "dhcpLeaseTime", "dhcpDomainName",
}
_HTTP = {
    "httpUserAgent", "userAgent", "httpHostname", "httpContentType",
    "httpOperatingSystem", "httpSupplicant",
}
_NETWORK = {
    "ip", "ipv6", "staticIp", "natIp", "openPorts",
}
_MDM = {
    "mdmAttributes", "mdmJailBroken", "mdmEnrolled", "mdmCompliant",
    "mdmServerName", "mdmImei", "mdmSerialNumber", "mdmModel",
    "mdmManufacturer", "mdmOs", "mdmOsVersion", "mdmPhoneNumber",
}
_PROFILER = {
    "profileId", "profilerVersion", "staticProfileAssignment",
    "endpointPolicy", "totalFailureCount", "failureReasonCode",
    "matchedPolicyId", "postureApplicable", "postureStatus",
    "profilerName",
}
# Felter der allerede vises i det generelle endpoint-panel — uinteressante her
_SKIP = {
    "id", "name", "mac", "description", "groupId", "staticGroupAssignment",
    "portalUser", "identityStore", "identityStoreId", "customAttributes",
    "link", "ers-attrs", "securityGroupTag",
}

_SECTION_LABELS = {
    "dhcp":    "DHCP",
    "http":    "HTTP / User-Agent",
    "network": "Netværk",
    "mdm":     "MDM",
    "profiler": "Profiler",
    "other":   "Andre attributter",
}


def _categorize(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Opdel rå endpoint-dict i navngivne probe-sektioner."""
    buckets: dict[str, dict[str, Any]] = {k: {} for k in _SECTION_LABELS}

    for key, val in raw.items():
        if key in _SKIP:
            continue
        if val is None or val == "" or val == []:
            continue
        if key in _DHCP:
            buckets["dhcp"][key] = val
        elif key in _HTTP:
            buckets["http"][key] = val
        elif key in _NETWORK:
            buckets["network"][key] = val
        elif key in _MDM:
            buckets["mdm"][key] = val
        elif key in _PROFILER:
            buckets["profiler"][key] = val
        else:
            buckets["other"][key] = val

    return [
        {"id": sec_id, "label": _SECTION_LABELS[sec_id], "attributes": attrs}
        for sec_id, attrs in buckets.items()
        if attrs
    ]


async def get_endpoint_profiling_data(
    client: IseClient, endpoint_id: str
) -> dict[str, Any]:
    """Hent alle probe-attributter for endpoint_id fra ISE Open API.

    Returnerer `{"sections": [...], "endpoint_id": "..."}` hvor sections
    er en liste af `{id, label, attributes: {key: value}}`.
    """
    data = await client.get(f"{OPENAPI_ENDPOINT}/{endpoint_id}")
    if not data:
        return {"endpoint_id": endpoint_id, "sections": []}

    # Pak response ud hvis ISE wrappede den
    if isinstance(data, dict):
        inner = data.get("response", data)
        if isinstance(inner, dict):
            data = inner

    sections = _categorize(data)
    logger.debug(
        "Profiling data for %s: %d sektioner, %d attributter total",
        endpoint_id,
        len(sections),
        sum(len(s["attributes"]) for s in sections),
    )
    return {"endpoint_id": endpoint_id, "sections": sections}
