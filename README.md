# HyperVision ISE Portal

Web-baseret portal til administration af endpoint-enheder i **Cisco ISE 3.4** via REST API (ERS + Open API + MnT).

HyperVision ISE Portal giver netværksadministratorer en hurtig og overskuelig brugerflade til at oprette, importere, browse og redigere endpoints — med fuldt custom attribute workflow, downloadable-ACL editor, session-status via MnT, Change-of-Authorization (CoA reauth/disconnect) og ISE-kompatibel CSV import/export — uden at navigere ISE's tunge admin-GUI.

---

## Features

### Endpoint-styring
- **Opret endpoint** — MAC-adresse, Identity Group (valgfri), beskrivelse og custom attributes (Type, Owner, Lokation, AuthzVlan, AuthzACL, PlatformType) med dropdown-valg og inline tilføjelse af nye værdier
- **CSV import** — bulk-opret endpoints fra CSV. Auto-detekterer **ISE CSV format** (Context Visibility eksport med `MACAddress` header, `CUSTOM.*` kolonner) og **simpelt format**. Preview med validering, skip vs. overskriv eksisterende endpoints, succeeded/failed resultat
- **CSV export** — eksportér endpoints til ISE-kompatibel CSV. Tilknytning (Identity Group) bevares ved roundtrip (export → re-import). Brugerdefinerbar kolonne-template (importér header fra CSV-fil via Settings). Default: 36 ISE-kolonner
- **Browse / Edit** — tabelvisning med fuld inline-redigering af alle managed attrs + Identity Group. Filter søger på tværs af alle kolonner. Sticky toolbar/sidebar. Kolonner kan skjules/vises. Bulk-edit på tværs af markerede rækker. "— ingen —" flytter endpoint til Unknown med `staticGroupAssignment=false`
- **MnT session-status** — aktive ISE-sessioner polles via MnT, og rækker i Browse farves grøn (online) / rød (offline) i realtid
- **CoA reauth / disconnect** — trigger Change-of-Authorization direkte på et endpoint fra Browse-siden. Handling afhænger af PlatformType-binding (reauth eller disconnect)

### Downloadable ACL editor
- **Dedikeret ACL-side** — liste, opret, redigér og slet DACLs (IPv4 / IPv6) i ISE
- **Live syntax-validering** — Cisco IOS ACL-parser fanger de typiske fejl (ukendt protocol, ugyldig adresse, forkerte port-operatorer, manglende wildcard-maske) inden save
- **DACL-specifik regel** — tjekker at source er `any` i alle ACEs (ISE afviser ellers hele DACL'en — portalen fanger fejlen mens brugeren skriver)
- **AuthzACL-binding** — DACL'en kan refereres fra endpoint-attributet `AuthzACL` og pushes til switchen via ISE authorization policy

### Custom attributes
- **6 managed custom attributes**: Type, Owner, Lokation, AuthzVlan, AuthzACL, PlatformType + skjult `HypervisionISEPortal`
- **Attributter-side** — administrér tilladte værdier per attribut. Tilføj/fjern værdier, sync fra ISE. Slet-værdi rydder værdien på eksisterende endpoints (empty-string merge — workaround for ISE ERS PUT merge-adfærd)
- **PlatformType-mapping** — raw device-type fra MnT oversættes til lokal label + CoA-binding (reauth eller disconnect). Sync kan køres med `overwrite=false` (udfyld kun tomme) eller `overwrite=true` (re-derivér alle)
- **Automatisk ISE-definition** — attribute-definitioner oprettes automatisk i ISE via Open API ved første brug
- **HypervisionISEPortal** — usynligt attribut der automatisk sættes på endpoints oprettet/redigeret via portalen. Bruges til at filtrere "Kun portal" vs. "Vis alle" i Browse

### Brugerstyring & autentificering
- **First-run setup** — ved første start opretter portalen en admin-bruger via guided setup-flow
- **Login / logout** — JWT-baseret session, bcrypt-hashede passwords
- **Roller** — `admin` (fuld adgang inkl. bruger-admin og logs), `editor` (opret/redigér endpoints, attrs, DACLs, CoA), `viewer` (read-only)
- **Users-side** — admin kan oprette, ændre rolle, skifte password og slette brugere
- **Change password** — enhver bruger kan skifte sit eget password

### Observability & konfiguration
- **Settings** — konfigurer ISE-forbindelse (URL, credentials, API-type, TLS, timeout) direkte i browseren. Test-connection, CSV export template-import, theme-valg
- **Logs-side** — admin kan streame seneste runtime-log fra backend direkte i browseren
- **Logning** — alle ISE-operationer (REST-kald, CoA, MnT-polls) logges med rotation (5 MB, 3 backups)
- **Dark mode** — lys/mørk theme kan vælges i Settings og persisteres per browser
- **Versionering** — version vises i sidebar og `/api/health`. Single source of truth: `version.json`

## Arkitektur

```
Browser  ──HTTP/JSON──>  FastAPI backend  ──HTTPS/JSON──>  Cisco ISE 3.4
(HTML/JS)                (Python 3.11+)                    (ERS + Open API + MnT)
```

Frontend taler kun med backend. Backend er eneste komponent der kommunikerer med ISE. Ingen ISE credentials eksponeres til browseren.

**Backend-lag:**

| Lag | Mappe | Ansvar |
|-----|-------|--------|
| API | `backend/app/api/` | FastAPI routers, auth-guards, input-validering, HTTP-svar |
| Service | `backend/app/services/` | Forretningslogik, orkestrering |
| Integration | `backend/app/ise/` | ISE REST-kald (ERS + Open API + MnT + CoA) |
| Core | `backend/app/core/` | Config, auth/JWT, logging, exceptions, persistens |

## Forudsætninger

| Krav | Detaljer |
|------|----------|
| Python | 3.11+ |
| Cisco ISE | 3.4 (testet) |
| ERS API | Aktiveret i ISE: Administration > System > Settings > API Settings |
| Open API | Aktiveret i ISE (custom attribute definitions, DACLs) |
| MnT | Bruger med rollen **MnT Admin** (til session-status og CoA) |
| ISE-bruger | Rollen **ERS Admin** (+ **MnT Admin** hvis session/CoA bruges) |
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

Åbn `http://localhost:8000` i browseren. Første gang prompter portalen for opret-admin (setup-flow). Derefter login. ISE-forbindelsen kan også konfigureres via **Settings**-siden.

## REST API

Alle ruter er prefixed med `/api`. `editor`- og `admin`-ruter kræver gyldig JWT-session.

| Metode | Path | Rolle | Beskrivelse |
|--------|------|-------|-------------|
| GET | `/health` | — | Sundhedscheck, version |
| GET | `/auth/status` | — | Er setup kørt? Er bruger logget ind? |
| POST | `/auth/setup` | — | First-run: opret første admin |
| POST | `/auth/login` | — | Login, returnerer JWT |
| POST | `/auth/logout` | any | Logout |
| GET | `/auth/me` | any | Aktuel bruger |
| POST | `/auth/change-password` | any | Skift eget password |
| GET | `/users` | admin | Liste brugere |
| POST | `/users` | admin | Opret bruger |
| PUT | `/users/{id}` | admin | Opdatér bruger (rolle/password) |
| DELETE | `/users/{id}` | admin | Slet bruger |
| GET | `/endpoints` | any | Liste endpoints |
| GET | `/endpoints/details` | any | Pagineret liste med custom attrs |
| GET | `/endpoints/details/all` | any | Alle endpoints med custom attrs (bulk-loop) |
| GET | `/endpoints/session-macs` | any | MAC'er med aktiv MnT-session (grøn/rød farve) |
| GET | `/endpoints/{id}` | any | Enkelt endpoint detalje |
| POST | `/endpoints` | editor | Opret endpoint |
| POST | `/endpoints/bulk` | editor | Bulk-opret |
| PUT | `/endpoints/{id}` | editor | Opdatér endpoint |
| DELETE | `/endpoints/{id}` | editor | Slet endpoint |
| POST | `/endpoints/{id}/coa-reauth` | editor | CoA reauth |
| POST | `/endpoints/{id}/coa-disconnect` | editor | CoA disconnect |
| GET | `/groups` | any | Liste endpoint groups |
| GET | `/custom-attributes` | any | Alle managed attrs + værdier |
| POST | `/custom-attributes/{name}/values` | editor | Tilføj værdi |
| DELETE | `/custom-attributes/{name}/values/{value}` | editor | Fjern værdi (+ ryd på endpoints) |
| POST | `/custom-attributes/sync` | editor | Sync værdier fra ISE |
| POST | `/custom-attributes/PlatformType/sync-mnt` | editor | Udled PlatformType fra MnT |
| GET | `/custom-attributes/PlatformType/mapping` | any | Raw→lokal PlatformType-mapping |
| PUT | `/custom-attributes/PlatformType/mapping` | editor | Gem mapping + CoA-binding |
| GET | `/dacls` | any | Liste DACLs |
| GET | `/dacls/{id}` | any | DACL detalje |
| POST | `/dacls` | editor | Opret DACL |
| PUT | `/dacls/{id}` | editor | Opdatér DACL |
| DELETE | `/dacls/{id}` | editor | Slet DACL |
| POST | `/dacls/validate` | any | Valider DACL-syntax |
| GET | `/settings/backend` | any | Backend-indstillinger |
| PUT | `/settings/backend` | admin | Gem indstillinger |
| POST | `/settings/test` | admin | Test ISE-forbindelse |
| GET | `/logs` | admin | Seneste runtime-log |

## Projektstruktur

```
.
+-- backend/
|   +-- app/
|   |   +-- api/                # FastAPI routers (auth, users, endpoints, groups,
|   |   |                         custom_attributes, dacls, settings, logs, health)
|   |   +-- services/           # Forretningslogik (endpoint, dacl, custom_attribute,
|   |   |                         settings, user)
|   |   +-- ise/                # ISE REST integration (client, endpoints,
|   |   |                         openapi_endpoints, custom_attributes, dacls,
|   |   |                         coa, mnt_sessions)
|   |   +-- schemas/            # Pydantic DTOs
|   |   +-- core/               # Config, auth/JWT, logging, exceptions, persistens
|   |   +-- main.py             # FastAPI entry point
|   +-- logs/                   # Runtime log (app.log)
|   +-- pyproject.toml
+-- frontend/
|   +-- index.html
|   +-- css/styles.css
|   +-- js/
|       +-- api.js              # Backend API wrapper
|       +-- app.js              # Router, UI-logik
|       +-- csv.js              # CSV parser/eksport med template-system
|       +-- views/              # login, create, import, browse, attributes,
|                                 dacls, logs, settings
+-- version.json                # Version single source of truth
+-- INSTALL.md                  # Installations- og driftsdokumentation
+-- ARCHITECTURE.md             # Lagstruktur og regler
+-- ISE_API_REFERENCE.md        # Cisco ISE 3.4 API reference
+-- FEATURES.md                 # Feature tracking
+-- BUGS.md                     # Bug tracking
+-- CHANGELOG.md                # Alle ændringer med version
```

## Sidebar-sider

| Side | Rolle | Funktion |
|------|-------|----------|
| **Opret endpoint** | editor | Manuel oprettelse med MAC, group, beskrivelse, custom attributes |
| **Import fra CSV** | editor | Bulk-import med auto-detektion af ISE/simpelt format, skip/overskriv |
| **Browse / Edit** | any | Tabel med inline-redigering, filter, "Kun portal" toggle, bulk-edit, MnT-status, CoA, export |
| **Attributter** | editor | Administrér tilladte værdier + PlatformType-mapping |
| **ACL** | editor | DACL-liste, editor med live syntax-validering |
| **Logs** | admin | Seneste runtime-log |
| **Users** | admin | Opret/redigér/slet brugere og roller |
| **Settings** | admin | ISE-forbindelse, CSV export template, theme |

## Dokumentation

- **[INSTALL.md](INSTALL.md)** — komplet installations-, konfigurations- og driftsguide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — lagstruktur, dataflow, regler
- **[ISE_API_REFERENCE.md](ISE_API_REFERENCE.md)** — Cisco ISE 3.4 ERS + Open API paths, payloads, gotchas
- **[CHANGELOG.md](CHANGELOG.md)** — alle ændringer med versionsnumre
- **[FEATURES.md](FEATURES.md)** — feature-backlog og status
- **[BUGS.md](BUGS.md)** — kendte fejl og løsninger

## Teknologier

- **Backend**: Python 3.11+, FastAPI, httpx (async), Pydantic v2, PyJWT, bcrypt
- **Frontend**: Vanilla HTML/CSS/JS (ingen build-step)
- **ISE integration**: ERS API (endpoints, groups, DACLs) + Open API (custom attribute definitions, DACLs) + MnT (aktive sessioner, CoA)
- **Persistens**: JSON-filer for settings, custom attribute værdier, brugere og PlatformType-mapping (ingen database)

## Sikkerhed

- ISE credentials gemmes i `.env` eller `config.json` (begge gitignored)
- Bruger-autentificering via JWT + bcrypt-hashede passwords. First-run setup tvinger oprettelse af admin ved første start
- Role-based access control: `admin` / `editor` / `viewer` håndhæves på alle mutating ruter
- TLS-verifikation kan aktiveres med `ISE_VERIFY_TLS=true`
- Deploy bag reverse proxy med TLS i produktion

## Licens

Privat repository. Alle rettigheder forbeholdes.
