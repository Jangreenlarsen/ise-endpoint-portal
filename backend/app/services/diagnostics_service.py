# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Systemdiagnostik: kører sundhedstjek af backend-afhængigheder og -tjenester."""
from __future__ import annotations

import asyncio
import importlib.metadata as _meta
import logging
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

STATUS = Literal["ok", "warning", "error"]

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT  = Path(__file__).resolve().parents[2]

_REQUIRED_DISTS = [
    "fastapi",
    "uvicorn",
    "httpx",
    "pydantic",
    "pydantic-settings",
    "python-dotenv",
    "python-multipart",
    "cryptography",
    "websockets",
    "tenacity",
    "prometheus-client",
    "tacacs-plus",
    "psutil",
]


@dataclass
class CheckResult:
    id: str
    name: str
    status: STATUS
    message: str
    details: dict[str, Any] = field(default_factory=dict)


async def run_quick() -> dict[str, Any]:
    """Hurtig system-status til dashboard.

    Udelukker live ISE-GET og git subprocess så kaldet er < 100 ms.
    Bruges af dashboard-refresh (hvert 30s) — fuld run_all() kun on-demand.
    """
    checks: list[CheckResult] = list(await asyncio.gather(
        _check_http2(),
        _check_nmap(),
        _check_disk_space(),
        _check_ise_config(),
        _check_mnt_connectivity(),
        _check_cache_status(),
        _check_circuit_breaker(),
        _check_pxgrid(),
    ))
    statuses = [c.status for c in checks]
    overall = "error" if "error" in statuses else "warning" if "warning" in statuses else "ok"
    return {
        "timestamp": time.time(),
        "overall": overall,
        "checks": [
            {"id": c.id, "name": c.name, "status": c.status, "message": c.message}
            for c in checks
        ],
    }


async def run_all() -> dict[str, Any]:
    """Kør alle diagnostik-tjek parallelt og returner samlet resultat."""
    checks: list[CheckResult] = list(await asyncio.gather(
        _check_python_version(),
        _check_venv(),
        _check_python_deps(),
        _check_http2(),
        _check_nmap(),
        _check_disk_space(),
        _check_ise_config(),
        _check_ise_connectivity(),
        _check_mnt_connectivity(),
        _check_cache_status(),
        _check_circuit_breaker(),
        _check_pxgrid(),
        _check_git(),
    ))

    statuses = [c.status for c in checks]
    if "error" in statuses:
        overall = "error"
    elif "warning" in statuses:
        overall = "warning"
    else:
        overall = "ok"

    return {
        "timestamp": time.time(),
        "overall": overall,
        "checks": [
            {"id": c.id, "name": c.name, "status": c.status, "message": c.message, "details": c.details}
            for c in checks
        ],
    }


async def _check_python_version() -> CheckResult:
    try:
        v = sys.version_info
        version_str = f"{v.major}.{v.minor}.{v.micro}"
        if v < (3, 11):
            return CheckResult("python_version", "Python version", "error", f"Python {version_str} — kræver 3.11+")
        return CheckResult("python_version", "Python version", "ok", f"Python {version_str}", {
            "version": version_str,
            "platform": platform.platform(),
        })
    except Exception as exc:  # noqa: BLE001
        return CheckResult("python_version", "Python version", "error", f"Fejl: {exc}")


async def _check_venv() -> CheckResult:
    try:
        exe = sys.executable
        in_venv = (
            hasattr(sys, "real_prefix")
            or (hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix)
            or "venv" in exe.lower()
        )
        if in_venv:
            return CheckResult("venv", "Virtuel miljø (venv)", "ok", f"Kører i venv: {exe}", {"executable": exe})
        return CheckResult("venv", "Virtuel miljø (venv)", "warning",
                           f"Ikke i venv: {exe} — anbefales til produktion", {"executable": exe})
    except Exception as exc:  # noqa: BLE001
        return CheckResult("venv", "Virtuel miljø (venv)", "warning", f"Fejl: {exc}")


async def _check_python_deps() -> CheckResult:
    try:
        missing: list[str] = []
        installed: dict[str, str] = {}
        for dist in _REQUIRED_DISTS:
            try:
                installed[dist] = _meta.version(dist)
            except _meta.PackageNotFoundError:
                missing.append(dist)
        if missing:
            return CheckResult(
                "python_deps", "Python afhængigheder", "error",
                f"{len(missing)} pakke(r) mangler: {', '.join(missing)}",
                {"installed": installed, "missing": missing},
            )
        return CheckResult(
            "python_deps", "Python afhængigheder", "ok",
            f"Alle {len(installed)} påkrævede pakker installeret",
            {"installed": installed, "missing": []},
        )
    except Exception as exc:  # noqa: BLE001
        return CheckResult("python_deps", "Python afhængigheder", "error", f"Fejl: {exc}")


async def _check_http2() -> CheckResult:
    try:
        try:
            import h2  # noqa: F401  # type: ignore[import]
            try:
                version = _meta.version("h2")
            except _meta.PackageNotFoundError:
                version = "installeret"
            return CheckResult("http2", "HTTP/2 (h2 pakke)", "ok", f"h2 {version} — HTTP/2 aktiveret", {"h2_version": version})
        except ImportError:
            http2_enabled = getattr(settings, "ise_http2", True)
            if http2_enabled:
                return CheckResult("http2", "HTTP/2 (h2 pakke)", "warning",
                                   "h2 mangler — kører HTTP/1.1. Installeres automatisk ved næste OTA-opdatering.")
            return CheckResult("http2", "HTTP/2 (h2 pakke)", "warning",
                               "HTTP/2 deaktiveret (ise_http2=false) og h2 ikke installeret.")
    except Exception as exc:  # noqa: BLE001
        return CheckResult("http2", "HTTP/2 (h2 pakke)", "warning", f"Fejl: {exc}")


async def _check_nmap() -> CheckResult:
    try:
        nmap_path = shutil.which("nmap")
        if nmap_path:
            try:
                result = subprocess.run([nmap_path, "--version"], capture_output=True, text=True, timeout=5)
                first_line = result.stdout.splitlines()[0] if result.stdout else "nmap"
                return CheckResult("nmap", "nmap", "ok", first_line, {"path": nmap_path})
            except Exception:
                return CheckResult("nmap", "nmap", "ok", f"nmap fundet: {nmap_path}", {"path": nmap_path})
        return CheckResult("nmap", "nmap", "warning", "nmap ikke fundet i PATH — nmap-scanning deaktiveret")
    except Exception as exc:  # noqa: BLE001
        return CheckResult("nmap", "nmap", "warning", f"Fejl: {exc}")


async def _check_disk_space() -> CheckResult:
    try:
        stat = shutil.disk_usage(BACKEND_ROOT)
        free_gb  = stat.free  / 1024 ** 3
        total_gb = stat.total / 1024 ** 3
        used_pct = stat.used  / stat.total * 100
        log_dir = BACKEND_ROOT / "logs"
        log_mb = (
            sum(f.stat().st_size for f in log_dir.rglob("*") if f.is_file()) / 1024 ** 2
            if log_dir.exists() else 0.0
        )
        if free_gb < 0.5:
            status = "error"
            msg = f"Kritisk lav diskplads: {free_gb:.1f} GB fri ({used_pct:.0f}% brugt)"
        elif free_gb < 2.0:
            status = "warning"
            msg = f"Lav diskplads: {free_gb:.1f} GB fri ({used_pct:.0f}% brugt)"
        else:
            status = "ok"
            msg = f"{free_gb:.1f} GB fri af {total_gb:.0f} GB ({used_pct:.0f}% brugt)"
        return CheckResult("disk_space", "Disk plads", status, msg, {
            "free_gb":    round(free_gb, 2),
            "total_gb":   round(total_gb, 1),
            "used_pct":   round(used_pct, 1),
            "log_size_mb": round(log_mb, 1),
        })
    except Exception as exc:  # noqa: BLE001
        return CheckResult("disk_space", "Disk plads", "warning", f"Tjek fejlede: {str(exc)[:80]}")


async def _check_ise_config() -> CheckResult:
    try:
        url      = getattr(settings, "ise_base_url", "") or ""
        username = getattr(settings, "ise_username", "") or ""
        password = getattr(settings, "ise_password", "") or ""
        issues: list[str] = []
        if not url or url == "https://ise.example.local":
            issues.append("Base URL ikke konfigureret")
        if not username:
            issues.append("ISE brugernavn mangler")
        if not password:
            issues.append("ISE adgangskode mangler")
        if issues:
            return CheckResult("ise_config", "ISE konfiguration", "warning", "; ".join(issues))
        return CheckResult("ise_config", "ISE konfiguration", "ok",
                           f"Konfigureret: {url} (bruger: {username})", {"url": url, "username": username})
    except Exception as exc:  # noqa: BLE001
        return CheckResult("ise_config", "ISE konfiguration", "warning", f"Fejl: {exc}")


async def _check_ise_connectivity() -> CheckResult:
    try:
        url      = getattr(settings, "ise_base_url", "") or ""
        username = getattr(settings, "ise_username", "") or ""
        password = getattr(settings, "ise_password", "") or ""
        if not url or not username or not password:
            return CheckResult("ise_connectivity", "ISE forbindelse (ERS)", "warning",
                               "ISE ikke konfigureret — spring over")
        start = time.perf_counter()
        async with httpx.AsyncClient(
            base_url=url.rstrip("/"),
            auth=(username, password),
            verify=getattr(settings, "ise_ca_bundle", None) or getattr(settings, "ise_verify_tls", False),
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=2.0),
            headers={"Accept": "application/json"},
        ) as client:
            resp = await client.get("/ers/config/endpointgroup?size=1&page=1")
        ms = round((time.perf_counter() - start) * 1000)
        if resp.status_code == 200:
            return CheckResult("ise_connectivity", "ISE forbindelse (ERS)", "ok",
                               f"200 OK — {ms} ms", {"latency_ms": ms, "status_code": 200})
        return CheckResult("ise_connectivity", "ISE forbindelse (ERS)", "warning",
                           f"Uventet svar: {resp.status_code} — {ms} ms", {"latency_ms": ms, "status_code": resp.status_code})
    except httpx.TimeoutException:
        return CheckResult("ise_connectivity", "ISE forbindelse (ERS)", "error",
                           "Timeout (>10 s) — ISE ikke tilgængelig")
    except httpx.ConnectError as exc:
        return CheckResult("ise_connectivity", "ISE forbindelse (ERS)", "error",
                           f"Forbindelsesfejl: {str(exc)[:100]}")
    except Exception as exc:  # noqa: BLE001
        return CheckResult("ise_connectivity", "ISE forbindelse (ERS)", "error",
                           f"Fejl: {str(exc)[:100]}")


async def _check_cache_status() -> CheckResult:
    try:
        from app.core.endpoint_cache import get_cache
        cache = get_cache()
        count = cache.detail_count() if hasattr(cache, "detail_count") else len(getattr(cache, "_details", {}))
        if count == 0:
            return CheckResult("cache_status", "Endpoint cache", "warning",
                               "Cache er tom — pre-warm kører muligvis endnu", {"count": 0})
        return CheckResult("cache_status", "Endpoint cache", "ok",
                           f"{count} endpoints i cache", {"count": count})
    except Exception as exc:  # noqa: BLE001
        return CheckResult("cache_status", "Endpoint cache", "warning",
                           f"Kunne ikke læse cache: {str(exc)[:80]}")


async def _check_circuit_breaker() -> CheckResult:
    try:
        from app.ise.client import get_ise_client
        cb = get_ise_client()._cb
        stats = cb.stats()
        state = stats["state"]
        if state == "closed":
            return CheckResult("circuit_breaker", "Circuit breaker", "ok",
                               "Closed — ISE kommunikation normal", stats)
        if state == "half_open":
            return CheckResult("circuit_breaker", "Circuit breaker", "warning",
                               "Half-open — tester om ISE er kommet op igen", stats)
        remaining = stats.get("recovery_remaining_s", 0)
        return CheckResult("circuit_breaker", "Circuit breaker", "error",
                           f"Open — ISE fejlede {stats['failure_count']}x, retry om {remaining:.0f} s", stats)
    except Exception as exc:  # noqa: BLE001
        return CheckResult("circuit_breaker", "Circuit breaker", "warning",
                           f"Kunne ikke læse circuit breaker: {str(exc)[:80]}")


async def _check_mnt_connectivity() -> CheckResult:
    """Test MnT-forbindelsen ved at sende en session-IP-probe og måle latens.

    Kalder det præcise endpoint som guest-selvregistrering bruger
    (GET /admin/API/mnt/Session/IPAddress/{ip}). 404 er forventet og OK —
    vi måler latensen for svaret, ikke session-indholdet.
    """
    try:
        url      = getattr(settings, "ise_base_url", "") or ""
        username = getattr(settings, "ise_username", "") or ""
        password = getattr(settings, "ise_password", "") or ""
        if not url or not username or not password:
            return CheckResult("mnt_connectivity", "MnT forbindelse (guest MAC-opslag)", "warning",
                               "ISE ikke konfigureret — spring over")
        probe_ip = "10.0.0.1"
        path = f"/admin/API/mnt/Session/IPAddress/{probe_ip}"
        start = time.perf_counter()
        async with httpx.AsyncClient(
            base_url=url.rstrip("/"),
            auth=(username, password),
            verify=getattr(settings, "ise_ca_bundle", None) or getattr(settings, "ise_verify_tls", False),
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=2.0),
            headers={"Accept": "application/xml"},
            follow_redirects=False,
        ) as client:
            resp = await client.get(path)
        ms = round((time.perf_counter() - start) * 1000)

        if resp.status_code in (200, 404):
            if ms > 5000:
                level, note = "warning", f"Svarer men langsomt ({ms} ms) — kan forsinke guest-registrering"
            elif ms > 2000:
                level, note = "warning", f"Svarer OK men noget langsomt ({ms} ms)"
            else:
                level, note = "ok", f"OK — {ms} ms"
            return CheckResult("mnt_connectivity", "MnT forbindelse (guest MAC-opslag)", level, note,
                               {"latency_ms": ms, "http_status": resp.status_code, "probe_ip": probe_ip})

        return CheckResult("mnt_connectivity", "MnT forbindelse (guest MAC-opslag)", "warning",
                           f"Uventet svar: HTTP {resp.status_code} — {ms} ms",
                           {"latency_ms": ms, "http_status": resp.status_code})
    except httpx.TimeoutException:
        return CheckResult("mnt_connectivity", "MnT forbindelse (guest MAC-opslag)", "error",
                           "Timeout (>15 s) — MnT ikke tilgængeligt, guest-registrering vil fejle")
    except httpx.ConnectError as exc:
        return CheckResult("mnt_connectivity", "MnT forbindelse (guest MAC-opslag)", "error",
                           f"Forbindelsesfejl: {str(exc)[:100]}")
    except Exception as exc:  # noqa: BLE001
        return CheckResult("mnt_connectivity", "MnT forbindelse (guest MAC-opslag)", "warning",
                           f"Fejl: {str(exc)[:100]}")


async def _check_pxgrid() -> CheckResult:
    try:
        if not getattr(settings, "pxgrid_enabled", False):
            return CheckResult("pxgrid", "pxGrid", "ok", "pxGrid er deaktiveret i indstillinger")
        from app.pxgrid.session_worker import get_worker
        status = get_worker().status
        if status.connected:
            return CheckResult("pxgrid", "pxGrid", "ok",
                               f"Forbundet til {status.peer_node or 'ISE'}", {
                                   "connected": True,
                                   "peer_node": status.peer_node,
                                   "messages_total": status.messages_total,
                                   "reconnect_count": status.reconnect_count,
                               })
        if status.running:
            return CheckResult("pxgrid", "pxGrid", "warning",
                               f"Kører men ikke forbundet — {status.last_error or 'ingen fejl'}", {
                                   "connected": False,
                                   "running": True,
                                   "last_error": status.last_error,
                                   "reconnect_count": status.reconnect_count,
                               })
        return CheckResult("pxgrid", "pxGrid", "warning", "pxGrid worker er ikke startet")
    except Exception as exc:  # noqa: BLE001
        return CheckResult("pxgrid", "pxGrid", "warning",
                           f"Kunne ikke hente pxGrid status: {str(exc)[:80]}")


async def _check_git() -> CheckResult:
    try:
        loop = asyncio.get_event_loop()

        def _run(args: list[str]):
            return subprocess.run(
                ["git", "-C", str(PROJECT_ROOT)] + args,
                capture_output=True, text=True, timeout=5,
            )

        log_r, branch_r = await asyncio.gather(
            loop.run_in_executor(None, lambda: _run(["log", "-1", "--format=%h|%s|%ai"])),
            loop.run_in_executor(None, lambda: _run(["branch", "--show-current"])),
        )

        if log_r.returncode != 0:
            return CheckResult("git", "Git", "warning", "Ikke et git-repo eller git ikke tilgængeligt")

        parts = log_r.stdout.strip().split("|", 2)
        commit_hash = parts[0]                   if parts          else "?"
        commit_msg  = parts[1]                   if len(parts) > 1 else "?"
        commit_date = parts[2].strip()[:19]      if len(parts) > 2 else "?"
        branch      = branch_r.stdout.strip()    or "?"

        return CheckResult("git", "Git", "ok", f"{branch} @ {commit_hash}", {
            "branch": branch,
            "commit": commit_hash,
            "message": commit_msg,
            "date": commit_date,
        })
    except Exception as exc:  # noqa: BLE001
        return CheckResult("git", "Git", "warning", f"git fejlede: {str(exc)[:80]}")
