#!/usr/bin/env python3
"""
Bygger en opdateringspakke (ZIP) til HyperVision ISE Portal.

Pakken kan uploades direkte i portalen via Settings → Opdatering (kun admin).
Indholdet matcher præcist hvad update_service.py tillader at overskrive.

Brug:
    python make_update_package.py
    python make_update_package.py --output dist/
    python make_update_package.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent

# ------------------------------------------------------------------ #
# Hvad pakkes med                                                      #
# ------------------------------------------------------------------ #
# Stier der inkluderes (mapper rekursivt, filer direkte).
# Skal matche _ALLOWED_PREFIXES i update_service.py.
INCLUDE_PATHS: list[str] = [
    "frontend",
    "backend/app",
    "backend/pyproject.toml",
    "version.json",
]

# ------------------------------------------------------------------ #
# Hvad ekskluderes altid                                               #
# ------------------------------------------------------------------ #
# Præfixes (relativ sti fra projekt-rod, forward slashes).
EXCLUDE_PREFIXES: tuple[str, ...] = (
    "backend/app/__pycache__",
    "backend/app/core/__pycache__",
    "backend/app/api/__pycache__",
    "backend/app/services/__pycache__",
    "backend/app/ise/__pycache__",
    "backend/app/pxgrid/__pycache__",
    "backend/app/schemas/__pycache__",
    "frontend/.git",
)

# Filendelser der ekskluderes
EXCLUDE_SUFFIXES: tuple[str, ...] = (
    ".pyc",
    ".pyo",
    ".pyd",
)

# Mappenavne der altid springes over (uanset dybde)
EXCLUDE_DIRS: frozenset[str] = frozenset({
    "__pycache__",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "temp",
})


def _should_exclude(rel_posix: str) -> bool:
    """Returnerer True hvis filen skal springes over."""
    if any(rel_posix.endswith(s) for s in EXCLUDE_SUFFIXES):
        return True
    if any(rel_posix.startswith(p) for p in EXCLUDE_PREFIXES):
        return True
    # Kig på alle mappekomponenter
    parts = rel_posix.split("/")
    for part in parts[:-1]:  # kun mapper, ikke filen selv
        if part in EXCLUDE_DIRS:
            return True
    return False


def collect_files() -> list[tuple[Path, str]]:
    """Returnerer liste af (absolut_sti, zip_sti) for alle filer der pakkes."""
    result: list[tuple[Path, str]] = []
    for include in INCLUDE_PATHS:
        p = PROJECT_ROOT / include
        if not p.exists():
            print(f"  ! {include} — ikke fundet, springes over")
            continue
        if p.is_file():
            rel = include.replace("\\", "/")
            if not _should_exclude(rel):
                result.append((p, rel))
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if not f.is_file():
                    continue
                rel = f.relative_to(PROJECT_ROOT).as_posix()
                if not _should_exclude(rel):
                    result.append((f, rel))
    return result


def _fmt_size(n_bytes: int) -> str:
    if n_bytes < 1024:
        return f"{n_bytes} B"
    if n_bytes < 1024 ** 2:
        return f"{n_bytes / 1024:.1f} KB"
    return f"{n_bytes / 1024 ** 2:.2f} MB"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Byg HyperVision ISE Portal opdateringspakke (ZIP)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Upload pakken via Settings → Opdatering i portal-admin.",
    )
    parser.add_argument(
        "--output", "-o", default=".",
        help="Output-mappe (default: projekt-rod)",
    )
    parser.add_argument(
        "--dry-run", "-n", action="store_true",
        help="Vis hvilke filer der ville inkluderes uden at oprette ZIP",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Vis alle inkluderede filer",
    )
    args = parser.parse_args()

    # Læs version
    version_file = PROJECT_ROOT / "version.json"
    if not version_file.exists():
        print("FEJL: version.json ikke fundet i projekt-roden")
        sys.exit(1)
    try:
        version_info = json.loads(version_file.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"FEJL: Kan ikke læse version.json: {exc}")
        sys.exit(1)

    version = version_info.get("version", "0.0.0")
    build   = version_info.get("build",   "0000")

    zip_name   = f"hypervision-portal-v{version}-b{build}.zip"
    output_dir = Path(args.output)
    zip_path   = output_dir / zip_name

    print()
    print("=" * 60)
    print("  HyperVision ISE Portal — opdateringspakke")
    print("=" * 60)
    print(f"  Version : {version}  build {build}")
    print(f"  Output  : {zip_path}")
    if args.dry_run:
        print("  Tilstand: DRY RUN (ingen fil oprettes)")
    print()

    files = collect_files()

    if not files:
        print("FEJL: Ingen filer fundet at pakke.")
        sys.exit(1)

    # Vis filer
    if args.verbose or args.dry_run:
        print(f"Inkluderede filer ({len(files)}):")
        for _, rel in files:
            print(f"  + {rel}")
        print()

    if args.dry_run:
        total = sum(abs_p.stat().st_size for abs_p, _ in files)
        print(f"Dry run: {len(files)} filer, estimeret ukomprimeret størrelse: {_fmt_size(total)}")
        print()
        return

    # Opret ZIP
    output_dir.mkdir(parents=True, exist_ok=True)
    total_uncompressed = 0
    try:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            for abs_path, zip_rel in files:
                file_size = abs_path.stat().st_size
                total_uncompressed += file_size
                zf.write(abs_path, zip_rel)
                if args.verbose:
                    print(f"  pakket: {zip_rel}  ({_fmt_size(file_size)})")
    except Exception as exc:
        print(f"FEJL: Kunne ikke oprette ZIP: {exc}")
        if zip_path.exists():
            zip_path.unlink()
        sys.exit(1)

    compressed = zip_path.stat().st_size
    ratio = (1 - compressed / total_uncompressed) * 100 if total_uncompressed else 0

    print(f"OK {len(files)} filer pakket")
    print(f"   Ukomprimeret : {_fmt_size(total_uncompressed)}")
    print(f"   Komprimeret  : {_fmt_size(compressed)}  ({ratio:.0f}% besparelse)")
    print()
    print(f"OK Pakke klar   : {zip_path}")
    print()
    print("  Upload via:  Settings > Opdatering  (kraever admin-login)")
    print()


if __name__ == "__main__":
    main()
