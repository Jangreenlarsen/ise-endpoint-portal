from typing import Literal

from pydantic import BaseModel, Field

AuthMode = Literal["local", "tacacs"]


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
    cache_disk_path: str = "cache/endpoints.json"
    cache_prewarm_concurrency: int = 5
    cache_prewarm_interval_s: float = 1800.0


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
    cache_disk_path: str = "cache/endpoints.json"
    cache_prewarm_concurrency: int = 5
    cache_prewarm_interval_s: float = 1800.0


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
    pxgrid_cert_extra_sans: str = ""
    pxgrid_session_topic: str = "/topic/com.cisco.ise.session"
    pxgrid_stomp_heartbeat_ms: int = 30000
    pxgrid_stomp_reconnect_min_s: float = 1.0
    pxgrid_stomp_reconnect_max_s: float = 300.0
    pxgrid_session_cache_max_age_s: float = 0.0
    pxgrid_worker_enabled: bool = True
    pxgrid_endpoint_topic_enabled: bool = False
    pxgrid_endpoint_topic: str = "/topic/com.cisco.ise.endpoint"
    pxgrid_endpoint_service: str = "com.cisco.ise.endpoint"


class PxGridSettingsResponse(BaseModel):
    pxgrid_enabled: bool
    pxgrid_node_name: str
    pxgrid_psn_fqdn: str
    pxgrid_cert_mode: PxGridCertMode
    pxgrid_cert_path: str
    pxgrid_key_path: str
    pxgrid_ca_bundle_path: str
    pxgrid_password_set: bool = Field(..., description="true if a secret is stored")
    pxgrid_cert_extra_sans: str = ""
    pxgrid_session_topic: str = "/topic/com.cisco.ise.session"
    pxgrid_stomp_heartbeat_ms: int = 30000
    pxgrid_stomp_reconnect_min_s: float = 1.0
    pxgrid_stomp_reconnect_max_s: float = 300.0
    pxgrid_session_cache_max_age_s: float = 0.0
    pxgrid_worker_enabled: bool = True
    pxgrid_endpoint_topic_enabled: bool = False
    pxgrid_endpoint_topic: str = "/topic/com.cisco.ise.endpoint"
    pxgrid_endpoint_service: str = "com.cisco.ise.endpoint"
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


class PxGridStompProbeResponse(BaseModel):
    """Result of POST /api/settings/pxgrid/stomp-probe.

    Diagnostik-værktøj der subscriber kortvarigt til pubsub-topic'et og
    rapporterer hvor mange events der kom — bruges til at verificere at
    WebSocket+STOMP-laget virker før vi bygger persistent worker oven på.
    """

    ok: bool
    step: str = Field(
        ...,
        description=(
            "Hvor langt vi nåede: 'config', 'cert_load', 'service_lookup', "
            "'access_secret', 'ws_connect', 'stomp_connect', 'stomp_subscribe', "
            "'complete'."
        ),
    )
    duration_s: float
    messages_received: int = 0
    sample_payloads: list[str] = Field(
        default_factory=list,
        description="Op til 3 første MESSAGE-bodies (trunkeret til 1 KB hver).",
    )
    ws_url: str = ""
    peer_node: str = ""
    error: str = ""


class PxGridSessionInfoResponse(BaseModel):
    """En enkelt cached session — read-only snapshot fra worker."""

    mac: str
    state: str = ""
    audit_session_id: str = ""
    nas_ip: str = ""
    user_name: str = ""
    policy_set_name: str = ""
    authz_profiles: list[str] = Field(default_factory=list)
    authz_rule_name: str = ""
    use_case: str = ""
    nas_name: str = ""
    nas_device_type: str = ""
    last_event_at: float = 0.0


class PxGridSessionsResponse(BaseModel):
    sessions: list[PxGridSessionInfoResponse] = Field(default_factory=list)
    total: int = 0
    cache_stats: dict = Field(default_factory=dict)


class PxGridWorkerStatusResponse(BaseModel):
    """Live runtime-state fra den persistente STOMP-worker."""

    running: bool
    connected: bool
    peer_node: str = ""
    ws_url: str = ""
    started_at: float = 0.0
    last_connect_at: float = 0.0
    last_disconnect_at: float = 0.0
    last_event_at: float = 0.0
    last_error: str = ""
    reconnect_count: int = 0
    messages_total: int = 0
    subscribed_topic: str = ""
    subscribed_topics: list[str] = Field(default_factory=list)
    session_events_total: int = 0
    endpoint_events_total: int = 0
    endpoint_lookup_service: str = ""
    endpoint_lookup_props: dict = Field(default_factory=dict)
    cache_size: int = 0


class PortalLocaleUpdate(BaseModel):
    default_language: Literal["da", "en"] = "en"


class PortalLocaleResponse(BaseModel):
    default_language: Literal["da", "en"]


class PskPolicy(BaseModel):
    """PSK-nøgle politik — validerings-regler for MPSK/IPSK PSK Key attributten."""

    psk_type: str = Field(default="MPSK", description="PSK mode: 'MPSK' eller 'IPSK'. IPSK tilføjer automatisk 'psk='-prefix i ISE.")
    show_key_in_table: bool = Field(default=False, description="Vis PSK Key i klartekst i browse-tabellen. False = vis ****** (standard).")
    min_length: int = Field(default=8, ge=8, le=128, description="Minimum nøgle-længde (min. 8).")
    require_uppercase: bool = Field(default=False, description="Kræv mindst ét stort bogstav.")
    require_numbers: bool = Field(default=False, description="Kræv mindst ét tal.")
    require_special: bool = Field(default=False, description="Kræv mindst ét specialtegn (!@#$%^&* m.fl.).")


class GeneratedPskKey(BaseModel):
    key: str


class PxGridResetResponse(BaseModel):
    """Result of POST /api/settings/pxgrid/reset.

    Nulstiller portal-side registrerings-state: cert/key/CA-paths,
    gemt password og fysiske PEM-filer på disk. Beholder config-niveau
    indstillinger (enabled, node_name, psn_fqdn, cert_mode) så admin
    kan starte registreringen forfra uden at miste opsætningen.
    """

    ok: bool
    files_deleted: list[str] = Field(default_factory=list)
    message: str


# ── Portal Auth Config (TACACS+) ─────────────────────────────────────────────


class PortalAuthConfigUpdate(BaseModel):
    """Payload for PUT /api/settings/auth-config."""

    auth_mode: AuthMode = "local"
    tacacs_server_host: str = ""
    tacacs_server_port: int = Field(default=49, ge=1, le=65535)
    tacacs_secret: str = ""
    tacacs_timeout_seconds: int = Field(default=5, ge=1, le=60)
    tacacs_fallback_to_local: bool = True
    tacacs_operator_profile_attribute: str = "portal-operator-profile"


class PortalAuthConfigResponse(BaseModel):
    """Response for GET /api/settings/auth-config — secret is masked."""

    auth_mode: AuthMode
    tacacs_server_host: str
    tacacs_server_port: int
    tacacs_secret_set: bool = Field(..., description="true hvis en shared secret er gemt")
    tacacs_timeout_seconds: int
    tacacs_fallback_to_local: bool
    tacacs_operator_profile_attribute: str


class TacacsTestRequest(BaseModel):
    """Payload for POST /api/settings/auth-config/test."""

    username: str
    password: str
    server_host: str | None = None
    server_port: int | None = None
    secret: str | None = None
    timeout_seconds: int | None = None


class TacacsTestResponse(BaseModel):
    ok: bool
    message: str
    operator_profile: str | None = None
