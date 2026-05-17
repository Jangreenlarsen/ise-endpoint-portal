# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
from typing import Any


class IseApiError(RuntimeError):
    """Raised when the Cisco ISE REST API returns an error response."""

    def __init__(self, status_code: int, message: str, payload: Any | None = None) -> None:
        super().__init__(f"ISE API {status_code}: {message}")
        self.status_code = status_code
        self.payload = payload
