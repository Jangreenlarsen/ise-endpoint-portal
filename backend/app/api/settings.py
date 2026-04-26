from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.deps import require_admin
from app.pxgrid import cert_manager
from app.schemas.settings import (
    BackendSettingsResponse,
    BackendSettingsUpdate,
    PxGridAccountCreateResponse,
    PxGridSettingsResponse,
    PxGridSettingsUpdate,
    PxGridStatusResponse,
    PxGridTestResponse,
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
    if not pem_bytes or b"-----BEGIN" not in pem_bytes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Uploaded file does not look like a PEM (missing -----BEGIN header)",
        )
    current = settings_service.get_pxgrid_settings()
    out_path = cert_manager.save_uploaded_pem(
        kind, current.pxgrid_node_name, pem_bytes  # type: ignore[arg-type]
    )
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
    csr_pem, key_pem = cert_manager.generate_csr(current.pxgrid_node_name)
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
    )
    return await settings_service.update_pxgrid_settings(update)
