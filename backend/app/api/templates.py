# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Endpoint-skabelon API (3.24.0).

GET    /api/templates          -> alle autentiserede inkl. registrant
POST   /api/templates          -> admin + editor
GET    /api/templates/{id}     -> alle autentiserede inkl. registrant
PUT    /api/templates/{id}     -> admin + editor
DELETE /api/templates/{id}     -> admin + editor
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user, require_editor, require_register_lookup
from app.core import template_store
from app.schemas.template import (
    Template,
    TemplateCreate,
    TemplateListResponse,
    TemplateUpdate,
)
from app.schemas.user import User

router = APIRouter(prefix="/templates", tags=["templates"])
logger = logging.getLogger(__name__)


@router.get("", response_model=TemplateListResponse)
async def list_templates(
    user: User = Depends(require_register_lookup),
) -> TemplateListResponse:
    records = template_store.load_templates()
    # Admin og editor ser alle skabeloner.
    # registrant_templet: hvis brugeren har eksplicitte assigned_templates bruges
    # den liste; ellers falder vi tilbage til visible_to-filtrering.
    # Alle andre roller: kun skabeloner hvor visible_to er tom (alle) eller
    # indeholder deres rolle.
    if user.role in ("admin", "editor"):
        pass
    elif user.role == "registrant_templet" and user.assigned_templates:
        assigned = set(user.assigned_templates)
        records = [r for r in records if r.get("id") in assigned]
    else:
        records = [
            r for r in records
            if not r.get("visible_to") or user.role in r.get("visible_to", [])
        ]
    return TemplateListResponse(
        templates=[Template(**_coerce(r)) for r in records]
    )


@router.post(
    "",
    response_model=Template,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_editor)],
)
async def create_template(
    payload: TemplateCreate,
    user: User = Depends(get_current_user),
) -> Template:
    try:
        record = template_store.add_template(
            name=payload.name,
            description=payload.description,
            fields=payload.fields.model_dump(),
            created_by=user.username,
            visible_to=payload.visible_to,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    logger.info("template created: '%s' by %s", payload.name, user.username)
    return Template(**_coerce(record))


@router.get("/{template_id}", response_model=Template)
async def get_template(
    template_id: str,
    _: User = Depends(require_register_lookup),
) -> Template:
    record = template_store.get_template(template_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Skabelon ikke fundet")
    return Template(**_coerce(record))


@router.put(
    "/{template_id}",
    response_model=Template,
    dependencies=[Depends(require_editor)],
)
async def update_template(
    template_id: str,
    payload: TemplateUpdate,
    user: User = Depends(get_current_user),
) -> Template:
    try:
        record = template_store.update_template(
            template_id=template_id,
            name=payload.name,
            description=payload.description,
            fields=payload.fields.model_dump() if payload.fields is not None else None,
            visible_to=payload.visible_to,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Skabelon ikke fundet")
    logger.info("template updated: '%s' by %s", record.get("name"), user.username)
    return Template(**_coerce(record))


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_editor)],
)
async def delete_template(
    template_id: str,
    user: User = Depends(get_current_user),
) -> None:
    deleted = template_store.delete_template(template_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Skabelon ikke fundet")
    logger.info("template deleted: '%s' by %s", deleted.get("name"), user.username)


def _coerce(record: dict) -> dict:
    """Ensure 'fields' is a dict with TemplateFields-compatible keys."""
    r = dict(record)
    if not isinstance(r.get("fields"), dict):
        r["fields"] = {}
    f = r["fields"]
    r["fields"] = {
        "group_id": f.get("group_id", ""),
        "description": f.get("description", ""),
        "static_group_assignment": f.get("static_group_assignment"),
        "custom_attributes": f.get("custom_attributes") or {},
    }
    if not isinstance(r.get("visible_to"), list):
        r["visible_to"] = []
    return r
