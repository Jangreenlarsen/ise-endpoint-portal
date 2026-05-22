"""Tests for PxGrid session worker — rene hjælpefunktioner og worker-tilstand.

Dækker: _extract_sessions (alle payload-shapes), _extract_endpoints
(alle payload-shapes), _parse_vlan (tag-stripping), WorkerStatus-defaults,
PxGridSessionWorker start/stop lifecycle (mocked asyncio).
Ingen netværksforbindelser — ISE og STOMP mockes fuldt.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest

from app.pxgrid.session_worker import (
    PxGridSessionWorker,
    WorkerStatus,
    _extract_endpoints,
    _extract_sessions,
    _parse_vlan,
)


# ------------------------------------------------------------------ #
# _parse_vlan                                                          #
# ------------------------------------------------------------------ #

@pytest.mark.parametrize("raw,expected", [
    ("",                    ""),
    ("32",                  "32"),
    ("(tag=0) 32",          "32"),    # standard ISE RADIUS format
    ("(tag=1) 100",         "100"),
    ("(tag=0) 42 ",         "42"),    # trailing whitespace
    ("not_a_vlan",          "not_a_vlan"),  # ikke-numerisk → bevar rå
    ("(tag=0) vlan_name",   "(tag=0) vlan_name"),  # ikke-numerisk suffix
])
def test_parse_vlan(raw, expected):
    assert _parse_vlan(raw) == expected


# ------------------------------------------------------------------ #
# _extract_sessions                                                    #
# ------------------------------------------------------------------ #

def test_extract_sessions_list_of_sessions():
    """Payload med 'sessions'-liste returnerer alle dicts."""
    payload = {"sessions": [{"macAddress": "AA:BB:CC:DD:EE:01"}, {"macAddress": "AA:BB:CC:DD:EE:02"}]}
    result = _extract_sessions(payload)
    assert len(result) == 2
    assert result[0]["macAddress"] == "AA:BB:CC:DD:EE:01"


def test_extract_sessions_single_session_dict():
    """Payload med 'session'-enkelt-dict returnerer singleton-liste."""
    payload = {"session": {"macAddress": "AA:BB:CC:DD:EE:03"}}
    result = _extract_sessions(payload)
    assert len(result) == 1
    assert result[0]["macAddress"] == "AA:BB:CC:DD:EE:03"


def test_extract_sessions_flat_session():
    """Payload der selv er en session (indeholder macAddress) returnerer singleton."""
    payload = {"macAddress": "AA:BB:CC:DD:EE:04", "ipAddress": "10.0.0.1"}
    result = _extract_sessions(payload)
    assert len(result) == 1
    assert result[0]["macAddress"] == "AA:BB:CC:DD:EE:04"


def test_extract_sessions_flat_calling_station():
    """Payload med callingStationId returnerer singleton."""
    payload = {"callingStationId": "AA-BB-CC-DD-EE-05"}
    result = _extract_sessions(payload)
    assert len(result) == 1


def test_extract_sessions_bare_list():
    """Payload der er en direkte liste returnerer alle dicts."""
    payload = [
        {"macAddress": "AA:BB:CC:DD:EE:06"},
        {"macAddress": "AA:BB:CC:DD:EE:07"},
    ]
    result = _extract_sessions(payload)
    assert len(result) == 2


def test_extract_sessions_filters_non_dicts_in_list():
    """Ikke-dict-elementer i liste filtreres fra."""
    payload = {"sessions": [{"macAddress": "AA:BB:CC:DD:EE:08"}, "ikke_dict", 42]}
    result = _extract_sessions(payload)
    assert len(result) == 1


def test_extract_sessions_empty_sessions_list():
    assert _extract_sessions({"sessions": []}) == []


def test_extract_sessions_unrecognized_payload():
    """Ukendt payload-shape returnerer tom liste."""
    assert _extract_sessions("raw_string") == []
    assert _extract_sessions(None) == []
    assert _extract_sessions(42) == []


# ------------------------------------------------------------------ #
# _extract_endpoints                                                   #
# ------------------------------------------------------------------ #

def test_extract_endpoints_from_endpoints_list():
    payload = {"endpoints": [{"id": "ep-1", "mac": "AA:BB:CC:DD:EE:01"}]}
    result = _extract_endpoints(payload)
    assert len(result) == 1
    assert result[0]["id"] == "ep-1"


def test_extract_endpoints_from_endpoint_dict():
    payload = {"endpoint": {"id": "ep-2", "mac": "AA:BB:CC:DD:EE:02"}}
    result = _extract_endpoints(payload)
    assert len(result) == 1


def test_extract_endpoints_from_data_list():
    payload = {"data": [{"id": "ep-3"}, {"id": "ep-4"}]}
    result = _extract_endpoints(payload)
    assert len(result) == 2


def test_extract_endpoints_flat_with_mac():
    """Top-level dict med 'mac'-nøgle → singleton."""
    payload = {"id": "ep-5", "mac": "AA:BB:CC:DD:EE:05"}
    result = _extract_endpoints(payload)
    assert len(result) == 1


def test_extract_endpoints_flat_with_endpoint_id():
    payload = {"endpointId": "ep-6", "operation": "CREATE"}
    result = _extract_endpoints(payload)
    assert len(result) == 1


def test_extract_endpoints_bare_list():
    payload = [{"id": "ep-7"}, {"id": "ep-8"}]
    result = _extract_endpoints(payload)
    assert len(result) == 2


def test_extract_endpoints_empty():
    assert _extract_endpoints({}) == []
    assert _extract_endpoints([]) == []
    assert _extract_endpoints(None) == []


# ------------------------------------------------------------------ #
# WorkerStatus defaults                                               #
# ------------------------------------------------------------------ #

def test_worker_status_defaults():
    status = WorkerStatus()
    assert status.running is False
    assert status.connected is False
    assert status.messages_total == 0
    assert status.reconnect_count == 0
    assert status.subscribed_topics == []
    assert status.peer_node == ""


def test_worker_status_is_mutable():
    status = WorkerStatus()
    status.running = True
    status.messages_total = 42
    assert status.running is True
    assert status.messages_total == 42


# ------------------------------------------------------------------ #
# PxGridSessionWorker — lifecycle                                     #
# ------------------------------------------------------------------ #

def test_worker_initial_status():
    """Ny worker har running=False og ingen task."""
    # asyncio.Event kræver en running event loop; patching undgår det
    with patch("app.pxgrid.session_worker.asyncio") as mock_asyncio:
        mock_asyncio.Event.return_value = MagicMock()
        worker = PxGridSessionWorker()
    assert worker.status.running is False


def test_worker_start_skipped_when_pxgrid_disabled():
    """start() gør ingenting når pxgrid_enabled=False."""
    with (
        patch("app.pxgrid.session_worker.asyncio") as mock_asyncio,
        patch("app.core.config.settings") as mock_settings,
    ):
        mock_asyncio.Event.return_value = MagicMock()
        mock_settings.pxgrid_enabled = False
        mock_settings.pxgrid_worker_enabled = True
        worker = PxGridSessionWorker()
        worker.start()

    assert worker.status.running is False


def test_worker_start_skipped_when_worker_disabled():
    """start() gør ingenting når pxgrid_worker_enabled=False."""
    with (
        patch("app.pxgrid.session_worker.asyncio") as mock_asyncio,
        patch("app.core.config.settings") as mock_settings,
    ):
        mock_asyncio.Event.return_value = MagicMock()
        mock_settings.pxgrid_enabled = True
        mock_settings.pxgrid_worker_enabled = False
        worker = PxGridSessionWorker()
        worker.start()

    assert worker.status.running is False


def test_worker_start_when_enabled():
    """start() sætter running=True og opretter asyncio task når begge flags er True."""
    mock_task = MagicMock()
    mock_task.done.return_value = True  # ingen eksisterende task

    with (
        patch("app.pxgrid.session_worker.asyncio") as mock_asyncio,
        patch("app.core.config.settings") as mock_settings,
    ):
        mock_asyncio.Event.return_value = MagicMock()
        mock_asyncio.create_task.return_value = mock_task
        mock_settings.pxgrid_enabled = True
        mock_settings.pxgrid_worker_enabled = True
        mock_settings.pxgrid_session_topic = "com.cisco.ise.session"
        mock_settings.pxgrid_endpoint_topic_enabled = False
        mock_settings.pxgrid_endpoint_topic = "com.cisco.ise.endpoint"

        worker = PxGridSessionWorker()
        worker.start()

    assert worker.status.running is True
    mock_asyncio.create_task.assert_called_once()
