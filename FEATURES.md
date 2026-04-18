# Features

Alle nye features registreres her FØR implementering påbegyndes.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte lag.
**Status**: `planned` · `in-progress` · `done`

---

## Aktive / færdige

- `[done] 2026-04-15 — Projekt bootstrap` — oprettet regel-filer, backend FastAPI skeleton, frontend skeleton. Lag: alle.
- `[done] 2026-04-15 — ISE endpoint listning` — hent liste af endpoints fra ISE 3.4 ERS API og vis i frontend tabel. Lag: backend (api, services, ise), frontend.
- `[done] 2026-04-15 — ISE endpoint group listning` — hent endpoint groups. Lag: backend (api, services, ise), frontend.
- `[done] 2026-04-15 — Health check endpoint` — `/api/health` til at verificere backend kører. Lag: backend (api).
- `[done] 2026-04-15 — Sidebar navigation` — venstre-menu med views: Opret / Import / Browse / Settings. Hash-baseret routing. Lag: frontend.
- `[done] 2026-04-15 — Opret endpoint view` — manuel indtastning af MAC, gruppe, beskrivelse. Validering af MAC format. Lag: frontend.
- `[done] 2026-04-15 — CSV import view` — upload fil eller paste CSV, preview med validering, bulk opret via backend. Lag: frontend, backend (api, services, ise).
- `[done] 2026-04-15 — Bulk create endpoints` — `POST /api/endpoints/bulk` der tager en liste og returnerer succeeded/failed. Lag: backend.
- `[done] 2026-04-15 — Browse/edit view` — liste endpoints, inline rediger beskrivelse, slet. Lag: frontend, backend (api PUT/DELETE).
- `[done] 2026-04-15 — Update endpoint endpoint` — `PUT /api/endpoints/{id}` generisk (description, group_id). Erstatter tidligere update_group. Lag: backend (ise, services, api).
- `[done] 2026-04-15 — Backend settings persistence` — `backend/config.json` override-fil. `GET/PUT /api/settings/backend` eksponerer ISE connection settings (url, user, password, api_type, verify_tls, timeout). Refresh af settings + reset af ISE client efter save. Lag: backend (core, schemas, services, api).
- `[done] 2026-04-15 — Settings view` — frontend form for backend ISE connection (password write-only) + frontend preferences (localStorage). Lag: frontend.

## Planlagte — Prioritet 1 (vigtigt nu)

- `[done] 2026-04-17 — Bulk throttling` — 150ms delay mellem ISE-kald i `bulk_create` for at overholde Ciscos 5–10 req/sec grænse. Forhindrer ERS overload ved store CSV imports. Lag: backend (services). Ref: [ISE_API_REFERENCE.md § Bulk](ISE_API_REFERENCE.md).
- `[planned] 2026-04-16 — 409 Conflict → "skipped"` — ISE returnerer HTTP 409 når endpoint allerede eksisterer. Mappér til en `skipped` liste i `BulkResult` i stedet for `failed`, så bruger kan skelne fejl fra dubletter. Lag: backend (services, schemas), frontend (import view). Ref: ISE status code 409.
- `[planned] 2026-04-16 — Server-side filter/search` — brug ERS filter-syntaks (`?filter=mac.CONTAINS.xx`) i `/api/endpoints` så Browse view ikke er begrænset til max 100 endpoints client-side. Tilføj `?search=` query param i backend router der oversættes til ERS filter. Lag: backend (api, ise). Ref: [ISE_API_REFERENCE.md § Filter syntax](ISE_API_REFERENCE.md).
- `[planned] 2026-04-16 — Parse Location header efter POST` — ERS returnerer `Location: .../endpoint/{uuid}` ved 201 Created. Parse dette for at returnere det nye endpoint-ID direkte, i stedet for en follow-up GET. Lag: backend (ise client, endpoints repository).
- `[planned] 2026-04-16 — ISE connectivity test` — "Test forbindelse" knap i Settings der prøver en autenticeret GET mod ISE og viser success/fejl uden at gemme. Giver bruger feedback inden save. Lag: backend (api/settings ny route), frontend (settings view).
- `[done] 2026-04-16 — CSV export template` — erstat hardkodet 100+ kolonner med brugerdefinerbar CSV-template (default: 34 kolonner fra ISE). Template kan importeres fra CSV-fil (header-only) og persisteres i localStorage. Lag: frontend (csv.js, settings view).
- `[done] 2026-04-16 — Identity Group "ingen" → Unknown` — "— ingen —" i Browse/Edit group-dropdown flytter endpoint til Unknown-gruppen og disabler staticGroupAssignment. Kolonne omdøbt til "Identity Group". Lag: backend (schemas, ise, services), frontend (browse view).
- `[done] 2026-04-17 — Custom attribute "Type" + Attributter-side` — nyt custom attribute "Type". Ny sidebar-side "Attributter" til at administrere værdier for Type, Owner, Lokation, AuthzVlan. Lag: backend (core, schemas, ise, services), frontend (ny view, sidebar, create, browse, import, csv).
- `[done] 2026-04-17 — HypervisionISEPortal skjult attribut + filter` — usynligt custom attribute "HypervisionISEPortal" sættes automatisk ved oprettelse og redigering. Toggle-knap i Browse/Edit for at vise kun portal-endpoints vs. alle. Lag: backend (core, ise, services), frontend (browse view).
- `[done] 2026-04-17 — Bulk select + bulk actions i Browse/Edit` — fjern individuelle Save/Del knapper per række. Tilføj checkbox per række + global select-all i header. Bulk-handlinger (Gem valgte / Slet valgte) i toolbar. Lag: frontend (browse view, css).
- `[done] 2026-04-17 — Global Gem alle-knap i Browse/Edit` — global save-knap i toolbar ved siden af Refresh/Export/Kun portal. Tracker dirty-state per række og gemmer alle ændrede endpoints med ét klik. Lag: frontend (browse view, css).
- `[done] 2026-04-17 — Bulk Rediger valgte i Browse/Edit` — "Rediger valgte" knap der åbner en modal til at sætte værdier (group, description, type, owner, lokation, authzvlan) på alle valgte endpoints på én gang. Lag: frontend (browse view, css).
- `[done] 2026-04-17 — Concurrent endpoint detail fetch` — parallelisér GET af individuelle endpoints med asyncio.gather + semaphore (max 5 samtidige). Reducerer load-tid markant. Lag: backend (services).
- `[done] 2026-04-18 — Export kun valgte endpoints` — Export CSV i Browse/Edit eksporterer nu kun de valgte endpoints hvis noget er selekteret. Hvis ingen er valgt, eksporteres alle (filtrerede) som før. Lag: frontend (browse view).
- `[done] 2026-04-18 — Portal-default CSV template + auto-extend ved ISE import` — "Nulstil"-knap i CSV Export Template giver nu kun portalens egne kolonner (MAC, IdentityGroup, Description, StaticGroupAssignment, CUSTOM.Type/Owner/Lokation/AuthzVlan/HypervisionISEPortal) i stedet for det store 34-kolonne ISE-template. Når en ISE-template importeres, udvides den automatisk med portal-kolonner der mangler, så export aldrig taber portal-data. Lag: frontend (csv.js, settings view).

## Planlagte — Prioritet 2 (bør have)

- `[planned] — Endpoint detalje-view` — klik på et endpoint i Browse for at se alle felter (groupId, profileId, customAttributes) via individual GET. Inline edit af alle felter. Lag: frontend, backend (api, services).
- `[planned] — ERS filter-operatorer i Browse` — dropdown i UI for felt (mac, name, description) + operator (EQ, CONTAINS, STARTSW) til at bygge server-side filter. Lag: frontend, backend.
- `[planned] — Gruppevalg i Browse/edit` — tilføj dropdown i rækken så bruger kan flytte endpoint til en anden gruppe direkte. Lag: frontend (browse view), bruger allerede PUT /api/endpoints/{id}.
- `[done] 2026-04-17 — Multi-page pagination` — Browse view med forrige/næste paginering + page size selector direkte i toolbar. Backend returnerer total count via `PaginatedEndpointDetails`. Lag: frontend, backend.
- `[planned] — Open API support` — implementer parallel integration mod `/api/v1/endpoint` (ISE 3.4 default). Payload og response shapes afviger fra ERS. Bruger vælger api_type i Settings. Lag: backend (ny `app/ise/openapi_endpoints.py`), service-lag dispatcher baseret på `config.settings.ise_api_type`. Ref: [ISE_API_REFERENCE.md § Open API](ISE_API_REFERENCE.md).

## Planlagte — Prioritet 3 (nice to have)

- `[planned] — ANC quarantine actions` — "Quarantine" og "Clear" knapper per endpoint i Browse view. Bruger ERS `/ers/config/ancendpoint/apply` og `/clear`. Lag: backend (ise, services, api), frontend.
- `[done] 2026-04-16 — ISE-kompatibel CSV import/export` — import forstår ISE Context Visibility CSV-format (MACAddress, IdentityGroup, Description, CUSTOM.* kolonner) + simpelt format. Export fra Browse genererer ISE-kompatibelt CSV med alle 100+ kolonner. Fælles CSV-modul i `js/csv.js`. Lag: frontend (csv.js, import view, browse view).
- `[done] 2026-04-16 — Fuld Browse/Edit med alle felter` — browse-tabellen viser MAC, Group (dropdown), Description, Owner, Lokation, AuthzVlan med fuld inline redigering af alle felter. Filter søger i alle felter. Group valgfri ved oprettelse.
- `[done] 2026-04-16 — Custom attributes i Browse/Edit view` — henter fuld endpoint-detalje inkl. custom attrs fra ISE. Nye routes: `GET /api/endpoints/details`, `GET /api/endpoints/{id}`. Lag: backend (api, services, schemas), frontend (api, browse view).
- `[done] 2026-04-16 — Installations- og driftsdokumentation` — INSTALL.md med forudsætninger, opsætning, konfiguration, brug af alle views, API-reference, logning, fejlsøgning, drift og sikkerhed. Lag: docs.
- `[done] 2026-04-16 — Custom endpoint attributes (Owner, Location, AuthzVlan)` — dropdown-lister i Opret endpoint view med mulighed for at tilføje nye værdier. CSV import understøtter custom attr kolonner. Backend: lokal registry (`custom_attr_values.json`), ISE sync, attribute definition management. Lag: backend (core, ise, schemas, services, api), frontend (api, create view, import view).
- `[planned] — SGT (Security Group Tag) tildeling` — vis/ændr `securityGroupId` per endpoint. Kræver lookup mod `/ers/config/sgt`. Lag: backend (ise, services), frontend.
- `[planned] — Dark mode` — theme toggle i frontend preferences (CSS variabler). Lag: frontend.
- `[planned] — Export til CSV` — "Download CSV" knap i Browse view der eksporterer nuværende liste. Lag: frontend.
- `[planned] — Audit log view` — læs `backend/logs/app.log` og vis i en tabel i frontend. Lag: backend (api), frontend.
