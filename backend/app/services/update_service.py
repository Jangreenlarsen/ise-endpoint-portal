# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Portal-opdateringsservice.

Admin uploader en ZIP-pakke der indeholder nye versions af portal-filer
(frontend + backend Python + version.json). Servicen validerer pakken,
anvender filerne og kan trigge en server-genstart.

Sikkerhedsregler:
  - Kun filer under tilladte prefixes godtages
  - Path-traversal (..) afvises
  - .env og runtime-mapper (logs/, cache/, data/) blokeres altid
  - Maks 100 MB pr. pakke

Genstart-mekanisme:
  schedule_restart() kalder os._exit(0) efter 2s delay. START.bat skal
  køre i en loop for at genstarte serveren automatisk. Uden loop kræves
  manuel genstart.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import subprocess
import time
import zipfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Projektroden: backend/app/services/ → ../../.. → projekt-root
PROJECT_ROOT = Path(__file__).resolve().parents[3]

MAX_ZIP_BYTES = 100 * 1024 * 1024         # 100 MB komprimeret
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024  # 500 MB ukomprimeret

# Filer/mapper der ALDRIG overskrives uanset pakkens indhold
_BLOCKED_PREFIXES = (
    ".env",
    "backend/.env",
    "backend/logs/",
    "backend/cache/",
    "backend/data/",
)

# Kun disse prefixes accepteres fra en pakke.
# Dokumentationsfiler (*.md) og START.bat er udeladt — de er ikke runtime-kritiske
# og er typisk read-only for portal-processen på Linux-deployment.
_ALLOWED_PREFIXES = (
    "frontend/",
    "backend/app/",
    "backend/pyproject.toml",
    "version.json",
)


def _safe_target(zip_name: str) -> Path | None:
    """Returnerer absolut målsti hvis filen er tilladt, ellers None."""
    # Normaliser til forward slashes, fjern leading /
    norm = zip_name.replace("\\", "/").lstrip("/")
    # Afvis path traversal
    parts = norm.split("/")
    if ".." in parts or any(p == "" for p in parts[:-1]):
        return None
    # Afvis blokerede stier
    for blocked in _BLOCKED_PREFIXES:
        if norm == blocked or norm.startswith(blocked):
            return None
    # Kræv tilladte prefixes
    if not any(norm == p.rstrip("/") or norm.startswith(p) for p in _ALLOWED_PREFIXES):
        return None
    target = PROJECT_ROOT / norm
    # Dobbelttjek at stien faktisk er under PROJECT_ROOT (paranoid check)
    try:
        target.resolve().relative_to(PROJECT_ROOT.resolve())
    except ValueError:
        return None
    return target


def validate_package(zip_bytes: bytes) -> dict[str, Any]:
    """Validér pakkeindhold uden at skrive til disk.

    Returns dict med: ok, version, build, file_count, files, blocked, errors.
    """
    errors: list[str] = []
    accepted: list[str] = []
    blocked_files: list[str] = []
    version_info: dict[str, Any] = {}

    if not zip_bytes:
        return {"ok": False, "errors": ["Tom fil"], "files": [], "blocked": []}

    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            all_names = zf.namelist()
            # Tjek ukomprimeret totalstørrelse inden videre behandling (ZIP-bomb)
            total_uncompressed = sum(zf.getinfo(n).file_size for n in all_names if not n.endswith("/"))
            if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                return {
                    "ok": False,
                    "errors": [f"Pakken udpakker til {total_uncompressed // (1024 * 1024)} MB — max 500 MB"],
                    "files": [], "blocked": [],
                }
            # Find version.json (acceptér på rod-niveau)
            v_candidates = [n for n in all_names if Path(n).name == "version.json" and n.count("/") <= 1]
            if not v_candidates:
                errors.append("Pakken mangler version.json på rod-niveau")
            else:
                try:
                    version_info = json.loads(zf.read(v_candidates[0]).decode("utf-8"))
                except Exception as exc:
                    errors.append(f"version.json er ugyldig: {exc}")

            for name in all_names:
                if name.endswith("/"):
                    continue  # mappe-entry
                target = _safe_target(name)
                if target is None:
                    blocked_files.append(name)
                else:
                    accepted.append(name)

    except zipfile.BadZipFile:
        errors.append("Filen er ikke et gyldigt ZIP-arkiv")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"ZIP-fejl: {exc}")

    ok = len(errors) == 0 and len(accepted) > 0
    return {
        "ok": ok,
        "version": version_info.get("version", "?"),
        "build": version_info.get("build", "?"),
        "file_count": len(accepted),
        "files": accepted,
        "blocked": blocked_files,
        "errors": errors,
    }


def apply_package(zip_bytes: bytes) -> dict[str, Any]:
    """Anvend pakkens filer til disk. Validerer igen inden write.

    Returns dict med: ok, applied, skipped, errors, applied_count.
    """
    applied: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    val = validate_package(zip_bytes)
    if not val["ok"]:
        return {"ok": False, "applied": [], "skipped": [], "errors": val["errors"], "applied_count": 0}

    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for name in zf.namelist():
                if name.endswith("/"):
                    continue
                target = _safe_target(name)
                if target is None:
                    skipped.append(name)
                    continue
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(zf.read(name))
                    applied.append(name)
                    logger.info("update: skrev %s", target.relative_to(PROJECT_ROOT))
                except PermissionError:
                    skipped.append(name)
                    logger.warning("update: springer %s over — ingen skriveadgang (ok på Linux-deployment)", name)
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{name}: {exc}")
                    logger.error("update: fejl ved skrivning af %s: %s", name, exc)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"ZIP-fejl: {exc}")

    ok = len(errors) == 0
    logger.info(
        "update: anvend færdig — %d filer skrevet, %d fejl",
        len(applied), len(errors),
    )
    result = {
        "ok": ok,
        "applied": applied,
        "skipped": skipped,
        "errors": errors,
        "applied_count": len(applied),
    }
    from app.core import audit_store
    audit_store.record_sync(
        "package_apply", "system",
        after={"ok": ok, "applied_count": len(applied), "errors": errors[:5]},
    )
    return result


# ---------------------------------------------------------------------------
# GitHub version check
# ---------------------------------------------------------------------------

_GITHUB_RAW_TMPL = (
    "https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/{branch}/version.json"
)
_GITHUB_RELEASE_NOTES_TMPL = (
    "https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/{branch}/RELEASE_NOTES.md"
)
_github_cache: dict[str, Any] = {}
_github_cache_ts: float = 0.0
_github_cache_branch: str = ""
_GITHUB_CACHE_TTL = 3600.0  # 1 time


def _parse_semver(v: str) -> tuple[int, int, int]:
    """Parse 'X.Y.Z' → (X, Y, Z). Returnerer (0,0,0) ved fejl."""
    import re
    m = re.match(r"(\d+)\.(\d+)\.(\d+)", v or "")
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)))


def _split_release_sections(md_text: str) -> list[tuple[tuple[int, int, int], str]]:
    """Opdel RELEASE_NOTES.md i (semver-tuple, tekst)-par for alle ## [X.Y.Z]-sektioner."""
    import re
    section_re = re.compile(r'(## \[\d+\.\d+\.\d+\][^\n]*(?:\n(?!## \[).*)*)', re.MULTILINE)
    result = []
    for section in section_re.findall(md_text):
        m = re.match(r'## \[(\d+\.\d+\.\d+)\]', section)
        if m:
            result.append((_parse_semver(m.group(1)), section.strip()))
    return result


def _extract_release_sections_since(
    md_text: str, current_version: str, latest_version: str
) -> str:
    """Udtræk alle release notes-sektioner der er relevante for en opdatering.

    Når en opdatering er tilgængelig: alle sektioner nyere end current_version
    og op til (og med) latest_version, ældste øverst.

    Når portalen er à jour (current == latest): vis sektionen for den aktuelle
    version (matcher på 3-parts semver — håndterer debug-builds som 5.7.4.5
    der matcher ## [5.7.4]).
    """
    current = _parse_semver(current_version)
    latest  = _parse_semver(latest_version)

    all_sections = _split_release_sections(md_text)

    # Sektioner der er nyere end current og op til latest (eksklusiv current, inklusiv latest)
    relevant = [(v, s) for v, s in all_sections if current < v <= latest]

    if relevant:
        relevant.sort(key=lambda x: x[0])
        return "\n\n---\n\n".join(s for _, s in relevant)

    # Fallback — vis sektionen for den version vi er på (3-parts semver-match,
    # håndterer debug-builds: 5.7.4.5 → finder ## [5.7.4])
    target = latest if latest != (0, 0, 0) else current
    for v, section in all_sections:
        if v == target:
            return section
    return ""


def _github_branch() -> str:
    from app.core import config as _cfg
    return (_cfg.settings.github_branch or "main").strip()


def _is_git_repo() -> bool:
    """Returnerer True hvis PROJECT_ROOT er et git-repo."""
    result = subprocess.run(
        ["git", "-C", str(PROJECT_ROOT), "rev-parse", "--git-dir"],
        capture_output=True, timeout=5,
    )
    return result.returncode == 0


async def check_github_version(*, force: bool = False) -> dict[str, Any]:
    """Hent seneste version fra GitHub og sammenlign med lokal.

    Returnerer:
        current_version, current_build, latest_version, latest_build,
        update_available, git_ready, checked_at, branch, error (hvis fejl).

    Caches i 1 time — invalideres automatisk hvis branch-indstilling ændres
    eller force=True sendes (bruges af knappen i UI'et).
    """
    global _github_cache, _github_cache_ts, _github_cache_branch
    from app.core.version import BUILD, VERSION

    branch = _github_branch()
    now = time.time()
    # Ugyldiggør cache hvis branch er skiftet eller force-refresh
    if not force and _github_cache and (now - _github_cache_ts < _GITHUB_CACHE_TTL) and _github_cache_branch == branch:
        return _github_cache

    git_ready = await asyncio.to_thread(_is_git_repo)
    result: dict[str, Any] = {
        "current_version": VERSION,
        "current_build": BUILD,
        "latest_version": None,
        "latest_build": None,
        "update_available": False,
        "git_ready": git_ready,
        "branch": branch,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "release_notes": "",
        "error": None,
    }
    try:
        import httpx
        _cb = int(now)  # cache-buster — råt.githubusercontent.com CDN ignorerer headers
        version_url = f"{_GITHUB_RAW_TMPL.format(branch=branch)}?t={_cb}"
        notes_url = f"{_GITHUB_RELEASE_NOTES_TMPL.format(branch=branch)}?t={_cb}"
        no_cache = {"Cache-Control": "no-cache", "Pragma": "no-cache"}
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            version_resp, notes_resp = await asyncio.gather(
                client.get(version_url, headers=no_cache),
                client.get(notes_url, headers=no_cache),
                return_exceptions=True,
            )
        if isinstance(version_resp, Exception):
            raise version_resp
        version_resp.raise_for_status()
        data = version_resp.json()
        result["latest_version"] = data.get("version", "?")
        result["latest_build"] = data.get("build", "?")
        try:
            result["update_available"] = int(data.get("build", "0")) > int(BUILD)
        except ValueError:
            result["update_available"] = data.get("build") != BUILD
        # Release notes — vis alle sektioner fra current → latest (fejl her er ikke fatalt)
        if not isinstance(notes_resp, Exception) and notes_resp.status_code == 200:
            result["release_notes"] = _extract_release_sections_since(
                notes_resp.text, VERSION, result["latest_version"]
            )
        _github_cache = result
        _github_cache_ts = now
        _github_cache_branch = branch
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)
        logger.warning("github version check fejlede (branch=%s): %s", branch, exc)
    return result


def _git_pull_sync() -> dict[str, Any]:
    """Hent og anvend seneste kode fra GitHub via fetch + reset --hard.

    Bruger fetch + reset --hard i stedet for pull for at undgå
    merge-konflikter ved lokale ændringer på produktionsserveren.
    Gitignored filer (config, logs, cache) berøres ikke.
    """
    from app.core import config as _cfg
    branch = (_cfg.settings.github_branch or "main").strip()
    stdout_parts: list[str] = []
    try:
        # Trin 1: fetch
        fetch = subprocess.run(
            ["git", "-C", str(PROJECT_ROOT), "fetch", "origin", branch],
            capture_output=True, text=True, timeout=60,
        )
        if fetch.stdout.strip(): stdout_parts.append(fetch.stdout.strip())
        if fetch.stderr.strip(): stdout_parts.append(fetch.stderr.strip())
        if fetch.returncode != 0:
            return {"ok": False, "stdout": "\n".join(stdout_parts), "stderr": fetch.stderr.strip(), "returncode": fetch.returncode}

        # Trin 2: reset --hard til FETCH_HEAD — mere robust end origin/{branch}
        # fordi FETCH_HEAD altid sættes af git fetch uanset om remote-tracking
        # referencen (origin/dev) eksisterer i det lokale repo.
        reset = subprocess.run(
            ["git", "-C", str(PROJECT_ROOT), "reset", "--hard", "FETCH_HEAD"],
            capture_output=True, text=True, timeout=30,
        )
        if reset.stdout.strip(): stdout_parts.append(reset.stdout.strip())
        if reset.stderr.strip(): stdout_parts.append(reset.stderr.strip())
        ok = reset.returncode == 0
        if ok:
            global _github_cache, _github_cache_ts
            _github_cache = {}
            _github_cache_ts = 0.0
        return {
            "ok": ok,
            "stdout": "\n".join(stdout_parts),
            "stderr": reset.stderr.strip() if not ok else "",
            "returncode": reset.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "stdout": "", "stderr": "git timed out (60s)", "returncode": -1}
    except FileNotFoundError:
        return {"ok": False, "stdout": "", "stderr": "git ikke fundet — er git installeret på serveren?", "returncode": -1}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "stdout": "", "stderr": str(exc), "returncode": -1}


async def git_pull() -> dict[str, Any]:
    from app.core import audit_store
    result = await asyncio.to_thread(_git_pull_sync)
    await audit_store.record(
        "github_pull", "system",
        after={"ok": result["ok"], "branch": _github_branch(), "returncode": result.get("returncode")},
    )
    return result


async def schedule_restart(delay_s: float = 2.5) -> None:
    """Planlæg server-genstart via os._exit(0) efter delay.

    START.bat skal køre i en loop for at genstarte automatisk. Ellers
    skal admin starte serveren manuelt efter genstart-signalet.
    """
    logger.info("update: server-genstart planlagt om %.1fs", delay_s)
    from app.core import audit_store
    audit_store.record_sync("server_restart", "system", after={"delay_s": delay_s})

    async def _do_exit() -> None:
        await asyncio.sleep(delay_s)
        logger.info("update: udfører os._exit(0) for genstart")
        os._exit(0)  # noqa: SLF001

    asyncio.create_task(_do_exit())
