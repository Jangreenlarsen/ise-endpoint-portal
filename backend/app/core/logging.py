# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app.core.config import settings

# Backend-rodmappen (to niveauer op fra denne fil: core/ → app/ → backend/)
_BACKEND_DIR = Path(__file__).resolve().parents[2]

# Redaktér kendte sensitive felter i log-beskeder (key=value og "key": "value" mønstre)
_SENSITIVE_PATTERN = re.compile(
    r'(?i)((?:password|ise_password|pxgrid_password|tacacs_secret|secret|token|auth_token|psk|api_key)\s*[=:]\s*)[^\s,}\]"\']+',
)
_SENSITIVE_QUOTED = re.compile(
    r'(?i)("(?:password|ise_password|pxgrid_password|tacacs_secret|secret|token|auth_token|psk|api_key)"\s*:\s*)"[^"]*"',
)


class _SensitiveDataFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        msg = _SENSITIVE_PATTERN.sub(r"\1***", msg)
        msg = _SENSITIVE_QUOTED.sub(r'\1"***"', msg)
        record.msg = msg
        record.args = ()
        return True


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
    root.addFilter(_SensitiveDataFilter())

    sw_logger = logging.getLogger("app.pxgrid.session_worker")
    if getattr(settings, "debug_pxgrid_sessions", False):
        sw_logger.setLevel(logging.DEBUG)
    else:
        sw_logger.setLevel(logging.NOTSET)

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
