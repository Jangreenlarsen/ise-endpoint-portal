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


# PxGrid 2.0 (3.0.0) — separate settings namespace so it can be enabled
# independently of ISE/ERS connection. cert paths are filesystem paths,
# not the cert content itself; upload happens via POST /api/settings/pxgrid/cert.
PxGridCertMode = Literal["upload", "csr"]


class PxGridSettingsUpdate(BaseModel):
    pxgrid_enabled: bool = False
    pxgrid_node_name: str = "hypervision-portal"
    pxgrid_psn_fqdn: str = ""
    pxgrid_cert_mode: PxGridCertMode = "upload"
    pxgrid_cert_path: str = ""
    pxgrid_key_path: str = ""
    pxgrid_ca_bundle_path: str = ""
    pxgrid_password: str = ""


class PxGridSettingsResponse(BaseModel):
    pxgrid_enabled: bool
    pxgrid_node_name: str
    pxgrid_psn_fqdn: str
    pxgrid_cert_mode: PxGridCertMode
    pxgrid_cert_path: str
    pxgrid_key_path: str
    pxgrid_ca_bundle_path: str
    pxgrid_password_set: bool = Field(..., description="true if a secret is stored")
    cert_status: str = Field(
        ...,
        description=(
            "'ok' if cert+key files exist and are readable; 'missing' if paths "
            "are empty or files not found; 'error: <msg>' on parse failure."
        ),
    )


class PxGridStatusResponse(BaseModel):
    """Live runtime state of the pxGrid client (separate from settings)."""

    enabled: bool
    account_state: str = Field(
        ..., description="'ENABLED', 'PENDING', 'DISABLED', 'UNKNOWN'"
    )
    services: list[str] = Field(
        default_factory=list,
        description="Topics the portal is currently subscribed to.",
    )
    last_error: str = ""
    psn_fqdn: str = ""


class PxGridTestResponse(BaseModel):
    ok: bool
    step: str = Field(
        ...,
        description=(
            "Which step succeeded/failed: 'cert_load', 'tls_handshake', "
            "'service_lookup', 'access_secret'."
        ),
    )
    message: str
    latency_ms: int | None = None
    services_found: list[str] = Field(default_factory=list)


class PxGridAccountCreateResponse(BaseModel):
    """Result of POST /api/settings/pxgrid/account (csr mode only)."""

    ok: bool
    node_name: str
    account_state: str
    password_received: bool = Field(
        ..., description="true if AccessSecretCreate returned a secret"
    )
    message: str
