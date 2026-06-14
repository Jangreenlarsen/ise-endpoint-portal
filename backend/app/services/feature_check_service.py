# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""To-faset funktionsgennemgang: statisk (fase 1) + live ISE (fase 2)."""
from __future__ import annotations

import asyncio
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import httpx

from app.core.config import settings

STATUS = Literal["ok", "warning", "error"]

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = Path(__file__).resolve().parents[3]

_GITHUB_RAW = (
    "https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal"
    "/{branch}/version.json"
)


@dataclass
class FCResult:
    id: str
    name: str
    status: STATUS
    message: str
    details: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# FASE 1 — statiske tjek (ingen netværk, < 200 ms)
# ---------------------------------------------------------------------------

async def run_phase1() -> dict[str, Any]:
    checks: list[FCResult] = list(await asyncio.gather(
        _p1_ise_config(),
        _p1_github_config(),
        _p1_db_audit(),
        _p1_db_lockout(),
        _p1_db_cache(),
        _p1_db_metrics(),
        _p1_log_dir(),
        _p1_pxgrid_certs(),
        _p1_custom_attrs_json(),
    ))
    statuses = [c.status for c in checks]
    overall = "error" if "error" in statuses else "warning" if "warning" in statuses else "ok"
    return {
        "timestamp": time.time(),
        "phase": 1,
        "overall": overall,
        "checks": [_fc_dict(c) for c in checks],
    }


async def _p1_ise_config() -> FCResult:
    try:
        url = getattr(settings, "ise_base_url", "")
        user = getattr(settings, "ise_username", "")
        pwd = getattr(settings, "ise_password", "")
        issues = []
        if not url or "example" in url or url == "https://ise.example.local":
            issues.append("ise_base_url ikke konfigureret")
        if not user:
            issues.append("ise_username mangler")
        if not pwd:
            issues.append("ise_password mangler")
        if issues:
            return FCResult("p1_ise_config", "ISE URL + credentials", "error",
                            "; ".join(issues), {"url": url, "username": user})
        return FCResult("p1_ise_config", "ISE URL + credentials", "ok",
                        f"{url} som '{user}'", {"url": url, "username": user})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_ise_config", "ISE URL + credentials", "error", f"Fejl: {exc}")


async def _p1_github_config() -> FCResult:
    try:
        branch = getattr(settings, "github_branch", "") or ""
        git_ok = (PROJECT_ROOT / ".git").is_dir()
        issues = []
        if not branch:
            issues.append("github_branch ikke sat")
        if not git_ok:
            issues.append(".git mappe mangler")
        if issues:
            return FCResult("p1_github_config", "GitHub OTA-config", "warning",
                            "; ".join(issues), {"branch": branch, "git_dir": git_ok})
        return FCResult("p1_github_config", "GitHub OTA-config", "ok",
                        f"Branch: {branch}", {"branch": branch, "git_dir": True})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_github_config", "GitHub OTA-config", "warning", f"Fejl: {exc}")


async def _p1_db_audit() -> FCResult:
    try:
        db = BACKEND_ROOT / "audit.db"
        if db.exists():
            size = db.stat().st_size
            return FCResult("p1_db_audit", "Audit database", "ok",
                            f"audit.db ({size:,} bytes)", {"path": str(db), "size": size})
        return FCResult("p1_db_audit", "Audit database", "warning",
                        "audit.db mangler — oprettes ved første audit-event",
                        {"path": str(db)})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_db_audit", "Audit database", "error", f"Fejl: {exc}")


async def _p1_db_lockout() -> FCResult:
    try:
        db = BACKEND_ROOT / "lockout.db"
        if db.exists():
            return FCResult("p1_db_lockout", "Lockout database", "ok",
                            f"lockout.db ({db.stat().st_size:,} bytes)", {"path": str(db)})
        return FCResult("p1_db_lockout", "Lockout database", "warning",
                        "lockout.db mangler — oprettes ved login-behov",
                        {"path": str(db)})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_db_lockout", "Lockout database", "error", f"Fejl: {exc}")


async def _p1_db_cache() -> FCResult:
    try:
        cache_dir = BACKEND_ROOT / "cache"
        fs = BACKEND_ROOT / "cache" / "first_seen.db"
        ge = BACKEND_ROOT / "cache" / "guest_expiry.db"
        missing = []
        if not cache_dir.is_dir():
            missing.append("cache/")
        else:
            if not fs.exists():
                missing.append("cache/first_seen.db")
            if not ge.exists():
                missing.append("cache/guest_expiry.db")
        if missing:
            return FCResult("p1_db_cache", "Cache databaser", "warning",
                            f"Mangler (oprettes automatisk): {', '.join(missing)}",
                            {"missing": missing})
        return FCResult("p1_db_cache", "Cache databaser", "ok",
                        "first_seen.db + guest_expiry.db OK",
                        {"first_seen": str(fs), "guest_expiry": str(ge)})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_db_cache", "Cache databaser", "error", f"Fejl: {exc}")


async def _p1_db_metrics() -> FCResult:
    try:
        db = BACKEND_ROOT / "metrics_history.db"
        if db.exists():
            return FCResult("p1_db_metrics", "Metrics database", "ok",
                            f"metrics_history.db ({db.stat().st_size:,} bytes)",
                            {"path": str(db)})
        return FCResult("p1_db_metrics", "Metrics database", "warning",
                        "metrics_history.db mangler — oprettes ved første metrics-scrape",
                        {"path": str(db)})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_db_metrics", "Metrics database", "error", f"Fejl: {exc}")


async def _p1_log_dir() -> FCResult:
    try:
        log_dir = BACKEND_ROOT / "logs"
        app_log = log_dir / "app.log"
        if not log_dir.is_dir():
            return FCResult("p1_log_dir", "Log-mappe", "error",
                            "backend/logs/ mangler", {"path": str(log_dir)})
        if not app_log.exists():
            return FCResult("p1_log_dir", "Log-mappe", "warning",
                            "logs/ OK men app.log mangler endnu",
                            {"path": str(log_dir)})
        return FCResult("p1_log_dir", "Log-mappe", "ok",
                        f"app.log ({app_log.stat().st_size:,} bytes)",
                        {"path": str(log_dir), "size": app_log.stat().st_size})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_log_dir", "Log-mappe", "error", f"Fejl: {exc}")


async def _p1_pxgrid_certs() -> FCResult:
    try:
        if not getattr(settings, "pxgrid_enabled", False):
            return FCResult("p1_pxgrid_certs", "pxGrid certifikater", "ok",
                            "pxGrid deaktiveret — certifikater ikke påkrævet")
        cert_mode = getattr(settings, "pxgrid_cert_mode", "upload")
        cert_path = getattr(settings, "pxgrid_cert_path", "")
        key_path = getattr(settings, "pxgrid_key_path", "")
        if cert_mode == "generate":
            cert_dir = BACKEND_ROOT / "certs"
            generated = list(cert_dir.glob("pxgrid_client*.pem")) if cert_dir.is_dir() else []
            if generated:
                return FCResult("p1_pxgrid_certs", "pxGrid certifikater", "ok",
                                f"Auto-genereret cert fundet: {generated[0].name}",
                                {"mode": "generate", "found": [str(p) for p in generated]})
            return FCResult("p1_pxgrid_certs", "pxGrid certifikater", "warning",
                            "Ingen auto-genereret cert fundet endnu — kør 'Generer CSR' i pxGrid-indstillinger",
                            {"mode": "generate"})
        issues = []
        if not cert_path or not Path(cert_path).exists():
            issues.append(f"cert mangler: {cert_path or '(ingen sti)'}")
        if not key_path or not Path(key_path).exists():
            issues.append(f"key mangler: {key_path or '(ingen sti)'}")
        if issues:
            return FCResult("p1_pxgrid_certs", "pxGrid certifikater", "error",
                            "; ".join(issues), {"cert_path": cert_path, "key_path": key_path})
        return FCResult("p1_pxgrid_certs", "pxGrid certifikater", "ok",
                        "Cert + key fundet",
                        {"cert_path": cert_path, "key_path": key_path})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_pxgrid_certs", "pxGrid certifikater", "error", f"Fejl: {exc}")


async def _p1_custom_attrs_json() -> FCResult:
    try:
        store = BACKEND_ROOT / "custom_attr_values.json"
        if store.exists():
            import json
            try:
                data = json.loads(store.read_text(encoding="utf-8"))
                n = sum(len(v) for v in data.values()) if isinstance(data, dict) else 0
                return FCResult("p1_custom_attrs_json", "Custom attrs store", "ok",
                                f"custom_attr_values.json ({n} værdier registreret)",
                                {"path": str(store), "attribute_count": len(data) if isinstance(data, dict) else 0})
            except Exception:
                return FCResult("p1_custom_attrs_json", "Custom attrs store", "warning",
                                "Filen eksisterer men er ugyldig JSON", {"path": str(store)})
        return FCResult("p1_custom_attrs_json", "Custom attrs store", "warning",
                        "custom_attr_values.json mangler — oprettes ved første redigering",
                        {"path": str(store)})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p1_custom_attrs_json", "Custom attrs store", "warning", f"Fejl: {exc}")


# ---------------------------------------------------------------------------
# FASE 2 — live funktionstest (netværk + ISE, 5-15 s)
# ---------------------------------------------------------------------------

async def run_phase2() -> dict[str, Any]:
    checks: list[FCResult] = list(await asyncio.gather(
        _p2_ers_endpoint_list(),
        _p2_ers_groups(),
        _p2_ers_custom_attrs(),
        _p2_mnt_sessions(),
        _p2_openapi(),
        _p2_nmap_test(),
        _p2_github_reach(),
        _p2_cache_warm(),
        _p2_pxgrid_live(),
    ))
    statuses = [c.status for c in checks]
    overall = "error" if "error" in statuses else "warning" if "warning" in statuses else "ok"
    return {
        "timestamp": time.time(),
        "phase": 2,
        "overall": overall,
        "checks": [_fc_dict(c) for c in checks],
    }


def _ise_client() -> httpx.AsyncClient:
    s = settings
    return httpx.AsyncClient(
        base_url=s.ise_base_url.rstrip("/"),
        auth=(s.ise_username, s.ise_password),
        verify=s.ise_ca_bundle or s.ise_verify_tls,
        timeout=8.0,
        headers={"Accept": "application/json"},
    )


async def _p2_ers_endpoint_list() -> FCResult:
    try:
        async with _ise_client() as c:
            r = await c.get("/ers/config/endpoint", params={"size": 1, "page": 1})
        if r.status_code == 200:
            total = r.json().get("SearchResult", {}).get("total", "?")
            return FCResult("p2_ers_endpoints", "ERS: endpoint-liste", "ok",
                            f"Kan liste endpoints — {total} total",
                            {"total": total, "status_code": 200})
        return FCResult("p2_ers_endpoints", "ERS: endpoint-liste", "error",
                        f"HTTP {r.status_code} — tjek ERS-bruger og rettigheder",
                        {"status_code": r.status_code})
    except httpx.TimeoutException:
        return FCResult("p2_ers_endpoints", "ERS: endpoint-liste", "error",
                        "Timeout (8s) — ISE ikke nåbar")
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_ers_endpoints", "ERS: endpoint-liste", "error",
                        f"Forbindelsesfejl: {str(exc)[:100]}")


async def _p2_ers_groups() -> FCResult:
    try:
        async with _ise_client() as c:
            r = await c.get("/ers/config/endpointgroup", params={"size": 1, "page": 1})
        if r.status_code == 200:
            total = r.json().get("SearchResult", {}).get("total", "?")
            return FCResult("p2_ers_groups", "ERS: endpoint-grupper", "ok",
                            f"{total} gruppe(r) tilgængelige",
                            {"total": total})
        return FCResult("p2_ers_groups", "ERS: endpoint-grupper", "error",
                        f"HTTP {r.status_code}", {"status_code": r.status_code})
    except httpx.TimeoutException:
        return FCResult("p2_ers_groups", "ERS: endpoint-grupper", "error", "Timeout (8s)")
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_ers_groups", "ERS: endpoint-grupper", "error",
                        f"Fejl: {str(exc)[:100]}")


async def _p2_ers_custom_attrs() -> FCResult:
    try:
        async with _ise_client() as c:
            r = await c.get("/ers/config/customattribute")
        if r.status_code == 200:
            items = r.json().get("SearchResult", {}).get("resources", [])
            names = [i.get("name", "") for i in items]
            has_portal_attr = any("hypervision" in n.lower() for n in names)
            if has_portal_attr:
                return FCResult("p2_ers_custom_attrs", "ERS: custom attributes", "ok",
                                f"{len(names)} custom attributes — HypervisionISEPortal fundet",
                                {"names": names, "portal_attr": True})
            return FCResult("p2_ers_custom_attrs", "ERS: custom attributes", "warning",
                            f"{len(names)} custom attributes — HypervisionISEPortal IKKE fundet (portal-attribut mangler i ISE)",
                            {"names": names, "portal_attr": False})
        return FCResult("p2_ers_custom_attrs", "ERS: custom attributes", "error",
                        f"HTTP {r.status_code}", {"status_code": r.status_code})
    except httpx.TimeoutException:
        return FCResult("p2_ers_custom_attrs", "ERS: custom attributes", "error", "Timeout (8s)")
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_ers_custom_attrs", "ERS: custom attributes", "error",
                        f"Fejl: {str(exc)[:100]}")


async def _p2_mnt_sessions() -> FCResult:
    try:
        s = settings
        async with httpx.AsyncClient(
            base_url=s.ise_base_url.rstrip("/"),
            auth=(s.ise_username, s.ise_password),
            verify=s.ise_ca_bundle or s.ise_verify_tls,
            timeout=8.0,
            headers={"Accept": "application/xml"},
        ) as c:
            r = await c.get("/admin/API/mnt/Session/ActiveList")
        if r.status_code == 200:
            import xml.etree.ElementTree as ET
            try:
                root = ET.fromstring(r.text)
                count = len(root.findall(".//activeSession"))
            except Exception:
                count = "?"
            return FCResult("p2_mnt_sessions", "MnT: aktive sessioner", "ok",
                            f"MnT tilgængeligt — {count} aktive sessioner",
                            {"session_count": count})
        if r.status_code == 401:
            return FCResult("p2_mnt_sessions", "MnT: aktive sessioner", "error",
                            "HTTP 401 — MnT kræver 'MnT Admin'-rolle på ISE-bruger",
                            {"status_code": 401})
        return FCResult("p2_mnt_sessions", "MnT: aktive sessioner", "error",
                        f"HTTP {r.status_code}", {"status_code": r.status_code})
    except httpx.TimeoutException:
        return FCResult("p2_mnt_sessions", "MnT: aktive sessioner", "error",
                        "Timeout (8s) — MnT svarer ikke")
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_mnt_sessions", "MnT: aktive sessioner", "error",
                        f"Fejl: {str(exc)[:100]}")


async def _p2_openapi() -> FCResult:
    try:
        async with _ise_client() as c:
            r = await c.get("/api/v1/endpoint/count")
        if r.status_code == 200:
            count = r.json().get("count", "?")
            return FCResult("p2_openapi", "OpenAPI endpoint-count", "ok",
                            f"OpenAPI tilgængeligt — {count} endpoints",
                            {"count": count})
        if r.status_code in (404, 405):
            return FCResult("p2_openapi", "OpenAPI endpoint-count", "warning",
                            f"HTTP {r.status_code} — OpenAPI muligvis ikke aktiveret på ISE",
                            {"status_code": r.status_code})
        return FCResult("p2_openapi", "OpenAPI endpoint-count", "error",
                        f"HTTP {r.status_code}", {"status_code": r.status_code})
    except httpx.TimeoutException:
        return FCResult("p2_openapi", "OpenAPI endpoint-count", "error", "Timeout (8s)")
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_openapi", "OpenAPI endpoint-count", "error",
                        f"Fejl: {str(exc)[:100]}")


async def _p2_nmap_test() -> FCResult:
    try:
        nmap_path = shutil.which("nmap")
        if not nmap_path:
            return FCResult("p2_nmap", "nmap funktionstest", "warning",
                            "nmap ikke fundet i PATH — scanning deaktiveret")
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    [nmap_path, "-sn", "-T4", "--host-timeout", "3s", "127.0.0.1"],
                    capture_output=True, text=True, timeout=10,
                ),
            ),
            timeout=12.0,
        )
        if result.returncode == 0 and "1 IP address" in result.stdout:
            return FCResult("p2_nmap", "nmap funktionstest", "ok",
                            "nmap localhost-scan OK",
                            {"nmap_path": nmap_path, "output": result.stdout.strip()[:200]})
        if result.returncode == 0:
            return FCResult("p2_nmap", "nmap funktionstest", "warning",
                            "nmap kørte men output var uventet",
                            {"output": result.stdout.strip()[:200]})
        return FCResult("p2_nmap", "nmap funktionstest", "error",
                        f"nmap returncode {result.returncode}",
                        {"stderr": result.stderr.strip()[:100]})
    except asyncio.TimeoutError:
        return FCResult("p2_nmap", "nmap funktionstest", "error", "nmap timeout (12s)")
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_nmap", "nmap funktionstest", "error", f"Fejl: {str(exc)[:100]}")


async def _p2_github_reach() -> FCResult:
    try:
        branch = (getattr(settings, "github_branch", "") or "main").strip()
        url = _GITHUB_RAW.format(branch=branch)
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(url)
        if r.status_code == 200:
            import json
            data = json.loads(r.text)
            remote_ver = f"{data.get('version', '?')}.{data.get('build', '?')}"
            return FCResult("p2_github", "GitHub-forbindelse", "ok",
                            f"GitHub nåbar — seneste version: {remote_ver} ({branch})",
                            {"url": url, "remote_version": remote_ver, "branch": branch})
        return FCResult("p2_github", "GitHub-forbindelse", "error",
                        f"HTTP {r.status_code} — kan ikke nå GitHub {branch} branch",
                        {"status_code": r.status_code, "url": url})
    except httpx.TimeoutException:
        return FCResult("p2_github", "GitHub-forbindelse", "error",
                        "Timeout (8s) — ingen internet-forbindelse?")
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_github", "GitHub-forbindelse", "error",
                        f"Fejl: {str(exc)[:100]}")


async def _p2_cache_warm() -> FCResult:
    try:
        from app.services.cache import get_cache
        cache = get_cache()
        count = cache.detail_count() if hasattr(cache, "detail_count") else 0
        if count > 0:
            return FCResult("p2_cache", "Endpoint-cache", "ok",
                            f"{count} endpoints i cache",
                            {"count": count})
        return FCResult("p2_cache", "Endpoint-cache", "warning",
                        "Cache er tom — kør 'Forvarm cache' i indstillinger eller vent på auto-opvarmning",
                        {"count": 0})
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_cache", "Endpoint-cache", "warning",
                        f"Kunne ikke læse cache: {str(exc)[:80]}")


async def _p2_pxgrid_live() -> FCResult:
    try:
        if not getattr(settings, "pxgrid_enabled", False):
            return FCResult("p2_pxgrid", "pxGrid live-status", "ok",
                            "pxGrid deaktiveret — live-test ikke relevant")
        from app.pxgrid.session_worker import get_worker
        status = get_worker().status
        if status.connected:
            return FCResult("p2_pxgrid", "pxGrid live-status", "ok",
                            f"Forbundet til {status.peer_node or 'ISE'} — {status.messages_total} events modtaget",
                            {"connected": True, "peer_node": status.peer_node,
                             "messages_total": status.messages_total})
        if status.running:
            return FCResult("p2_pxgrid", "pxGrid live-status", "warning",
                            f"Worker kører men ikke forbundet — {status.last_error or 'ingen fejl'}",
                            {"running": True, "last_error": status.last_error})
        return FCResult("p2_pxgrid", "pxGrid live-status", "error",
                        "pxGrid worker er ikke startet")
    except Exception as exc:  # noqa: BLE001
        return FCResult("p2_pxgrid", "pxGrid live-status", "warning",
                        f"Fejl: {str(exc)[:80]}")


# ---------------------------------------------------------------------------
# Hjælper
# ---------------------------------------------------------------------------

def _fc_dict(r: FCResult) -> dict[str, Any]:
    return {"id": r.id, "name": r.name, "status": r.status,
            "message": r.message, "details": r.details}
