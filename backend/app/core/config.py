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
    ise_cb_failure_threshold: int = Field(
        default=5,
        description=(
            "Antal på hinanden følgende request-fejl (transport-niveau) der "
            "tripper circuit-breakeren til OPEN. En 'fejl' er en request der "
            "udtømmer alle ise_retry_attempts."
        ),
    )
    ise_cb_recovery_timeout_s: float = Field(
        default=60.0,
        description=(
            "Sekunder i OPEN-tilstand inden circuit-breakeren skifter til "
            "HALF_OPEN og tillader én probe-request igennem. "
            "Sæt lavt (30s) for hurtig recovery, højt (120s) for konservativ."
        ),
    )
    rate_limit_per_minute: int = Field(
        default=200,
        description=(
            "Max API-requests pr. IP pr. minut. 0 = deaktiveret. "
            "Gælder kun /api/-stier. Returnerer 429 ved overskridelse."
        ),
    )
    ise_max_connections: int = Field(
        default=10,
        description=(
            "Max antal samtidige HTTP-forbindelser til ISE. ISE ERS accepterer "
            "ca. 5-10 samtidige — over denne grænse ses connection-reset. "
            "10 er sikkert maksimum; 5 er konservativt."
        ),
    )
    ise_retry_attempts: int = Field(
        default=3,
        description=(
            "Antal genforsøg ved ISE transport-fejl (timeout, connection reset). "
            "Gælder ikke 4xx/5xx HTTP-svar. 0 = ingen retry."
        ),
    )

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
    cache_disk_path: str = Field(
        default="cache/endpoints.json",
        description=(
            "Sti til disk-cache JSON-fil (relativ til backend/). Indeholder "
            "alle endpoint-details fra seneste fulde pre-warm scan så portalen "
            "kan vise data øjeblikkeligt ved genstart. Tom streng = deaktiveret."
        ),
    )
    cache_max_entries: int = Field(
        default=5000,
        description=(
            "Max antal endpoint-entries i in-memory cachen. Når grænsen nås "
            "evictes ældste (FIFO) entries ved næste put_detail. "
            "0 = ubegrænset (default-adfærd frem til 3.17.0). "
            "5000 entries ≈ 37 MB ved ~7,5 KB/endpoint."
        ),
    )
    cache_prewarm_concurrency: int = Field(
        default=5,
        description=(
            "Antal parallelle ISE-kald under baggrunds pre-warm scan. "
            "ISE ERS accepterer ca. 5 samtidige forbindelser pr. klient — "
            "overskridelse medfører connection-reset fejl. 3-5 anbefales."
        ),
    )
    bulk_create_concurrency: int = Field(
        default=3,
        description=(
            "Antal samtidige ISE-kald under bulk create/import. "
            "Kombineret med ~100ms ISE-svartid giver 3 parallelle kald ≈ 10 req/s — "
            "inden for Cisco's 5-10 req/s grænse. Øg kun med eksplicit ISE-godkendelse."
        ),
    )
    cache_prewarm_interval_s: float = Field(
        default=1800.0,
        description=(
            "Interval i sekunder mellem hele pre-warm scans (default 30 min). "
            "0 = kun ét scan ved startup. Pre-warm sørger for at cachen "
            "forbliver varm selvom brugere ikke aktivt browser."
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
    pxgrid_stomp_recv_timeout_s: float = Field(
        default=600.0,
        description=(
            "Maks ventetid i sekunder på en STOMP-frame (MESSAGE, heartbeat o.l.). "
            "WebSocket ping/pong (ping_interval=20, ping_timeout=10) detekterer "
            "dead TCP inden for 30s — denne timeout er kun backstop mod en broker "
            "der er alive på TCP-niveau men sender ingenting. ISE pxGrid broker "
            "kan sagtens have >120s stille perioder, så default er 600s."
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
        description=(
            "STOMP destination for endpoint-events. Bruges som fallback hvis "
            "ServiceLookup ikke returnerer en eksplicit 'topic'-property på "
            "den fundne service-node."
        ),
    )
    pxgrid_endpoint_service: str = Field(
        default="com.cisco.ise.endpoint",
        description=(
            "ISE pxGrid-service navn der ServiceLookup'es for endpoint CRUD-"
            "events. Hvis denne ikke eksisterer på din ISE-version, prøv "
            "'com.cisco.ise.config.profiler' eller 'com.cisco.ise.endpoint.asset'."
        ),
    )

    # PSK-politik (3.11.0) — validerings-regler for MPSK/IPSK nøgler.
    psk_type: str = Field(default="MPSK", description="PSK mode-type: MPSK eller IPSK.")
    psk_show_key_in_table: bool = Field(default=False, description="Vis PSK Key i klartekst i browse-tabellen.")
    psk_min_length: int = Field(default=8, description="Minimum PSK-nøgle længde.")
    psk_require_uppercase: bool = Field(default=False, description="Kræv mindst ét stort bogstav.")
    psk_require_numbers: bool = Field(default=False, description="Kræv mindst ét tal.")
    psk_require_special: bool = Field(default=False, description="Kræv mindst ét specialtegn.")

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
