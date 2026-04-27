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

    missing: list[str] = []
    if cert is None:
        missing.append("klient-cert")
    if key is None:
        missing.append("private key (kør Trin 1: Generér CSR for at oprette en ny)")
    if missing:
        raise PxGridCertError(
            "Manglende cert-materiale: " + ", ".join(missing) +
            ". Kør CSR-flowet (Trin 1 → 4) eller importér en PKCS#12 først."
        )
    if not cert.exists():
        raise PxGridCertError(
            f"Klient-certifikatet blev ikke fundet på disk: {cert}. "
            f"Upload det signerede cert igen via Trin 3."
        )
    if not key.exists():
        raise PxGridCertError(
            f"Private key blev ikke fundet på disk: {key}. "
            f"Kør Trin 1: Generér CSR for at oprette en ny."
        )
    if ca is not None and not ca.exists():
        raise PxGridCertError(
            f"CA-bundle blev ikke fundet på disk: {ca}. "
            f"Upload CA-bundle igen via Trin 4."
        )
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
    # pxGrid 2.0 / RFC 5280: SAN:dNSName skal matche nodeName, ellers afviser
    # ISE 3.4 cert som "ikke matcher node" selv hvis CN er korrekt (CN-only
    # matching er deprecated siden RFC 6125).
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(
            x509.Name(
                [x509.NameAttribute(NameOID.COMMON_NAME, common_name)]
            )
        )
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName(common_name)]),
            critical=False,
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


def delete_artifacts(node_name: str) -> list[str]:
    """Slet alle PEM/CSR-artifacts for en given node fra ``backend/pxgrid/``.

    Returnerer listen af faktisk-slettede filnavne. Fejler ikke hvis
    filerne ikke findes — reset er idempotent. Bruges af
    ``POST /api/settings/pxgrid/reset`` til at give admin et rent slate.
    """
    target = BACKEND_ROOT / "pxgrid"
    if not target.exists():
        return []
    safe = _safe_node_name(node_name)
    suffixes = ["cert.pem", "key.pem", "ca.pem", "csr.pem"]
    deleted: list[str] = []
    for suffix in suffixes:
        f = target / f"{safe}.{suffix}"
        if f.exists():
            try:
                f.unlink()
                deleted.append(f.name)
            except OSError as exc:
                logger.warning("pxgrid reset: kunne ikke slette %s: %s", f, exc)
    if deleted:
        logger.info("pxgrid reset: slettede %s for node=%s", deleted, node_name)
    return deleted


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


def normalize_uploaded_bytes(kind: PEM_KIND, raw: bytes) -> bytes:
    """Validate + canonicalize an uploaded cert/key/CA file to X.509 PEM.

    Catches the three formats admins commonly hand us by mistake before
    we hit OpenSSL at TLS-handshake time (where the error is the cryptic
    ``[SSL] PEM lib (_ssl.c:4143)``):

      - **CSR uploaded as cert** — ``-----BEGIN CERTIFICATE REQUEST-----``
        passes a naïve "contains BEGIN" check but is not a usable cert.
      - **PKCS#7 (.p7b) chain** — common output from MS certsrv "Download
        certificate chain"; has ``-----BEGIN PKCS7-----`` but OpenSSL's
        ``cert=`` / ``verify=`` want X.509 PEM. We extract certs and
        re-emit as concatenated X.509 PEM.
      - **DER (.cer / .crt binary)** — no ``-----BEGIN`` header at all.
        We DER-decode and re-emit as PEM.

    Raises ``PxGridCertError`` with a Danish message that points the
    admin at what they actually need to upload.
    """
    from app.pxgrid.exceptions import PxGridCertError

    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.serialization import pkcs7
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "PEM-validering kræver 'cryptography'-pakken."
        ) from exc

    if not raw:
        raise PxGridCertError("Tom fil")

    # Strip UTF-8 BOM (Notepad/Excel-eksporter tilføjer ofte \ufeff)
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]

    if kind == "key":
        if b"-----BEGIN" in raw:
            try:
                key = serialization.load_pem_private_key(raw, password=None)
            except Exception as exc:  # noqa: BLE001
                raise PxGridCertError(
                    f"Kunne ikke parse private key (PEM): {exc}"
                ) from exc
        else:
            try:
                key = serialization.load_der_private_key(raw, password=None)
            except Exception as exc:  # noqa: BLE001
                raise PxGridCertError(
                    "Filen er ikke en gyldig private key (hverken PEM eller DER). "
                    "Hvis nøglen er password-beskyttet eller ligger i en .pfx, "
                    "brug 'Importér PKCS#12'-knappen i stedet."
                ) from exc
        return key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

    # kind == "cert" or "ca" — both want X.509 PEM (CA can be a chain)
    if b"-----BEGIN CERTIFICATE REQUEST-----" in raw:
        raise PxGridCertError(
            "Den uploadede fil er en CSR (Certificate Signing Request), ikke "
            "et signeret certifikat. Send CSR'en til din CA (ISE internal CA "
            "eller MS certsrv), download det signerede cert tilbage, og upload "
            "DET her."
        )

    certs: list = []
    if b"-----BEGIN CERTIFICATE-----" in raw:
        try:
            certs = list(x509.load_pem_x509_certificates(raw))
        except Exception as exc:  # noqa: BLE001
            raise PxGridCertError(
                f"Kunne ikke parse X.509 PEM: {exc}"
            ) from exc
    elif b"-----BEGIN PKCS7-----" in raw or b"-----BEGIN PKCS #7" in raw:
        try:
            certs = list(pkcs7.load_pem_pkcs7_certificates(raw))
        except Exception as exc:  # noqa: BLE001
            raise PxGridCertError(
                f"Kunne ikke parse PKCS#7-PEM: {exc}"
            ) from exc
    else:
        # No PEM header → try DER X.509, then DER PKCS#7
        try:
            certs = [x509.load_der_x509_certificate(raw)]
        except Exception:  # noqa: BLE001
            try:
                certs = list(pkcs7.load_der_pkcs7_certificates(raw))
            except Exception as exc:  # noqa: BLE001
                raise PxGridCertError(
                    "Filen er ikke et genkendeligt certifikat-format "
                    "(forventede PEM X.509, PEM PKCS#7, DER X.509 eller "
                    "DER PKCS#7)."
                ) from exc

    if not certs:
        raise PxGridCertError("Ingen certifikater fundet i filen")

    if kind == "cert" and len(certs) > 1:
        # Klient-cert skal være ét enkelt cert — chain-certs hører til CA-bundle.
        # Tag leaf-cert (det første i bundlet) og lad admin uploade resten som CA.
        logger.info(
            "pxgrid: cert-upload indeholdt %d certs, bruger kun leaf",
            len(certs),
        )
        certs = certs[:1]

    return b"".join(c.public_bytes(serialization.Encoding.PEM) for c in certs)


def save_uploaded_pem(
    kind: PEM_KIND,
    node_name: str,
    pem_bytes: bytes,
) -> Path:
    """Persist an uploaded PEM file under backend/pxgrid/.

    Validates + canonicalizes via ``normalize_uploaded_bytes`` first so we
    never persist a CSR/p7b/DER as if it were X.509 PEM (those would only
    fail later at TLS-handshake with a cryptic OpenSSL error).

    Returns the path; the caller writes the resulting path back into
    settings (pxgrid_cert_path / pxgrid_key_path / pxgrid_ca_bundle_path).
    """
    normalized = normalize_uploaded_bytes(kind, pem_bytes)
    target = BACKEND_ROOT / "pxgrid"
    target.mkdir(parents=True, exist_ok=True)
    safe = _safe_node_name(node_name)
    suffix = {"cert": "cert", "key": "key", "ca": "ca"}[kind]
    out = target / f"{safe}.{suffix}.pem"
    out.write_bytes(normalized)
    if kind == "key":
        try:
            out.chmod(0o600)
        except OSError:
            pass
    logger.info("pxgrid: saved uploaded %s pem to %s", kind, out)
    return out
