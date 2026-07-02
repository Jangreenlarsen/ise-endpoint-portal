# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import json as _json
import re
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.deps import require_admin
from app.core.config import settings
from app.core.version import FULL as APP_VERSION

router = APIRouter(tags=["logs"], dependencies=[Depends(require_admin)])

_BACKEND_DIR = Path(__file__).resolve().parents[2]

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


def _resolve_log_path() -> Path:
    log_path = Path(settings.log_file)
    if not log_path.is_absolute():
        log_path = _BACKEND_DIR / log_path
    return log_path


def _all_log_files(log_path: Path) -> list[Path]:
    """Returnér alle logfiler i kronologisk rækkefølge, ældste først (.3 → .log)."""
    files = []
    for suffix in [".3", ".2", ".1", ""]:
        p = Path(str(log_path) + suffix) if suffix else log_path
        if p.exists():
            files.append(p)
    files.reverse()
    return files


# ── GET /logs ─────────────────────────────────────────────────────────────────

@router.get("/logs")
async def get_logs(
    lines: int = Query(500, ge=1, le=5000),
    level: str | None = Query(None),
    search: str | None = Query(None),
) -> dict:
    """Hent de seneste log-linjer fra aktuel app.log."""
    log_path = _resolve_log_path()
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


# ── GET /logs/export ──────────────────────────────────────────────────────────

@router.get("/logs/export")
async def export_logs(
    format: str = Query("text", pattern="^(text|ndjson)$"),
) -> StreamingResponse:
    """Download alle logfiler (inkl. roterede) kombineret i kronologisk rækkefølge.

    format=text  → rå loglinjer med version/URL-header (standard, let at læse)
    format=ndjson → én JSON-objekt per linje; første linje er metadata-record
    """
    log_path = _resolve_log_path()
    files = _all_log_files(log_path)
    if not files:
        raise HTTPException(status_code=404, detail="Ingen logfiler fundet")

    now_str = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    exported_at = datetime.now(timezone.utc).isoformat()
    ext = "ndjson" if format == "ndjson" else "log"
    filename = f"hypervision-{APP_VERSION}-{now_str}.{ext}"

    if format == "ndjson":
        def _iter_ndjson():
            meta = {
                "_meta": True,
                "app": "HyperVision ISE Portal",
                "url": "https://hypervision.ll.lan",
                "version": APP_VERSION,
                "exported_at": exported_at,
                "files": [f.name for f in files],
            }
            yield _json.dumps(meta, ensure_ascii=False) + "\n"
            for f in files:
                try:
                    with f.open("r", encoding="utf-8", errors="replace") as fh:
                        for raw in fh:
                            parsed = _parse(raw)
                            if parsed:
                                yield _json.dumps(parsed, ensure_ascii=False) + "\n"
                except OSError:
                    pass

        return StreamingResponse(
            _iter_ndjson(),
            media_type="application/x-ndjson",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # format=text
    file_names = ", ".join(f.name for f in files)
    total_kb = sum(f.stat().st_size for f in files) // 1024
    header = (
        f"# ============================================================\n"
        f"# HyperVision ISE Portal — Log Export\n"
        f"# Version  : {APP_VERSION}\n"
        f"# System   : https://hypervision.ll.lan\n"
        f"# Eksporteret: {exported_at}\n"
        f"# Filer    : {file_names} ({total_kb} KB samlet)\n"
        f"# Format   : TIMESTAMP | LEVEL | logger | message\n"
        f"# ============================================================\n"
        f"#\n"
    )

    def _iter_text():
        yield header
        for f in files:
            size_kb = f.stat().st_size // 1024
            yield f"\n# === {f.name} ({size_kb} KB) ===\n"
            try:
                with f.open("r", encoding="utf-8", errors="replace") as fh:
                    yield from fh
            except OSError:
                yield f"# (kunne ikke læse {f.name})\n"

    return StreamingResponse(
        _iter_text(),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── GET /logs/summary ─────────────────────────────────────────────────────────

@router.get("/logs/summary")
async def get_logs_summary() -> dict:
    """Aggregeret log-analyse på tværs af alle roterede logfiler.

    Returnerer struktureret baseline-rapport til system-kvalitetsanalyse:
    - level-fordeling, top-fejl-beskeder, top-loggers
    - circuit breaker events-tidslinje
    - transport-fejl-statistik (exception-type, idle-tid)
    - startup-events (versionhistorik i loggen)
    - per-time breakdown (seneste 48 timer af tilgængelige data)
    """
    log_path = _resolve_log_path()
    files = _all_log_files(log_path)
    if not files:
        return {"error": "Ingen logfiler fundet"}

    level_counts: Counter = Counter()
    logger_issue_counts: Counter = Counter()
    message_counts: Counter = Counter()
    cb_events: list[dict] = []
    transport_errors: list[dict] = []
    startup_events: list[dict] = []
    per_hour: dict[str, Counter] = defaultdict(Counter)
    ise_outcomes: Counter = Counter()   # 2xx / 4xx / 5xx / error
    drip_stats: Counter = Counter()     # refreshed / skipped
    total_lines = 0
    first_ts: str | None = None
    last_ts: str | None = None

    _CB_OPEN   = re.compile(r"circuit.?breaker[:\s]+OPEN",       re.I)
    _CB_CLOSE  = re.compile(r"circuit.?breaker[:\s]+CLOSED",     re.I)
    _CB_HALF   = re.compile(r"circuit.?breaker[:\s]+HALF.?OPEN", re.I)
    _TRANSPORT = re.compile(
        r"transport error on .+?:.+?\((\w+)\).+?\[idle_before=([\d.]+)s\]"
    )
    _ISE_OUT   = re.compile(r"ISE\s+\w+\s+/[^\s]+\s+->\s+(\d{3})")
    _STARTUP   = re.compile(r"HyperVision ISE Portal\s+v?([\d]+\.[\d]+(?:\.[\d]+)?)")
    _DRIP_REF  = re.compile(r"drip: refreshed", re.I)
    _DRIP_SKIP = re.compile(r"drip.*skip|CACHE_DRIP_SKIPPED", re.I)
    _UUID      = re.compile(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I
    )
    _IP        = re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")
    _LONGNUM   = re.compile(r"\b\d{4,}\b")

    for f in files:
        try:
            with f.open("r", encoding="utf-8", errors="replace") as fh:
                for raw in fh:
                    total_lines += 1
                    parsed = _parse(raw.rstrip("\n"))
                    if not parsed:
                        continue
                    ts  = parsed["timestamp"]
                    lvl = parsed["level"]
                    lgr = parsed["logger"]
                    msg = parsed["message"]

                    if first_ts is None:
                        first_ts = ts
                    last_ts = ts

                    level_counts[lvl] += 1
                    per_hour[ts[:13]][lvl] += 1

                    # Warnings / errors → normalisér besked til dedup
                    if lvl in ("WARNING", "ERROR", "CRITICAL"):
                        logger_issue_counts[lgr] += 1
                        norm = _LONGNUM.sub(
                            "<N>", _IP.sub("<ip>", _UUID.sub("<uuid>", msg))
                        )[:130]
                        message_counts[norm] += 1

                    # Circuit breaker events
                    low = msg.lower()
                    if "circuit" in low and "breaker" in low:
                        if _CB_OPEN.search(msg):
                            cb_events.append({
                                "ts": ts, "event": "OPEN", "detail": msg[:200]
                            })
                        elif _CB_CLOSE.search(msg):
                            cb_events.append({
                                "ts": ts, "event": "CLOSED", "detail": msg[:200]
                            })
                        elif _CB_HALF.search(msg):
                            cb_events.append({
                                "ts": ts, "event": "HALF_OPEN", "detail": msg[:200]
                            })

                    # Transport errors (idle-tid + exception-type)
                    m = _TRANSPORT.search(msg)
                    if m:
                        transport_errors.append({
                            "ts": ts,
                            "exc_type": m.group(1),
                            "idle_before_s": float(m.group(2)),
                        })

                    # ISE HTTP outcomes
                    m2 = _ISE_OUT.search(msg)
                    if m2:
                        code = int(m2.group(1))
                        bucket = "2xx" if code < 300 else "4xx" if code < 500 else "5xx"
                        ise_outcomes[bucket] += 1
                    if "transport error" in low:
                        ise_outcomes["error"] += 1

                    # Drip stats
                    if _DRIP_REF.search(msg):
                        drip_stats["refreshed"] += 1
                    elif _DRIP_SKIP.search(msg):
                        drip_stats["skipped"] += 1

                    # Startup/version markers
                    m3 = _STARTUP.search(msg)
                    if m3 and ("start" in low or "===" in msg):
                        startup_events.append({"ts": ts, "version": m3.group(1)})
        except OSError:
            pass

    # Transport error aggregation
    idle_times = [e["idle_before_s"] for e in transport_errors]
    exc_type_counts: Counter = Counter(e["exc_type"] for e in transport_errors)

    # Hourly timeline — seneste 48 timers data
    sorted_hours = sorted(per_hour)[-48:]
    timeline = [
        {
            "hour": h,
            "errors":   per_hour[h].get("ERROR", 0) + per_hour[h].get("CRITICAL", 0),
            "warnings": per_hour[h].get("WARNING", 0),
            "infos":    per_hour[h].get("INFO", 0),
        }
        for h in sorted_hours
    ]

    drip_total = drip_stats["refreshed"] + drip_stats["skipped"]
    drip_eff_pct = (
        round(drip_stats["refreshed"] / drip_total * 100, 1) if drip_total > 0 else None
    )

    return {
        "meta": {
            "app": "HyperVision ISE Portal",
            "url": "https://hypervision.ll.lan",
            "current_version": APP_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "files_analyzed": [
                {"name": f.name, "size_kb": round(f.stat().st_size / 1024, 1)}
                for f in files
            ],
            "total_lines_analyzed": total_lines,
            "time_range": {"first": first_ts, "last": last_ts},
        },
        "level_counts": dict(level_counts.most_common()),
        "top_loggers_by_issues": dict(logger_issue_counts.most_common(20)),
        "top_issue_messages": [
            {"message": msg, "count": cnt}
            for msg, cnt in message_counts.most_common(30)
        ],
        "circuit_breaker": {
            "total_events": len(cb_events),
            "open_count":   sum(1 for e in cb_events if e["event"] == "OPEN"),
            "close_count":  sum(1 for e in cb_events if e["event"] == "CLOSED"),
            "events_recent": cb_events[-20:],
        },
        "transport_errors": {
            "total": len(transport_errors),
            "by_exception_type": dict(exc_type_counts.most_common()),
            "idle_before_s": {
                "min":        round(min(idle_times), 1)                      if idle_times else None,
                "max":        round(max(idle_times), 1)                      if idle_times else None,
                "avg":        round(sum(idle_times) / len(idle_times), 1)   if idle_times else None,
                "over_300s":  sum(1 for t in idle_times if t > 300),
                "over_1800s": sum(1 for t in idle_times if t > 1800),
            },
            "recent": transport_errors[-15:],
        },
        "ise_requests": {
            "outcomes": dict(ise_outcomes.most_common()),
        },
        "drip_refresh": {
            "total_refreshed": drip_stats["refreshed"],
            "total_skipped":   drip_stats["skipped"],
            "efficiency_pct":  drip_eff_pct,
        },
        "startup_events": startup_events,
        "hourly_timeline": timeline,
    }
