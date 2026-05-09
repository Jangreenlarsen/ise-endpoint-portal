from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import require_admin, require_psk_editor
from app.pxgrid import cert_manager
from app.schemas.settings import (
    BackendSettingsResponse,
    BackendSettingsUpdate,
    GeneratedPskKey,
    PortalAuthConfigResponse,
    PortalAuthConfigUpdate,
    PskPolicy,
    PxGridAccountCreateResponse,
    PxGridResetResponse,
    PxGridSettingsResponse,
    PxGridSettingsUpdate,
    PxGridStatusResponse,
    PxGridStompProbeResponse,
    PxGridTestResponse,
    TacacsTestRequest,
    TacacsTestResponse,
    TestConnectionRequest,
    TestConnectionResponse,
)
from app.services import settings_service

router = APIRouter(
    prefix="/settings", tags=["settings"], dependencies=[Depends(require_admin)]
)


@router.get("/backend", response_model=BackendSettingsResponse)
async def read_backend_settings() -> BackendSettingsResponse:
    return settings_service.get_backend_settings()


@router.put("/backend", response_model=BackendSettingsResponse)
async def update_backend_settings(
    req: BackendSettingsUpdate,
) -> BackendSettingsResponse:
    return await settings_service.update_backend_settings(req)


@router.post("/test", response_model=TestConnectionResponse)
async def test_backend_connection(
    req: TestConnectionRequest,
) -> TestConnectionResponse:
    """Verify ISE reachability + credentials without saving."""
    return await settings_service.test_connection(req)


# ── PxGrid (3.0.0) ─────────────────────────────────────────────────────


@router.get("/pxgrid", response_model=PxGridSettingsResponse)
async def read_pxgrid_settings() -> PxGridSettingsResponse:
    return settings_service.get_pxgrid_settings()


@router.put("/pxgrid", response_model=PxGridSettingsResponse)
async def update_pxgrid_settings(
    req: PxGridSettingsUpdate,
) -> PxGridSettingsResponse:
    return await settings_service.update_pxgrid_settings(req)


@router.get("/pxgrid/status", response_model=PxGridStatusResponse)
async def read_pxgrid_status() -> PxGridStatusResponse:
    return settings_service.get_pxgrid_status()


@router.post("/pxgrid/test", response_model=PxGridTestResponse)
async def test_pxgrid_connection() -> PxGridTestResponse:
    """Walk cert → TLS → ServiceLookup. Reports which step failed."""
    return await settings_service.test_pxgrid_connection()


@router.post("/pxgrid/account", response_model=PxGridAccountCreateResponse)
async def create_pxgrid_account() -> PxGridAccountCreateResponse:
    """CSR-mode bootstrap: register portal with ISE pxGrid.

    After this call, an ISE admin must approve the client in
    Administration → pxGrid Services → Clients. Status flips to
    ENABLED on next /pxgrid/test once approved.
    """
    return await settings_service.pxgrid_account_create()


@router.post("/pxgrid/stomp-probe", response_model=PxGridStompProbeResponse)
async def stomp_probe(duration: float = 10.0) -> PxGridStompProbeResponse:
    """One-shot STOMP-subscription mod com.cisco.ise.session for diagnostik.

    Subscriber til topic'et i ``duration`` sekunder (1-60), counter
    MESSAGE-frames og returnerer op til 3 sample-payloads. Bruges til
    at verificere at WebSocket+STOMP-laget virker før vi bygger persistent
    worker ovenpå. Read-only og selvterminerende.
    """
    return await settings_service.pxgrid_stomp_probe(duration)


@router.post("/pxgrid/reset", response_model=PxGridResetResponse)
async def reset_pxgrid_registration() -> PxGridResetResponse:
    """Nulstil portal-side pxGrid-registrering så CSR-flowet kan køres forfra.

    Sletter cert/key/CA/CSR-filer fra ``backend/pxgrid/`` og rydder de
    tilhørende paths + gemt password fra settings. Beholder config-niveau
    felter (enabled, node_name, psn_fqdn, cert_mode). Idempotent.

    **Server-side reset er ikke fuldstændig** — admin skal stadig manuelt
    slette klient-entry'en i ISE → Administration → pxGrid Services →
    All Clients hvis de vil starte 100% rent. Reset er primært til når
    portalen er gået i hak (forkert cert uploadet, server-skifte,
    expired keys osv.).
    """
    return await settings_service.pxgrid_reset()


@router.post("/pxgrid/cert", response_model=PxGridSettingsResponse)
async def upload_pxgrid_cert(
    kind: str = Form(..., description="One of: cert, key, ca"),
    file: UploadFile = File(..., description="PEM file (-----BEGIN ...-----)"),
) -> PxGridSettingsResponse:
    """Upload mode: persist a PEM file under backend/pxgrid/ and update settings.

    Saves three separate files (one per call). Settings paths auto-update
    so the admin doesn't have to type them in. Use 'cert', 'key', or 'ca'
    as the kind parameter.
    """
    if kind not in {"cert", "key", "ca"}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Invalid kind '{kind}' — must be one of: cert, key, ca",
        )
    pem_bytes = await file.read()
    if not pem_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tom fil")
    current = settings_service.get_pxgrid_settings()
    if not current.pxgrid_node_name:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "pxgrid_node_name skal være sat — gem PxGrid-settings først",
        )
    try:
        out_path = cert_manager.save_uploaded_pem(
            kind, current.pxgrid_node_name, pem_bytes
        )
    except Exception as exc:  # PxGridCertError or anything cryptography raised
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    update = PxGridSettingsUpdate(
        pxgrid_enabled=current.pxgrid_enabled,
        pxgrid_node_name=current.pxgrid_node_name,
        pxgrid_psn_fqdn=current.pxgrid_psn_fqdn,
        pxgrid_cert_mode=current.pxgrid_cert_mode,
        pxgrid_cert_path=str(out_path) if kind == "cert" else current.pxgrid_cert_path,
        pxgrid_key_path=str(out_path) if kind == "key" else current.pxgrid_key_path,
        pxgrid_ca_bundle_path=(
            str(out_path) if kind == "ca" else current.pxgrid_ca_bundle_path
        ),
        pxgrid_password="",
    )
    return await settings_service.update_pxgrid_settings(update)


@router.get("/pxgrid/csr/download")
async def download_pxgrid_csr() -> FileResponse:
    """Stream the most recent CSR for the configured node back as a download.

    Saves the admin from having to SSH/RDP into the host to grab the file out
    of ``backend/pxgrid/``. 404 hvis CSR ikke er genereret endnu.
    """
    current = settings_service.get_pxgrid_settings()
    if not current.pxgrid_node_name:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "pxgrid_node_name skal være sat — gem PxGrid-settings først",
        )
    csr_path = cert_manager.csr_path_for(current.pxgrid_node_name)
    if not csr_path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Ingen CSR genereret endnu — kør POST /pxgrid/csr først",
        )
    return FileResponse(
        csr_path,
        media_type="application/x-pem-file",
        filename=csr_path.name,
    )


@router.post("/pxgrid/pfx", response_model=PxGridSettingsResponse)
async def upload_pxgrid_pfx(
    file: UploadFile = File(..., description="PKCS#12 bundle (.pfx / .p12)"),
    password: str = Form("", description="PFX password (tom hvis ingen)"),
) -> PxGridSettingsResponse:
    """Import en PKCS#12-bundle (typisk fra MS certsrv) og udpak til de tre
    PEM-filer portalen bruger til mTLS.

    Bundlet skal indeholde:
      - klient-certifikatet
      - den matchende private key (eksportér med "Yes, export private key")
      - valgfri CA-chain ("Include all certificates in path")

    Hvis CA-chain er med, sættes pxgrid_ca_bundle_path automatisk;
    ellers bevares den eksisterende værdi (admin kan så uploade CA-bundle
    separat via /pxgrid/cert kind=ca).
    """
    pfx_bytes = await file.read()
    if not pfx_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tom fil")
    current = settings_service.get_pxgrid_settings()
    if not current.pxgrid_node_name:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "pxgrid_node_name skal være sat — gem PxGrid-settings først",
        )
    try:
        cert_pem, key_pem, ca_pem = cert_manager.extract_pkcs12(pfx_bytes, password)
    except Exception as exc:  # PxGridCertError or anything cryptography raised
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    cert_path, key_path, ca_path = cert_manager.save_pkcs12_bundle(
        current.pxgrid_node_name, cert_pem, key_pem, ca_pem
    )
    update = PxGridSettingsUpdate(
        pxgrid_enabled=current.pxgrid_enabled,
        pxgrid_node_name=current.pxgrid_node_name,
        pxgrid_psn_fqdn=current.pxgrid_psn_fqdn,
        pxgrid_cert_mode=current.pxgrid_cert_mode,
        pxgrid_cert_path=str(cert_path),
        pxgrid_key_path=str(key_path),
        pxgrid_ca_bundle_path=(
            str(ca_path) if ca_path else current.pxgrid_ca_bundle_path
        ),
        pxgrid_password="",
    )
    return await settings_service.update_pxgrid_settings(update)


@router.post("/pxgrid/csr", response_model=PxGridSettingsResponse)
async def generate_pxgrid_csr() -> PxGridSettingsResponse:
    """Generate a fresh keypair + CSR, persist to backend/pxgrid/.

    Returns updated settings (key path is set; cert path stays empty until
    the admin downloads the signed cert from ISE and uploads it via
    /pxgrid/cert with kind=cert). The CSR file lives on disk for manual
    submission to the ISE internal CA via Administration → pxGrid Services.

    Generation itself is mode-agnostic and non-destructive (writes new
    files under backend/pxgrid/) — admin can call this even when nominally
    in upload-mode, e.g. to switch over later.
    """
    current = settings_service.get_pxgrid_settings()
    if not current.pxgrid_node_name:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "pxgrid_node_name skal være sat — gem PxGrid-settings først",
        )
    extra_sans = [
        s for s in (current.pxgrid_cert_extra_sans or "").split(",") if s.strip()
    ]
    csr_pem, key_pem = cert_manager.generate_csr(
        current.pxgrid_node_name, extra_sans=extra_sans
    )
    key_path, _csr_path = cert_manager.persist_csr_artifacts(
        current.pxgrid_node_name, csr_pem, key_pem
    )
    update = PxGridSettingsUpdate(
        pxgrid_enabled=current.pxgrid_enabled,
        pxgrid_node_name=current.pxgrid_node_name,
        pxgrid_psn_fqdn=current.pxgrid_psn_fqdn,
        pxgrid_cert_mode=current.pxgrid_cert_mode,
        pxgrid_cert_path=current.pxgrid_cert_path,
        pxgrid_key_path=str(key_path),
        pxgrid_ca_bundle_path=current.pxgrid_ca_bundle_path,
        pxgrid_password="",
        pxgrid_cert_extra_sans=current.pxgrid_cert_extra_sans,
    )
    return await settings_service.update_pxgrid_settings(update)


# ── PSK-politik (3.11.0) ────────────────────────────────────────────────
# Separat router uden require_admin så editor-psk-rollen kan tilgå PSK-endpoints.
# Monteres på samme /settings-prefix i main.py.

psk_router = APIRouter(
    prefix="/settings", tags=["settings"], dependencies=[Depends(require_psk_editor)]
)


@psk_router.get("/psk-policy", response_model=PskPolicy)
async def read_psk_policy() -> PskPolicy:
    return settings_service.get_psk_policy()


@psk_router.put("/psk-policy", response_model=PskPolicy)
async def update_psk_policy(req: PskPolicy) -> PskPolicy:
    return await settings_service.update_psk_policy(req)


@psk_router.post("/psk-policy/generate", response_model=GeneratedPskKey)
async def generate_psk_key() -> GeneratedPskKey:
    """Generér én PSK-nøgle der overholder den aktive PSK-politik."""
    return settings_service.generate_psk_key()


# ── Portal Auth Config (TACACS+) ─────────────────────────────────────────────

auth_config_router = APIRouter(
    prefix="/settings", tags=["settings"], dependencies=[Depends(require_admin)]
)


@auth_config_router.get("/auth-config", response_model=PortalAuthConfigResponse)
async def read_portal_auth_config() -> PortalAuthConfigResponse:
    return settings_service.get_portal_auth_config()


@auth_config_router.put("/auth-config", response_model=PortalAuthConfigResponse)
async def update_portal_auth_config(
    req: PortalAuthConfigUpdate,
) -> PortalAuthConfigResponse:
    return await settings_service.update_portal_auth_config(req)


@auth_config_router.post("/auth-config/test", response_model=TacacsTestResponse)
async def test_tacacs_connection(req: TacacsTestRequest) -> TacacsTestResponse:
    """Test TACACS+ auth + authz med givne credentials (gemmer ikke settings)."""
    return settings_service.test_tacacs_connection(req)
