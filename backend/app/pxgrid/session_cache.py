# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""In-memory cache af pxGrid session-state.

Worker (``session_worker.py``) modtager STOMP MESSAGE-frames fra
``com.cisco.ise.session``-topic og opdaterer denne cache. API-laget
læser den (read-only) i stedet for at lave MnT-poll mod ISE.

Designvalg
----------
- Single source of truth: én ``MAC → SessionInfo``-dict, asyncio-lock
  beskyttet. Worker har eneste skrive-adgang; API'er læser.
- Tom session = ingen entry. ``DISCONNECTED``-event sletter MAC'en.
- ``last_event_at`` er portal-side wall-clock så vi kan tale om
  cache-alder uden at parse pxGrid-payload-tidsstempler.
- ``max_age_s`` evicter automatisk gamle entries ved næste touch hvis
  konfigureret > 0; 0 = aldrig (default).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DISK_CACHE_VERSION = 1


@dataclass
class SessionInfo:
    mac: str
    state: str = ""
    audit_session_id: str = ""
    nas_ip: str = ""
    user_name: str = ""
    policy_set_name: str = ""
    authz_profiles: list[str] = field(default_factory=list)
    authz_rule_name: str = ""
    use_case: str = ""
    nas_name: str = ""
    nas_device_type: str = ""
    last_event_at: float = field(default_factory=time.time)
    # MnT Session/MACAddress enrichment fields (populated asynchronously after reconcile)
    endpoint_policy: str = ""
    dacl: str = ""
    vlan: str = ""
    cts_security_group: str = ""
    # MnT AuthStatus enrichment fields
    identity_group: str = ""
    auth_method: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # Don't ship the raw blob to API consumers by default — too noisy.
        d.pop("raw", None)
        return d


class SessionCache:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionInfo] = {}
        self._lock = asyncio.Lock()
        self._messages_total = 0
        self._upserts_total = 0
        self._evictions_total = 0
        # Phase 3 (3.5.0): pubsub-fan-out til SSE-subscribers. Hver subscriber
        # får sin egen Queue så langsomme klienter ikke holder worker'en op.
        # Queue capper ved 256 events; ved overflow droppes ældste.
        self._subscribers: set[asyncio.Queue] = set()
        # Sync observers called immediately on every broadcast (anomaly detector etc.)
        self._observers: list = []

    @staticmethod
    def _norm(mac: str) -> str:
        return (mac or "").upper().replace("-", ":").strip()

    def register_observer(self, fn) -> None:
        """Register a sync callback called on every broadcast event."""
        self._observers.append(fn)

    def subscribe(self, maxsize: int = 256) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _broadcast(self, event: dict) -> None:
        dead: list[asyncio.Queue] = []
        for q in self._subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Slow consumer: drop oldest event so nye kommer igennem.
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:  # noqa: BLE001
                    dead.append(q)
        for q in dead:
            self._subscribers.discard(q)
        for fn in self._observers:
            try:
                fn(event)
            except Exception:  # noqa: BLE001
                pass

    async def upsert(self, info: SessionInfo) -> None:
        info.mac = self._norm(info.mac)
        if not info.mac:
            return
        async with self._lock:
            self._sessions[info.mac] = info
            self._upserts_total += 1
        self._broadcast({
            "type": "upsert",
            "mac": info.mac,
            "state": info.state,
            "user_name": info.user_name,
            "nas_ip": info.nas_ip,
            "audit_session_id": info.audit_session_id,
            "policy_set_name": info.policy_set_name,
            "authz_profiles": info.authz_profiles,
            "authz_rule_name": info.authz_rule_name,
            "use_case": info.use_case,
            "nas_name": info.nas_name,
            "nas_device_type": info.nas_device_type,
            "endpoint_policy": info.endpoint_policy,
            "dacl": info.dacl,
            "vlan": info.vlan,
            "cts_security_group": info.cts_security_group,
            "identity_group": info.identity_group,
            "auth_method": info.auth_method,
            "ts": info.last_event_at,
        })

    async def remove(self, mac: str) -> bool:
        mac = self._norm(mac)
        async with self._lock:
            existed = self._sessions.pop(mac, None) is not None
            if existed:
                self._evictions_total += 1
        if existed:
            self._broadcast({"type": "remove", "mac": mac, "ts": time.time()})
        return existed

    async def clear(self) -> None:
        async with self._lock:
            n = len(self._sessions)
            self._sessions.clear()
            self._evictions_total += n
        if n:
            self._broadcast({"type": "clear", "ts": time.time()})

    def note_message(self) -> None:
        self._messages_total += 1

    async def list(self, max_age_s: float = 0.0) -> list[SessionInfo]:
        async with self._lock:
            if max_age_s > 0:
                self._evict_expired_locked(max_age_s)
            return list(self._sessions.values())

    async def get(self, mac: str, max_age_s: float = 0.0) -> SessionInfo | None:
        mac = self._norm(mac)
        async with self._lock:
            if max_age_s > 0:
                self._evict_expired_locked(max_age_s)
            return self._sessions.get(mac)

    def _evict_expired_locked(self, max_age_s: float) -> None:
        cutoff = time.time() - max_age_s
        stale = [m for m, s in self._sessions.items() if s.last_event_at < cutoff]
        for m in stale:
            self._sessions.pop(m, None)
            self._evictions_total += 1

    def stats(self) -> dict[str, int]:
        return {
            "size": len(self._sessions),
            "messages_total": self._messages_total,
            "upserts_total": self._upserts_total,
            "evictions_total": self._evictions_total,
        }

    def save_to_disk(self, path: Path) -> int:
        """Gem alle sessions til JSON-fil. Atomisk via tmp→rename.
        Trådsikker: laver en shallow dict-kopi med Python GIL."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        sessions_snapshot = dict(self._sessions)
        data = {
            "version": DISK_CACHE_VERSION,
            "saved_at": time.time(),
            "sessions": [s.to_dict() for s in sessions_snapshot.values()],
        }
        tmp = path.with_suffix(".tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f)
            tmp.replace(path)
            n = len(sessions_snapshot)
            logger.info("session cache: gemt %d sessioner til %s", n, path)
            return n
        except Exception as exc:  # noqa: BLE001
            logger.warning("session cache: fejl ved gemning til %s: %s", path, exc)
            return 0

    def load_from_disk(self, path: Path, max_age_s: float = 0.0) -> int:
        """Indlæs sessions fra JSON-fil og merge ind i cache.
        Kald synkront FØR worker starter (ingen asyncio-lock nødvendig).

        ``max_age_s > 0`` udelader sessions hvis ``last_event_at`` er ældre end
        dette antal sekunder — forhindrer at meget gamle disk-sessions vises
        i Browse-vinduet inden pxGrid-reconcile er færdig.
        """
        path = Path(path)
        if not path.exists():
            logger.debug("session cache: ingen disk-fil fundet på %s", path)
            return 0
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            now = time.time()
            skipped = 0
            for item in data.get("sessions", []):
                mac = self._norm(item.get("mac", ""))
                if not mac:
                    continue
                if max_age_s > 0:
                    last_event = float(item.get("last_event_at") or 0.0)
                    if last_event > 0 and (now - last_event) > max_age_s:
                        skipped += 1
                        continue
                info = SessionInfo(
                    mac=mac,
                    state=item.get("state", ""),
                    audit_session_id=item.get("audit_session_id", ""),
                    nas_ip=item.get("nas_ip", ""),
                    user_name=item.get("user_name", ""),
                    policy_set_name=item.get("policy_set_name", ""),
                    authz_profiles=item.get("authz_profiles", []),
                    authz_rule_name=item.get("authz_rule_name", ""),
                    use_case=item.get("use_case", ""),
                    nas_name=item.get("nas_name", ""),
                    nas_device_type=item.get("nas_device_type", ""),
                    last_event_at=item.get("last_event_at", 0.0),
                    endpoint_policy=item.get("endpoint_policy", ""),
                    dacl=item.get("dacl", ""),
                    vlan=item.get("vlan", ""),
                    cts_security_group=item.get("cts_security_group", ""),
                    identity_group=item.get("identity_group", ""),
                    auth_method=item.get("auth_method", ""),
                )
                self._sessions[mac] = info
                loaded += 1
            if skipped:
                logger.info(
                    "session cache: indlæst %d sessioner fra %s (%d for gamle udeladt)",
                    loaded, path, skipped,
                )
            else:
                logger.info("session cache: indlæst %d sessioner fra %s", loaded, path)
            return loaded
        except Exception as exc:  # noqa: BLE001
            logger.warning("session cache: fejl ved indlæsning fra %s: %s", path, exc)
            return 0


_cache: SessionCache | None = None


def get_cache() -> SessionCache:
    global _cache
    if _cache is None:
        _cache = SessionCache()
    return _cache
