# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""P-9: en delvis PUT /settings/backend må ikke nulstille felter der ikke blev sendt.

ISE-forbindelsesformularen sender kun ISE-felterne. Før fixet blev alle andre
felter (cache, selvregistrering, dekommissionering, github_branch …) skrevet med
skemaets defaults — fx blev gæste-selvregistrering slået fra.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

import asyncio
from unittest.mock import AsyncMock, patch

from app.schemas.settings import BackendSettingsUpdate
from app.services import settings_service


def _run_update(stored: dict, payload: dict) -> dict:
    saved: dict = {}

    def _save(data):
        saved.clear()
        saved.update(data)

    with patch.object(settings_service, "load_overrides", return_value=dict(stored)), \
         patch.object(settings_service, "save_overrides", side_effect=_save), \
         patch.object(settings_service.config, "refresh_settings"), \
         patch.object(settings_service, "close_ise_client", AsyncMock()), \
         patch.object(settings_service.audit_store, "record", AsyncMock()), \
         patch("app.core.logging.setup_logging"):
        asyncio.run(settings_service.update_backend_settings(BackendSettingsUpdate(**payload)))
    return saved


ISE_FORM = {
    "ise_base_url": "https://ise.new", "ise_read_base_url": "", "ise_username": "api",
    "ise_password": "", "ise_verify_tls": True, "ise_timeout": 30.0, "ise_api_type": "ers",
    "coa_psn_name": "psn1", "coa_reauth_type": 1, "coa_disconnect_type": 0,
}


def test_ise_formular_nulstiller_ikke_andre_indstillinger():
    stored = {
        "ise_base_url": "https://ise.old", "ise_username": "api",
        "selfregister_enabled": True, "selfregister_group_id": "g-guest",
        "cache_prewarm_concurrency": 8, "decomm_authz_vlan": "666", "github_branch": "dev",
    }
    saved = _run_update(stored, ISE_FORM)
    assert saved["ise_base_url"] == "https://ise.new"
    assert saved["coa_psn_name"] == "psn1"
    assert saved["selfregister_enabled"] is True
    assert saved["selfregister_group_id"] == "g-guest"
    assert saved["cache_prewarm_concurrency"] == 8
    assert saved["decomm_authz_vlan"] == "666"
    assert saved["github_branch"] == "dev"


def test_felter_der_sendes_overskrives_stadig():
    stored = {"ise_base_url": "https://ise", "ise_username": "api", "selfregister_enabled": True}
    saved = _run_update(stored, {**ISE_FORM, "selfregister_enabled": False, "cache_prewarm_concurrency": 3})
    assert saved["selfregister_enabled"] is False
    assert saved["cache_prewarm_concurrency"] == 3


def test_uskrevne_felter_tilfoejes_ikke_til_config():
    saved = _run_update({}, ISE_FORM)
    # Ikke-sendte felter falder tilbage til config.Settings-defaults og skrives ikke.
    assert "selfregister_enabled" not in saved
    assert "cache_prewarm_concurrency" not in saved


def test_hentemetode_gemmes_og_bevares():
    saved = _run_update({"ise_base_url": "https://ise", "ise_username": "api"},
                        {**ISE_FORM, "cache_scan_source": "openapi_list"})
    assert saved["cache_scan_source"] == "openapi_list"
    saved = _run_update(saved, ISE_FORM)  # ISE-formularen sender ikke feltet
    assert saved["cache_scan_source"] == "openapi_list"
