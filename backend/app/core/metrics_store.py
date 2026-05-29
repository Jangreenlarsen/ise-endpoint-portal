# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Persistence for Prometheus metrics time-series (Feature 4 — Metrics-historik).

Scrapes selected Gauges and Counter totals every 60 s and stores them in a
lightweight SQLite database so the portal Metrics view can render time-series
charts without an external Prometheus + Grafana stack.

DB location: backend/metrics_history.db  (gitignored via cache/).
The table keeps at most MAX_ROWS_PER_METRIC rows per series; a prune sweep runs
every 60 scrape cycles (~1 hour) to enforce this limit.
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parents[2] / "metrics_history.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT    NOT NULL,
    metric_name TEXT    NOT NULL,
    value       REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ms_name_ts
    ON metrics_snapshots (metric_name, ts DESC);
"""

MAX_ROWS_PER_METRIC = 1440  # 24 h at 1-min interval


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create table + index if missing. Idempotent."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript(SCHEMA)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _insert_sync(ts: str, snapshots: dict[str, float]) -> None:
    if not snapshots:
        return
    with _connect() as conn:
        conn.executemany(
            "INSERT INTO metrics_snapshots (ts, metric_name, value) VALUES (?, ?, ?)",
            [(ts, name, value) for name, value in snapshots.items()],
        )
        conn.commit()


def _prune_sync() -> None:
    """Keep only the last MAX_ROWS_PER_METRIC rows per metric series."""
    with _connect() as conn:
        names = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT metric_name FROM metrics_snapshots"
            ).fetchall()
        ]
        for name in names:
            conn.execute(
                """
                DELETE FROM metrics_snapshots
                WHERE metric_name = ?
                  AND id NOT IN (
                    SELECT id FROM metrics_snapshots
                    WHERE metric_name = ?
                    ORDER BY id DESC
                    LIMIT ?
                  )
                """,
                (name, name, MAX_ROWS_PER_METRIC),
            )
        conn.commit()


def _query_sync(metric_name: str, limit: int) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT ts, value FROM metrics_snapshots "
            "WHERE metric_name = ? ORDER BY id DESC LIMIT ?",
            (metric_name, limit),
        ).fetchall()
    # Reverse so result is chronological (oldest → newest)
    return [{"ts": r["ts"], "value": r["value"]} for r in reversed(rows)]


async def insert_snapshot(snapshots: dict[str, float]) -> None:
    """Write one scrape snapshot to the DB (thread-safe via asyncio.to_thread)."""
    ts = _now_iso()
    try:
        await asyncio.to_thread(_insert_sync, ts, snapshots)
    except Exception as exc:  # noqa: BLE001
        logger.warning("metrics_store insert failed: %s", exc)


async def prune() -> None:
    """Trim old rows to stay within MAX_ROWS_PER_METRIC per series."""
    try:
        await asyncio.to_thread(_prune_sync)
    except Exception as exc:  # noqa: BLE001
        logger.warning("metrics_store prune failed: %s", exc)


async def get_history(metric_name: str, limit: int = 120) -> list[dict[str, Any]]:
    """Return up to `limit` most-recent {ts, value} dicts for `metric_name`."""
    return await asyncio.to_thread(_query_sync, metric_name, limit)
