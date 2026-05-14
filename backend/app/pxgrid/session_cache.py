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
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class SessionInfo:
    mac: str
    state: str = ""
    audit_session_id: str = ""
    nas_ip: str = ""
    user_name: str = ""
    policy_set_name: str = ""
    authz_profiles: list[str] = field(default_factory=list)
    last_event_at: float = field(default_factory=time.time)
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

    @staticmethod
    def _norm(mac: str) -> str:
        return (mac or "").upper().replace("-", ":").strip()

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


_cache: SessionCache | None = None


def get_cache() -> SessionCache:
    global _cache
    if _cache is None:
        _cache = SessionCache()
    return _cache
