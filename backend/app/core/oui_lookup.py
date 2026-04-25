"""IEEE OUI → vendor lookup (2.11.0).

Loads a bundled CSV (``backend/data/oui.csv``) once at import and exposes
``lookup(mac) -> str`` returning a vendor name or empty string. MAC is
normalised to uppercase hex without separators. The lookup tries the
longest registry prefix first (MA-S 36 bit → MA-M 28 bit → MA-L 24 bit)
so assignments from the sub-blocks take precedence over the parent OUI.

The bundled dataset is a curated subset of ~400 common OUIs. A larger
dataset (e.g. the full IEEE MA-L registry) can be dropped into the same
CSV — the loader accepts any length prefix per row.

The ``scripts/update_oui.py`` helper can refresh the CSV from IEEE's
public registries offline.
"""
from __future__ import annotations

import csv
import logging
import re
from pathlib import Path
from typing import Iterable

logger = logging.getLogger(__name__)

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "oui.csv"

# Three lookup tables keyed by hex-prefix length so we can pick the
# longest match (MA-S wins over MA-M which wins over MA-L).
_PREFIX_6: dict[str, str] = {}   # MA-L: 24 bits / 6 hex
_PREFIX_7: dict[str, str] = {}   # MA-M: 28 bits / 7 hex
_PREFIX_9: dict[str, str] = {}   # MA-S: 36 bits / 9 hex
_loaded = False

_MAC_CLEAN_RE = re.compile(r"[^0-9A-Fa-f]")


def _normalise(mac: str) -> str:
    """Return hex-only uppercase MAC."""
    return _MAC_CLEAN_RE.sub("", mac or "").upper()


def _load() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    if not DATA_PATH.exists():
        logger.warning("OUI data file missing: %s", DATA_PATH)
        return
    try:
        with DATA_PATH.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                prefix = _normalise(row.get("oui", ""))
                vendor = (row.get("vendor") or "").strip()
                if not prefix or not vendor:
                    continue
                n = len(prefix)
                if n >= 9:
                    _PREFIX_9[prefix[:9]] = vendor
                elif n >= 7:
                    _PREFIX_7[prefix[:7]] = vendor
                else:
                    _PREFIX_6[prefix[:6]] = vendor
    except OSError as exc:
        logger.error("failed to load OUI data: %s", exc)
        return
    logger.info(
        "OUI lookup loaded: %d MA-L + %d MA-M + %d MA-S entries",
        len(_PREFIX_6), len(_PREFIX_7), len(_PREFIX_9),
    )


def lookup(mac: str) -> str:
    """Return vendor name for a MAC or empty string if unknown."""
    if not _loaded:
        _load()
    hx = _normalise(mac)
    if len(hx) < 6:
        return ""
    # Longest prefix wins: MA-S (9) → MA-M (7) → MA-L (6).
    v = _PREFIX_9.get(hx[:9])
    if v:
        return v
    v = _PREFIX_7.get(hx[:7])
    if v:
        return v
    return _PREFIX_6.get(hx[:6], "")


def stats() -> dict[str, int]:
    if not _loaded:
        _load()
    return {
        "ma_l": len(_PREFIX_6),
        "ma_m": len(_PREFIX_7),
        "ma_s": len(_PREFIX_9),
        "total": len(_PREFIX_6) + len(_PREFIX_7) + len(_PREFIX_9),
    }


__all__: Iterable[str] = ("lookup", "stats")
