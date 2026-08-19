# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Atomisk JSON-skrivning for portalens tilstandsfiler (BUGS.md F-05).

**Hvorfor:** samtlige JSON-stores skrev med et direkte `Path.write_text()`, der
**trunkerer filen før den skriver**. Afbrydes processen i det vindue, står filen
tom eller halv. For `users.json` betyder det at alle konti forsvinder — og fordi
`load_users()` stille returnerer `[]` ved parse-fejl, er symptomet ikke en
fejlmeddelelse men en portal hvor ingen kan logge ind.

Vinduet var ikke hypotetisk: opdateringstjenesten afsluttede selv processen med
`os._exit(0)`, og `save_users()` kaldes fra 17 steder — heriblandt hvert logout
og hver gemning af brugerpræferencer.

**Hvordan:** skriv til en temp-fil i SAMME mappe (så `os.replace` bliver en
rename inden for ét filsystem og dermed atomisk), `flush()` + `os.fsync()` så
data reelt står på disken, og først derefter `os.replace()`. Læsere ser enten
den gamle eller den nye fil — aldrig noget derimellem.

`os.replace()` er atomisk på både POSIX og Windows (til forskel fra `os.rename`,
der fejler på Windows hvis målet findes).
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def atomic_write_json(
    path: Path,
    data: Any,
    *,
    indent: int | None = 2,
    ensure_ascii: bool = False,
    mode: int | None = None,
) -> None:
    """Skriv `data` som JSON til `path` atomisk.

    `mode` sætter filrettigheder (fx 0o600) på temp-filen FØR den flyttes på
    plads, så der aldrig findes et øjeblik hvor den færdige fil er for åben.
    Ignoreres på Windows, hvor kaldere selv sætter ACL'er.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=indent, ensure_ascii=ensure_ascii)

    # delete=False: vi flytter filen selv. dir=path.parent er afgørende —
    # os.replace kan kun være atomisk inden for ét filsystem.
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(path.parent),
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            tmp_name = tmp.name
            tmp.write(payload)
            tmp.flush()
            os.fsync(tmp.fileno())

        if mode is not None and os.name != "nt":
            os.chmod(tmp_name, mode)

        os.replace(tmp_name, path)
        tmp_name = None  # flyttet — ingen oprydning nødvendig
    finally:
        if tmp_name is not None:
            # Skrivningen fejlede undervejs; den originale fil er urørt.
            try:
                os.unlink(tmp_name)
            except OSError:
                logger.warning("atomic_write_json: kunne ikke rydde temp-fil %s", tmp_name)


def atomic_write_text(path: Path, text: str, *, mode: int | None = None) -> None:
    """Som `atomic_write_json`, men for en færdig-serialiseret streng.

    Bruges hvor kalderen selv styrer serialiseringen (fx disk-cachen, der
    serialiserer i en thread-pool).
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(path.parent),
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            tmp_name = tmp.name
            tmp.write(text)
            tmp.flush()
            os.fsync(tmp.fileno())
        if mode is not None and os.name != "nt":
            os.chmod(tmp_name, mode)
        os.replace(tmp_name, path)
        tmp_name = None
    finally:
        if tmp_name is not None:
            try:
                os.unlink(tmp_name)
            except OSError:
                logger.warning("atomic_write_text: kunne ikke rydde temp-fil %s", tmp_name)
