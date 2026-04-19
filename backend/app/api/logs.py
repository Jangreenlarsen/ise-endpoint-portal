import re
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import require_admin
from app.core.config import settings

router = APIRouter(tags=["logs"], dependencies=[Depends(require_admin)])

LINE_RE = re.compile(
    r"^(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \| "
    r"(?P<level>\S+)\s*\| "
    r"(?P<logger>[^|]+?) \| "
    r"(?P<message>.*)$"
)

LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


def _parse(line: str) -> dict | None:
    m = LINE_RE.match(line.rstrip("\n"))
    if not m:
        return None
    d = m.groupdict()
    d["logger"] = d["logger"].strip()
    return d


@router.get("/logs")
async def get_logs(
    lines: int = Query(500, ge=1, le=5000),
    level: str | None = Query(None),
    search: str | None = Query(None),
) -> dict:
    log_path = Path(settings.log_file)
    if not log_path.is_absolute():
        log_path = Path.cwd() / log_path

    if not log_path.exists():
        return {"entries": [], "total_lines": 0, "path": str(log_path)}

    wanted_level = level.upper() if level else None
    if wanted_level and wanted_level not in LEVELS:
        raise HTTPException(status_code=400, detail=f"Invalid level: {level}")

    needle = search.lower() if search else None

    try:
        with log_path.open("r", encoding="utf-8", errors="replace") as f:
            tail = deque(f, maxlen=lines * 4 if (wanted_level or needle) else lines)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot read log: {e}") from e

    entries: list[dict] = []
    for raw in tail:
        parsed = _parse(raw)
        if not parsed:
            if entries:
                entries[-1]["message"] += "\n" + raw.rstrip("\n")
            continue
        if wanted_level and parsed["level"] != wanted_level:
            continue
        if needle and needle not in raw.lower():
            continue
        entries.append(parsed)

    entries.reverse()
    if len(entries) > lines:
        entries = entries[:lines]

    return {
        "entries": entries,
        "returned": len(entries),
        "path": str(log_path),
    }
