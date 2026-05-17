"""Portal-opdaterings API (kun admin)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from app.api.deps import require_admin
from app.services import update_service

router = APIRouter(prefix="/update", tags=["update"])


@router.post("/validate")
async def validate_update(
    file: UploadFile = File(...),
    _user=Depends(require_admin),
) -> dict:
    """Validér en opdateringspakke uden at anvende den.

    Returnerer pakkens version, antal filer, blokerede stier og fejl.
    """
    data = await file.read()
    if len(data) > update_service.MAX_ZIP_BYTES:
        raise HTTPException(status_code=413, detail="Pakken er for stor (max 100 MB)")
    return update_service.validate_package(data)


@router.post("/apply")
async def apply_update(
    file: UploadFile = File(...),
    _user=Depends(require_admin),
) -> dict:
    """Validér og anvend en opdateringspakke.

    Filer skrives til disk øjeblikkeligt. Frontend-ændringer træder i kraft
    med det samme (næste browser-request). Backend-ændringer kræver genstart.
    """
    data = await file.read()
    if len(data) > update_service.MAX_ZIP_BYTES:
        raise HTTPException(status_code=413, detail="Pakken er for stor (max 100 MB)")
    result = update_service.apply_package(data)
    if not result["ok"] and result["applied_count"] == 0:
        raise HTTPException(status_code=422, detail={"errors": result["errors"]})
    return result


@router.get("/github-check")
async def github_check(_user=Depends(require_admin)) -> dict:
    """Tjek om der er en ny version på GitHub. Caches i 1 time."""
    return await update_service.check_github_version()


@router.post("/github-pull")
async def github_pull(_user=Depends(require_admin)) -> dict:
    """Kør git pull origin main i projektroden.

    Kræver at serveren er et git-repo (git init + remote sat op).
    """
    result = await update_service.git_pull()
    if not result["ok"]:
        raise HTTPException(
            status_code=500,
            detail=result["stderr"] or "git pull fejlede",
        )
    return result


@router.post("/restart")
async def restart_server(_user=Depends(require_admin)) -> dict:
    """Planlæg server-genstart om 2.5 sekunder.

    Kræver at START.bat kører i en loop for automatisk genstart.
    """
    await update_service.schedule_restart()
    return {"ok": True, "message": "Server genstarter om få sekunder..."}
