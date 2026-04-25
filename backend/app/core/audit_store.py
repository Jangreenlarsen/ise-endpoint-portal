"""Append-only audit log for write-operations (2.9.0).

Persisted to ``backend/audit.db`` (SQLite). Every successful
create/update/delete on endpoints, custom-attribute values, DACLs,
users, and backend settings is recorded with actor, timestamp, and
before/after snapshots so an admin can trace *who* changed *what*
and roll back.

The schema is deliberately minimal so we don't re-implement the
endpoint/DACL schemas here — before/after are stored as JSON blobs
and rendered in the UI as a diff viewer. A nullable ``resource_id``
lets us audit settings-level changes that don't have a natural id.

Actor context is supplied by ``actor_ctx`` — a ``ContextVar`` set in
the FastAPI auth dependency so service-layer code doesn't have to
thread the user through every call.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core import config

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parents[2] / "audit.db"


@dataclass
class ActorContext:
    actor_id: str = ""
    actor_username: str = "system"
    source_ip: str = ""


actor_ctx: ContextVar[ActorContext] = ContextVar(
    "actor_ctx", default=ActorContext()
)


SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor_id TEXT NOT NULL DEFAULT '',
    actor_username TEXT NOT NULL DEFAULT 'system',
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    before_json TEXT,
    after_json TEXT,
    source_ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource
    ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_username);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the audit table + indexes if missing. Idempotent."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript(SCHEMA)


def _enabled() -> bool:
    return bool(getattr(config.settings, "audit_enabled", True))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _serialize(obj: Any) -> str | None:
    if obj is None:
        return None
    try:
        return json.dumps(obj, default=str, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        logger.warning("audit: could not serialize payload: %s", exc)
        return json.dumps({"__unserialisable__": str(exc)})


def _insert_sync(
    action: str,
    resource_type: str,
    resource_id: str | None,
    before_json: str | None,
    after_json: str | None,
    actor: ActorContext,
) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO audit_events "
            "(ts, actor_id, actor_username, action, resource_type, resource_id, "
            " before_json, after_json, source_ip) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                _now_iso(),
                actor.actor_id,
                actor.actor_username,
                action,
                resource_type,
                resource_id,
                before_json,
                after_json,
                actor.source_ip,
            ),
        )
        conn.commit()
        return int(cur.lastrowid or 0)


async def record(
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    *,
    before: Any = None,
    after: Any = None,
) -> int | None:
    """Append a single audit event. Returns the new row id (or None when disabled).

    Failures are logged but never propagated — audit must never break
    the primary operation that triggered it.
    """
    if not _enabled():
        return None
    actor = actor_ctx.get()
    before_json = _serialize(before)
    after_json = _serialize(after)
    try:
        return await asyncio.to_thread(
            _insert_sync,
            action,
            resource_type,
            resource_id,
            before_json,
            after_json,
            actor,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("audit record failed: %s", exc)
        return None


def _query_sync(
    actor: str | None,
    resource_type: str | None,
    resource_id: str | None,
    from_ts: str | None,
    to_ts: str | None,
    search: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int]:
    where: list[str] = []
    params: list[Any] = []
    if actor:
        where.append("actor_username = ?")
        params.append(actor)
    if resource_type:
        where.append("resource_type = ?")
        params.append(resource_type)
    if resource_id:
        where.append("resource_id = ?")
        params.append(resource_id)
    if from_ts:
        where.append("ts >= ?")
        params.append(from_ts)
    if to_ts:
        where.append("ts <= ?")
        params.append(to_ts)
    if search:
        # Bredsøgning på alle relevante kolonner inkl. JSON-blobs.
        # Case-insensitive via LOWER(); IFNULL beskytter mod NULL-felter
        # (resource_id og JSON-blobs kan være NULL).
        pattern = f"%{search.lower()}%"
        where.append(
            "("
            "LOWER(actor_username) LIKE ? OR "
            "LOWER(action) LIKE ? OR "
            "LOWER(resource_type) LIKE ? OR "
            "LOWER(IFNULL(resource_id, '')) LIKE ? OR "
            "LOWER(IFNULL(before_json, '')) LIKE ? OR "
            "LOWER(IFNULL(after_json, '')) LIKE ? OR "
            "LOWER(IFNULL(source_ip, '')) LIKE ? OR "
            "LOWER(ts) LIKE ?"
            ")"
        )
        params.extend([pattern] * 8)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    with _connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM audit_events {where_sql}", params
        ).fetchone()["n"]
        rows = conn.execute(
            f"SELECT * FROM audit_events {where_sql} "
            "ORDER BY id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return [dict(r) for r in rows], int(total)


async def query(
    *,
    actor: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """Return (events, total_count) matching the filters, newest first.

    ``search`` er en bredsøgning der laver case-insensitive
    substring-match på actor_username, action, resource_type,
    resource_id, source_ip, ts og hele før/efter JSON-blobs.
    """
    return await asyncio.to_thread(
        _query_sync,
        actor,
        resource_type,
        resource_id,
        from_ts,
        to_ts,
        search,
        limit,
        offset,
    )


def _get_sync(event_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM audit_events WHERE id = ?", (event_id,)
        ).fetchone()
    return dict(row) if row else None


async def get(event_id: int) -> dict[str, Any] | None:
    return await asyncio.to_thread(_get_sync, event_id)


def _prune_sync(cutoff_iso: str) -> int:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM audit_events WHERE ts < ?", (cutoff_iso,))
        conn.commit()
        return cur.rowcount or 0


async def prune_older_than(retention_days: int) -> int:
    """Delete events older than ``retention_days``. Returns rows removed."""
    if retention_days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc).timestamp() - retention_days * 86400
    cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat(
        timespec="seconds"
    )
    removed = await asyncio.to_thread(_prune_sync, cutoff_iso)
    if removed:
        logger.info("audit: pruned %d events older than %s", removed, cutoff_iso)
    return removed
