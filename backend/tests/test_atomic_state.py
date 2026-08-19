"""Tests for atomisk tilstands-skrivning og users.json-serialisering (F-05/F-06).

F-05: alle JSON-stores skrev med `Path.write_text()`, der trunkerer filen før
den skriver. Afbrydes processen i det vindue, står filen tom eller halv — og
`load_users()` returnerer stille `[]` ved parse-fejl, så symptomet er en portal
hvor ingen kan logge ind.

F-06: mønsteret load→ret→save læser og skriver hele brugerlisten. Racet er ikke
nåbart i dag (alle route-handlere er `async def`, og intet `await` ligger mellem
load og save), men garantien hørte hjemme i storen frem for at afhænge af
kaldstedernes form.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import pytest

from app.core.atomic_json import atomic_write_json, atomic_write_text


# ── F-05: atomicitet ─────────────────────────────────────────────────────────

def test_write_creates_file_with_content(tmp_path: Path):
    target = tmp_path / "state.json"
    atomic_write_json(target, {"a": 1})
    assert json.loads(target.read_text(encoding="utf-8")) == {"a": 1}


def test_original_survives_failed_serialisation(tmp_path: Path):
    """Fejler skrivningen undervejs, skal den GAMLE fil stå urørt.

    Det er hele pointen: `write_text` ville allerede have trunkeret filen.
    """
    target = tmp_path / "users.json"
    atomic_write_json(target, [{"id": "1", "username": "alice"}])

    class Unserialisable:
        pass

    with pytest.raises(TypeError):
        atomic_write_json(target, [Unserialisable()])

    assert json.loads(target.read_text(encoding="utf-8")) == [
        {"id": "1", "username": "alice"}
    ]


def test_no_temp_files_left_behind(tmp_path: Path):
    target = tmp_path / "state.json"
    atomic_write_json(target, {"ok": True})
    try:
        atomic_write_json(target, {"bad": object()})
    except TypeError:
        pass
    leftovers = [p.name for p in tmp_path.iterdir() if p.name != "state.json"]
    assert leftovers == [], f"temp-filer efterladt: {leftovers}"


def test_temp_file_is_created_in_same_directory(tmp_path: Path):
    """os.replace er kun atomisk inden for ét filsystem.

    Havner temp-filen i systemets tmp-mappe, kan flytningen krydse et
    filsystem og dermed ikke længere være atomisk.
    """
    target = tmp_path / "sub" / "state.json"
    seen: list[str] = []
    real = os.replace

    def spy(src, dst):
        seen.append(str(Path(src).parent))
        return real(src, dst)

    import app.core.atomic_json as mod
    orig, mod.os.replace = mod.os.replace, spy
    try:
        atomic_write_json(target, {"x": 1})
    finally:
        mod.os.replace = orig
    assert seen == [str(target.parent)]


def test_overwrite_replaces_content_completely(tmp_path: Path):
    """En kortere payload må ikke efterlade hale fra den forrige."""
    target = tmp_path / "state.json"
    atomic_write_json(target, {"long": "x" * 500})
    atomic_write_json(target, {"s": 1})
    assert json.loads(target.read_text(encoding="utf-8")) == {"s": 1}


def test_atomic_write_text_roundtrip(tmp_path: Path):
    target = tmp_path / "cache.json"
    atomic_write_text(target, '{"entries": {}}')
    assert target.read_text(encoding="utf-8") == '{"entries": {}}'


@pytest.mark.skipif(os.name == "nt", reason="Unix-filrettigheder")
def test_mode_is_applied_before_rename(tmp_path: Path):
    target = tmp_path / "secret.json"
    atomic_write_json(target, {"token": "s3cr3t"}, mode=0o600)
    assert (target.stat().st_mode & 0o077) == 0, "filen må ikke være læsbar for andre"


# ── Alle stores bruger hjælperen ─────────────────────────────────────────────

def test_no_store_uses_raw_write_text():
    """Strukturel vagt: en ny store må ikke genindføre den utrunkerede skrivning."""
    core = Path(__file__).resolve().parents[1] / "app" / "core"
    offenders = []
    for f in core.glob("*.py"):
        if f.name == "atomic_json.py":
            continue
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if ".write_text(" in line and not line.lstrip().startswith("#"):
                offenders.append(f"{f.name}:{i}")
    assert offenders == [], f"rå write_text() fundet: {offenders}"


# ── F-06: serialisering af users.json ────────────────────────────────────────

def test_transaction_serialises_concurrent_writers(tmp_path: Path, monkeypatch):
    """To tråde der laver læs-ret-skriv må ikke tabe hinandens ændringer."""
    from app.core import user_store

    users_file = tmp_path / "users.json"
    monkeypatch.setattr(user_store, "USERS_FILE", users_file)
    user_store.save_users([])

    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def add(name: str) -> None:
        try:
            barrier.wait(timeout=5)
            with user_store.transaction():
                users = user_store.load_users()
                users.append({"id": name, "username": name})
                user_store.save_users(users)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=add, args=(n,)) for n in ("alice", "bob")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, errors
    names = {u["username"] for u in user_store.load_users()}
    assert names == {"alice", "bob"}, "en skrivning gik tabt"


def test_transaction_is_reentrant():
    """En transaktion skal kunne kalde hjælpere der selv tager låsen."""
    from app.core import user_store

    with user_store.transaction():
        with user_store.transaction():
            pass  # ville deadlocke med en almindelig Lock


def test_read_modify_write_sites_are_wrapped():
    """Vagt: de kendte læs-ret-skriv-sekvenser skal ligge i en transaction().

    Fanger et nyt kaldsted der kopierer mønsteret uden låsen.
    """
    import ast

    root = Path(__file__).resolve().parents[1] / "app"
    unwrapped: list[str] = []
    for path in list(root.rglob("*.py")):
        src = path.read_text(encoding="utf-8")
        if "save_users(" not in src or path.name == "user_store.py":
            continue
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if not isinstance(node, ast.With):
                continue
            # markér linjer dækket af en with-blok der nævner transaction
            if "transaction()" in (ast.get_source_segment(src, node) or "")[:60]:
                for n in ast.walk(node):
                    setattr(n, "_covered", True)
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id == "save_users"
                    and not getattr(node, "_covered", False)):
                unwrapped.append(f"{path.name}:{node.lineno}")

    # Eneste tilladte undtagelse: main.py's opstarts-migrering, der kører før
    # serveren tager imod requests og derfor ikke kan have en medskriver.
    unexpected = [u for u in unwrapped if not u.startswith("main.py:")]
    assert unexpected == [], f"usikret save_users(): {unexpected}"
