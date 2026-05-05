import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app.core.config import settings

# Backend-rodmappen (to niveauer op fra denne fil: core/ → app/ → backend/)
_BACKEND_DIR = Path(__file__).resolve().parents[2]


def setup_logging() -> None:
    log_path = Path(settings.log_file)
    # Gør relative stier absolutte ift. backend-mappen, ikke CWD.
    # Uvicorn startes typisk fra projektroden, ikke backend-mappen, så
    # "logs/app.log" ville ellers havne i projektroden.
    if not log_path.is_absolute():
        log_path = _BACKEND_DIR / log_path
    log_path.parent.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())

    has_file = any(isinstance(h, RotatingFileHandler) for h in root.handlers)
    if not has_file:
        fh = RotatingFileHandler(
            log_path, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
        )
        fh.setFormatter(formatter)
        root.addHandler(fh)

    has_stream = any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
        for h in root.handlers
    )
    if not has_stream:
        sh = logging.StreamHandler()
        sh.setFormatter(formatter)
        root.addHandler(sh)
