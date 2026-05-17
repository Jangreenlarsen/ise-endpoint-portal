# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Endpoint-rolle-katalog API (2.12.0).

GET    /api/endpoint-roles            -> alle (read for any auth user
                                         så frontend kan vise pickers)
POST   /api/endpoint-roles            -> admin only — opret ny rolle
DELETE /api/endpoint-roles/{name}     -> admin only — slet rolle

Bemærk: implicit username-rollen som hver bruger har, er IKKE en del
af kataloget — den eksisterer kun i `effective_roles`-beregningen.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user, require_admin
from app.core import audit_store, role_catalog
from app.schemas.endpoint_role import (
    EndpointRole,
    EndpointRoleCreate,
    EndpointRoleListResponse,
)
from app.schemas.user import User

router = APIRouter(prefix="/endpoint-roles", tags=["endpoint-roles"])

logger = logging.getLogger(__name__)


@router.get("", response_model=EndpointRoleListResponse)
async def list_roles(_: User = Depends(get_current_user)) -> EndpointRoleListResponse:
    roles = [EndpointRole(**r) for r in role_catalog.load_roles()]
    return EndpointRoleListResponse(roles=roles)


@router.post(
    "",
    response_model=EndpointRole,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def create_role(
    payload: EndpointRoleCreate,
    user: User = Depends(get_current_user),
) -> EndpointRole:
    try:
        record = role_catalog.add_role(
            name=payload.name,
            description=payload.description,
            created_by=user.username,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    logger.info("endpoint role created: %s by %s", payload.name, user.username)
    await audit_store.record(
        "created",
        "endpoint_role",
        record["name"],
        after={
            "name": record["name"],
            "description": record.get("description", ""),
            "created_by": record.get("created_by", ""),
        },
    )
    return EndpointRole(**record)


@router.delete(
    "/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
async def delete_role(name: str, user: User = Depends(get_current_user)) -> None:
    deleted = role_catalog.delete_role(name)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Rolle '{name}' findes ikke")
    logger.info("endpoint role deleted: %s by %s", name, user.username)
    await audit_store.record(
        "deleted",
        "endpoint_role",
        deleted["name"],
        before={
            "name": deleted["name"],
            "description": deleted.get("description", ""),
            "created_by": deleted.get("created_by", ""),
        },
    )
