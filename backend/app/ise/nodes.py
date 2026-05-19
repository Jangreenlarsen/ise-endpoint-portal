# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""ISE deployment node info via ERS /node."""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


async def list_nodes(client) -> list[dict]:
    """Hent alle ISE-noder med roller og services. Returnerer liste af dicts."""
    try:
        data = await client.get("/ers/config/node?size=100")
        resources = (data or {}).get("SearchResult", {}).get("resources", [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("nodes: list fejlede: %s", exc)
        return []

    sem = asyncio.Semaphore(5)

    async def fetch_one(r: dict) -> dict:
        node_id = r.get("id", "")
        async with sem:
            try:
                detail = await client.get(f"/ers/config/node/{node_id}")
                node = (detail or {}).get("Node", {})
                return {
                    "id": node_id,
                    "name": node.get("name", r.get("name", "")),
                    "fqdn": node.get("fqdn", ""),
                    "ip_address": node.get("ipAddress", ""),
                    "node_type": node.get("nodeType", ""),
                    "roles": node.get("roles", []),
                    "services": node.get("services", []),
                    "reachable": True,
                }
            except Exception as exc:  # noqa: BLE001
                return {
                    "id": node_id,
                    "name": r.get("name", ""),
                    "fqdn": "",
                    "ip_address": "",
                    "node_type": "",
                    "roles": [],
                    "services": [],
                    "reachable": False,
                    "error": str(exc),
                }

    return list(await asyncio.gather(*(fetch_one(r) for r in resources)))
