# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""Per-bruger personalisering — saved views, fremtidige preferences m.m.

Bruger-records gemmer en ``saved_views``-liste under ``users.json``. Hver
view er en navngivet snapshot af Browse-viewets filter-tilstand som user
kan re-aktivere med ét klik. Max 20 views pr. bruger (en vilkårlig grænse
for at holde users.json overskuelig).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.core import audit_store
from app.core.user_store import find_by_id, load_users, save_users, transaction
from app.schemas.user import (
    SavedView,
    SavedViewCreate,
    SavedViewUpdate,
    SavedViewsResponse,
    User,
    UserPrefs,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/me", tags=["me"])

MAX_VIEWS_PER_USER = 20


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_views(record: dict) -> list[dict]:
    raw = record.get("saved_views")
    if not isinstance(raw, list):
        return []
    return raw


@router.get("/views", response_model=SavedViewsResponse)
async def list_my_views(user: User = Depends(get_current_user)) -> SavedViewsResponse:
    users = load_users()
    record = find_by_id(users, user.id)
    if not record:
        return SavedViewsResponse(views=[], max_views=MAX_VIEWS_PER_USER)
    return SavedViewsResponse(
        views=[SavedView(**v) for v in _get_views(record)],
        max_views=MAX_VIEWS_PER_USER,
    )


@router.post("/views", response_model=SavedView, status_code=status.HTTP_201_CREATED)
async def create_my_view(
    payload: SavedViewCreate,
    user: User = Depends(get_current_user),
) -> SavedView:
    with transaction():  # F-06: serialiser laes-ret-skriv
        users = load_users()
        if user.id.startswith("tacacs:"):
            record = _ensure_shadow_record(users, user)
        else:
            record = find_by_id(users, user.id)
        if not record:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
        views = _get_views(record)
        # Duplikat-navne tilladt — admin kan vælge selv. Men hård cap på antal.
        if len(views) >= MAX_VIEWS_PER_USER:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Maks {MAX_VIEWS_PER_USER} views pr. bruger — slet en eksisterende først",
            )
        view = {
            "id": str(uuid.uuid4()),
            "name": payload.name.strip(),
            "query": payload.query or {},
            "created_at": _now_iso(),
        }
        views.append(view)
        record["saved_views"] = views
        save_users(users)
    logger.info("user %s created saved view '%s'", user.username, view["name"])
    await audit_store.record(
        "created", "saved_view", view["id"],
        after={"username": user.username, "name": view["name"]},
    )
    return SavedView(**view)


@router.put("/views/{view_id}", response_model=SavedView)
async def update_my_view(
    view_id: str,
    payload: SavedViewUpdate,
    user: User = Depends(get_current_user),
) -> SavedView:
    with transaction():  # F-06: serialiser laes-ret-skriv
        users = load_users()
        record = find_by_id(users, user.id)
        if not record:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
        views = _get_views(record)
        target = next((v for v in views if v.get("id") == view_id), None)
        if not target:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "View ikke fundet")
        before = {"name": target.get("name"), "query": target.get("query")}
        if payload.name is not None:
            target["name"] = payload.name.strip()
        if payload.query is not None:
            target["query"] = payload.query
        record["saved_views"] = views
        save_users(users)
    await audit_store.record(
        "updated", "saved_view", view_id,
        before=before,
        after={"name": target.get("name"), "query": target.get("query")},
    )
    return SavedView(**target)


@router.delete("/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_view(
    view_id: str,
    user: User = Depends(get_current_user),
) -> None:
    with transaction():  # F-06: serialiser laes-ret-skriv
        users = load_users()
        record = find_by_id(users, user.id)
        if not record:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
        views = _get_views(record)
        target = next((v for v in views if v.get("id") == view_id), None)
        if not target:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "View ikke fundet")
        record["saved_views"] = [v for v in views if v.get("id") != view_id]
        save_users(users)
    await audit_store.record(
        "deleted", "saved_view", view_id,
        before={"name": target.get("name")},
    )


# ── Per-bruger præferencer (i18n m.m.) ───────────────────────────────────────

_VALID_LANGUAGES = {"da", "en"}


def _safe_col_order(raw: object) -> list[str] | None:
    if not isinstance(raw, list):
        return None
    return [k for k in raw if isinstance(k, str) and 1 <= len(k) <= 32][:30]


def _safe_col_vis(raw: object) -> dict[str, bool] | None:
    if not isinstance(raw, dict):
        return None
    return {k: bool(v) for k, v in list(raw.items())[:30] if isinstance(k, str) and 1 <= len(k) <= 32}


def _safe_col_widths(raw: object) -> dict[str, int] | None:
    if not isinstance(raw, dict):
        return None
    result = {
        k: int(v) for k, v in list(raw.items())[:30]
        if isinstance(k, str) and 1 <= len(k) <= 32
        and isinstance(v, int) and 20 <= v <= 2000
    }
    return result or None


def _safe_tree_layout(raw: object) -> dict | None:
    """Valider + begræns gruppetræets layout (per-bruger, egen visning — men
    grænser holder users.json overskuelig og modvirker misbrug).

    Struktur: {groupBy:[str], branchDim:{path:str}, merges:{path:[[str]]},
    hidden:{path:[str]}}. Stier kan være lange (indeholder gren-værdier).
    """
    if not isinstance(raw, dict):
        return None
    out: dict = {}

    gb = raw.get("groupBy")
    if isinstance(gb, list):
        out["groupBy"] = [k for k in gb if isinstance(k, str) and 1 <= len(k) <= 32][:20]

    # NB: parent-stier kan være "" (root-niveau) → tillad tom nøgle her.
    bd = raw.get("branchDim")
    if isinstance(bd, dict):
        out["branchDim"] = {
            k: v for k, v in list(bd.items())[:300]
            if isinstance(k, str) and len(k) <= 1024
            and isinstance(v, str) and len(v) <= 256
        }

    mg = raw.get("merges")
    if isinstance(mg, dict):
        merges: dict = {}
        for k, v in list(mg.items())[:300]:
            if not (isinstance(k, str) and len(k) <= 1024 and isinstance(v, list)):
                continue
            groups = [
                [x for x in grp if isinstance(x, str) and len(x) <= 256][:100]
                for grp in v[:100] if isinstance(grp, list)
            ]
            merges[k] = [g for g in groups if len(g) >= 2]
        out["merges"] = merges

    hd = raw.get("hidden")
    if isinstance(hd, dict):
        out["hidden"] = {
            k: [x for x in v if isinstance(x, str) and len(x) <= 256][:200]
            for k, v in list(hd.items())[:300]
            if isinstance(k, str) and len(k) <= 1024 and isinstance(v, list)
        }

    return out or None


def _prefs_response(prefs: dict) -> UserPrefs:
    lang = prefs.get("language")
    if lang not in _VALID_LANGUAGES:
        lang = None
    return UserPrefs(
        language=lang,  # type: ignore[arg-type]
        col_order=_safe_col_order(prefs.get("col_order")),
        col_vis=_safe_col_vis(prefs.get("col_vis")),
        col_widths=_safe_col_widths(prefs.get("col_widths")),
        tree_layout=_safe_tree_layout(prefs.get("tree_layout")),
    )


@router.get("/prefs", response_model=UserPrefs)
async def get_my_prefs(user: User = Depends(get_current_user)) -> UserPrefs:
    users = load_users()
    record = find_by_id(users, user.id)
    if not record:
        return UserPrefs()
    return _prefs_response(record.get("prefs") or {})


def _ensure_shadow_record(users: list, user: User) -> dict:
    """Find eller opret en tacacs_shadow-record i users.json for TACACS-bruger."""
    record = find_by_id(users, user.id)
    if record is None:
        record = {"id": user.id, "user_type": "tacacs_shadow", "prefs": {}}
        users.append(record)
    return record


@router.put("/prefs", response_model=UserPrefs)
async def update_my_prefs(
    payload: UserPrefs,
    user: User = Depends(get_current_user),
) -> UserPrefs:
    with transaction():  # F-06: serialiser laes-ret-skriv
        users = load_users()
        if user.id.startswith("tacacs:"):
            record = _ensure_shadow_record(users, user)
        else:
            record = find_by_id(users, user.id)
        if not record:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
        prefs = record.get("prefs") or {}
        updated = payload.model_fields_set

        if "language" in updated:
            if payload.language is None:
                prefs.pop("language", None)
            elif payload.language in _VALID_LANGUAGES:
                prefs["language"] = payload.language

        if "col_order" in updated:
            if payload.col_order is None:
                prefs.pop("col_order", None)
            else:
                valid = _safe_col_order(payload.col_order)
                if valid is not None:
                    prefs["col_order"] = valid

        if "col_vis" in updated:
            if payload.col_vis is None:
                prefs.pop("col_vis", None)
            else:
                valid = _safe_col_vis(payload.col_vis)
                if valid is not None:
                    prefs["col_vis"] = valid

        if "col_widths" in updated:
            if payload.col_widths is None:
                prefs.pop("col_widths", None)
            else:
                valid = _safe_col_widths(payload.col_widths)
                if valid is not None:
                    prefs["col_widths"] = valid

        if "tree_layout" in updated:
            if payload.tree_layout is None:
                prefs.pop("tree_layout", None)
            else:
                valid = _safe_tree_layout(payload.tree_layout)
                if valid is not None:
                    prefs["tree_layout"] = valid
                else:
                    prefs.pop("tree_layout", None)

        record["prefs"] = prefs
        save_users(users)
    logger.info("user %s updated prefs (fields: %s)", user.username, updated)
    return _prefs_response(prefs)
