from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.settings_store import load_overrides


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ise_base_url: str = Field(default="https://ise.example.local")
    ise_username: str = "ers-admin"
    ise_password: str = ""
    ise_verify_tls: bool = False
    ise_timeout: float = 30.0
    ise_api_type: str = Field(default="ers", description="'ers' or 'openapi'")

    # Change of Authorization (CoA) via MnT API
    # GET /admin/API/mnt/CoA/Reauth/{psn_name}/{mac}/{reauth_type}
    coa_psn_name: str = Field(
        default="",
        description=(
            "PSN hostname that issues the CoA. If empty, the host portion of "
            "ise_base_url is used as fallback."
        ),
    )
    coa_reauth_type: int = Field(
        default=1,
        description="0=DEFAULT, 1=RERUN, 2=LAST — 1 is standard for attribute changes.",
    )
    coa_disconnect_type: int = Field(
        default=0,
        description=(
            "0=DEFAULT (deauth — wireless), 1=PORT BOUNCE (wired), "
            "2=PORT SHUTDOWN (wired). Default 0 works for WLC deauth."
        ),
    )

    # Endpoint-cache (2.8.0) — serve repeat reads from memory and let
    # write-paths invalidate synchronously so next read is fresh.
    cache_enabled: bool = Field(
        default=True,
        description="Master switch for in-memory endpoint/group cache.",
    )
    cache_ttl_seconds: float = Field(
        default=60.0,
        description="Max age of a fresh cache entry before it needs revalidation.",
    )
    cache_stale_while_revalidate: bool = Field(
        default=True,
        description=(
            "If true, serve stale entries (up to 10x TTL) and spawn a background "
            "refresh instead of blocking the request."
        ),
    )
    cache_sync_interval_seconds: float = Field(
        default=300.0,
        description=(
            "How often the background worker revalidates cached detail entries. "
            "Set to 0 to disable the worker; cache still serves from memory."
        ),
    )

    # Audit log (2.9.0) — append-only event trail with rollback support.
    audit_enabled: bool = Field(
        default=True,
        description="Master switch for the audit log. Off = no events recorded.",
    )
    audit_retention_days: int = Field(
        default=90,
        description="How many days of audit events to keep. 0 = keep forever.",
    )

    # PxGrid 2.0 (3.0.0) — REST control plane + WebSocket/STOMP push subscription
    # for real-time session and endpoint events from ISE. Off by default;
    # graceful fallback to MnT poll + TTL cache when disabled or unreachable.
    pxgrid_enabled: bool = Field(
        default=False,
        description="Master switch for PxGrid integration.",
    )
    pxgrid_node_name: str = Field(
        default="hypervision-portal",
        description=(
            "Portal's identity registered with ISE. Becomes the pxGrid client name "
            "shown in 'pxGrid Services → Clients'. CSR-mode also uses this as CN."
        ),
    )
    pxgrid_psn_fqdn: str = Field(
        default="",
        description=(
            "FQDN of an ISE PSN that exposes pxGrid (port 8910). If empty, the "
            "host portion of ise_base_url is used as fallback."
        ),
    )
    pxgrid_cert_mode: str = Field(
        default="upload",
        description=(
            "Cert provisioning mode. 'upload' = admin uploads pre-issued client "
            "cert+key+CA bundle (paths below). 'csr' = portal generates CSR and "
            "registers via /pxgrid/control/AccountCreate, then ISE admin must "
            "approve in pxGrid Services."
        ),
    )
    pxgrid_cert_path: str = Field(
        default="",
        description=(
            "Path to client certificate PEM (upload mode) or written-out cert "
            "after CSR signing (csr mode). Relative paths resolve from backend/."
        ),
    )
    pxgrid_key_path: str = Field(
        default="",
        description="Path to client private key PEM (matches pxgrid_cert_path).",
    )
    pxgrid_ca_bundle_path: str = Field(
        default="",
        description=(
            "Path to PEM bundle of CAs that signed the ISE pxGrid server cert. "
            "Empty = use system CA store."
        ),
    )
    pxgrid_password: str = Field(
        default="",
        description=(
            "Account password returned from AccessSecretCreate (csr mode) or "
            "shared secret from ISE (upload mode if your ISE requires it). "
            "Write-only via PUT /api/settings/pxgrid; masked on GET."
        ),
    )
    pxgrid_cert_extra_sans: str = Field(
        default="",
        description=(
            "Komma-separeret liste af ekstra DNS-navne der inkluderes som "
            "SubjectAlternativeName:dNSName i CSR'en udover pxgrid_node_name. "
            "Best practice: tilføj portalens host-FQDN (f.eks. portal.ll.lan) så "
            "cert'et er fuldt spec-compliant pr. RFC 6125 / pxGrid 2.0. Tom = "
            "kun node_name i SAN (minimum-kravet for ISE 3.4-acceptance)."
        ),
    )

    # PxGrid Phase 2b (3.4.0) — persistent STOMP-worker tunables.
    pxgrid_session_topic: str = Field(
        default="/topic/com.cisco.ise.session",
        description=(
            "STOMP destination som worker subscriber til. Standard er "
            "session-topic'et; kan ændres til andre topics under fejlsøgning."
        ),
    )
    pxgrid_stomp_heartbeat_ms: int = Field(
        default=30000,
        description=(
            "Server-til-klient heart-beat interval i ms som vi annoncerer i "
            "STOMP CONNECT (cx,sx hvor sx er denne værdi). Broker forventes at "
            "sende mindst én byte hvert sx ms; ellers anses forbindelsen død. "
            "0 = ingen heart-beat (ikke anbefalet — hængende TCP detekteres ikke)."
        ),
    )
    pxgrid_stomp_reconnect_min_s: float = Field(
        default=1.0,
        description="Initial backoff ved reconnect (eksponentiel: min → max).",
    )
    pxgrid_stomp_reconnect_max_s: float = Field(
        default=300.0,
        description="Maks backoff cap (5 min default = balanceret idle-cost).",
    )
    pxgrid_session_cache_max_age_s: float = Field(
        default=0.0,
        description=(
            "Sessioner ældre end denne fjernes ved næste cache-touch. 0 = aldrig "
            "udløb (kun DISCONNECTED-events evictor). Brug fx 86400 (24t) til "
            "automatisk oprydning hvis disconnect-events bortfalder."
        ),
    )
    pxgrid_worker_enabled: bool = Field(
        default=True,
        description=(
            "Kør den persistente STOMP-worker. Sættes typisk samme som "
            "pxgrid_enabled, men kan slåes fra alene for at falde tilbage på "
            "MnT-poll uden at miste REST control plane."
        ),
    )
    # Phase 4 (3.6.0) — abonnér også på endpoint-topic så admin-ændringer
    # i ISE-GUI'en invaliderer 2.8.0 endpoint-cache i real-time.
    pxgrid_endpoint_topic_enabled: bool = Field(
        default=False,
        description=(
            "Subscribe også til com.cisco.ise.endpoint-topic. Når ON: "
            "endpoint-events fra ISE-admin invaliderer cache + pushes til "
            "frontend så Browse genindlæser rækken automatisk. Off = kun "
            "session-topic (auth-status). Opt-in fordi det øger event-volume."
        ),
    )
    pxgrid_endpoint_topic: str = Field(
        default="/topic/com.cisco.ise.endpoint",
        description="STOMP destination for endpoint-events.",
    )

    backend_cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://localhost:8000"]
    )
    log_level: str = "INFO"
    log_file: str = "logs/app.log"


def _load() -> Settings:
    base = Settings()  # type: ignore[call-arg]
    overrides = load_overrides()
    if overrides:
        return base.model_copy(update=overrides)
    return base


settings: Settings = _load()


def refresh_settings() -> Settings:
    """Reload settings from .env + config.json. Call after saving overrides."""
    global settings
    settings = _load()
    return settings
