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
from app.core.user_store import find_by_id, load_users, save_users
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
    return SavedViewsResponse(
        views=[SavedView(**v) for v in _get_views(record)],
        max_views=MAX_VIEWS_PER_USER,
    )


@router.post("/views", response_model=SavedView, status_code=status.HTTP_201_CREATED)
async def create_my_view(
    payload: SavedViewCreate,
    user: User = Depends(get_current_user),
) -> SavedView:
    users = load_users()
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


@router.get("/prefs", response_model=UserPrefs)
async def get_my_prefs(user: User = Depends(get_current_user)) -> UserPrefs:
    if user.id.startswith("tacacs:"):
        return UserPrefs(language=None)
    users = load_users()
    record = find_by_id(users, user.id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
    lang = record.get("prefs", {}).get("language")
    if lang not in _VALID_LANGUAGES:
        lang = None
    return UserPrefs(language=lang)  # type: ignore[arg-type]


@router.put("/prefs", response_model=UserPrefs)
async def update_my_prefs(
    payload: UserPrefs,
    user: User = Depends(get_current_user),
) -> UserPrefs:
    if user.id.startswith("tacacs:"):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(
            status.HTTP_403_FORBIDDEN,
            "TACACS+-brugere kan ikke gemme præferencer server-side — indstillingen gemmes lokalt i browseren",
        )
    users = load_users()
    record = find_by_id(users, user.id)
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bruger ikke fundet")
    prefs = record.get("prefs") or {}
    if payload.language is None:
        prefs.pop("language", None)
    elif payload.language in _VALID_LANGUAGES:
        prefs["language"] = payload.language
    record["prefs"] = prefs
    save_users(users)
    logger.info("user %s updated prefs: %s", user.username, prefs)
    lang = prefs.get("language")
    if lang not in _VALID_LANGUAGES:
        lang = None
    return UserPrefs(language=lang)  # type: ignore[arg-type]
