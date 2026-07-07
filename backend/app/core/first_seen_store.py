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
                mac           TEXT PRIMARY KEY,
                first_seen_at REAL NOT NULL,
                endpoint_id   TEXT NOT NULL DEFAULT '',
                deleted_at    REAL DEFAULT NULL
            )
        """)
        # Migration: tilføj deleted_at til eksisterende DB (idempotent)
        try:
            con.execute("ALTER TABLE first_seen ADD COLUMN deleted_at REAL DEFAULT NULL")
        except Exception:  # noqa: BLE001
            pass  # kolonnen eksisterer allerede
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_fs_added ON first_seen(first_seen_at)"
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_fs_deleted ON first_seen(deleted_at)"
        )
        con.commit()
    finally:
        con.close()


def record(mac: str, endpoint_id: str = "", seed_ts: float | None = None) -> float:
    """Registrér mac som 'set nu' hvis den ikke kendes i forvejen.

    Returnerer always first_seen_at — enten den eksisterende record
    eller det netop indsatte tidspunkt.

    seed_ts: valgfrit Unix-timestamp der bruges som first_seen_at ved NY
    indsættelse (i stedet for time.time()). Bruges til at bevare
    HypervisionRegisteredAt fra ISE selv efter at SQLite-DB'en er nulstillet.

    Hvis endpoint_id er ændret for samme MAC (slettet og genskabt i ISE),
    nulstilles tidsstemplet så endpointet behandles som nyt.
    """
    mac = (mac or "").upper().strip()
    if not mac:
        return time.time()
    now = time.time()
    insert_ts = seed_ts if (seed_ts and seed_ts <= now) else now
    con = sqlite3.connect(DB_PATH)
    try:
        row = con.execute(
            "SELECT first_seen_at, endpoint_id FROM first_seen WHERE mac = ?", (mac,)
        ).fetchone()
        if row is None:
            con.execute(
                "INSERT INTO first_seen (mac, first_seen_at, endpoint_id, deleted_at) VALUES (?, ?, ?, NULL)",
                (mac, insert_ts, endpoint_id),
            )
            con.commit()
            return insert_ts
        existing_ts, existing_id = row
        if endpoint_id and existing_id and existing_id != endpoint_id:
            # Samme MAC men nyt ISE endpoint_id → slettet og genskabt i ISE
            con.execute(
                "UPDATE first_seen SET first_seen_at = ?, endpoint_id = ?, deleted_at = NULL WHERE mac = ?",
                (now, endpoint_id, mac),
            )
            con.commit()
            return now
        # Endpoint er genobservet (var evt. soft-deleted) → nulstil deleted_at
        con.execute(
            "UPDATE first_seen SET deleted_at = NULL WHERE mac = ? AND deleted_at IS NOT NULL",
            (mac,),
        )
        con.commit()
        return existing_ts
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


def delete(mac: str) -> None:
    """Soft-slet MAC: sæt deleted_at = nu i stedet for at fjerne rækken.

    Bevarer historikken til Trend Analyse. Hvis endpointet genskabes i ISE
    nulstiller record() deleted_at og sætter nyt first_seen_at.
    """
    mac = (mac or "").upper().strip()
    if not mac:
        return
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute(
            "UPDATE first_seen SET deleted_at = ? WHERE mac = ? AND deleted_at IS NULL",
            (time.time(), mac),
        )
        con.commit()
    finally:
        con.close()


def get_added_since(since_ts: float) -> list[tuple[str, float]]:
    """Returnerer [(mac, first_seen_at)] for endpoints portalen første gang så siden since_ts."""
    con = sqlite3.connect(DB_PATH)
    try:
        rows = con.execute(
            "SELECT mac, first_seen_at FROM first_seen WHERE first_seen_at >= ?",
            (since_ts,),
        ).fetchall()
        return [(row[0], row[1]) for row in rows]
    finally:
        con.close()


def get_removed_since(since_ts: float) -> list[tuple[str, float]]:
    """Returnerer [(mac, deleted_at)] for endpoints bekræftet slettet fra ISE siden since_ts."""
    con = sqlite3.connect(DB_PATH)
    try:
        rows = con.execute(
            "SELECT mac, deleted_at FROM first_seen WHERE deleted_at IS NOT NULL AND deleted_at >= ?",
            (since_ts,),
        ).fetchall()
        return [(row[0], row[1]) for row in rows]
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


def export_rows() -> list[dict]:
    """Alle poster som JSON-serialiserbare dicts — til config-backup."""
    init_db()
    con = sqlite3.connect(DB_PATH)
    try:
        rows = con.execute(
            "SELECT mac, first_seen_at, endpoint_id, deleted_at FROM first_seen"
        ).fetchall()
        return [
            {"mac": r[0], "first_seen_at": r[1], "endpoint_id": r[2], "deleted_at": r[3]}
            for r in rows
        ]
    finally:
        con.close()


def import_rows(rows: list[dict], replace: bool = True) -> int:
    """Genindlæs poster fra en backup. replace=True rydder tabellen først.
    Returnerer antal importerede rækker."""
    init_db()
    imported = 0
    con = sqlite3.connect(DB_PATH)
    try:
        if replace:
            con.execute("DELETE FROM first_seen")
        for row in rows or []:
            mac = ((row or {}).get("mac") or "").upper().strip()
            if not mac:
                continue
            con.execute(
                """
                INSERT INTO first_seen (mac, first_seen_at, endpoint_id, deleted_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(mac) DO UPDATE SET
                    first_seen_at = excluded.first_seen_at,
                    endpoint_id   = excluded.endpoint_id,
                    deleted_at    = excluded.deleted_at
                """,
                (
                    mac,
                    row.get("first_seen_at") or time.time(),
                    row.get("endpoint_id", ""),
                    row.get("deleted_at"),
                ),
            )
            imported += 1
        con.commit()
        return imported
    finally:
        con.close()
