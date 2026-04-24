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
    coa_psn_name: str = ""
    coa_reauth_type: int = 1
    coa_disconnect_type: int = 0
    cache_enabled: bool = True
    cache_ttl_seconds: float = 60.0
    cache_stale_while_revalidate: bool = True
    cache_sync_interval_seconds: float = 300.0


class BackendSettingsResponse(BaseModel):
    """Response for GET /api/settings/backend — password is masked."""

    ise_base_url: str
    ise_username: str
    ise_password_set: bool = Field(..., description="true if a password is stored")
    ise_verify_tls: bool
    ise_timeout: float
    ise_api_type: Literal["ers", "openapi"]
    coa_psn_name: str = ""
    coa_reauth_type: int = 1
    coa_disconnect_type: int = 0
    cache_enabled: bool = True
    cache_ttl_seconds: float = 60.0
    cache_stale_while_revalidate: bool = True
    cache_sync_interval_seconds: float = 300.0


class TestConnectionRequest(BaseModel):
    """Optional payload for POST /api/settings/test.

    Alle felter er valgfri — udeladte felter fallback til de aktive settings.
    Hvis `ise_password` er tom, bruges det gemte password.
    """

    ise_base_url: str | None = None
    ise_username: str | None = None
    ise_password: str = ""
    ise_verify_tls: bool | None = None
    ise_timeout: float | None = None
    ise_api_type: Literal["ers", "openapi"] | None = None


class TestConnectionResponse(BaseModel):
    ok: bool
    status_code: int | None = None
    message: str
    latency_ms: int | None = None
