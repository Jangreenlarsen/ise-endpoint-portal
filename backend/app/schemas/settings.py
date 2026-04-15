from typing import Literal

from pydantic import BaseModel, Field


class BackendSettingsUpdate(BaseModel):
    """Payload for PUT /api/settings/backend.

    ise_password is write-only; if empty, the existing password is preserved.
    """

    ise_base_url: str
    ise_username: str
    ise_password: str = ""
    ise_verify_tls: bool = False
    ise_timeout: float = 30.0
    ise_api_type: Literal["ers", "openapi"] = "ers"


class BackendSettingsResponse(BaseModel):
    """Response for GET /api/settings/backend — password is masked."""

    ise_base_url: str
    ise_username: str
    ise_password_set: bool = Field(..., description="true if a password is stored")
    ise_verify_tls: bool
    ise_timeout: float
    ise_api_type: Literal["ers", "openapi"]
