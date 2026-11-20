# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Test: Endpoint-hentning — Open API-liste vs. ERS N+1.

Portalens cache fyldes i dag med ERS: en pagineret liste der kun indeholder
id/name, efterfulgt af ét detalje-kald pr. endpoint (N+1). Open API-listen
`GET /api/v1/endpoint` kan på nogle ISE-versioner returnere hele endpoint-
objektet pr. listeelement. Gør den det, kan en fuld scanning klares med ca.
ét kald pr. 100 endpoints i stedet for ét kald pr. endpoint.

Denne probe afgør det mod den rigtige ISE og måler svartider. Den sender
KUN GET-kald og højst `1 + 1 + SAMPLE_DETAILS + MAX_EXTRA_PAGES` kald i serie,
så den ikke belaster ISE nævneværdigt.
"""
from __future__ import annotations

import logging
import math
import time
from typing import Any

from app.core import config
from app.core.exceptions import IseApiError
from app.ise.client import get_ise_client

logger = logging.getLogger(__name__)

OPENAPI_LIST = "/api/v1/endpoint"
ERS_LIST = "/ers/config/endpoint"
PAGE_SIZE = 100
SAMPLE_DETAILS = 5
MAX_EXTRA_PAGES = 10


async def _timed_get(client: Any, path: str, params: Any = None) -> dict[str, Any]:
    """Ét GET-kald med tidsmåling. Fejl returneres som data, aldrig som exception."""
    t0 = time.perf_counter()
    try:
        data, resp = await client.request("GET", path, params=params, return_response=True)
        return {
            "data": data,
            "ms": round((time.perf_counter() - t0) * 1000, 1),
            "http_version": getattr(resp, "http_version", "") or "",
            "error": None,
        }
    except IseApiError as exc:
        return {
            "data": None,
            "ms": round((time.perf_counter() - t0) * 1000, 1),
            "http_version": "",
            "error": str(exc),
            "status_code": exc.status_code,
        }


def _list_items(data: Any) -> tuple[list[dict[str, Any]], int | None]:
    """(items, total) fra et Open API- eller ERS-listesvar. total=None hvis ukendt."""
    if isinstance(data, list):
        return [i for i in data if isinstance(i, dict)], None
    if not isinstance(data, dict):
        return [], None
    if isinstance(data.get("SearchResult"), dict):
        sr = data["SearchResult"]
        return list(sr.get("resources") or []), sr.get("total")
    for key in ("response", "resources"):
        if isinstance(data.get(key), list):
            total = data.get("total", data.get("totalCount"))
            return list(data[key]), int(total) if total is not None else None
    return [], None


def _custom_attrs(obj: dict[str, Any]) -> dict[str, str] | None:
    """Custom attributes som flad dict. None = feltet findes ikke i objektet.

    Håndterer både Open API (flad) og ERS (`customAttributes.customAttributes`).
    """
    if not isinstance(obj, dict) or "customAttributes" not in obj:
        return None
    ca = obj.get("customAttributes")
    if isinstance(ca, dict) and isinstance(ca.get("customAttributes"), dict):
        ca = ca["customAttributes"]
    if not isinstance(ca, dict):
        return {}
    return {str(k): "" if v is None else str(v) for k, v in ca.items()}


def _group_id(obj: dict[str, Any]) -> str:
    return str(obj.get("groupId") or obj.get("identityGroupId") or "")


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _field_coverage(items: list[dict[str, Any]]) -> dict[str, int]:
    cov: dict[str, int] = {}
    for it in items:
        for k in it:
            cov[k] = cov.get(k, 0) + 1
    return dict(sorted(cov.items()))


async def run_probe(extra_pages: int = 3) -> dict[str, Any]:
    """Kør proben. `extra_pages` = ekstra Open API-sider til gennemløbsmåling (0-10)."""
    extra_pages = max(0, min(int(extra_pages), MAX_EXTRA_PAGES))
    client = get_ise_client()
    started = time.time()
    concurrency = max(1, int(getattr(config.settings, "cache_prewarm_concurrency", 5)))
    result: dict[str, Any] = {
        "timestamp": started,
        "page_size": PAGE_SIZE,
        "concurrency": concurrency,
        "openapi": {},
        "ers": {},
        "comparison": {},
        "estimate": {},
        "verdict": "error",
        "message": "",
    }

    # 1) Open API-liste, side 1
    o1 = await _timed_get(client, OPENAPI_LIST, params=[("page", 1), ("size", PAGE_SIZE)])
    o_items, o_total = _list_items(o1["data"])
    with_ca = [i for i in o_items if _custom_attrs(i) is not None]
    result["openapi"] = {
        "ok": o1["error"] is None,
        "error": o1["error"],
        "first_page_ms": o1["ms"],
        "http_version": o1["http_version"],
        "items": len(o_items),
        "total": o_total,
        "fields": _field_coverage(o_items),
        "items_with_custom_attributes": len(with_ca),
        "items_with_nonempty_custom_attributes": sum(1 for i in with_ca if _custom_attrs(i)),
        "items_with_group": sum(1 for i in o_items if _group_id(i)),
        "items_with_profile": sum(1 for i in o_items if i.get("profileId")),
    }

    # 2) ERS-liste, side 1 (det portalen bruger i dag)
    e1 = await _timed_get(client, ERS_LIST, params=[("page", 1), ("size", PAGE_SIZE)])
    e_items, e_total = _list_items(e1["data"])
    result["ers"] = {
        "ok": e1["error"] is None,
        "error": e1["error"],
        "list_page_ms": e1["ms"],
        "http_version": e1["http_version"],
        "items": len(e_items),
        "total": e_total,
        "fields": _field_coverage(e_items),
        "detail_ms": [],
        "avg_detail_ms": None,
    }

    if o1["error"] is not None:
        result["message"] = (
            "Open API-listen svarede ikke. Tjek at Open API er slået til i ISE "
            "(Administration → System → Settings → API Settings) og at portalens "
            "ISE-bruger har adgang."
        )
        result["duration_s"] = round(time.time() - started, 1)
        return result

    # 3) Sammenlign listens data med ERS-detaljekald for et udsnit
    sample = sorted(o_items, key=lambda i: 0 if _custom_attrs(i) else 1)[:SAMPLE_DETAILS]
    compared: list[dict[str, Any]] = []
    detail_ms: list[float] = []
    for item in sample:
        ep_id = str(item.get("id") or "")
        if not ep_id:
            continue
        d = await _timed_get(client, f"{ERS_LIST}/{ep_id}")
        if d["error"] is not None:
            compared.append({"id": ep_id, "error": d["error"]})
            continue
        detail_ms.append(d["ms"])
        detail = (d["data"] or {}).get("ERSEndPoint", d["data"] or {})
        list_ca = _custom_attrs(item)
        detail_ca = _custom_attrs(detail) or {}
        diff = sorted(
            k for k in set(detail_ca) | set(list_ca or {})
            if (list_ca or {}).get(k, "") != detail_ca.get(k, "")
        )
        compared.append({
            "id": ep_id,
            "mac": item.get("mac") or item.get("name") or "",
            "list_has_custom_attributes": list_ca is not None,
            "custom_attributes_match": list_ca is not None and not diff,
            "differing_attributes": diff[:20],
            "group_match": _group_id(item) == _group_id(detail),
            "profile_match": str(item.get("profileId") or "") == str(detail.get("profileId") or ""),
        })
    result["ers"]["detail_ms"] = detail_ms
    result["ers"]["avg_detail_ms"] = _avg(detail_ms)

    ok_rows = [c for c in compared if "error" not in c]
    result["comparison"] = {
        "sampled": len(compared),
        "custom_attributes_match": sum(1 for c in ok_rows if c["custom_attributes_match"]),
        "group_match": sum(1 for c in ok_rows if c["group_match"]),
        "profile_match": sum(1 for c in ok_rows if c["profile_match"]),
        "rows": compared,
    }

    # 4) Gennemløb: hent et par ekstra Open API-sider i serie
    page_ms = [o1["ms"]]
    total = o_total if o_total is not None else e_total
    n_pages = math.ceil(total / PAGE_SIZE) if total else 1
    for page in range(2, min(n_pages, 1 + extra_pages) + 1):
        p = await _timed_get(client, OPENAPI_LIST, params=[("page", page), ("size", PAGE_SIZE)])
        if p["error"] is not None:
            break
        page_ms.append(p["ms"])
    result["openapi"]["page_ms"] = page_ms
    result["openapi"]["avg_page_ms"] = _avg(page_ms)

    # 5) Estimat af fuld scanning (begge med portalens prewarm-concurrency)
    if total:
        avg_page = result["openapi"]["avg_page_ms"] or 0.0
        avg_detail = result["ers"]["avg_detail_ms"]
        est: dict[str, Any] = {
            "total_endpoints": total,
            "openapi_list_calls": n_pages,
            "openapi_list_seconds": round(n_pages * avg_page / 1000 / concurrency, 1),
            "ers_n_plus_1_calls": n_pages + total,
            "ers_n_plus_1_seconds": None,
        }
        if avg_detail is not None and result["ers"]["ok"]:
            est["ers_n_plus_1_seconds"] = round(
                n_pages * e1["ms"] / 1000 + total * avg_detail / 1000 / concurrency, 1
            )
            if est["openapi_list_seconds"]:
                est["speedup"] = round(est["ers_n_plus_1_seconds"] / est["openapi_list_seconds"], 1)
        result["estimate"] = est

    # 6) Konklusion
    all_have_ca = bool(o_items) and len(with_ca) == len(o_items)
    all_match = bool(ok_rows) and all(
        c["custom_attributes_match"] and c["group_match"] for c in ok_rows
    )
    if all_have_ca and all_match:
        result["verdict"] = "ok"
        result["message"] = (
            "Open API-listen returnerer fulde endpoint-data, og de stemmer med "
            "detalje-kaldene. Cachen kan fyldes fra listen uden et kald pr. endpoint."
        )
    elif not with_ca:
        result["verdict"] = "warning"
        result["message"] = (
            "Open API-listen indeholder ikke custom attributes. Portalen skal fortsat "
            "hente hvert endpoint for sig (N+1)."
        )
    else:
        result["verdict"] = "warning"
        result["message"] = (
            "Open API-listen indeholder custom attributes, men ikke for alle endpoints "
            "eller med afvigelser fra detalje-kaldet. Se sammenligningen før listen "
            "bruges som datakilde."
        )
    result["duration_s"] = round(time.time() - started, 1)
    logger.info(
        "endpoint-fetch-probe: verdict=%s openapi_items=%d with_ca=%d sampled=%d est=%s",
        result["verdict"], len(o_items), len(with_ca), len(compared), result["estimate"],
    )
    return result
