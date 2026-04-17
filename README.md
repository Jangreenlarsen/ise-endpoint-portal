# hyperVision ISE Portal

Web-baseret portal til administration af endpoint-enheder i **Cisco ISE 3.1+** via REST API (ERS + Open API).

hyperVision ISE Portal giver netværksadministratorer en hurtig og overskuelig brugerflade til at oprette, importere, browse og redigere endpoints — med fuldt custom attribute workflow og ISE-kompatibel CSV import/export — uden at navigere ISE's tunge admin-GUI.

---

## Features

### Endpoint-styring
- **Opret endpoint** — MAC-adresse, Identity Group (valgfri), beskrivelse og custom attributes (Type, Owner, Lokation, AuthzVlan) med dropdown-valg og inline tilføjelse af nye værdier
- **CSV import** — bulk-opret endpoints fra CSV. Auto-detekterer **ISE CSV format** (Context Visibility eksport med `MACAddress` header, `CUSTOM.*` kolonner) og **simpelt format** (`mac,group,description,type,owner,lokation,authz_vlan`). Preview med validering, succeeded/failed resultat
- **CSV export** — eksportér endpoints til ISE-kompatibel CSV. Brugerdefinerbar kolonne-template (importér header fra CSV-fil via Settings). Default: 36 ISE-kolonner
- **Browse / Edit** — tabelvisning med fuld inline-redigering: Identity Group (dropdown), Description, Type, Owner, Lokation, AuthzVlan. Filter søger på tværs af alle kolonner. "— ingen —" flytter endpoint til Unknown med `staticGroupAssignment=false`

### Custom attributes
- **5 custom attributes**: Type, Owner, Lokation, AuthzVlan + skjult `HypervisionISEPortal`
- **Attributter-side** — dedikeret sidebar-side til administration af tilladte værdier for Type, Owner, Lokation og AuthzVlan. Tilføj/fjern værdier, sync fra ISE
- **Automatisk ISE-definition** — attribute-definitioner oprettes automatisk i ISE via Open API ved første brug
- **HypervisionISEPortal** — usynligt attribut der automatisk sættes på alle endpoints oprettet eller redigeret via portalen. Bruges til at filtrere "Kun portal" vs. "Vis alle" i Browse/Edit

### Konfiguration
- **Settings** — konfigurer ISE-forbindelse (URL, credentials, API-type, TLS, timeout) direkte i browseren. CSV export template-import
- **Logning** — alle ISE-operationer logges med rotation (5 MB, 3 backups)
- **Versionering** — version vises i sidebar og `/api/health`. Single source of truth: `version.json`

## Arkitektur

```
Browser  ──HTTP/JSON──>  FastAPI backend  ──HTTPS/JSON──>  Cisco ISE 3.x
(HTML/JS)                (Python 3.11+)                    (ERS + Open API)
```

Frontend taler kun med backend. Backend er eneste komponent der kommunikerer med ISE. Ingen ISE credentials eksponeres til browseren.

**Backend-lag:**

| Lag | Mappe | Ansvar |
|-----|-------|--------|
| API | `backend/app/api/` | FastAPI routers, input-validering, HTTP-svar |
| Service | `backend/app/services/` | Forretningslogik, orkestrering |
| Integration | `backend/app/ise/` | ISE REST-kald (ERS + Open API) |
| Core | `backend/app/core/` | Config, logging, exceptions |

## Forudsætninger

| Krav | Detaljer |
|------|----------|
| Python | 3.11+ |
| Cisco ISE | 3.1+ (testet med 3.4) |
| ERS API | Aktiveret i ISE: Administration > System > Settings > API Settings |
| Open API | Aktiveret i ISE (til custom attribute definitions) |
| ISE-bruger | Rollen **ERS Admin** |
| Netværk | Backend skal kunne nå ISE på port 443 via HTTPS |

## Hurtig start

```bash
# 1. Klon
git clone https://github.com/Jangreenlarsen/ise-endpoint-portal.git
cd ise-endpoint-portal

# 2. Python environment
cd backend
python -m venv .venv
source .venv/Scripts/activate   # Windows (Git Bash)
# source .venv/bin/activate     # Linux/macOS
pip install -e .

# 3. Konfigurer ISE-forbindelse
cat > .env << 'EOF'
ISE_BASE_URL=https://ise.example.local
ISE_USERNAME=ers-admin
ISE_PASSWORD=din-adgangskode
ISE_VERIFY_TLS=false
EOF

# 4. Start
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Åbn `http://localhost:8000` i browseren. ISE-forbindelsen kan også konfigureres via **Settings**-siden i portalen.

## REST API

| Metode | Path | Beskrivelse |
|--------|------|-------------|
| GET | `/api/health` | Sundhedscheck, version |
| GET | `/api/endpoints?page=1&size=100` | Liste endpoints |
| GET | `/api/endpoints/details?page=1&size=100` | Liste med fuld detalje inkl. custom attrs |
| GET | `/api/endpoints/{id}` | Enkelt endpoint detalje |
| POST | `/api/endpoints` | Opret endpoint |
| POST | `/api/endpoints/bulk` | Bulk-opret |
| PUT | `/api/endpoints/{id}` | Opdater endpoint |
| DELETE | `/api/endpoints/{id}` | Slet endpoint |
| GET | `/api/groups` | Liste endpoint groups |
| GET | `/api/custom-attributes` | Custom attribute værdier |
| POST | `/api/custom-attributes/{name}/values` | Tilføj værdi |
| DELETE | `/api/custom-attributes/{name}/values/{value}` | Fjern værdi |
| POST | `/api/custom-attributes/sync` | Synkroniser fra ISE |
| GET | `/api/settings/backend` | Backend-indstillinger |
| PUT | `/api/settings/backend` | Gem indstillinger |

## Projektstruktur

```
.
+-- backend/
|   +-- app/
|   |   +-- api/            # FastAPI routers
|   |   +-- services/       # Forretningslogik
|   |   +-- ise/            # ISE REST integration
|   |   +-- schemas/        # Pydantic DTOs
|   |   +-- core/           # Config, logging, exceptions
|   |   +-- main.py         # FastAPI entry point
|   +-- logs/               # Runtime log (app.log)
|   +-- pyproject.toml
+-- frontend/
|   +-- index.html
|   +-- css/styles.css
|   +-- js/
|       +-- api.js          # Backend API wrapper
|       +-- app.js          # Router, UI-logik
|       +-- csv.js          # CSV parser/eksport med template-system
|       +-- views/          # create, import, browse, attributes, settings
+-- version.json            # Version single source of truth
+-- INSTALL.md              # Installations- og driftsdokumentation
+-- ARCHITECTURE.md         # Lagstruktur og regler
+-- ISE_API_REFERENCE.md    # Cisco ISE 3.4 API reference
+-- FEATURES.md             # Feature tracking
+-- BUGS.md                 # Bug tracking
+-- CHANGELOG.md            # Alle ændringer med version
```

## Sidebar-sider

| Side | Funktion |
|------|----------|
| **Opret endpoint** | Manuel oprettelse med MAC, group, beskrivelse, custom attributes |
| **Import fra CSV** | Bulk-import med auto-detektion af ISE/simpelt format |
| **Browse / Edit** | Tabel med inline-redigering, filter, "Kun portal" toggle, export |
| **Attributter** | Administrer tilladte værdier for Type, Owner, Lokation, AuthzVlan |
| **Settings** | ISE-forbindelse, CSV export template, frontend preferences |

## Dokumentation

- **[INSTALL.md](INSTALL.md)** — komplet installations-, konfigurations- og driftsguide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — lagstruktur, dataflow, regler
- **[ISE_API_REFERENCE.md](ISE_API_REFERENCE.md)** — Cisco ISE 3.4 ERS + Open API paths, payloads, gotchas
- **[CHANGELOG.md](CHANGELOG.md)** — alle ændringer med versionsnumre
- **[FEATURES.md](FEATURES.md)** — feature-backlog og status
- **[BUGS.md](BUGS.md)** — kendte fejl og løsninger

## Teknologier

- **Backend**: Python 3.11+, FastAPI, httpx (async), Pydantic v2
- **Frontend**: Vanilla HTML/CSS/JS (ingen build-step)
- **ISE integration**: ERS API (endpoints, groups) + Open API (custom attribute definitions)
- **Persistens**: JSON-filer for settings og custom attribute værdier (ingen database)

## Sikkerhed

- ISE credentials gemmes i `.env` eller `config.json` (begge gitignored)
- Portalen har ingen bruger-autentificering — deploy bag reverse proxy med auth i produktion
- TLS-verifikation kan aktiveres med `ISE_VERIFY_TLS=true`

## Licens

Privat repository. Alle rettigheder forbeholdes.
