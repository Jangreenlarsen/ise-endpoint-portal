# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""System-ressource-info: CPU, RAM og disk — bruges af dashboard."""
from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _collect_sync() -> dict[str, Any]:
    """Blokkerende kald — køres i executor for ikke at blokere event loop."""
    try:
        import psutil  # type: ignore[import]

        # CPU: interval=0.3 giver en reel måling (ikke instant snapshot der altid er 0.0)
        cpu_pct = psutil.cpu_percent(interval=0.3)

        vm = psutil.virtual_memory()
        ram_used_gb  = round(vm.used  / 1024 ** 3, 1)
        ram_total_gb = round(vm.total / 1024 ** 3, 1)
        ram_pct      = round(vm.percent, 1)

        du = shutil.disk_usage(BACKEND_ROOT)
        disk_used_gb  = round((du.total - du.free) / 1024 ** 3, 1)
        disk_total_gb = round(du.total / 1024 ** 3, 1)
        disk_free_gb  = round(du.free  / 1024 ** 3, 1)
        disk_pct      = round((du.total - du.free) / du.total * 100, 1) if du.total else 0.0

        return {
            "cpu_pct":      cpu_pct,
            "ram_pct":      ram_pct,
            "ram_used_gb":  ram_used_gb,
            "ram_total_gb": ram_total_gb,
            "disk_pct":     disk_pct,
            "disk_used_gb": disk_used_gb,
            "disk_free_gb": disk_free_gb,
            "disk_total_gb": disk_total_gb,
            "source": "psutil",
        }
    except ImportError:
        # Fallback: kun disk via shutil (psutil ikke installeret endnu)
        du = shutil.disk_usage(BACKEND_ROOT)
        disk_pct = round((du.total - du.free) / du.total * 100, 1) if du.total else 0.0
        return {
            "cpu_pct":      None,
            "ram_pct":      None,
            "ram_used_gb":  None,
            "ram_total_gb": None,
            "disk_pct":     disk_pct,
            "disk_used_gb": round((du.total - du.free) / 1024 ** 3, 1),
            "disk_free_gb": round(du.free  / 1024 ** 3, 1),
            "disk_total_gb": round(du.total / 1024 ** 3, 1),
            "source": "fallback",
        }


async def get_sysinfo() -> dict[str, Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _collect_sync)
