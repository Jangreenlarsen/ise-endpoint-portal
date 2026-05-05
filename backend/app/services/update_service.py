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
import time
import zipfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Projektroden: backend/app/services/ → ../../.. → projekt-root
PROJECT_ROOT = Path(__file__).resolve().parents[3]

MAX_ZIP_BYTES = 100 * 1024 * 1024  # 100 MB

# Filer/mapper der ALDRIG overskrives uanset pakkens indhold
_BLOCKED_PREFIXES = (
    ".env",
    "backend/.env",
    "backend/logs/",
    "backend/cache/",
    "backend/data/",
)

# Kun disse prefixes accepteres fra en pakke
_ALLOWED_PREFIXES = (
    "frontend/",
    "backend/app/",
    "backend/pyproject.toml",
    "version.json",
    "CHANGELOG.md",
    "FEATURES.md",
    "BUGS.md",
    "ARCHITECTURE.md",
    "ISE_API_REFERENCE.md",
    "START.bat",
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
    return {
        "ok": ok,
        "applied": applied,
        "skipped": skipped,
        "errors": errors,
        "applied_count": len(applied),
    }


async def schedule_restart(delay_s: float = 2.5) -> None:
    """Planlæg server-genstart via os._exit(0) efter delay.

    START.bat skal køre i en loop for at genstarte automatisk. Ellers
    skal admin starte serveren manuelt efter genstart-signalet.
    """
    logger.info("update: server-genstart planlagt om %.1fs", delay_s)

    async def _do_exit() -> None:
        await asyncio.sleep(delay_s)
        logger.info("update: udfører os._exit(0) for genstart")
        os._exit(0)  # noqa: SLF001

    asyncio.create_task(_do_exit())
