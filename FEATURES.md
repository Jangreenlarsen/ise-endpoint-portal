# Features

Alle nye features registreres her FØR implementering påbegyndes.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte lag.
**Status**: `planned` · `in-progress` · `done`

---

## Aktive / færdige

- `[done] 2026-04-20 — PlatformType attribut + AireOS-aware CoA + kolonne hide/unhide` — nyt managed custom attribute "PlatformType" på endpoints (frie værdier som airos, iosxe, iossw, nxos osv.; administreres på Attributter-siden). Vises som ny "Platform"-kolonne i Browse/Edit, kan redigeres inline + i detail-modal + i bulk-edit, eksporteres/importeres via CSV (`CUSTOM.PlatformType`) og oprettes via Opret-formularen. Når global "CoA reauth"-toggle er TIL: hvis et gemt endpoint har `platformType == "airos"` sender portalen en CoA-Disconnect i stedet for CoA-Reauth (AireOS WLC honorerer ikke reauth pålideligt for policy-skift). Toolbar-knap "Kolonner ▾" giver hide/unhide pr. kolonne (persisteret i `localStorage`, default vis alle). Lag: backend (core/custom_attr_store, schemas/endpoint, services/endpoint_service), frontend (browse, create, import, attributes views, csv.js, css).

- `[done] 2026-04-20 — Persistente filtre i Browse/Edit` — alle aktive filtre i Browse/Edit (kolonnefiltre, server-side MAC-filter, "Kun portal"-toggle) gemmes i `localStorage` og restoreres når man vender tilbage til siden eller skifter mellem views. Filtrene fjernes kun ved aktiv handling (uncheck checkbox / ryd værdi / klik toggle). Lag: frontend (browse view).

- `[done] 2026-04-20 — AuthzACL attribut + Cisco IOS access-list editor` — nyt custom attribute "AuthzACL" på endpoints (dropdown med navne på DACL'er fra ISE; navngivet i samme stil som AuthzVlan). Ny sidebar-side "ACL" med editor for Cisco IOS-style access-list (DACL): liste over alle DACL'er fra ISE (både portal-oprettede og admin-oprettede), opret/rediger/slet, real-time syntaks-validering i backend (permit/deny + protocol + src/dst), endelig validering i ISE ved gem. Lag: backend (ise/dacls, services/dacl_service, schemas/dacl, api/dacls, schemas/endpoint, services/endpoint_service, custom_attr_store), frontend (api.js, app.js, views/dacls.js, views/browse.js, views/create.js, views/import.js, csv.js, index.html, css/styles.css).

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

- `[done] 2026-04-19 — CoA Disconnect (deauthenticate)` — ny knap der udløser MnT `GET /admin/API/mnt/CoA/Disconnect/{psn}/{mac}/{disconnectType}` så klienten deautentificeres på WLC/switch og skal gen-associere. Brugbar når man vil tvinge ny DHCP (fx ved VLAN-skift). Per-endpoint knap i detail-modal + bulk-knap "Disconnect valgte". Admin kan konfigurere `coa_disconnect_type` i Settings (default 0 = DEFAULT deauth for wireless; 1 = port-bounce for wired; 2 = port-shutdown). Lag: backend (core, schemas, services, ise, api), frontend (api, settings, browse).

- `[done] 2026-04-19 — Browse/Edit refresh efter save` — efter hver succesful endpoint-save (detail-modal, Gem alle, Gem valgte) kaldes `load()` så tabellen genindlæses fra ISE. Filter- og portal-toggle-state bevares. Lag: frontend (browse view).

- `[done] 2026-04-19 — Global CoA reauth toggle i Browse/Edit` — toolbar-knap "CoA reauth: TIL/FRA" (persisteret i `localStorage`). Når TIL kaldes `POST /api/endpoints/{id}/coa-reauth` for hvert gemt endpoint efter save. Backend rammer ISE MnT `GET /admin/API/mnt/CoA/Reauth/{psn}/{mac}/{type}` — tvinger fornyet policy-evaluering så attribut-ændringer slår igennem uden at brugeren skal genforbinde. Admin kan konfigurere PSN-hostnavn og reauth type i Settings (default reauth_type=1 RERUN; tomt PSN afledes fra `ise_base_url`). Lag: backend (core, schemas, services, ise, api), frontend (api, settings view, browse view).

- `[done] 2026-04-19 — Slet attribut-værdi rydder også værdien i ISE` — `DELETE /api/custom-attributes/{attr}/values/{value}` scanner nu alle ISE-endpoints og rydder den givne værdi på alle endpoints der bruger den (feltet sættes til tomt; øvrige custom attributter bevares). Frontend-confirm advarer om opførslen og success-besked viser antal scannede/ryddede endpoints. Lag: backend (ise, services, schemas, api), frontend (attributes view).

- `[done] 2026-04-19 — Authentication + rollebaseret adgangskontrol` — lokal brugerbase i `backend/users.json` (PBKDF2-SHA256 med 600k iterations), stateless signerede tokens (HMAC-SHA256, 24h TTL, auto-genereret secret i `backend/auth_secret.key`). Tre roller: `admin` (alt), `editor` (CRUD på endpoints), `viewer` (kun GET). Første-gangs opsætning via login-siden når ingen brugere eksisterer. Ny "Brugere & roller"-sektion i Settings (admin-only) til CRUD på brugere. "Skift password"-sektion for alle. Sidebar viser kun ruter brugeren har adgang til. Lag: backend (core, schemas, services, api), frontend (auth.js, login view, app.js, api.js, settings view, index.html, css).

## Planlagte — Prioritet 1 (vigtigt nu)

- `[done] 2026-04-17 — Bulk throttling` — 150ms delay mellem ISE-kald i `bulk_create` for at overholde Ciscos 5–10 req/sec grænse. Forhindrer ERS overload ved store CSV imports. Lag: backend (services). Ref: [ISE_API_REFERENCE.md § Bulk](ISE_API_REFERENCE.md).
- `[done] 2026-04-18 — 409 Conflict → "skipped"` — ISE returnerer HTTP 409 når endpoint allerede eksisterer. Mappes nu til en `skipped` liste i `BulkResult` i stedet for `failed`, så bruger kan skelne fejl fra dubletter. Import-view viser tre spande. Lag: backend (services, schemas), frontend (import view).
- `[done] 2026-04-18 — Server-side filter/search` — `?search=` query parameter på `/api/endpoints`, `/endpoints/details` og `/details/all` oversættes til ERS `mac.CONTAINS.xxx` filter. Ny MAC-søgeboks i Browse-toolbaren (debounced) gør det muligt at finde endpoints uden at hente alle ISE-sider. Lag: backend (api, ise, services), frontend (api, browse view, css).
- `[done] 2026-04-18 — Parse Location header efter POST` — ERS returnerer `Location: .../endpoint/{uuid}` ved 201 Created. Parses nu i `IseEndpointRepository.create` så det nye id returneres direkte uden follow-up GET. `POST /api/endpoints` svarer med `{"status":"created","id":"<uuid>"}`. Lag: backend (ise client, endpoints repository, services, api).
- `[done] 2026-04-18 — ISE connectivity test` — `POST /api/settings/test` laver en autenticeret GET mod ISE (endpoint groups, size=1) med valgfrit medsendte eller aktive settings. Ny "Test forbindelse"-knap i Settings viser success/latency eller fejl uden at gemme. Lag: backend (schemas, services, api), frontend (api, settings view).
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

- `[done] 2026-04-18 — Endpoint detalje-view` — klik på MAC-linket i Browse åbner en modal der henter fuld `GET /api/endpoints/{id}` med alle felter (groupId, profileId, portalUser, identityStore, customAttributes). Inline edit af description/group/type/owner/lokation/authzvlan + Gem-knap. Lag: frontend (browse view, css), backend (schemas, services).
- `[done] 2026-04-18 — ERS filter-operatorer i Browse` — felt-dropdown (MAC/Name/Description) + operator-dropdown (CONTAINS/EQ/NEQ/STARTSW/ENDSW) + værdi-input (debounced) bygger ERS filter-expression og sender den til backend som gentagelig `?filter=` query. Backend tager filter-liste videre til ISE. Lag: frontend (browse view, css, api), backend (api, services).
- `[done] 2026-04-17 — Gruppevalg i Browse/edit` — dropdown per række flytter endpoint til en anden gruppe via PUT /api/endpoints/{id}. Inkluderet i fuld Browse/Edit + bulk-save. Lag: frontend (browse view).
- `[done] 2026-04-17 — Multi-page pagination` — Browse view med forrige/næste paginering + page size selector direkte i toolbar. Backend returnerer total count via `PaginatedEndpointDetails`. Lag: frontend, backend.
- `[done] 2026-04-18 — Open API support` — parallel integration mod `/api/v1/endpoint` implementeret i `app/ise/openapi_endpoints.py` (list/get/create/update/delete + `endpoint-identity-group`). Response-shapes normaliseres til ERS-form så service-laget deler kode. `EndpointService.__init__` dispatcher baseret på `config.settings.ise_api_type`. `/api/settings/test` prober korrekt endpoint pr. api_type. Lag: backend (ise, services, settings). Ref: [ISE_API_REFERENCE.md § Open API](ISE_API_REFERENCE.md).

## Planlagte — Prioritet 3 (nice to have)

- `[planned] — ANC quarantine actions` — "Quarantine" og "Clear" knapper per endpoint i Browse view. Bruger ERS `/ers/config/ancendpoint/apply` og `/clear`. Lag: backend (ise, services, api), frontend.
- `[done] 2026-04-16 — ISE-kompatibel CSV import/export` — import forstår ISE Context Visibility CSV-format (MACAddress, IdentityGroup, Description, CUSTOM.* kolonner) + simpelt format. Export fra Browse genererer ISE-kompatibelt CSV med alle 100+ kolonner. Fælles CSV-modul i `js/csv.js`. Lag: frontend (csv.js, import view, browse view).
- `[done] 2026-04-16 — Fuld Browse/Edit med alle felter` — browse-tabellen viser MAC, Group (dropdown), Description, Owner, Lokation, AuthzVlan med fuld inline redigering af alle felter. Filter søger i alle felter. Group valgfri ved oprettelse.
- `[done] 2026-04-16 — Custom attributes i Browse/Edit view` — henter fuld endpoint-detalje inkl. custom attrs fra ISE. Nye routes: `GET /api/endpoints/details`, `GET /api/endpoints/{id}`. Lag: backend (api, services, schemas), frontend (api, browse view).
- `[done] 2026-04-16 — Installations- og driftsdokumentation` — INSTALL.md med forudsætninger, opsætning, konfiguration, brug af alle views, API-reference, logning, fejlsøgning, drift og sikkerhed. Lag: docs.
- `[done] 2026-04-16 — Custom endpoint attributes (Owner, Location, AuthzVlan)` — dropdown-lister i Opret endpoint view med mulighed for at tilføje nye værdier. CSV import understøtter custom attr kolonner. Backend: lokal registry (`custom_attr_values.json`), ISE sync, attribute definition management. Lag: backend (core, ise, schemas, services, api), frontend (api, create view, import view).
- `[planned] — SGT (Security Group Tag) tildeling` — vis/ændr `securityGroupId` per endpoint. Kræver lookup mod `/ers/config/sgt`. Lag: backend (ise, services), frontend.
- `[done] 2026-04-17 — Dark mode` — theme toggle i Settings (light/dark) gemt i localStorage. `applyTheme`/`initTheme` i [settings.js](frontend/js/views/settings.js) sætter `data-theme="dark"` på `<html>`; CSS-variationer i [styles.css § Dark theme](frontend/css/styles.css). Lag: frontend.
- `[done] 2026-04-18 — Export til CSV` — "Export CSV" knap i Browse/Edit toolbar eksporterer selekterede, filtrerede eller alle endpoints (auto-hentning fra ISE hvis ingen selektion og intet filter). ISE-kompatibelt format via `toIseCsv()` fra `csv.js`. Lag: frontend.
- `[done] 2026-04-19 — Audit log view` — ny sidebar-side "Log" der læser `backend/logs/app.log` via `GET /api/logs` og viser parsede entries (timestamp, niveau, logger, besked) i en filtrerbar tabel. Niveau- og fritekst-filter, refresh-knap, farvekodet niveau. Lag: backend (api), frontend.
