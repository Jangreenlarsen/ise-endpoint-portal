# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.deps import require_admin
from app.schemas.user import User, UserCreate, UserEndpointRoles, UserTemplates, UserUpdate
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[User])
async def list_users(_: User = Depends(require_admin)) -> list[User]:
    return user_service.list_users()


@router.post("", response_model=User, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    _: User = Depends(require_admin),
) -> User:
    return await user_service.create_user(payload)


@router.put("/{user_id}", response_model=User)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    _: User = Depends(require_admin),
) -> User:
    return await user_service.update_user(user_id, payload)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    requester: User = Depends(require_admin),
) -> None:
    await user_service.delete_user(user_id, requester.id)


@router.put("/{user_id}/endpoint-roles", response_model=User)
async def set_endpoint_roles(
    user_id: str,
    payload: UserEndpointRoles,
    requester: User = Depends(require_admin),
) -> User:
    return await user_service.set_endpoint_roles(
        user_id, payload.roles, requester.username
    )


@router.put("/{user_id}/templates", response_model=User)
async def set_user_templates(
    user_id: str,
    payload: UserTemplates,
    requester: User = Depends(require_admin),
) -> User:
    return await user_service.set_user_templates(
        user_id, payload.template_ids, requester.username
    )
