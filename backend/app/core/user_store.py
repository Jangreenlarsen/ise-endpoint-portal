# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Persistent store for local user accounts.

Layout: backend/users.json (gitignored) — list of user records.
Thread/async-safe only under the current single-process assumption.

**Læs-ret-skriv (BUGS.md F-06).** Mønsteret ``users = load_users(); …;
save_users(users)`` optræder 17 steder og læser/skriver HELE listen. Går to
sådanne sekvenser i flæng, vinder den sidste, og den førstes ændring forsvinder
— fx kan en samtidig gemning af brugerpræferencer skrive en gammel
``token_gen`` tilbage og dermed genoplive et token som et logout har
tilbagekaldt.

I dag er det ikke nåbart: alle route-handlere er ``async def`` (intet kører i
FastAPI's threadpool), og der er intet ``await`` mellem load og save i noget
kaldsted, så sekvenserne er atomiske i den enkelttrådede event-loop. Det er
imidlertid en egenskab ved kaldstederne, ikke ved storen — ét indskudt
``await``, eller en enkelt ``run_in_threadpool`` (som fixet til F-09 kræver),
gør racet ægte uden at nogen bemærker det.

``transaction()`` gør garantien til storens ansvar i stedet. Låsen er en
``threading.RLock``: den dækker både tråde og — fordi ingen af sekvenserne
afgiver kontrollen — den nuværende event-loop-brug. Bliver en sekvens senere
gjort ægte asynkron, skal den have en ``asyncio.Lock`` i stedet; en blokerende
lås må aldrig holdes hen over et ``await``.
"""
from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
from app.core.atomic_json import atomic_write_json

USERS_FILE = Path(__file__).resolve().parents[2] / "users.json"

# RLock frem for Lock: en transaction() kan kalde hjælpere der selv tager låsen.
_users_lock = threading.RLock()


@contextmanager
def transaction() -> Iterator[None]:
    """Serialisér en læs-ret-skriv-sekvens på users.json.

    Brug den om HELE sekvensen — ikke kun om skrivningen::

        with user_store.transaction():
            users = load_users()
            record["role"] = "editor"
            save_users(users)

    Må ikke holdes hen over et ``await``: låsen er blokerende, og en suspenderet
    coroutine ville låse event-loopen for alle andre.
    """
    with _users_lock:
        yield


def load_users() -> list[dict[str, Any]]:
    if not USERS_FILE.exists():
        return []
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    if not isinstance(data, list):
        return []
    return data


def save_users(users: list[dict[str, Any]]) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(USERS_FILE, users, ensure_ascii=True, mode=0o600)


def find_by_id(users: list[dict[str, Any]], user_id: str) -> dict[str, Any] | None:
    return next((u for u in users if u.get("id") == user_id), None)


def find_by_username(users: list[dict[str, Any]], username: str) -> dict[str, Any] | None:
    lowered = username.lower()
    return next((u for u in users if u.get("username", "").lower() == lowered), None)


def increment_token_gen(users: list[dict[str, Any]], user_id: str) -> None:
    """Increment token_gen in-place — invaliderer alle eksisterende tokens for brugeren."""
    for u in users:
        if u.get("id") == user_id:
            u["token_gen"] = u.get("token_gen", 0) + 1
            break
