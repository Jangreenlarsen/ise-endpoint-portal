# HyperVision ISE Portal — Sikkerhedsanalyse V2

**Intern sikkerhedsrapport — ikke til offentliggørelse**
Analysedato: 2026-05-19
Analyseret version: v5.5.4 build 0431
Baseline: V1-analyse fra 2026-05-17 (v5.4.8 build 0386)
Analyseform: White-box statisk kodegennemgang

---

## Indhold

1. [Fase 1 — Kortlægning](#fase-1--kortlægning)
2. [Fase 2 — Fund-tabel og detaljerede fund](#fase-2--fund-tabel-og-detaljerede-fund)
3. [Top-10 handlingsliste](#top-10-handlingsliste)
4. [Sammenligning med V1](#sammenligning-med-v1)

---

## Fase 1 — Kortlægning

### 1.1 Token-arkitektur

Portalen bruger et **hjemmebygget token-format** i stedet for standard-JWT:

```
base64url(json_payload) . hex(HMAC-SHA256(secret, payload_b64))
```

HMAC-hemmeligheden er `secrets.token_bytes(64)` gemt i `backend/auth_secret.key`. Algoritmevalget er kryptografisk forsvarligt. Token-TTL er 3600 sekunder (1 time, reduceret fra 8 timer i V1).

Token-payload indeholder `role`, `endpoint_roles` og `operator_profile` som klartekst — felterne er HMAC-beskyttet mod manipulation men er ikke krypteret og fuldt synlige for enhver med adgang til `localStorage`. Tokenet mangler en standardiseret revokationsmekanisme — logout er kun klient-side.

### 1.2 Brugerstyring og TACACS+-login

TACACS+ auto-admin bootstrap (introduceret i v5.5.4): Hvis ingen bruger med `user_type=operator` eksisterer i `users.json`, tildeles det første succesfulde TACACS+-login automatisk admin-rollen. Betingelsen evalueres ved **hvert** login-forsøg, ikke kun ved første opstart. Dette betyder at betingelsen genaktiveres hvis alle operatørprofiler slettes.

Account lockout er implementeret korrekt med sliding window (5 fejl / 10 min → 15 min lockout), men tilstanden gemmes in-memory og nulstilles ved servergenstart.

### 1.3 TACACS+-service

Operatørprofil-navne modtages direkte fra TACACS+-server som attribut-værdier og bruges til opslag i `users.json` via case-insensitiv streng-matching uden tegnvalidering. Fallback bruger selve brugernavnet som profilnavn hvis TACACS-serveren ikke returnerer attributten.

### 1.4 Operatørprofiler

Lagres i `backend/operator_profiles.json`. Filen skrives **uden** `chmod(0o600)` — til forskel fra `auth_config.json` og `config.json` der eksplicit rettigheds-sættes. Indeholder ikke credentials men rolle-tildelinger.

### 1.5 Update-service

**git pull:** Bruger `git fetch` + `git reset --hard FETCH_HEAD`. Remote URL er konfigurationsbestemt og kan peges på en vilkårlig branch i det legitime repo af en admin med adgang til backend-settings. Ingen validering af at remote er et betroet repository.

**ZIP-pakke-validering:** Path traversal forhindres korrekt med prefix-whitelist og `resolve().relative_to()` double-check. `MAX_ZIP_BYTES` (100 MB) tjekkes på **komprimeret** størrelse — ukomprimeret størrelse er ubegrænset.

**Release notes fetch:** Markdown-renderen HTML-escaper input korrekt inden markdown-fortolkning — XSS via GitHub-kontrolleret indhold er ikke muligt.

### 1.6 PSK-nøglegenerering

`generate_psk_key()` i `settings_service.py` bruger Python's `random`-modul (Mersenne Twister, MT19937) — ikke kryptografisk sikker. Nøgler genereret via "Generér PSK"-knappen er forudsigelige med kendskab til PRNG-tilstanden.

### 1.7 pxGrid-certifikathåndtering

Private keys skrives med `chmod(0o600)` og genereres ukrypterede (`NoEncryption`). Node-navne saniteres korrekt til `[A-Za-z0-9-_]` — forhindrer path traversal via node_name-feltet. Windows-stier i settings håndteres relativt til `backend/pxgrid/`.

### 1.8 pxGrid AccountCreate og SSRF

`pxgrid_psn_fqdn` indsættes direkte i udgående mTLS-URL uden RFC 1918/localhost-validering:

```python
# client.py linje ~93
return f"https://{psn}:{CONTROL_PORT}/pxgrid/control"
```

En admin der kan redigere backend-settings kan trigge udgående mTLS-forbindelser til vilkårlige interne hosts på port 8910.

### 1.9 Rate limiter og CORS

`X-Forwarded-For` læses kun fra IPs i `trusted_proxy_ips` — korrekt implementering. `trusted_proxy_ips` er admin-konfigurérbar, så en kompromitteret admin kan gøre rate limiting virkningsløs.

CORS: `allow_credentials=True` med konfigurérbar origin-liste. Default er localhost-origins. Admin-konfigurerbar.

### 1.10 Audit log

Append-only SQLite-log med god dækning af write-operationer. Login-succes og -fejl logges. Følgende kritiske handlinger **mangler** audit-record:

- `POST /update/github-pull` — git reset til remote
- `POST /update/apply` — ZIP-pakke overskriver serverfiler
- `POST /update/restart` — servergenstart
- `setup_first_admin` — første admin-oprettelse
- TACACS+ auto-admin bootstrap-login

### 1.11 Frontend-sikkerhed

Token gemmes i `localStorage` — tilgængeligt for al JavaScript på domænet. CSP-headeren tillader `'unsafe-inline'` scripts, hvilket i praksis eliminerer CSP's beskyttelse mod XSS. Kombinationen er ugunstig: XSS → token exfiltration → fuld bruger-impersonation.

### 1.12 ISE TLS-verifikation

Default: `ise_verify_tls: bool = False` — ISE-forbindelsen kører uden certifikat-validering ved frisk installation. Udgående ISE-kald bruger Basic Auth over HTTPS — MitM-angriber på netværkssegmentet kan intercept ISE-credentials og endpoint-data.

---

## Fase 2 — Fund-tabel og detaljerede fund

### Fund-tabel

| ID | OWASP 2021 | Beskrivelse | Fil | CVSS | Vektor | Sand. | Konsekvens | Status |
|----|-----------|-------------|-----|------|--------|-------|------------|--------|
| SEC-A | A04 Insecure Design | TACACS+ auto-admin genaktiveres ved sletning af operatørprofiler | `user_service.py:448` | A04 | Auth (TACACS) | Lav | Kritisk | **By Design** |
| SEC-B | A02 Crypto Failures | PSK-nøgler genereres med `random` (ikke CSPRNG) | `settings_service.py:583` | A02 | Netværk | Lav | Høj | **Ny** |
| SEC-C | A10 SSRF | `pxgrid_psn_fqdn` bruges direkte i udgående mTLS-URL | `client.py:93` | A10 | Auth (admin) | Lav | Medium | **Ny** |
| SEC-D | A05 Misconfiguration | `ise_verify_tls` default `False` — ISE MitM-sårbar ved frisk installation | `config.py:19` | A05 | Netværk (MitM) | Medium | Høj | **Ny** |
| SEC-E | A09 Logging Failures | `git pull`, `apply_package`, `restart`, `setup_first_admin` audit-logges ikke | `update_service.py`, `user_service.py:386` | A09 | N/A | Høj | Medium | **Ny** |
| SEC-F | A05 Misconfiguration | CSP tillader `'unsafe-inline'` — reelt ingen XSS-beskyttelse | `main.py:172` | A05 | Netværk | Medium | Høj | Delvist fikset |
| SEC-G | A02 Crypto Failures | Hjemmebygget token mangler revokation — logout er kun klient-side | `auth.py` | A02 | Netværk | Lav | Medium | Delvist fikset |
| SEC-H | A07 Auth Failures | Account lockout in-memory — nulstilles ved servergenstart | `user_service.py:41` | A07 | Netværk | Lav | Medium | **Ny** |
| SEC-I | A05 Misconfiguration | `operator_profiles.json` mangler `chmod(0o600)` | `operator_profile_store.py:21` | A05 | Lokal | Lav | Lav | **Ny** |
| SEC-J | A04 Insecure Design | ZIP-bomb: max-størrelse tjekkes på komprimeret størrelse, ikke udpakket | `update_service.py:84` | A04 | Auth (admin) | Lav | Medium | **Ny** |
| SEC-K | A02 Crypto Failures | pxGrid private key gemmes ukrypteret, ingen memory-wipe | `cert_manager.py:190` | A02 | Lokal | Lav | Høj | **Ny** |
| SEC-L | A05 Misconfiguration | Token i `localStorage` — XSS kan exfiltrere token | `auth.js:20` | A05 | Netværk (XSS) | Medium | Høj | Delvist fikset |
| SEC-M | A09 Logging Failures | TACACS+ auto-admin bootstrap logges ikke til audit-DB | `user_service.py:456` | A09 | N/A | Høj | Medium | **Ny** |

---

### SEC-A — TACACS+ Auto-Admin Bootstrap (By Design)

**Sværhedsgrad:** Kritisk (vurderet)
**Fil:** `backend/app/services/user_service.py` linje 448–471
**Status: By Design — ikke en sårbarhed**

Bootstrap-betingelsen `any_operator_profiles` evalueres ved hvert login. Hvis alle operatørprofiler slettes genaktiveres auto-admin til næste TACACS+-bruger der logger ind. Dette er **intentionel adfærd**: hvis en administrator rydder alle operatørprofiler, skal portalen kunne bootstrappe en ny admin via TACACS+ uden manuel indgriben i filer. Forudsætter at TACACS+-server (ekstern authoritetskilde) er betroet.

---

### SEC-B — Kryptografisk svag PSK-nøglegenerering

**Sværhedsgrad:** Høj
**Fil:** `backend/app/services/settings_service.py` linje 559–586

```python
# Nuværende kode — IKKE kryptografisk sikker
required.append(random.choice(uppercase))
required += [random.choice(pool) for _ in range(remaining)]
random.shuffle(required)
```

`random` er Mersenne Twister (MT19937) — forudsigelig med 624 successive 32-bit outputs.

**Anbefalet fix:**
```python
import secrets
# Erstat alle random.choice() med secrets.choice()
required.append(secrets.choice(uppercase))
required += [secrets.choice(pool) for _ in range(remaining)]
# Erstat random.shuffle() med secrets-baseret shuffle
secrets_shuffle(required)  # sorted by random key via secrets.randbelow
```

---

### SEC-C — SSRF via pxGrid PSN FQDN

**Sværhedsgrad:** Medium
**Fil:** `backend/app/pxgrid/client.py` linje ~93, `backend/app/services/settings_service.py` linje ~239

```python
return f"https://{psn}:{CONTROL_PORT}/pxgrid/control"
# psn = settings.pxgrid_psn_fqdn (ukontrolleret admin-input)
```

**Begrænsende faktorer:** Kræver admin-adgang. Port låst til 8910. mTLS-certifikat kræves.

**Anbefalet fix:**
```python
import ipaddress, re

def _validate_psn_fqdn(fqdn: str) -> None:
    # Afvis tomme og localhost-lignende
    if not fqdn or fqdn.lower() in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("PSN FQDN må ikke være localhost")
    # Afvis rå IP-adresser (FQDN bør aldrig være en IP i pxGrid-kontekst)
    try:
        addr = ipaddress.ip_address(fqdn)
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            raise ValueError(f"PSN FQDN må ikke være en privat/loopback-adresse: {fqdn}")
    except ValueError as exc:
        if "PSN FQDN" in str(exc):
            raise
        pass  # Ikke en IP — OK, fortsæt
```

---

### SEC-D — ISE TLS-verifikation deaktiveret som default

**Sværhedsgrad:** Høj
**Fil:** `backend/app/core/config.py` linje 19

`ise_verify_tls: bool = False` — nyinstallerede portaler kommunikerer med ISE uden certifikat-validering. MitM-angriber på netværkssegmentet kan intercept ISE Basic Auth-credentials og al endpoint-data.

**Anbefalet fix:**
- Skift default til `True`
- Tilbyd `ise_ca_bundle`-felt som nem løsning for ISE med selvsigneret certifikat
- Vis synlig advarselsbanner i Settings-UI når `ise_verify_tls=False`

---

### SEC-E — Kritiske handlinger mangler audit-log

**Sværhedsgrad:** Medium
**Filer:** `backend/app/services/update_service.py`, `backend/app/api/update.py`, `backend/app/services/user_service.py`

Følgende handlinger mangler `audit_store.record()`:

| Handling | Endpoint | Risiko ved manglende log |
|---------|----------|------------------------|
| `git pull` / `reset --hard` | `POST /update/github-pull` | Uopdaget kodeudskiftning |
| ZIP-pakke apply | `POST /update/apply` | Uopdaget fil-overskrivning |
| Servergenstart | `POST /update/restart` | Uopdaget service-afbrydelse |
| Første admin-oprettelse | intern | Bootstrap-aktivitet uspores |

**Anbefalet fix — eksempel for git pull:**
```python
async def git_pull() -> dict[str, Any]:
    from app.core import audit_store, actor_ctx
    result = await asyncio.to_thread(_git_pull_sync)
    audit_store.record_sync(
        "github_pull", "system", actor_ctx.get(""),
        {"ok": result["ok"], "branch": _github_branch(), "rc": result.get("returncode")}
    )
    return result
```

---

### SEC-F — CSP tillader `unsafe-inline` (eksisterende fund)

**Sværhedsgrad:** Høj
**Fil:** `backend/app/main.py` linje 172–174
**Status:** Identificeret i V1. CSP-header tilføjet som SEC-2, men `'unsafe-inline'` er bibeholdt.

`script-src 'self' 'unsafe-inline'` giver enhver XSS-injektion mulighed for at eksekvere scripts. Kombineret med SEC-L (token i localStorage) medfører XSS fuld bruger-kompromittering.

**Anbefalet fix (langsigtet arkitekturprojekt):**
Erstat inline event-handlers med `addEventListener()` i al frontend-kode og fjern `'unsafe-inline'` fra CSP. Alternativt: implementer CSP nonces via middleware.

---

### SEC-G — Token mangler revokation (eksisterende fund)

**Sværhedsgrad:** Medium
**Fil:** `backend/app/core/auth.py`
**Status:** HMAC-signatur tilføjet i V1. Revokation stadig ikke implementeret.

Logout er udelukkende klient-side (`localStorage.removeItem()`). Et stjålet token er gyldigt op til 3600 sekunder.

**Anbefalet fix:** In-memory revokationsliste som renses periodisk:
```python
_revoked: set[str] = set()  # set af token-signaturer

def revoke_token(sig: str) -> None:
    _revoked.add(sig)

def is_revoked(sig: str) -> bool:
    return sig in _revoked
```
Kald `revoke_token(sig)` i `POST /api/auth/logout`.

---

### SEC-H — In-memory lockout nulstilles ved servergenstart

**Sværhedsgrad:** Medium
**Fil:** `backend/app/services/user_service.py` linje 41–43

```python
_failed_attempts: dict[str, list[float]] = {}
_lockout_until: dict[str, float] = {}
```

En angriber der kan trigge servergenstart (via kompromitteret admin-konto + `POST /update/restart`) nulstiller alle aktive lockouts og kan straks genoptage brute-force-forsøg.

**Anbefalet fix:** Persister lockout-tilstande i `audit.db` med TTL-cleanup:
```sql
CREATE TABLE IF NOT EXISTS lockouts (
    username TEXT PRIMARY KEY,
    locked_until REAL NOT NULL
);
```

---

### SEC-I — `operator_profiles.json` mangler filrettigheder

**Sværhedsgrad:** Lav
**Fil:** `backend/app/core/operator_profile_store.py` linje 21–24

Filen skrives uden `chmod(0o600)`. Indeholder rolle-tildelinger (ikke credentials) men burde være 600 for konsistens med øvrige konfigurationsfiler.

**Anbefalet fix:**
```python
def _save_raw(profiles: list[dict]) -> None:
    _STORE_FILE.write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")
    if os.name != "nt":
        try:
            _STORE_FILE.chmod(0o600)
        except OSError:
            pass
```

---

### SEC-J — ZIP-bomb: ukomprimeret størrelse ubegrænset

**Sværhedsgrad:** Medium
**Fil:** `backend/app/services/update_service.py` linje 84–133

`MAX_ZIP_BYTES = 100 * 1024 * 1024` tjekkes på **komprimeret** zip-størrelse. En 100 MB zip kan indeholde filer med høj kompressionsratio der udpakker til adskillige GB og fylder diskpladsen op.

**PoC:** En fil med 1 GB nuller komprimerer til <1 MB (ratio ~1000:1). Passerer størrelsesstjekket men udpakker til 1 GB.

**Anbefalet fix:**
```python
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024  # 500 MB total

total_uncompressed = sum(zf.getinfo(n).file_size for n in zf.namelist())
if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
    return {"ok": False, "errors": [f"Pakken udpakker til {total_uncompressed // (1024*1024)} MB — max 500 MB"]}
```

---

### SEC-K — pxGrid private key ukrypteret på disk

**Sværhedsgrad:** Medium
**Fil:** `backend/app/pxgrid/cert_manager.py` linje 190–194

```python
encryption_algorithm=serialization.NoEncryption()
```

`chmod(0o600)` sættes korrekt, men nøglen er ukrypteret og eksponeret ved backupadgang eller rootkompromittering. Nøglen bruges til mTLS mod ISE pxGrid.

**Anbefalet fix:** Kryptér private key med passphrase fra environment-variabel:
```python
enc = (
    serialization.BestAvailableEncryption(os.environb.get(b"PXGRID_KEY_PASS", b""))
    if os.environ.get("PXGRID_KEY_PASS")
    else serialization.NoEncryption()
)
```

---

### SEC-L — Token i localStorage (eksisterende fund)

**Sværhedsgrad:** Høj
**Fil:** `frontend/js/auth.js` linje 20–22
**Status:** Identificeret i V1. TTL reduceret til 1 time. Grundproblem uændret.

XSS-angreb kan exfiltrere token fra `localStorage` og impersonere brugeren i op til 1 time.

**Anbefalet fix (langsigtet):** Migrer til `HttpOnly; Secure; SameSite=Strict` cookie. Kræver backend-ændringer i alle auth-endpoints.

---

### SEC-M — TACACS+ auto-admin bootstrap ikke i audit-DB

**Sværhedsgrad:** Medium
**Fil:** `backend/app/services/user_service.py` linje 456–460

Den kritiske hændelse at en bruger automatisk tildeles admin-rolle logges kun til `app.log` — ikke til audit-databasen der er tilgængelig via UI og søgbar.

**Anbefalet fix:**
```python
audit_store.record_sync(
    "auto_admin_bootstrap", "session",
    f"tacacs:{payload.username}",
    {"reason": "no_operator_profiles_configured", "granted_role": "admin"}
)
```

---

## Top-10 handlingsliste

| Pri | ID | Handling | Indsats |
|-----|----|----------|---------|
| 1 | SEC-B | Erstat `random` med `secrets` i PSK-nøglegenerator | 30 min |
| 2 | SEC-D | Skift `ise_verify_tls` default til `True` + tilføj UI-advarselsbanner ved `False` | 1–2 timer |
| 3 | SEC-E | Tilføj `audit_store.record()` i `git_pull()`, `apply_package()`, `schedule_restart()` og `setup_first_admin()` | 1–2 timer |
| 4 | SEC-M | Tilføj `audit_store.record_sync()` ved auto-admin bootstrap-login | 30 min |
| 5 | SEC-I | Tilføj `chmod(0o600)` i `operator_profile_store._save_raw()` | 15 min |
| 6 | SEC-J | Tilføj max-ukomprimeret-størrelse tjek i `validate_package()` (500 MB total) | 30 min |
| 7 | SEC-H | Persister lockout-tilstand i SQLite så servergenstart ikke nulstiller lockout | 2–3 timer |
| 8 | SEC-C | Valider `pxgrid_psn_fqdn` — afvis RFC 1918/loopback/link-local adresser | 1 time |
| 9 | SEC-K | Kryptér pxGrid private key med passphrase fra env-variabel | 1 time |
| 10 | SEC-F | Plan for CSP hardening: erstat `'unsafe-inline'` med nonces (arkitekturprojekt) | 2–5 dage |

---

## Sammenligning med V1

**V1-analyse:** 2026-05-17 — v5.4.8 build 0386 — 13 fund (SEC-1 til SEC-13)

| V1-fund | Beskrivelse | Status i V2 |
|---------|-------------|-------------|
| SEC-1 | `auth_secret.key` world-readable | ✅ Fikset (chmod 600 ved oprettelse + startup-check) |
| SEC-2 | Manglende security headers (CSP, HSTS m.fl.) | ⚠️ Delvist fikset — CSP tilføjet men `unsafe-inline` reducerer effekten → **SEC-F** |
| SEC-3 | XSS via `err.message` i `innerHTML` | ✅ Fikset (esc() konsekvent i 8 frontend-filer) |
| SEC-4 | Manglende bruger-lockout | ✅ Fikset (sliding window lockout) → men in-memory → **SEC-H** |
| SEC-5 | ISE TLS-verifikation (ingen CA-bundle) | ⚠️ Delvist fikset (`ise_ca_bundle` tilføjet) men default stadig `False` → **SEC-D** |
| SEC-6 | Config-filer mangler chmod 600 | ✅ Fikset (`config.json`, `auth_config.json` sættes til 600) → `operator_profiles.json` mangler stadig → **SEC-I** |
| SEC-7 | Login-hændelser ikke i audit-log | ✅ Fikset (login_success og login_failed auditeres) → men update-handlinger mangler → **SEC-E** |
| SEC-8 | CORS: allow_methods/allow_headers wildcard | ✅ Fikset (eksplicitte lister) |
| SEC-9 | Rate limiter stoler blindt på X-Forwarded-For | ✅ Fikset (trusted_proxy_ips whitelist) |
| SEC-10 | Token TTL 8 timer, ingen refresh | ✅ Fikset (1 time TTL + silent refresh) → revokation mangler → **SEC-G** |
| SEC-11 | Svage password-krav | ✅ Fikset (min 10 tegn, stort/lille/tal validator) |
| SEC-12 | `/match`-endpoint accepterer fri dict | ✅ Fikset (Pydantic EndpointMatchRequest schema) |
| SEC-13 | Token i localStorage | ⚠️ Delvist afhjulpet (TTL reduceret) — grundproblem uændret → **SEC-L** |

**Nettoresultat:** 10 af 13 V1-fund er fuldt fiksede. 3 er delvist fiksede (SEC-F, SEC-G, SEC-L). 10 nye fund identificeret i nye angrebsflader. SEC-A afklaret som By Design.

---

*Rapporten er genereret ved white-box statisk analyse. Dynamisk testning (penetrationstest) er ikke udført.*
*Næste analyse anbefales efter implementering af Top-5 handlingspunkter.*
