# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Persistent account-lockout store (SQLite).

Gemmer fejlede login-forsøg og lockout-status i audit.db så de
overlever backend-genstarter. Tidligere var dette kun i-memory.
"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from app.core.audit_store import DB_PATH

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


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript(_SCHEMA)


def get_lockout_until(username: str) -> float | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT locked_until FROM lockout_state WHERE username = ?", (username,)
        ).fetchone()
    return float(row["locked_until"]) if row else None


def set_lockout(username: str, until: float) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO lockout_state(username, locked_until) VALUES(?,?)"
            " ON CONFLICT(username) DO UPDATE SET locked_until=excluded.locked_until",
            (username, until),
        )
        conn.commit()


def clear_lockout(username: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM lockout_state WHERE username = ?", (username,))
        conn.execute("DELETE FROM lockout_failures WHERE username = ?", (username,))
        conn.commit()


def add_failure(username: str, ts: float) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO lockout_failures(username, ts) VALUES(?,?)", (username, ts)
        )
        conn.commit()


def get_failures_since(username: str, since: float) -> list[float]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT ts FROM lockout_failures WHERE username = ? AND ts >= ?",
            (username, since),
        ).fetchall()
    return [float(r["ts"]) for r in rows]


def prune_old_failures(window_s: float) -> None:
    cutoff = time.time() - window_s
    with _connect() as conn:
        conn.execute("DELETE FROM lockout_failures WHERE ts < ?", (cutoff,))
        conn.commit()
