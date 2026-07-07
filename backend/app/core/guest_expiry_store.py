# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""SQLite-store der tracker endpoints med GuestRegistration=true og en GuestExperyDate.

Background-workeren (guest_expiry_worker) forespørger denne store periodisk,
finder udløbne poster og sætter GuestAccessExpire=true i ISE via ERS.

DB-sti: backend/cache/guest_expiry.db  (oprettes automatisk)

Format for expiry_str: "YYYY-MM-DD:HH:MM"  (samme format som GuestExperyDate CA)
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parents[2] / "cache" / "guest_expiry.db"

EXPIRY_FMT = "%Y-%m-%d:%H:%M"


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute("""
            CREATE TABLE IF NOT EXISTS guest_expiry (
                endpoint_id  TEXT PRIMARY KEY,
                mac          TEXT NOT NULL DEFAULT '',
                expiry_str   TEXT NOT NULL,
                registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            )
        """)
        con.execute("CREATE INDEX IF NOT EXISTS idx_ge_expiry ON guest_expiry(expiry_str)")
        con.commit()
    finally:
        con.close()


def _connect() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


def upsert(endpoint_id: str, mac: str, expiry_str: str) -> None:
    """Registrér eller opdatér et endpoints udløbsdato til overvågning."""
    with _connect() as con:
        con.execute(
            """
            INSERT INTO guest_expiry (endpoint_id, mac, expiry_str)
            VALUES (?, ?, ?)
            ON CONFLICT(endpoint_id) DO UPDATE SET
                mac        = excluded.mac,
                expiry_str = excluded.expiry_str
            """,
            (endpoint_id, mac, expiry_str),
        )
        con.commit()
    logger.debug("guest_expiry: registreret %s (mac=%s expiry=%s)", endpoint_id, mac, expiry_str)


def remove(endpoint_id: str) -> None:
    """Fjern endpoint fra overvågning (gæsteadgang tilbagekaldt/ændret)."""
    with _connect() as con:
        con.execute("DELETE FROM guest_expiry WHERE endpoint_id = ?", (endpoint_id,))
        con.commit()


def list_expired(reference_dt: datetime | None = None) -> list[dict[str, Any]]:
    """Returnér alle poster hvor udløbstidspunktet er nået eller passeret.

    reference_dt: sammenlignes mod; defaults til datetime.now() (lokal tid).
    """
    now = reference_dt or datetime.now()
    rows: list[dict[str, Any]] = []
    with _connect() as con:
        cur = con.execute("SELECT endpoint_id, mac, expiry_str FROM guest_expiry")
        for ep_id, mac, expiry_str in cur.fetchall():
            try:
                expiry_dt = datetime.strptime(expiry_str, EXPIRY_FMT)
            except ValueError:
                logger.warning(
                    "guest_expiry: ugyldigt datofmt for %s: %r — fjernes fra store",
                    ep_id, expiry_str,
                )
                remove(ep_id)
                continue
            if expiry_dt <= now:
                rows.append({"endpoint_id": ep_id, "mac": mac, "expiry_str": expiry_str})
    return rows


def count() -> int:
    """Antal endpoints i aktiv overvågning."""
    with _connect() as con:
        row = con.execute("SELECT COUNT(*) FROM guest_expiry").fetchone()
        return row[0] if row else 0


def export_rows() -> list[dict[str, Any]]:
    """Alle poster som JSON-serialiserbare dicts — til config-backup."""
    init_db()
    with _connect() as con:
        cur = con.execute(
            "SELECT endpoint_id, mac, expiry_str, registered_at FROM guest_expiry"
        )
        return [
            {"endpoint_id": r[0], "mac": r[1], "expiry_str": r[2], "registered_at": r[3]}
            for r in cur.fetchall()
        ]


def import_rows(rows: list[dict[str, Any]], replace: bool = True) -> int:
    """Genindlæs poster fra en backup. replace=True rydder tabellen først.
    Returnerer antal importerede rækker."""
    init_db()
    imported = 0
    with _connect() as con:
        if replace:
            con.execute("DELETE FROM guest_expiry")
        for row in rows or []:
            ep = (row or {}).get("endpoint_id")
            expiry = (row or {}).get("expiry_str")
            if not ep or not expiry:
                continue
            con.execute(
                """
                INSERT INTO guest_expiry (endpoint_id, mac, expiry_str, registered_at)
                VALUES (?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%SZ','now')))
                ON CONFLICT(endpoint_id) DO UPDATE SET
                    mac = excluded.mac, expiry_str = excluded.expiry_str
                """,
                (ep, row.get("mac", ""), expiry, row.get("registered_at")),
            )
            imported += 1
        con.commit()
    logger.info("guest_expiry: importerede %d poster fra backup (replace=%s)", imported, replace)
    return imported
