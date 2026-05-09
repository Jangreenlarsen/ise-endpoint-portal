<!-- Version: 4.0.1 | Opdateret: 2026-05-09 -->

# 02 — Installation og første opsætning

---

## Forudsætninger

### Software

| Krav | Detaljer |
|---|---|
| Python | 3.11 eller nyere |
| Git | Valgfri — kræves kun til klon-baseret installation |
| Windows | 10/11 (anbefalet). Linux og macOS understøttes men er ikke testet |

### Cisco ISE

| Krav | Detaljer |
|---|---|
| ISE-version | 3.1 eller nyere. Testet og primært udviklet mod ISE 3.4 |
| ERS API | Skal være aktiveret: *Administration → System → Settings → API Settings → ERS* |
| Open API | Skal være aktiveret samme sted: *Open API* |
| ISE-bruger til portalen | Rollen **ERS Admin** (læs + skriv til endpoints og grupper) |
| ISE-bruger til portalen | Rollen **MnT Admin** (session-status og CoA-kald) |
| pxGrid (valgfri) | pxGrid Services aktiveret i ISE: *Administration → pxGrid Services → Enable* |
| Netværk | Backend skal nå ISE på port **443** (REST) og port **8910** (pxGrid) |

Det anbefales at oprette en dedikeret ISE service-account til portalen fremfor at genbruge en personlig admin-konto. Kontoen behøver ikke *SUPER ADMIN* — kun ERS Admin og MnT Admin.

### TACACS+-server (valgfri)

Kræves kun hvis portal-login skal gå via TACACS+ i stedet for lokal auth.

| Krav | Detaljer |
|---|---|
| TACACS+-server | Cisco ISE TACACS+, Cisco ACS, tac_plus eller tilsvarende |
| TCP-port | Backend skal nå TACACS+-serveren på port **49** |
| Shared secret | Konfigureres i Settings → Portal Auth Config |
| Attribut | Serveren skal returnere `portal-operator-profile = <profilnavn>` i Authorization-svar |

---

## Trin-for-trin installation

### 1. Hent kildekoden

```
git clone https://github.com/Jangreenlarsen/ise-endpoint-portal.git
cd ise-endpoint-portal
```

Alternativt: udpak ZIP-pakken fra GitHub releases direkte.

### 2. Opret Python virtual environment

```
cd backend
python -m venv .venv
```

### 3. Aktivér virtual environment og installér afhængigheder

Windows:
```
.venv\Scripts\activate
pip install -e .
```

Linux/macOS:
```
source .venv/bin/activate
pip install -e .
```

`pip install -e .` installerer portalen i editérbar tilstand via `pyproject.toml`. Alle afhængigheder (FastAPI, httpx, Pydantic v2, PyJWT, bcrypt, tacacs-plus m.fl.) hentes automatisk.

### 4. Start portalen

Den nemmeste metode på Windows er `START.bat` i projektmappens rod:

```
START.bat
```

`START.bat` starter backend og genstarter den automatisk ved fejl. Se [05-DRIFT.md](05-DRIFT.md#start-stop-og-genstart) for detaljer.

Alternativt manuelt fra projektroden:

```
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
```

### 5. Første opstart — opret admin-bruger

Åbn `http://localhost:8000` i en browser. Første gang vises et setup-flow:

1. Udfyld brugernavn og adgangskode for den første admin-konto.
2. Klik **Opret admin-bruger**.
3. Du logges automatisk ind og dirigeres til Settings.

Admin-brugeren valideres altid lokalt — også når TACACS+ er aktiveret.

### 6. Konfigurér ISE-forbindelsen

Under **Settings → ISE-forbindelsesindstillinger**:

- **ISE Host**: IP-adresse eller hostname for ISE Primary Admin Node (PAN). Brug ikke `https://` — bare hostname.
- **ERS Brugernavn / Adgangskode**: den dedikerede ISE service-account.
- **Timeout**: anbefalet 30 sekunder. Sæt ikke under 10 sekunder i produktionsmiljøer — ISE kan svare langsomt ved stor load.
- **Open API aktiveret**: slå til hvis du bruger Open API til DACL/custom attribute-administration.

Klik **Test forbindelse** — portalen forsøger et simpelt ERS-kald og rapporterer success eller fejlbeskrivelse.

Klik **Gem** — indstillingerne gemmes i `backend/data/settings_overrides.json`.

---

## ISE-konfiguration

### ERS API aktivering

1. Log ind i ISE som Super Admin.
2. Naviger til *Administration → System → Settings → API Settings*.
3. Under **ERS (External RESTful Services)**: sæt *ERS for Read/Write* til **Enabled**.
4. Under **Open API**: sæt til **Enabled** (kræves til DACL og custom attributes).
5. Klik **Save**.

ISE genstarter ikke af denne ændring — API er tilgængeligt øjeblikkeligt.

### ISE-bruger med korrekte roller

1. Naviger til *Administration → Admin Access → Administrators → Admin Users*.
2. Klik **Add**.
3. Udfyld brugernavn, kodeord og Admin Groups: tilføj **ERS Admin** og **MnT Admin**.
4. Gem.

Tjek at kontoen kan autentificere ved at kalde `https://<ISE>:9060/ers/config/endpointgroup` direkte i browser eller curl.

### pxGrid-aktivering (valgfri)

1. Naviger til *Administration → pxGrid Services*.
2. Sæt **Enable pxGrid** til aktiveret.
3. Portalen bruger certifikat-baseret autentificering. Se [04-ADMIN.md](04-ADMIN.md#pxgrid-opsætning) for certifikat-flow.

---

## Konfigurationsfiler

Portalen gemmer sin tilstand i filer under `backend/data/` (eller `backend/` afhængig af build):

| Fil | Indhold |
|---|---|
| `users.json` | Portal-brugere (bcrypt-hashede passwords, roller, System adm-tags, skabeloner) |
| `settings_overrides.json` | ISE-forbindelsesindstillinger, cache-parametre, pxGrid-config m.m. |
| `auth_config.json` | Portal Auth Config: auth-mode, TACACS+-server, secret (maskeret ved visning) |
| `roles.json` | System adm-katalog (brugerdefinerede tags) |

Disse filer oprettes automatisk ved første opstart. De er ikke versioneret i git (`.gitignore`). Sørg for at tage backup af disse filer regelmæssigt — se [05-DRIFT.md](05-DRIFT.md#backup).

DiskCache gemmes som standard i `backend/cache/endpoints.json`. Stien kan ændres i Settings → Cache.

---

## START.bat og auto-genstart

`START.bat` i projektmappen:

```batch
@echo off
:loop
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
echo Backend stoppede — genstarter om 3 sekunder...
timeout /t 3
goto loop
```

Scriptet genstarter automatisk backend hvis den crasher. Det er ikke en service-manager — til produktionsdrift anbefales NSSM (Non-Sucking Service Manager) til at pakke `START.bat` ind som Windows Service, så den starter automatisk ved serverens genstart.

NSSM-opsætning:
```
nssm install HyperVisionISE "C:\Projekter\ise-endpoint-portal\START.bat"
nssm set HyperVisionISE AppDirectory "C:\Projekter\ise-endpoint-portal"
nssm start HyperVisionISE
```

---

## Verificering

Efter opsætning kan følgende tjekkes:

| Test | Forventet resultat |
|---|---|
| `http://localhost:8000` | Login-side eller Browse |
| Settings → Test forbindelse | "Forbindelse til ISE OK" |
| Browse viser endpoint-liste | Endpoints fra ISE indlæses |
| Browse-farvning | Grøn/rød farve vises (kræver pxGrid eller MnT) |
| `http://localhost:8000/api/health` | `{"status": "ok"}` |
| `backend/logs/app.log` | ISE-kald logges uden CRITICAL-fejl |
| Settings → Portal Auth Config → Test TACACS+ | "TACACS+ auth OK" (kun ved TACACS+-mode) |
