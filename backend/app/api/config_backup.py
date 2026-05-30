# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Config backup og restore — GET /config/backup, POST /config/restore.

Backup samler alle portal-konfigurationsfiler i ét JSON-objekt.
Credentials (ise_password, pxgrid_password) redigeres ud og erstattes med
sentinel-værdien "__REDACTED__" — genopret dem manuelt i Settings efter restore.
Restore springer felter med "__REDACTED__" over så eksisterende credentials bevares.
"""
from __future__ import annotations

import copy
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

_REDACTED = "__REDACTED__"

# Felter der redigeres ud af backup-eksporten for at forhindre credential-lækage.
_SENSITIVE_FIELDS: dict[str, set[str]] = {
    "config.json": {"ise_password", "pxgrid_password"},
    "auth_config.json": {"tacacs_secret"},
}


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


def _redact(name: str, data: Any) -> Any:
    """Returnér en kopi af data med sensitive felter erstattet af _REDACTED."""
    fields = _SENSITIVE_FIELDS.get(name)
    if not fields or not isinstance(data, dict):
        return data
    result = copy.deepcopy(data)
    for field in fields:
        if field in result and result[field]:
            result[field] = _REDACTED
    return result


def _merge_without_redacted(existing: Any, incoming: Any) -> Any:
    """Returnér incoming men bevar eksisterende værdier for __REDACTED__-felter."""
    if not isinstance(existing, dict) or not isinstance(incoming, dict):
        return incoming
    result = copy.deepcopy(incoming)
    for key, val in incoming.items():
        if val == _REDACTED and key in existing:
            result[key] = existing[key]
    return result


@router.get("/backup", dependencies=[Depends(require_admin)])
async def backup_config() -> JSONResponse:
    """Returnér alle konfigurationsfiler som ét JSON-objekt til download.

    Sensitive credentials redigeres ud (erstattes med "__REDACTED__") — de er
    IKKE inkluderet i backup-filen. Genopret ise_password og pxgrid_password
    manuelt i Settings → ISE Connection / PxGrid efter en restore.
    """
    payload: dict[str, Any] = {
        "version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "credentials_redacted": True,
        "files": {},
    }
    for name in _CONFIG_FILES:
        data = _read_config_file(name)
        if data is not None:
            payload["files"][name] = _redact(name, data)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"ise_portal_config_backup_{ts}.json"
    logger.info("config backup downloaded (credentials redacted)")
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/restore", dependencies=[Depends(require_admin)])
async def restore_config(body: dict) -> dict:
    """Gendan konfiguration fra et backup-objekt.

    Accepterer body fra GET /config/backup.
    Validerer at body.version == 1 og at alle filer er gyldige JSON-objekter.
    Felter med værdien "__REDACTED__" bevarer eksisterende serverværdi (credentials overskrives ikke).
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
    for name, incoming in files.items():
        if incoming is None:
            continue
        try:
            existing = _read_config_file(name) or {}
            merged = _merge_without_redacted(existing, incoming)
            _write_config_file(name, merged)
            restored.append(name)
            logger.info("config restore: gendannede %s", name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                f"Kunne ikke skrive {name}: {exc}",
            ) from exc

    credentials_note = (
        " Credentials (ise_password, pxgrid_password, tacacs_secret) var redigeret "
        "ud af backup og er IKKE gendannet — genopret dem manuelt i Settings."
        if body.get("credentials_redacted")
        else ""
    )
    logger.warning("config restore: %d filer gendannet af admin", len(restored))
    return {
        "ok": True,
        "restored": restored,
        "message": (
            f"{len(restored)} konfigurationsfil(er) gendannet. "
            "Genstart backend for at ISE-forbindelsesindstillinger træder i kraft."
            + credentials_note
        ),
    }
