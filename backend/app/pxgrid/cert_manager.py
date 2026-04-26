"""Bridge between the two cert provisioning modes.

Mode 'upload' (default, simplest):
    Admin uploads three PEM files via POST /api/settings/pxgrid/cert
    or drops them on disk and points settings at the paths. We just
    verify they exist + parse + form a matching pair.

Mode 'csr':
    Portal generates a fresh RSA-2048 keypair + CSR (CN=node_name).
    The CSR is POSTed to ISE via /pxgrid/control/AccountCreate; ISE
    returns an account state. An ISE admin then approves the client
    in pxGrid Services UI, after which AccountActivate succeeds and
    AccessSecretCreate yields the per-node password.

Both modes converge on a usable (cert_path, key_path, ca_path) triple
that ``client.PxGridClient`` consumes for mTLS. The CSR mode also
populates ``pxgrid_password`` in settings as a side-effect.

We deliberately use the stdlib + a tiny bit of `cryptography` (already
a transitive dep via httpx[http2]) instead of pulling in heavy CA
tooling — pxGrid only needs a single client cert, no PKI plumbing.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

# Resolve relative cert paths against backend/ so settings can use
# short paths like "pxgrid/client.pem" without absolute prefixes.
BACKEND_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class CertBundle:
    """Resolved, on-disk cert material ready for httpx mTLS."""

    cert_path: Path
    key_path: Path
    ca_path: Path | None  # None = system CA store

    def httpx_cert(self) -> tuple[str, str]:
        return (str(self.cert_path), str(self.key_path))

    def httpx_verify(self) -> str | bool:
        return str(self.ca_path) if self.ca_path else True


def _resolve(path_str: str) -> Path | None:
    if not path_str:
        return None
    p = Path(path_str)
    if not p.is_absolute():
        p = BACKEND_ROOT / p
    return p


def load_bundle(
    cert_path: str, key_path: str, ca_bundle_path: str
) -> CertBundle:
    """Resolve + verify all three paths exist. Raises PxGridCertError otherwise.

    Does not parse PEM contents — httpx + OpenSSL handle that at handshake time
    and give better error messages than re-implementing PEM parsing here.
    """
    from app.pxgrid.exceptions import PxGridCertError

    cert = _resolve(cert_path)
    key = _resolve(key_path)
    ca = _resolve(ca_bundle_path)

    if cert is None or key is None:
        raise PxGridCertError(
            "pxgrid_cert_path and pxgrid_key_path must both be set"
        )
    if not cert.exists():
        raise PxGridCertError(f"Client certificate not found: {cert}")
    if not key.exists():
        raise PxGridCertError(f"Private key not found: {key}")
    if ca is not None and not ca.exists():
        raise PxGridCertError(f"CA bundle not found: {ca}")
    return CertBundle(cert_path=cert, key_path=key, ca_path=ca)


def cert_status(
    cert_path: str, key_path: str, ca_bundle_path: str
) -> str:
    """Cheap check used by GET /api/settings/pxgrid (no exception path).

    Returns 'ok' | 'missing' | 'error: <msg>' — the Settings UI shows
    this as a colored badge so admins can spot a typo without doing
    a full TLS handshake.
    """
    if not cert_path or not key_path:
        return "missing"
    try:
        load_bundle(cert_path, key_path, ca_bundle_path)
        return "ok"
    except Exception as exc:  # noqa: BLE001
        return f"error: {exc}"


# ── CSR mode helpers ────────────────────────────────────────────────────

CsrResult = tuple[bytes, bytes]  # (csr_pem, key_pem)


def generate_csr(
    common_name: str,
    *,
    key_size: int = 2048,
) -> CsrResult:
    """Generate a fresh RSA keypair + CSR.

    Returns ``(csr_pem, key_pem)``. Caller is responsible for persisting
    the key (never log it!) and posting the CSR to ISE.

    We don't write to disk here — that's the cert_manager's persist step,
    so we can keep generation pure + testable.
    """
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "CSR mode requires the 'cryptography' package. Install with "
            "`pip install cryptography`."
        ) from exc

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(
            x509.Name(
                [x509.NameAttribute(NameOID.COMMON_NAME, common_name)]
            )
        )
        .sign(private_key, hashes.SHA256())
    )
    csr_pem = csr.public_bytes(serialization.Encoding.PEM)
    key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return csr_pem, key_pem


def _safe_node_name(node_name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in node_name)


def csr_path_for(node_name: str) -> Path:
    """Where ``persist_csr_artifacts`` writes the CSR. Used by the download
    endpoint so it doesn't have to track paths separately."""
    return BACKEND_ROOT / "pxgrid" / f"{_safe_node_name(node_name)}.csr.pem"


def persist_csr_artifacts(
    node_name: str,
    csr_pem: bytes,
    key_pem: bytes,
    *,
    target_dir: Path | None = None,
) -> tuple[Path, Path]:
    """Write key + CSR to ``backend/pxgrid/<node>.{key,csr}.pem``.

    Returns ``(key_path, csr_path)``. Cert file isn't written here —
    it arrives later from ISE after the admin approves and downloads
    the signed cert (or via a separate AccountActivate flow).
    """
    target = target_dir or (BACKEND_ROOT / "pxgrid")
    target.mkdir(parents=True, exist_ok=True)
    safe = _safe_node_name(node_name)
    key_file = target / f"{safe}.key.pem"
    csr_file = target / f"{safe}.csr.pem"
    key_file.write_bytes(key_pem)
    csr_file.write_bytes(csr_pem)
    # Restrict key permissions on POSIX; on Windows ACLs handle this differently
    # so we just best-effort it.
    try:
        key_file.chmod(0o600)
    except OSError:
        pass
    logger.info("pxgrid: wrote CSR to %s and key to %s", csr_file, key_file)
    return key_file, csr_file


# ── PKCS#12 helpers (Microsoft AD CS / generic .pfx imports) ────────────


def extract_pkcs12(
    pfx_bytes: bytes, password: str = ""
) -> tuple[bytes, bytes, bytes | None]:
    """Split a PKCS#12 (.pfx/.p12) bundle into PEM cert + key + CA chain.

    Returns ``(cert_pem, key_pem, ca_pem_or_none)``. Caller persists each
    to the cert/key/ca paths so we end up with the same on-disk shape as
    upload-mode (httpx mTLS reads PEMs, not PFX).

    The CA chain is concatenated PEMs of all extra certs in the bundle —
    ISE typically ships its sub-CA + root in the same PFX when you export
    "with chain" in the certsrv UI. Returns None if no chain certs.
    """
    from app.pxgrid.exceptions import PxGridCertError

    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.serialization import pkcs12
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "PKCS#12 support requires the 'cryptography' package."
        ) from exc

    pwd_bytes = password.encode("utf-8") if password else None
    try:
        key, cert, extra = pkcs12.load_key_and_certificates(pfx_bytes, pwd_bytes)
    except ValueError as exc:
        # cryptography raises ValueError for bad password / corrupt PFX
        raise PxGridCertError(f"Kunne ikke parse PKCS#12: {exc}") from exc

    if cert is None or key is None:
        raise PxGridCertError(
            "PKCS#12 mangler enten cert eller private key — "
            "eksportér med 'Yes, export the private key' i certsrv."
        )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    ca_pem: bytes | None = None
    if extra:
        ca_pem = b"".join(
            c.public_bytes(serialization.Encoding.PEM) for c in extra
        )
    return cert_pem, key_pem, ca_pem


def save_pkcs12_bundle(
    node_name: str,
    cert_pem: bytes,
    key_pem: bytes,
    ca_pem: bytes | None,
) -> tuple[Path, Path, Path | None]:
    """Persist the three PEMs from a PFX import using the same naming scheme
    as ``save_uploaded_pem``. CA-pathen er None hvis bundlet ikke havde chain.
    """
    target = BACKEND_ROOT / "pxgrid"
    target.mkdir(parents=True, exist_ok=True)
    safe = _safe_node_name(node_name)
    cert_path = target / f"{safe}.cert.pem"
    key_path = target / f"{safe}.key.pem"
    cert_path.write_bytes(cert_pem)
    key_path.write_bytes(key_pem)
    try:
        key_path.chmod(0o600)
    except OSError:
        pass
    ca_path: Path | None = None
    if ca_pem:
        ca_path = target / f"{safe}.ca.pem"
        ca_path.write_bytes(ca_pem)
    logger.info(
        "pxgrid: imported PKCS#12 → cert=%s key=%s ca=%s",
        cert_path,
        key_path,
        ca_path or "(none)",
    )
    return cert_path, key_path, ca_path


# ── Upload mode helpers ─────────────────────────────────────────────────

PEM_KIND = Literal["cert", "key", "ca"]


def save_uploaded_pem(
    kind: PEM_KIND,
    node_name: str,
    pem_bytes: bytes,
) -> Path:
    """Persist an uploaded PEM file under backend/pxgrid/.

    Returns the path; the caller writes the resulting path back into
    settings (pxgrid_cert_path / pxgrid_key_path / pxgrid_ca_bundle_path).
    """
    target = BACKEND_ROOT / "pxgrid"
    target.mkdir(parents=True, exist_ok=True)
    safe = _safe_node_name(node_name)
    suffix = {"cert": "cert", "key": "key", "ca": "ca"}[kind]
    out = target / f"{safe}.{suffix}.pem"
    out.write_bytes(pem_bytes)
    if kind == "key":
        try:
            out.chmod(0o600)
        except OSError:
            pass
    logger.info("pxgrid: saved uploaded %s pem to %s", kind, out)
    return out
