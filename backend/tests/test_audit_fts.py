"""Integration tests for audit_store FTS5-søgning.

Bruger en midlertidig SQLite-database (via monkeypatch + tmp_path)
så den rigtige audit.db ikke berøres.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest


@pytest.fixture
def audit_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Patch DB_PATH til en temp-fil og initialiser en frisk database."""
    db_path = tmp_path / "test_audit.db"
    import app.core.audit_store as store
    monkeypatch.setattr(store, "DB_PATH", db_path)
    monkeypatch.setattr(store, "_fts_available", False)  # Reset flag
    store.init_db()  # Opretter tabel + FTS5
    yield store
    # Cleanup: luk evt. åbne connections (sqlite3 lukker ved GC)


# ------------------------------------------------------------------ #
# FTS5 oprettelse                                                      #
# ------------------------------------------------------------------ #

def test_fts_table_created(audit_db) -> None:
    """audit_fts-tabellen skal eksistere efter init_db()."""
    import sqlite3
    conn = sqlite3.connect(audit_db.DB_PATH)
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_fts'"
    ).fetchone()
    conn.close()
    assert row is not None, "audit_fts-tabellen mangler"


def test_fts_available_flag_set(audit_db) -> None:
    assert audit_db._fts_available is True


# ------------------------------------------------------------------ #
# Søgning                                                              #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_fts_search_finds_by_actor(audit_db) -> None:
    """Søgning på brugernavnet finder den indsatte event."""
    await audit_db.record("updated", "endpoint", "id-1",
                          after={"mac": "AA:BB:CC:DD:EE:FF"})
    # Tving actor til noget søgbart
    import sqlite3
    conn = sqlite3.connect(audit_db.DB_PATH)
    conn.execute("UPDATE audit_events SET actor_username = 'netops_jan'")
    # Rebuild FTS efter manuel update (triggers dækker ikke UPDATE i dette setup)
    conn.execute("INSERT INTO audit_fts(audit_fts) VALUES('rebuild')")
    conn.commit()
    conn.close()

    events, total = await audit_db.query(search="netops_jan")
    assert total >= 1
    assert any("netops_jan" in e["actor_username"] for e in events)


@pytest.mark.asyncio
async def test_fts_search_finds_mac_in_json(audit_db) -> None:
    """FTS trigram finder MAC-adresse inde i JSON-blob."""
    await audit_db.record("created", "endpoint", "id-mac",
                          after={"mac": "11:22:33:44:55:66", "group": "test"})
    events, total = await audit_db.query(search="11:22:33")
    assert total >= 1


@pytest.mark.asyncio
async def test_fts_search_case_insensitive(audit_db) -> None:
    """Trigram-søgning er case-insensitiv."""
    await audit_db.record("deleted", "endpoint", "id-case",
                          before={"mac": "AA:BB:CC:DD:EE:FF"})
    events_upper, total_upper = await audit_db.query(search="DELETED")
    events_lower, total_lower = await audit_db.query(search="deleted")
    assert total_upper == total_lower
    assert total_upper >= 1


@pytest.mark.asyncio
async def test_fts_search_no_false_positives(audit_db) -> None:
    """Søgning på en streng der ikke findes returnerer 0 resultater."""
    await audit_db.record("updated", "endpoint", "id-x",
                          after={"note": "regular update"})
    events, total = await audit_db.query(search="zzz_nonexistent_xyz")
    assert total == 0


# ------------------------------------------------------------------ #
# Kombinerede filtre                                                    #
# ------------------------------------------------------------------ #

@pytest.mark.asyncio
async def test_fts_combined_with_resource_type_filter(audit_db) -> None:
    """FTS + resource_type-filter kombineres korrekt (AND-logik)."""
    await audit_db.record("updated", "endpoint", "id-ep",
                          after={"note": "searchable"})
    await audit_db.record("updated", "user", "id-usr",
                          after={"note": "searchable"})

    events, total = await audit_db.query(search="searchable", resource_type="endpoint")
    assert total == 1
    assert events[0]["resource_type"] == "endpoint"
