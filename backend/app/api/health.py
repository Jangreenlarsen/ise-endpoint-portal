# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from fastapi import APIRouter

from app.core.version import BUILD, FULL, VERSION

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": VERSION, "build": BUILD, "full": FULL}
