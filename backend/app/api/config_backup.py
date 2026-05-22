# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Config backup og restore — GET /config/backup, POST /config/restore.

Backup samler alle portal-konfigurationsfiler i ét JSON-objekt.
Restore validerer og skriver filerne tilbage.
Bemærk: backup indeholder credentials (ISE password, JWT secret).
Opbevar backups sikkert.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.api.deps import require_admin

router = APIRouter(prefix="/config", tags=["config-backup"])

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parents[3] / "backend"

_CONFIG_FILES: list[str] = [
    "config.json",
    "auth_config.json",
    "operator_profiles.json",
    "users.json",
    "endpoint_roles.json",
    "templates.json",
    "custom_attr_values.json",
    "platform_mapping.json",
]


def _read_config_file(name: str) -> Any:
    path = _BACKEND_DIR / name
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_config_file(name: str, data: Any) -> None:
    path = _BACKEND_DIR / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@router.get("/backup", dependencies=[Depends(require_admin)])
async def backup_config() -> JSONResponse:
    """Returnér alle konfigurationsfiler som ét JSON-objekt til download."""
    payload: dict[str, Any] = {
        "version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "files": {},
    }
    for name in _CONFIG_FILES:
        data = _read_config_file(name)
        if data is not None:
            payload["files"][name] = data

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"ise_portal_config_backup_{ts}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/restore", dependencies=[Depends(require_admin)])
async def restore_config(body: dict) -> dict:
    """Gendan konfiguration fra et backup-objekt.

    Accepterer body fra GET /config/backup.
    Validerer at body.version == 1 og at alle filer er gyldige JSON-objekter.
    Skriver filerne og returnerer liste over gendannede filer.
    Backend skal genstartes for at ændringer træder i kraft for ISE-forbindelsen.
    """
    if body.get("version") != 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Ugyldigt backup-format (version != 1)",
        )

    files: dict[str, Any] = body.get("files", {})
    if not isinstance(files, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "files-feltet mangler eller er ugyldigt")

    allowed = set(_CONFIG_FILES)
    unknown = set(files.keys()) - allowed
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Ukendte konfigurationsfiler: {', '.join(sorted(unknown))}",
        )

    restored: list[str] = []
    for name, data in files.items():
        if data is None:
            continue
        try:
            _write_config_file(name, data)
            restored.append(name)
            logger.info("config restore: gendannede %s", name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                f"Kunne ikke skrive {name}: {exc}",
            ) from exc

    logger.warning("config restore: %d filer gendannet af admin", len(restored))
    return {
        "ok": True,
        "restored": restored,
        "message": (
            f"{len(restored)} konfigurationsfil(er) gendannet. "
            "Genstart backend for at ISE-forbindelsesindstillinger træder i kraft."
        ),
    }
