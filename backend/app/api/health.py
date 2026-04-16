from fastapi import APIRouter

from app.core.version import BUILD, FULL, VERSION

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": VERSION, "build": BUILD, "full": FULL}
