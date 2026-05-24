# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Persistent account-lockout store (SQLite).

Bruger en dedikeret lockout.db (adskilt fra audit.db) for at undgå
SQLite write-lock-konflikter under startup og ved samtidige logins.
Alle funktioner har try-except så en DB-fejl aldrig crasher auth-laget.
"""
from __future__ import annotations

import logging
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parents[2] / "lockout.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS lockout_failures (
    username  TEXT NOT NULL,
    ts        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lockout_user_ts
    ON lockout_failures(username, ts);

CREATE TABLE IF NOT EXISTS lockout_state (
    username    TEXT PRIMARY KEY,
    locked_until REAL NOT NULL
);
"""

# Sættes til True af init_db() ved succes — funktioner er no-ops hvis False.
_available: bool = False


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    global _available
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        conn = _connect()
        try:
            conn.executescript(_SCHEMA)
        finally:
            conn.close()
        _available = True
        logger.info("lockout_store: initialiseret (%s)", DB_PATH)
    except Exception as exc:  # noqa: BLE001
        logger.warning("lockout_store: kunne ikke initialisere DB — bruger in-memory fallback: %s", exc)


def get_lockout_until(username: str) -> float | None:
    if not _available:
        return None
    try:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT locked_until FROM lockout_state WHERE username = ?", (username,)
            ).fetchone()
        finally:
            conn.close()
        return float(row["locked_until"]) if row else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("lockout_store.get_lockout_until fejlede: %s", exc)
        return None


def set_lockout(username: str, until: float) -> None:
    if not _available:
        return
    try:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO lockout_state(username, locked_until) VALUES(?,?)"
                " ON CONFLICT(username) DO UPDATE SET locked_until=excluded.locked_until",
                (username, until),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("lockout_store.set_lockout fejlede: %s", exc)


def clear_lockout(username: str) -> None:
    if not _available:
        return
    try:
        conn = _connect()
        try:
            conn.execute("DELETE FROM lockout_state WHERE username = ?", (username,))
            conn.execute("DELETE FROM lockout_failures WHERE username = ?", (username,))
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("lockout_store.clear_lockout fejlede: %s", exc)


def add_failure(username: str, ts: float) -> None:
    if not _available:
        return
    try:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO lockout_failures(username, ts) VALUES(?,?)", (username, ts)
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("lockout_store.add_failure fejlede: %s", exc)


def get_failures_since(username: str, since: float) -> list[float]:
    if not _available:
        return []
    try:
        conn = _connect()
        try:
            rows = conn.execute(
                "SELECT ts FROM lockout_failures WHERE username = ? AND ts >= ?",
                (username, since),
            ).fetchall()
        finally:
            conn.close()
        return [float(r["ts"]) for r in rows]
    except Exception as exc:  # noqa: BLE001
        logger.warning("lockout_store.get_failures_since fejlede: %s", exc)
        return []


def prune_old_failures(window_s: float) -> None:
    if not _available:
        return
    try:
        cutoff = time.time() - window_s
        conn = _connect()
        try:
            conn.execute("DELETE FROM lockout_failures WHERE ts < ?", (cutoff,))
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("lockout_store.prune_old_failures fejlede: %s", exc)
