# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Alert API: aktive systemadvarsler."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_any
from app.core.alert_store import get_alerts

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", dependencies=[Depends(require_any)])
async def list_alerts() -> dict:
    """Returnér aktive systemadvarsler."""
    alerts = get_alerts()
    return {
        "alerts": [
            {
                "id": a.id,
                "severity": a.severity,
                "title": a.title,
                "body": a.body,
                "since": a.since,
            }
            for a in alerts
        ],
        "count": len(alerts),
        "has_errors": any(a.severity == "error" for a in alerts),
    }
