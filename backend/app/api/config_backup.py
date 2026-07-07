# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Config backup og restore — GET/POST /config/backup, POST /config/restore.

To tilstande:

* **Plain (uden passphrase)** — bagudkompatibel. Samler konfigurationsfilerne +
  ikke-følsom operationel state (guest-udløb, first-seen). Credentials
  (`ise_password`, `pxgrid_password`, `tacacs_secret`) redigeres ud
  (`"__REDACTED__"`) og skal genindtastes manuelt efter restore.

* **Krypteret (med passphrase)** — hele payloaden krypteres med PBKDF2→Fernet
  (fortrolighed + integritet). Inkluderer credentials, cert-filer (pxGrid + ISE
  CA-bundle) og JWT-signeringsnøglen, så restore er selvstændig. Kræver samme
  passphrase ved restore.

Backup-format er version 2; restore accepterer også version 1 (legacy plain).
"""
from __future__ import annotations

import base64
import copy
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.api.deps import require_admin
from app.core import backup_crypto, config, first_seen_store, guest_expiry_store

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

# Felter der redigeres ud af PLAIN backup for at forhindre credential-lækage.
# I krypteret backup inkluderes de (beskyttet af passphrase).
_SENSITIVE_FIELDS: dict[str, set[str]] = {
    "config.json": {"ise_password", "pxgrid_password"},
    "auth_config.json": {"tacacs_secret"},
}

# Settings-felter der peger på cert-/nøglefiler som inkluderes i krypteret backup.
_CERT_PATH_KEYS = (
    "ise_ca_bundle",
    "pxgrid_cert_path",
    "pxgrid_key_path",
    "pxgrid_ca_bundle_path",
)


# ── Fil-helpers ───────────────────────────────────────────────────────────────

def _auth_secret_path() -> Path:
    return _BACKEND_DIR / "auth_secret.key"


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


def _resolve_backend_path(rel: str) -> Path | None:
    """Resolve en (evt. relativ) sti og bekræft at den ligger inden for backend/.

    Returnerer None hvis stien peger uden for backend/ (path-traversal-værn ved
    restore) eller ikke kan resolves. Cert-filer skal derfor ligge under backend/.
    """
    if not rel:
        return None
    p = Path(rel)
    if not p.is_absolute():
        p = _BACKEND_DIR / p
    try:
        resolved = p.resolve()
        resolved.relative_to(_BACKEND_DIR.resolve())
        return resolved
    except (ValueError, OSError):
        return None


def _redact(name: str, data: Any) -> Any:
    fields = _SENSITIVE_FIELDS.get(name)
    if not fields or not isinstance(data, dict):
        return data
    result = copy.deepcopy(data)
    for field in fields:
        if field in result and result[field]:
            result[field] = _REDACTED
    return result


def _merge_without_redacted(existing: Any, incoming: Any) -> Any:
    """incoming, men bevar eksisterende værdier for __REDACTED__-felter."""
    if not isinstance(existing, dict) or not isinstance(incoming, dict):
        return incoming
    result = copy.deepcopy(incoming)
    for key, val in incoming.items():
        if val == _REDACTED and key in existing:
            result[key] = existing[key]
    return result


# ── Backup-bygning ────────────────────────────────────────────────────────────

def _collect_files(redact: bool) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in _CONFIG_FILES:
        data = _read_config_file(name)
        if data is not None:
            out[name] = _redact(name, data) if redact else data
    return out


def _collect_certs() -> dict[str, Any]:
    """Læs cert-/nøglefiler som config.json peger på (kun inden for backend/)."""
    s = config.settings
    certs: dict[str, Any] = {}
    for key in _CERT_PATH_KEYS:
        rel = (getattr(s, key, "") or "").strip()
        p = _resolve_backend_path(rel)
        if p and p.exists() and p.is_file():
            certs[key] = {
                "path": rel,
                "data": base64.b64encode(p.read_bytes()).decode("ascii"),
            }
    return certs


def _collect_extras(include_sensitive: bool) -> dict[str, Any]:
    extras: dict[str, Any] = {
        "guest_expiry": guest_expiry_store.export_rows(),
        "first_seen": first_seen_store.export_rows(),
    }
    if include_sensitive:
        extras["certs"] = _collect_certs()
        secret_path = _auth_secret_path()
        if secret_path.exists():
            extras["auth_secret"] = base64.b64encode(secret_path.read_bytes()).decode("ascii")
    return extras


def build_backup_payload(passphrase: str | None) -> dict[str, Any]:
    """Byg backup-objektet. Passphrase (ikke-tom) ⇒ krypteret fuld backup."""
    now = datetime.now(timezone.utc).isoformat()
    encrypted = bool(passphrase)
    if encrypted:
        inner = {
            "files": _collect_files(redact=False),
            "extras": _collect_extras(include_sensitive=True),
        }
        return {
            "version": 2,
            "created_at": now,
            "encrypted": True,
            "enc": backup_crypto.encrypt_obj(inner, passphrase or ""),
        }
    return {
        "version": 2,
        "created_at": now,
        "encrypted": False,
        "credentials_redacted": True,
        "files": _collect_files(redact=True),
        "extras": _collect_extras(include_sensitive=False),
    }


# ── Restore ───────────────────────────────────────────────────────────────────

def _apply_files(files: dict[str, Any], redacted: bool) -> list[str]:
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
        existing = _read_config_file(name) or {}
        merged = _merge_without_redacted(existing, incoming) if redacted else incoming
        _write_config_file(name, merged)
        restored.append(name)
        logger.info("config restore: gendannede %s", name)
    return restored


def _apply_extras(extras: dict[str, Any]) -> list[str]:
    applied: list[str] = []
    if not isinstance(extras, dict):
        return applied

    ge = extras.get("guest_expiry")
    if isinstance(ge, list):
        n = guest_expiry_store.import_rows(ge)
        applied.append(f"guest_expiry ({n})")

    fs = extras.get("first_seen")
    if isinstance(fs, list):
        n = first_seen_store.import_rows(fs)
        applied.append(f"first_seen ({n})")

    certs = extras.get("certs")
    if isinstance(certs, dict):
        for key, entry in certs.items():
            if not isinstance(entry, dict):
                continue
            p = _resolve_backend_path(entry.get("path", ""))
            data = entry.get("data")
            if p is None or not data:
                logger.warning("config restore: springer cert %s over (sti uden for backend/)", key)
                continue
            try:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(base64.b64decode(data))
                applied.append(f"cert:{key}")
            except Exception as exc:  # noqa: BLE001
                logger.warning("config restore: kunne ikke skrive cert %s: %s", key, exc)

    secret = extras.get("auth_secret")
    if secret:
        try:
            path = _auth_secret_path()
            path.write_bytes(base64.b64decode(secret))
            try:
                os.chmod(path, 0o600)  # best-effort; ingen effekt på Windows
            except OSError:
                pass
            applied.append("auth_secret")
        except Exception as exc:  # noqa: BLE001
            logger.warning("config restore: kunne ikke skrive auth_secret.key: %s", exc)

    return applied


def apply_restore(backup_obj: dict[str, Any], passphrase: str | None) -> dict[str, Any]:
    """Gendan fra et backup-objekt. Returnerer summary-dict."""
    version = backup_obj.get("version")
    if version not in (1, 2):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ugyldigt backup-format (version)")

    if backup_obj.get("encrypted"):
        try:
            inner = backup_crypto.decrypt_obj(backup_obj.get("enc", {}), passphrase or "")
        except backup_crypto.BackupCryptoError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        files = inner.get("files", {}) if isinstance(inner, dict) else {}
        extras = inner.get("extras", {}) if isinstance(inner, dict) else {}
        redacted = False
    else:
        files = backup_obj.get("files", {})
        extras = backup_obj.get("extras", {})
        redacted = bool(backup_obj.get("credentials_redacted"))

    if not isinstance(files, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "files-feltet mangler eller er ugyldigt")

    try:
        restored = _apply_files(files, redacted)
        restored_extras = _apply_extras(extras)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, f"Restore fejlede: {exc}"
        ) from exc

    credentials_note = (
        " Credentials (ise_password, pxgrid_password, tacacs_secret) var redigeret "
        "ud af denne (plain) backup — genindtast dem manuelt i Settings, eller brug "
        "en passphrase-krypteret backup næste gang."
        if redacted
        else ""
    )
    logger.warning(
        "config restore: %d filer + %d ekstra-elementer gendannet af admin",
        len(restored), len(restored_extras),
    )
    return {
        "ok": True,
        "restored": restored,
        "restored_extras": restored_extras,
        "encrypted": bool(backup_obj.get("encrypted")),
        "message": (
            f"{len(restored)} konfigurationsfil(er) og {len(restored_extras)} "
            "ekstra-element(er) gendannet. Genstart backend for at "
            "ISE-forbindelsesindstillinger og JWT-nøgle træder i kraft." + credentials_note
        ),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

def _download_response(payload: dict[str, Any], encrypted: bool) -> JSONResponse:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    suffix = "encrypted" if encrypted else "plain"
    filename = f"ise_portal_config_backup_{suffix}_{ts}.json"
    logger.info("config backup downloaded (encrypted=%s)", encrypted)
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/backup", dependencies=[Depends(require_admin)])
async def backup_config_plain() -> JSONResponse:
    """Plain backup (credentials redigeret ud). Bagudkompatibel."""
    return _download_response(build_backup_payload(None), encrypted=False)


@router.post("/backup", dependencies=[Depends(require_admin)])
async def backup_config(body: dict = Body(default_factory=dict)) -> JSONResponse:
    """Backup. Med `{"passphrase": "..."}` ⇒ krypteret fuld backup (inkl.
    credentials, cert-filer og JWT-nøgle). Uden ⇒ som GET (plain/redigeret)."""
    passphrase = (body or {}).get("passphrase") or ""
    payload = build_backup_payload(passphrase or None)
    return _download_response(payload, encrypted=bool(passphrase))


@router.post("/restore", dependencies=[Depends(require_admin)])
async def restore_config(body: dict) -> dict:
    """Gendan konfiguration fra et backup-objekt.

    Body kan enten være backup-objektet direkte (legacy) eller
    `{"backup": <obj>, "passphrase": "..."}` (passphrase kræves til krypterede backups).
    Backend skal genstartes for at ISE-forbindelse + JWT-nøgle træder i kraft.
    """
    backup_obj = body.get("backup") if isinstance(body, dict) and "backup" in body else body
    passphrase = body.get("passphrase") if isinstance(body, dict) else None
    if not isinstance(backup_obj, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Manglende eller ugyldigt backup-objekt")
    return apply_restore(backup_obj, passphrase)
