"""Regressionstests for PSK-validering (BUGS.md P-4, P-5).

- P-4: WPA-passphrase skal være 8-63 printbare ASCII-tegn uanset politik,
       og en nøgle valideres også når PSK_Mode ikke sendes med.
- P-5: en ugyldig nøgle på gæstesiden giver 422 med forklaring, ikke 500.
"""
from __future__ import annotations

import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

import pytest
from pydantic import ValidationError

from app.schemas.settings import PskPolicy
from app.services._endpoint_helpers import _validate_psk
from app.services.settings_service import (
    generate_psk_key,
    psk_policy_hint,
    validate_psk_key,
)

POLICY = PskPolicy(min_length=8)


def test_accepts_valid_key():
    assert validate_psk_key("Abcdefgh12", POLICY) == []


def test_accepts_exactly_63_chars():
    assert validate_psk_key("a" * 63, POLICY) == []


def test_rejects_64_chars():
    errs = validate_psk_key("a" * 64, POLICY)
    assert any("63" in e for e in errs)


@pytest.mark.parametrize("key", ["nøglenøgle", "abcdefghæ", "abc\tdefghij", "abcdefgh€"])
def test_rejects_non_ascii_and_control_chars(key):
    assert validate_psk_key(key, POLICY)


def test_policy_min_length_capped_at_63():
    with pytest.raises(ValidationError):
        PskPolicy(min_length=64)


def test_generated_keys_are_valid_wpa():
    p = PskPolicy(min_length=63, require_uppercase=True, require_numbers=True, require_special=True)
    for _ in range(20):
        key = generate_psk_key(p).key
        assert validate_psk_key(key, p) == [], key


def test_key_without_mode_is_still_validated():
    """En nøgle sendt uden PSK_Mode må ikke slippe uden om valideringen."""
    with pytest.raises(ValueError):
        _validate_psk({"PSK_Key": "x" * 70})


def test_key_with_mode_false_is_not_validated():
    _validate_psk({"PSK_Mode": "false", "PSK_Key": "kort"})


def test_hint_mentions_limits():
    hint = psk_policy_hint(PskPolicy(min_length=10, require_numbers=True))
    assert "10-63" in hint and "tal" in hint
