# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""SQLite-store der tracker hvornår en MAC-adresse første gang blev observeret
i ISE-endpoint-listen via portalen.

Record-tidspunktet sættes én gang (INSERT OR IGNORE) og ændres aldrig.
Det repræsenterer ikke ISE-oprettelsestidspunktet, men det tidspunkt portalen
første gang så endpointet — typisk ved første cache-prewarm-scan.

DB-sti: backend/cache/first_seen.db  (oprettes automatisk)
"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "cache" / "first_seen.db"


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute("""
            CREATE TABLE IF NOT EXISTS first_seen (
                mac         TEXT PRIMARY KEY,
                first_seen_at REAL NOT NULL,
                endpoint_id TEXT NOT NULL DEFAULT ''
            )
        """)
        con.commit()
    finally:
        con.close()


def record(mac: str, endpoint_id: str = "") -> float:
    """Registrér mac som 'set nu' hvis den ikke kendes i forvejen.

    Returnerer always first_seen_at — enten den eksisterende record
    eller det netop indsatte tidspunkt.
    """
    mac = (mac or "").upper().strip()
    if not mac:
        return time.time()
    now = time.time()
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute(
            "INSERT OR IGNORE INTO first_seen (mac, first_seen_at, endpoint_id) VALUES (?, ?, ?)",
            (mac, now, endpoint_id),
        )
        con.commit()
        row = con.execute(
            "SELECT first_seen_at FROM first_seen WHERE mac = ?", (mac,)
        ).fetchone()
        return row[0] if row else now
    finally:
        con.close()


def get(mac: str) -> float | None:
    mac = (mac or "").upper().strip()
    if not mac:
        return None
    con = sqlite3.connect(DB_PATH)
    try:
        row = con.execute(
            "SELECT first_seen_at FROM first_seen WHERE mac = ?", (mac,)
        ).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def get_many(macs: list[str]) -> dict[str, float]:
    """Batch-lookup: returnerer {mac_upper: first_seen_at} for kendte MACs."""
    if not macs:
        return {}
    upper = [m.upper().strip() for m in macs if m]
    if not upper:
        return {}
    placeholders = ",".join("?" * len(upper))
    con = sqlite3.connect(DB_PATH)
    try:
        rows = con.execute(
            f"SELECT mac, first_seen_at FROM first_seen WHERE mac IN ({placeholders})",
            upper,
        ).fetchall()
        return {row[0]: row[1] for row in rows}
    finally:
        con.close()
