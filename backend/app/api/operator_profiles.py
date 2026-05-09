from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_admin
from app.core import operator_profile_store as store
from app.schemas.operator_profile import (
    OperatorProfile,
    OperatorProfileCreate,
    OperatorProfileUpdate,
)

router = APIRouter(
    prefix="/operator-profiles",
    tags=["operator-profiles"],
    dependencies=[Depends(require_admin)],
)


def _to_model(record: dict) -> OperatorProfile:
    return OperatorProfile(
        id=record["id"],
        name=record["name"],
        display_name=record["display_name"],
        default_role=record["default_role"],
        assigned_endpoint_roles=list(record.get("assigned_endpoint_roles") or []),
        assigned_templates=list(record.get("assigned_templates") or []),
    )


@router.get("", response_model=list[OperatorProfile])
async def list_profiles() -> list[OperatorProfile]:
    return [_to_model(p) for p in store.load_profiles()]


@router.post("", response_model=OperatorProfile, status_code=status.HTTP_201_CREATED)
async def create_profile(req: OperatorProfileCreate) -> OperatorProfile:
    profiles = store.load_profiles()
    if store.find_by_name(profiles, req.name):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Operatørprofil med navn '{req.name}' findes allerede",
        )
    record = store.create_profile(
        name=req.name,
        display_name=req.display_name,
        default_role=req.default_role,
        assigned_endpoint_roles=req.assigned_endpoint_roles,
        assigned_templates=req.assigned_templates,
    )
    return _to_model(record)


@router.get("/{profile_id}", response_model=OperatorProfile)
async def get_profile(profile_id: str) -> OperatorProfile:
    profiles = store.load_profiles()
    record = store.find_by_id(profiles, profile_id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operatørprofil ikke fundet")
    return _to_model(record)


@router.put("/{profile_id}", response_model=OperatorProfile)
async def update_profile(profile_id: str, req: OperatorProfileUpdate) -> OperatorProfile:
    updates: dict = {}
    if req.display_name is not None:
        updates["display_name"] = req.display_name
    if req.default_role is not None:
        updates["default_role"] = req.default_role
    if req.assigned_endpoint_roles is not None:
        updates["assigned_endpoint_roles"] = req.assigned_endpoint_roles
    if req.assigned_templates is not None:
        updates["assigned_templates"] = req.assigned_templates
    record = store.update_profile(profile_id, updates)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operatørprofil ikke fundet")
    return _to_model(record)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(profile_id: str) -> None:
    if not store.delete_profile(profile_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operatørprofil ikke fundet")
