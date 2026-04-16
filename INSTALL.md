# ISE Endpoint Portal — Installation og drift

Guide til opsætning, konfiguration og daglig brug af ISE Endpoint Portal.

---

## Indhold

1. [Forudsætninger](#forudsætninger)
2. [Installation](#installation)
3. [Konfiguration](#konfiguration)
4. [Start af systemet](#start-af-systemet)
5. [Brug af portalen](#brug-af-portalen)
6. [API-reference](#api-reference)
7. [Logning og fejlsøgning](#logning-og-fejlsøgning)
8. [Drift og vedligeholdelse](#drift-og-vedligeholdelse)
9. [Sikkerhed](#sikkerhed)

---

## Forudsætninger

### Software

| Krav | Minimum version | Bemærkning |
|------|-----------------|------------|
| Python | 3.11+ | Skal være tilgængelig som `python` eller `python3` |
| pip | 23+ | Følger med Python |
| Git | 2.40+ | Til versionskontrol |
| Webbrowser | Moderne (Chrome, Edge, Firefox) | Til frontend |

### Cisco ISE

| Krav | Detaljer |
|------|----------|
| ISE version | 3.1 eller nyere (testet med 3.4) |
| ERS API | Skal være aktiveret: **Administration → System → Settings → API Settings → Enable ERS** |
| ERS Admin bruger | En bruger med rollen **ERS Admin** (ikke kun Read-only) |
| Netværk | Backend-serveren skal kunne nå ISE på port 443 (eller 9060) via HTTPS |

---

## Installation

### 1. Klon repository

```bash
git clone https://github.com/Jangreenlarsen/ise-endpoint-portal.git
cd ise-endpoint-portal
```

### 2. Opret Python virtual environment

```bash
cd backend
python -m venv .venv
```

Aktivér environment:

- **Windows (PowerShell)**: `.venv\Scripts\Activate.ps1`
- **Windows (cmd)**: `.venv\Scripts\activate.bat`
- **Windows (Git Bash)**: `source .venv/Scripts/activate`
- **Linux/macOS**: `source .venv/bin/activate`

### 3. Installér afhængigheder

```bash
pip install -e .
```

For udvikling (tests, linting):

```bash
pip install -e ".[dev]"
```

### 4. Konfigurér ISE-forbindelse

Der er to måder at konfigurere på — vælg den der passer:

#### Mulighed A: `.env`-fil (anbefalet til første opsætning)

Opret filen `backend/.env`:

```env
ISE_BASE_URL=https://ise.example.local
ISE_USERNAME=ers-admin
ISE_PASSWORD=din-adgangskode
ISE_VERIFY_TLS=false
ISE_TIMEOUT=30.0
ISE_API_TYPE=ers
LOG_LEVEL=INFO
```

#### Mulighed B: Via web-UI (Settings-siden)

Start systemet først, åbn portalen i browseren, og konfigurér under **Settings**. Ændringer gemmes i `backend/config.json` og overskriver `.env`-værdier.

### 5. Verificér installation

```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Åbn `http://localhost:8000` i en browser. Du skal se portalen med sidebar-navigation. Status-indikatoren i sidebaren viser **ok** (grøn) når backend kører.

---

## Konfiguration

### Konfigurationsfiler

| Fil | Formål | Git-tracket |
|-----|--------|-------------|
| `backend/.env` | Standard ISE-forbindelsesindstillinger | Nej (i `.gitignore`) |
| `backend/config.json` | Brugerændringer fra Settings-UI. Overskriver `.env` | Nej (i `.gitignore`) |
| `backend/custom_attr_values.json` | Lokale tilladte værdier for custom attributes | Nej (i `.gitignore`) |

### ISE-forbindelsesparametre

| Parameter | Env-variabel | Standard | Beskrivelse |
|-----------|-------------|----------|-------------|
| ISE URL | `ISE_BASE_URL` | `https://ise.example.local` | Fuld HTTPS-URL til ISE PAN (Primary Admin Node) |
| Brugernavn | `ISE_USERNAME` | `ers-admin` | ERS Admin-bruger |
| Adgangskode | `ISE_PASSWORD` | *(tom)* | Adgangskode til ERS-brugeren |
| Verificér TLS | `ISE_VERIFY_TLS` | `false` | Sæt til `true` i produktion med gyldigt certifikat |
| Timeout | `ISE_TIMEOUT` | `30.0` | Timeout i sekunder for ISE API-kald |
| API-type | `ISE_API_TYPE` | `ers` | `ers` (anbefalet) eller `openapi` |

### Øvrige parametre

| Parameter | Env-variabel | Standard | Beskrivelse |
|-----------|-------------|----------|-------------|
| Log-niveau | `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| Log-fil | `LOG_FILE` | `logs/app.log` | Relativ sti fra `backend/` |
| CORS origins | `BACKEND_CORS_ORIGINS` | `localhost:5173,8000` | Tilladte origins for CORS |

---

## Start af systemet

### Udvikling / enkel brug

```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

- `--reload` genstarter serveren automatisk ved filændringer (kun til udvikling)
- Frontend serveres automatisk fra `frontend/`-mappen på roden `/`
- Åbn `http://localhost:8000` i browseren

### Produktion

```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

> **Bemærk**: Brug kun 1 worker da ISE-klienten deler state i hukommelsen. Flere workers kan give uforudsigelig opførsel.

### Kør som baggrundstjeneste (Linux systemd)

Opret `/etc/systemd/system/ise-portal.service`:

```ini
[Unit]
Description=ISE Endpoint Portal
After=network.target

[Service]
Type=simple
User=ise-portal
WorkingDirectory=/opt/ise-endpoint-portal/backend
Environment=PATH=/opt/ise-endpoint-portal/backend/.venv/bin
ExecStart=/opt/ise-endpoint-portal/backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now ise-portal
```

---

## Brug af portalen

### Sidebar-navigation

Portalen har fire hovedsektioner, tilgængelige via menuen i venstre side:

### 1. Opret endpoint

Opret et enkelt endpoint i ISE.

**Felter:**
- **MAC adresse** (påkrævet) — format: `AA:BB:CC:DD:EE:FF` (kolon eller bindestreg)
- **Endpoint Group** (påkrævet) — dropdown med grupper hentet fra ISE
- **Beskrivelse** (valgfri) — fritekst
- **Ejer / Owner** (valgfri) — custom attribute, vælg fra liste eller tilføj ny
- **Lokation / Location** (valgfri) — custom attribute, vælg fra liste eller tilføj ny
- **Authz VLAN** (valgfri) — custom attribute, vælg fra liste eller tilføj ny

**Tilføj ny værdi til dropdown:**
1. Vælg `+ Tilføj ny…` i dropdown-listen
2. Indtast den nye værdi i tekstfeltet
3. Klik **Gem** — værdien oprettes lokalt og er straks tilgængelig
4. Værdien sendes til ISE som custom attribute ved endpoint-oprettelse

### 2. Import fra CSV

Bulk-opret endpoints fra en CSV-fil.

**CSV-format:**
```csv
mac,group,description,owner,location,authz_vlan
AA:BB:CC:DD:EE:01,Unknown,lab device,IT,BLR-1F,VLAN100
AA:BB:CC:DD:EE:02,Profiled,printer,Facilities,,VLAN200
```

- Header-rækken er valgfri (auto-detekteres)
- De tre sidste kolonner (owner, location, authz_vlan) er valgfrie
- Minimalt format: `mac,group,description`
- Hvis **group** ikke matcher et gruppenavn i ISE, bruges fallback-gruppen

**Workflow:**
1. Upload en CSV-fil eller paste indholdet direkte
2. Vælg fallback-gruppe (bruges når group-kolonnen er tom eller ukendt)
3. Klik **Preview** for at se validering (gyldige/ugyldige MAC'er)
4. Klik **Import** for at oprette endpoints
5. Resultatet viser succeeded/failed lister

### 3. Browse / Edit

Vis, søg, rediger og slet eksisterende endpoints.

**Funktioner:**
- **Tabel** med alle endpoints (id, name, description)
- **Filter** — søg i tabellen (client-side)
- **Inline edit** — klik på beskrivelse for at redigere direkte
- **Slet** — slet endpoint fra ISE (med bekræftelse)

### 4. Settings

Konfigurér forbindelsen til ISE og frontend-præferencer.

**Backend-indstillinger (ISE-forbindelse):**
- ISE URL, brugernavn, adgangskode
- API-type (ERS / OpenAPI)
- TLS-verifikation, timeout
- Ændringer gemmes i `backend/config.json` og træder i kraft straks

**Frontend-præferencer:**
- Gemmes lokalt i browseren (localStorage)

---

## API-reference

Backend eksponerer følgende REST API-endpoints under `/api`:

### Health

| Metode | Path | Beskrivelse |
|--------|------|-------------|
| GET | `/api/health` | Sundhedscheck — returnerer `status`, `version`, `build` |

### Endpoints

| Metode | Path | Beskrivelse |
|--------|------|-------------|
| GET | `/api/endpoints?page=1&size=100` | Hent liste af endpoints (pagineret) |
| POST | `/api/endpoints` | Opret enkelt endpoint |
| POST | `/api/endpoints/bulk` | Bulk-opret endpoints |
| PUT | `/api/endpoints/{id}` | Opdater endpoint (description, group, custom attrs) |
| DELETE | `/api/endpoints/{id}` | Slet endpoint |

### Endpoint Groups

| Metode | Path | Beskrivelse |
|--------|------|-------------|
| GET | `/api/groups` | Hent alle endpoint groups fra ISE |

### Custom Attributes

| Metode | Path | Beskrivelse |
|--------|------|-------------|
| GET | `/api/custom-attributes` | Hent alle custom attributes og deres tilladte værdier |
| POST | `/api/custom-attributes/{name}/values` | Tilføj ny værdi til en attribut |
| DELETE | `/api/custom-attributes/{name}/values/{value}` | Fjern en værdi fra en attribut |
| POST | `/api/custom-attributes/sync` | Synkronisér fra ISE (scan endpoints, discover values) |

### Settings

| Metode | Path | Beskrivelse |
|--------|------|-------------|
| GET | `/api/settings/backend` | Hent backend-indstillinger (password maskeret) |
| PUT | `/api/settings/backend` | Gem backend-indstillinger |

### Eksempler

**Opret endpoint:**
```bash
curl -X POST http://localhost:8000/api/endpoints \
  -H "Content-Type: application/json" \
  -d '{
    "mac": "AA:BB:CC:DD:EE:FF",
    "group_id": "gruppe-uuid",
    "description": "Test device",
    "custom_attributes": {
      "Owner": "IT",
      "Location": "BLR-1F",
      "AuthzVlan": "VLAN100"
    }
  }'
```

**Bulk import:**
```bash
curl -X POST http://localhost:8000/api/endpoints/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"mac": "AA:BB:CC:DD:EE:01", "group_id": "uuid", "description": "Device 1"},
      {"mac": "AA:BB:CC:DD:EE:02", "group_id": "uuid", "description": "Device 2"}
    ]
  }'
```

---

## Logning og fejlsøgning

### Log-fil

Alle ISE-operationer logges til `backend/logs/app.log`.

- **Format**: `TIMESTAMP | LEVEL | MODULE | MESSAGE`
- **Rotation**: Max 5 MB per fil, op til 3 backup-filer
- **Niveau**: Kan ændres via `LOG_LEVEL` i `.env` eller Settings

**Eksempel:**
```
2026-04-16 14:23:01 | INFO     | app.services.endpoint_service | creating endpoint mac=AA:BB:CC:DD:EE:FF group=abc-123
2026-04-16 14:23:02 | INFO     | app.services.endpoint_service | bulk done: 5 ok, 1 failed
```

### Almindelige fejl

| Symptom | Årsag | Løsning |
|---------|-------|---------|
| `401 Unauthorized` fra ISE | Forkert brugernavn/adgangskode, ERS ikke aktiveret, eller bruger mangler ERS Admin-rolle | Tjek credentials i Settings. Verificér at ERS er enabled i ISE: Administration → System → Settings → API Settings |
| `502 Bad Gateway` i portalen | Backend kan ikke nå ISE | Tjek `ISE_BASE_URL` — kan serveren nå ISE via HTTPS? Prøv `curl -k https://ise-url/ers/config/endpoint` |
| `Connection refused` | Backend kører ikke | Start backend med `uvicorn` kommandoen |
| Sidebar viser `backend: err` | Frontend kan ikke nå backend | Verificér at backend kører på port 8000 |
| Tomt endpoint-group dropdown | ISE-forbindelse fejler | Åbn Settings og bekræft at ISE URL og credentials er korrekte |
| `409 Conflict` ved oprettelse | Endpoint MAC eksisterer allerede i ISE | Slet det eksisterende endpoint først eller brug en anden MAC |

### Debug-tilstand

Sæt `LOG_LEVEL=DEBUG` i `.env` for detaljeret logging inkl. HTTP requests/responses mod ISE.

---

## Drift og vedligeholdelse

### Opdatering

```bash
cd ise-endpoint-portal
git pull origin main
cd backend
pip install -e .
# Genstart serveren
```

### Backup

Følgende filer indeholder brugerdata og bør sikkerhedskopieres:

| Fil | Indhold |
|-----|---------|
| `backend/config.json` | ISE-forbindelsesindstillinger |
| `backend/custom_attr_values.json` | Tilladte værdier for Owner, Location, AuthzVlan |
| `backend/logs/app.log` | Driftslog |

### Custom attributes synkronisering

Portalen gemmer tilladte værdier for Owner, Location og AuthzVlan lokalt. For at opdatere fra ISE:

1. Brug API-kaldet `POST /api/custom-attributes/sync`
2. Systemet scanner alle endpoints i ISE og samler alle unikke værdier
3. Nye værdier tilføjes til de lokale lister (eksisterende bevares)
4. Manglende attribute-definitioner oprettes automatisk i ISE

### Versionering

Systemets version vises i:
- Sidebar (nederste venstre hjørne)
- `GET /api/health` → `version`, `build`, `full`
- `version.json` i roden af projektet

---

## Sikkerhed

### Anbefalinger

1. **TLS**: Sæt `ISE_VERIFY_TLS=true` i produktion og installér ISE's CA-certifikat
2. **Adgangskontrol**: Portalen har ingen bruger-autentificering — deploy bag en reverse proxy (nginx/Apache) med auth
3. **Credentials**: Gem aldrig ISE-adgangskoden i versionskontrol. Brug `.env`-fil eller miljøvariabler
4. **Netværk**: Begræns adgang til portalen via firewall-regler — kun autoriserede klienter bør kunne nå port 8000
5. **ISE-bruger**: Opret en dedikeret ERS Admin-bruger kun til portalen — brug ikke en personlig admin-konto
6. **CORS**: I produktion, begræns `BACKEND_CORS_ORIGINS` til den faktiske frontend-URL

### Filbeskyttelse

Følgende filer indeholder følsomme data og er ekskluderet fra git:

- `backend/.env` — ISE credentials
- `backend/config.json` — ISE credentials (gemt via UI)
- `backend/custom_attr_values.json` — lokale attribute-værdier
