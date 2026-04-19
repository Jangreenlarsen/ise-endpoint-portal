# Changelog

Alle kodeændringer registreres her. Nyeste øverst.
Versionering: `version.json` er single source of truth. Se [CLAUDE.md](CLAUDE.md) regel 1.

---

## [1.19.0 build 0038] — 2026-04-19 — feat: Slet attribut-værdi rydder også værdien i ISE

- **backend**: `app/ise/endpoints.py` — ny `IseEndpointRepository.set_custom_attributes(endpoint_id, attrs)` der altid sender hele `customAttributes`-blokken (modsat `update()` der springer feltet over når blokken er tom), så udeladte nøgler ryddes på ISE.
- **backend**: `app/services/custom_attribute_service.py` — `remove_value()` er nu `async` og scanner samtlige ISE-endpoints via `list_page` + `get`. For hvert endpoint hvor `customAttributes[attr] == value` bygges en ny dict uden den nøgle (øvrige attributter inkl. skjult `HypervisionISEPortal` bevares) og PUT'es tilbage. Returnerer nu `RemoveValueResult` med `scanned_endpoints` og `cleared_endpoints`.
- **backend**: `app/schemas/custom_attribute.py` — ny `RemoveValueResult` (attributes + scanned_endpoints + cleared_endpoints).
- **backend**: `app/api/custom_attributes.py` — `DELETE /custom-attributes/{attr}/values/{value}` awaiter nu service-kaldet og returnerer `RemoveValueResult`.
- **frontend**: `js/views/attributes.js` — confirm-dialog advarer nu om at alle ISE-endpoints med den værdi får feltet ryddet. Info-besked vises mens scan/PUT kører; success-besked viser antal scannede og ryddede endpoints.

## [1.18.1 build 0037] — 2026-04-19 — fix: Login-kort for smalt pga. grid-kolonne

- **frontend**: `css/styles.css` — `.app` bruger `grid-template-columns: 240px 1fr`, så selv når sidebar skjules med `display:none` reserveres de 240px stadig. Tilføjet `body.auth-mode .app { grid-template-columns: 1fr }` + `body.auth-mode .sidebar { display: none }` + `body.auth-mode .content { padding: 0 }` så login-siden får fuld bredde. Login-card justeret til `width: 380px` med `box-sizing: border-box` og `min-height: 100vh` på wrap for centrering.
- **frontend**: `js/views/login.js`, `js/app.js` — fjernet inline `sidebar.style.display = "none/''"` (CSS-klassen `auth-mode` styrer nu al visning).

## [1.18.0 build 0036] — 2026-04-19 — feat: Authentication + rollebaseret adgangskontrol

**BREAKING**: Alle `/api/*` ruter (undtagen `/api/health` og `/api/auth/*`) kræver nu gyldig Bearer-token. Klienter uden auth vil få 401.

- **backend**: `app/core/auth.py` — **ny fil**. PBKDF2-SHA256 password hashing (600k iter), stateless signerede tokens (HMAC-SHA256, 24h TTL). Auto-genereret secret i `backend/auth_secret.key` (gitignored).
- **backend**: `app/core/user_store.py` — **ny fil**. Persistens af brugerkonti i `backend/users.json` (gitignored).
- **backend**: `app/schemas/user.py` — **ny fil**. `User`, `UserCreate`, `UserUpdate`, `LoginRequest/Response`, `AuthStatus`, `SetupRequest`, `ChangePasswordRequest`. Roller: `Literal["admin","editor","viewer"]`.
- **backend**: `app/services/user_service.py` — **ny fil**. CRUD, login (opdaterer `last_login`), first-run setup, change-password, beskyttelse mod at slette sig selv eller sidste admin.
- **backend**: `app/api/auth.py` — **ny fil**. `/auth/status`, `/login`, `/logout`, `/setup`, `/me`, `/change-password`.
- **backend**: `app/api/users.py` — **ny fil**. CRUD på `/users` (admin only).
- **backend**: `app/api/deps.py` — `get_current_user` (parser Bearer-token, validerer signatur+expiry+rolle-match mod DB), `require_roles(*roles)` factory, færdige deps: `require_admin`, `require_editor`, `require_any`.
- **backend**: `app/api/endpoints.py` — GET-ruter kræver `require_any`; POST/PUT/DELETE kræver `require_editor`.
- **backend**: `app/api/groups.py`, `app/api/custom_attributes.py` — GET kræver `require_any`, mutationer kræver `require_editor`.
- **backend**: `app/api/settings.py`, `app/api/logs.py` — hele routeren kræver `require_admin`.
- **backend**: `app/main.py` — registrerer `auth_api.router` og `users.router`.
- **frontend**: `js/auth.js` — **ny fil**. Token + user persistens i localStorage, `isAdmin()`, `isEditor()`, `hasRole()`.
- **frontend**: `js/api.js` — sender `Authorization: Bearer <token>` automatisk; 401-svar clearer token og kalder `onUnauthorized`-handler. Nye endpoints: `authStatus`, `login`, `logout`, `setupAdmin`, `changePassword`, `listUsers`, `createUser`, `updateUser`, `deleteUser`.
- **frontend**: `js/views/login.js` — **ny fil**. Login-form; detekterer `setup_required` og viser "Første-gangs opsætning"-form i stedet, der opretter admin-bruger.
- **frontend**: `js/app.js` — auth-aware routing: viser login hvis ikke logget ind, filtrerer sidebar-nav efter rolle, blokerer views hvor brugerens rolle ikke matcher. Rute-roller: `create`/`import`/`attributes` → admin+editor; `browse`/`settings` → alle; `logs` → admin.
- **frontend**: `js/views/settings.js` — ny "Brugere & roller"-card (admin-only) med tabel, rolle-dropdown, reset-password, slet, og opret-bruger-form. Ny "Skift dit password"-card for alle. Backend-card vises kun for admins.
- **frontend**: `index.html` — bruger-info-blok i sidebar-footer (brugernavn, rolle-badge, log-ud-knap).
- **frontend**: `css/styles.css` — login-card, role-badges (`.role-admin`, `.role-editor`, `.role-viewer`), `.users-table`, `.user-create-row`, `.linkish`-knap + dark-mode varianter.
- **ops**: `.gitignore` — tilføjet `backend/users.json` og `backend/auth_secret.key`.

## [1.17.0 build 0035] — 2026-04-19 — feat: Audit log view (Prioritet 3-batch afslutning)

- **backend**: `app/api/logs.py` — **ny fil**. `GET /api/logs?lines=&level=&search=` læser `settings.log_file` (default `logs/app.log`), parser hver linje mod formatet `%(asctime)s | %(levelname)-8s | %(name)s | %(message)s`, understøtter niveau-filter (DEBUG/INFO/WARNING/ERROR/CRITICAL) og fritekst-søgning. Returnerer nyeste øverst. Uparselige linjer appendes som fortsættelse på foregående entry (multi-line tracebacks).
- **backend**: `app/main.py` — registrerer `logs.router` under `/api`.
- **frontend**: `js/api.js` — ny `getLogs(lines, level, search)` helper.
- **frontend**: `js/views/logs.js` — **ny fil**. Renderer log-tabel (tidspunkt, niveau, logger, besked) med niveau-dropdown, linje-antal-dropdown (100–5000), debounced fritekst-søgefelt og refresh-knap. Farvekodede niveau-badges.
- **frontend**: `index.html`, `js/app.js` — ny "Log" sidebar-link og route (`#/logs`).
- **frontend**: `css/styles.css` — `.logs-toolbar`, `.log-table`, `.log-level-*` badge-styling + dark-mode varianter.
- **features**: `FEATURES.md` — markerer `Dark mode`, `Export til CSV` og `Audit log view` som `done` (de to første var allerede implementeret men ikke registreret).

## [1.16.2 build 0034] — 2026-04-18 — fix: Export CSV uden selektion eksporterer nu alle endpoints

- **frontend**: `js/views/browse.js` — Export CSV-knappen eksporterer ved ingen selektion og ingen aktivt filter nu **alle** endpoints på tværs af ISE-sider (via `listAllEndpointDetails()`, bruger `allRowsCache` hvis tilgængelig), ikke kun den aktuelle pagination-side. Filter-mode og selektion-baseret export uændret. Knappen disables under hentning og resultat-labelen indikerer "(alle)".

## [1.16.1 build 0033] — 2026-04-18 — fix: ERS filter-dropdown begrænset til 'mac' (name/description ikke understøttet)

- **frontend**: `js/views/browse.js` — server-side filter-felt-dropdown reduceret til kun `MAC`. ISE 3.4 returnerer `400 The filter field 'name'/'description' is not supported` for de to andre felter på trods af hvad ERS SDK-docs siger. Name/Description kan stadig filtreres client-side via kolonnefilter-rækken.
- **docs**: `ISE_API_REFERENCE.md` — filtrerbare felter opdateret med empirisk verifikation: `mac` virker, `name`/`description` returnerer 400. Konklusion: server-side filter er i praksis begrænset til MAC.

## [1.16.0 build 0032] — 2026-04-18 — feat: Prioritet 2-batch (detalje-view, ERS filter-operatorer, Open API support)

- **backend**: `app/schemas/endpoint.py` — `EndpointDetail` udvidet med `profile_id`, `static_profile`, `portal_user`, `identity_store`, `identity_store_id`.
- **backend**: `app/services/endpoint_service.py` — dispatcher på `config.settings.ise_api_type`: bruger `OpenApiEndpointRepository`/`OpenApiEndpointGroupRepository` når `openapi` er valgt, ellers ERS. `list_endpoints`/`list_endpoint_details`/`list_all_endpoint_details` accepterer ny `filters`-parameter (liste af ERS-ekspressioner som `mac.STARTSW.AA`). Ny `_combine_filters()` merger eksplicitte filters med legacy `search`-shortcut. `get_endpoint` udfylder nu profile/portal/identity felter.
- **backend**: `app/api/endpoints.py` — tre GET-routes (`/endpoints`, `/endpoints/details`, `/endpoints/details/all`) tager nu gentagelig `?filter=<field>.<OP>.<value>` query param.
- **backend**: `app/ise/openapi_endpoints.py` — **ny fil**. `OpenApiEndpointRepository` + `OpenApiEndpointGroupRepository` med samme interface som ERS-repoene. Normaliserer Open API responses til ERS-shape (bl.a. wrap af flat `customAttributes` til double-nested) så service-laget kan dele kode. Parse id fra response-body eller Location-header ved create.
- **backend**: `app/services/settings_service.py` — `/api/settings/test` prober nu den korrekte API (ERS `/ers/config/endpointgroup` eller Open API `/api/v1/endpoint-identity-group`) afhængig af `ise_api_type`. Auth-fejl-besked tilpasses (ERS Admin-rolle vs. Open API-adgang).
- **frontend**: `js/api.js` — `listEndpoints`/`listEndpointDetails`/`listAllEndpointDetails` accepterer ny `filters`-array og sender dem som gentagelige `?filter=...` query params.
- **frontend**: `js/views/browse.js` — MAC-søgeboksen erstattet med kombineret felt-dropdown (MAC/Name/Description) + operator-dropdown (CONTAINS/EQ/NEQ/STARTSW/ENDSW) + værdi-input (debounced). Nyt endpoint detalje-modal: klik på MAC-linket i en række for at hente fuld `GET /api/endpoints/{id}` med alle felter (profile_id, portal_user, identity_store) og inline edit af description/group/type/owner/lokation/authzvlan med Gem-knap der kalder PUT og opdaterer lokal række.
- **frontend**: `css/styles.css` — styling for `.server-filter` (field+op+value), `.detail-modal` + `.detail-grid`, `a.mac-link` og dark-mode varianter.

## [1.15.1 build 0031] — 2026-04-18 — fix: Browse/Edit count viser page/total i server-side mode

- **frontend**: `js/views/browse.js` — i server-side pagination viste toolbaren kun `${allRows.length} endpoints` (antal rækker på aktuel side) selvom pagination-baren allerede viste totalen. Ændret til `${allRows.length} / ${totalEndpoints} endpoints` så forholdet mellem viste rækker og total er konsistent med filter-mode visningen.

## [1.15.0 build 0030] — 2026-04-18 — feat: Prioritet 1-batch (409 skipped, server-side søg, Location-header, test forbindelse)

- **backend**: `app/schemas/endpoint.py` — tilføjet `skipped: list[str]` til `BulkResult`.
- **backend**: `app/services/endpoint_service.py` — `bulk_create` mapper `IseApiError(409)` til `skipped` i stedet for `failed`, så brugeren kan skelne dubletter fra reelle fejl. `create_endpoint` returnerer nu endpoint-id. Ny `_build_search_filters()` der oversætter `?search=` til ERS filter-syntaks `mac.CONTAINS.xxx`.
- **backend**: `app/ise/endpoints.py` — `list_page`/`list_all` accepterer valgfri `filters`-liste (flere = AND). `create()` læser `Location`-headeren og returnerer det nye UUID i stedet for at kræve follow-up GET. Ny helper `_id_from_location()`.
- **backend**: `app/ise/client.py` — `request()` har fået valgfri `return_response=True` der returnerer `(data, response)` så kaldere kan læse response-headers (Location m.fl.). `params` accepterer nu både dict og list-of-tuples (multi-value filter).
- **backend**: `app/api/endpoints.py` — `GET /api/endpoints`, `/endpoints/details`, `/endpoints/details/all` har alle fået `?search=` query parameter. `POST /api/endpoints` returnerer `{"status": "created", "id": "<uuid>"}`.
- **backend**: `app/schemas/settings.py` + `app/services/settings_service.py` + `app/api/settings.py` — ny `POST /api/settings/test` der laver en autenticeret GET mod ISE (endpoint groups, size=1) med enten de medsendte settings eller de aktive. Returnerer `{ok, status_code, message, latency_ms}` og særskilt fejltekst ved 401/403 (auth) vs. 5xx/transport (network).
- **frontend**: `js/api.js` — `listEndpoints/listEndpointDetails/listAllEndpointDetails` accepterer valgfri `search`-parameter. Ny `testBackendConnection()`.
- **frontend**: `js/views/import.js` — viser nu tre spande (Succeeded / Skipped / Failed) i import-resultatet.
- **frontend**: `js/views/browse.js` — ny MAC-søgeboks i toolbaren (debounced 400ms) der bruger server-side ERS-filter. Gør det muligt at finde endpoints uden at hente alle ISE-sider.
- **frontend**: `js/views/settings.js` — ny "Test forbindelse"-knap der kalder `/api/settings/test` og viser success/fejl uden at gemme.
- **frontend**: `css/styles.css` — styling for `.mac-search` inputtet.

## [1.14.0 build 0029] — 2026-04-18 — feat: Portal-default CSV template + auto-extend ved ISE import

- **frontend**: `js/csv.js` — `DEFAULT_TEMPLATE` reduceret fra 34 ISE-kolonner til kun portalens egne 9 kolonner (MAC, IdentityGroup, Description, StaticGroupAssignment, CUSTOM.Type/Owner/Lokation/AuthzVlan/HypervisionISEPortal). Ny `extendTemplateWithPortalColumns()` der appender manglende portal-kolonner til en importeret template.
- **frontend**: `js/views/settings.js` — ved import af template fra CSV-fil udvides den automatisk med portal-kolonner, så export aldrig taber portal-data. Success-beskeden viser hvor mange kolonner der blev tilføjet. "Nulstil"-knap giver nu det rene portal-template i stedet for det gamle ISE-template.

## [1.13.0 build 0028] — 2026-04-18 — feat: Export CSV eksporterer kun valgte endpoints

- **frontend**: `js/views/browse.js` — Export CSV-knappen eksporterer nu kun de valgte endpoints hvis nogle rækker er markeret. Hvis ingen er valgt, eksporteres alle (filtrerede) endpoints som før. Success-besked viser "valgte" når selektion er brugt.

## [1.12.1 build 0027] — 2026-04-18 — fix: sync custom attributes fejlede med TypeError

- **backend**: `app/services/custom_attribute_service.py` — `sync_from_ise()` forventede at `list_page()` returnerede en liste, men siden build 0024 returnerer den `(resources, total)`-tuple. Unpack tuplen korrekt og brug `total` til at stoppe pagineringen. Fikser 500 Internal Server Error ved `POST /api/custom-attributes/sync`.

## [1.12.0 build 0026] — 2026-04-17 — feat: bulk throttling — 150ms delay mellem ISE-kald

- **backend**: `app/services/endpoint_service.py` — tilføjet 150ms `asyncio.sleep` mellem hvert ISE-kald i `bulk_create` for at overholde Ciscos 5–10 req/sec grænse og forhindre ERS overload ved store CSV-imports.

## [1.11.1 build 0025] — 2026-04-17 — chore: oprydning BUGS.md — flyt fixed bugs til Fixed sektion

- **docs**: `BUGS.md` — alle 7 fixed bugs flyttet fra "Åbne" til "Fixed" sektion, sorteret nyeste først.

## [1.11.1 build 0024] — 2026-04-17 — fix: filter søger nu i ALLE endpoints, ikke kun aktuel side

- **backend**: `app/ise/endpoints.py` — ny `list_all()` metode der itererer alle ISE ERS-sider (max 100 per side) og returnerer alle endpoint-summaries.
- **backend**: `app/services/endpoint_service.py` — ny `list_all_endpoint_details()` der henter alle endpoints med detaljer (concurrent, semaphore=5).
- **backend**: `app/api/endpoints.py` — ny route `GET /endpoints/details/all` der returnerer alle endpoint-detaljer.
- **frontend**: `js/api.js` — ny `listAllEndpointDetails()` metode.
- **frontend**: `js/views/browse.js` — to-mode arkitektur: **paged mode** (server-side pagination, ingen filter) og **filter mode** (alle endpoints loaded, client-side filter + client-side pagination). Skifter automatisk til filter mode når et kolonnefilter eller "Kun portal" aktiveres. Cache (`allRowsCache`) sikrer at gentagne filter-ændringer ikke re-fetcher. Retur til paged mode når alle filtre deaktiveres. Export i filter mode eksporterer alle filtrerede rækker, ikke kun aktuel side. Bulk delete opdaterer også cache.

## [1.11.0 build 0023] — 2026-04-17 — feat: pagination + inline page size selector i Browse/Edit

- **backend**: `app/ise/endpoints.py` — `list_page()` returnerer nu `(resources, total)` tuple, parser `SearchResult.total` fra ISE ERS response.
- **backend**: `app/schemas/endpoint.py` — ny `PaginatedEndpointDetails` model med `items`, `total`, `page`, `size`.
- **backend**: `app/services/endpoint_service.py` — `list_endpoint_details()` returnerer nu `PaginatedEndpointDetails` med total count.
- **backend**: `app/api/endpoints.py` — `/endpoints/details` response model ændret til `PaginatedEndpointDetails`.
- **frontend**: `js/views/browse.js` — paginerings-state (`currentPage`, `totalEndpoints`). Forrige/Næste knapper under tabellen. Page size dropdown (`10/25/50/100/200/500`) direkte i toolbar — ændring gemmes automatisk i localStorage og nulstiller til side 1.
- **frontend**: `css/styles.css` — `.pagination-bar` og `.page-size-label` styling + dark mode varianter.

## [1.10.2 build 0022] — 2026-04-17 — fix: pageSize preference + dark theme

- **frontend**: `js/views/browse.js` — Browse/Edit læser nu `pageSize` fra localStorage (Frontend preferences) i stedet for at hardkode 100. Ny `getPageSize()` helper.
- **frontend**: `js/views/settings.js` — ny `applyTheme()` og `initTheme()` eksporterede funktioner. Tema-valg anvendes nu med det samme ved gem, og fjernet "(ikke implementeret endnu)" label fra Dark option.
- **frontend**: `js/app.js` — kalder `initTheme()` ved app-start så gemt tema anvendes fra første page load.
- **frontend**: `css/styles.css` — komplet dark mode tema via `[data-theme="dark"]` selektorer: baggrund, sidebar, cards, tabeller, forms, alerts, modals, filter-row, dirty rows, attr-tags.

## [1.10.1 build 0021] — 2026-04-17 — perf: concurrent endpoint detail fetch

- **backend**: `app/services/endpoint_service.py` — `list_endpoint_details` henter nu alle endpoint-detaljer parallelt med `asyncio.gather` + `Semaphore(5)` i stedet for sekventielt. Overholder Ciscos anbefalede max 5 samtidige requests. Reducerer load-tid for 100 endpoints fra ~100 sekventielle kald til ~20 batches à 5.

## [1.10.0 build 0020] — 2026-04-17 — feat: global "Gem alle" + "Rediger valgte" i Browse/Edit

- **frontend**: `js/views/browse.js` — ny "Gem alle" knap i toolbar ved siden af Refresh/Export/Kun portal. Tracker dirty-state per række: ændring af ethvert felt (dropdown, tekstfelt) markerer rækken som dirty (gul baggrund). Knappen viser antal ændrede rækker og gemmer alle på én gang. Dirty-state ryddes efter vellykket save og ved refresh.
- **frontend**: `js/views/browse.js` — ny "Rediger valgte" knap i toolbar. Åbner en modal med checkbox-aktiverede felter (Identity Group, Description, Type, Owner, Lokation, AuthzVlan). Kun markerede felter anvendes på alle valgte endpoints. Ændringer sættes lokalt i tabellen og markeres som dirty — brugeren gemmer via "Gem alle" eller "Gem valgte".
- **frontend**: `css/styles.css` — `tr.dirty` gul highlight, `.modal-overlay`/`.modal` styling for bulk-edit modal med grid-layout.

## [1.9.0 build 0019] — 2026-04-17 — feat: bulk select + bulk actions i Browse/Edit

- **frontend**: `js/views/browse.js` — individuelle Save/Del knapper fjernet fra hver række. Ny checkbox-kolonne med per-række markering og global "Vælg alle" checkbox i header. Nye "Gem valgte" og "Slet valgte" knapper i toolbar der udfører bulk-operationer på valgte endpoints. Select-all understøtter indeterminate state. Bekræftelsesdialog ved bulk-slet viser alle berørte MAC-adresser. Statusbesked viser antal gemte/slettede/fejlede.
- **frontend**: `css/styles.css` — `.select-cell`, `#select-all`, `#selection-count` styling for checkbox-kolonnen.

## [1.8.0 build 0018] — 2026-04-17 — fix: "Kun portal" knap skifter kun farve, ikke tekst

- **frontend**: `js/views/browse.js` — fjernet tekstskift på portal-toggle. Knappen viser altid "Kun portal", aktiv tilstand vises med farve (`.active-toggle`).

## [1.8.0 build 0017] — 2026-04-17 — feat: per-kolonne regex-filter i Browse/Edit

- **frontend**: `js/views/browse.js` — det gamle enkelt-filter erstattet med per-kolonne filtrering. Hver kolonne (MAC, Identity Group, Tilknytning, Description, Type, Owner, Lokation, AuthzVlan) har en checkbox + input-felt i en filter-række under header. Sæt flueben for at aktivere filter, skriv regex-pattern (case-insensitive). Flere kolonner kan filtreres samtidig (AND-logik). Ugyldig regex falder automatisk back til literal søgning.
- **frontend**: `css/styles.css` — `.filter-row`, `.col-filter`, `.col-filter-input` styling.

## [1.7.1 build 0016] — 2026-04-17 — chore: omdøbt hyperVision → HyperVision

- Alle forekomster af "hyperVision ISE Portal" ændret til "HyperVision ISE Portal" i frontend, backend, docs og GitHub repo-beskrivelse.

## [1.7.1 build 0015] — 2026-04-17 — fix: save ændrer ikke tilknytning medmindre group ændres

- **frontend**: `js/views/browse.js` — Save sender nu kun `group_id` og `static_group_assignment` til backend når brugeren faktisk har ændret Identity Group. Tidligere blev group_id altid sendt, hvilket fik ISE til at sætte `staticGroupAssignment=true` ved enhver ændring.

## [1.7.0 build 0014] — 2026-04-17 — feat: Tilknytning-kolonne (statisk/dynamisk) i Browse/Edit

- **backend**: `schemas/endpoint.py` — `EndpointDetail` har nu `static_group: bool` felt.
- **backend**: `services/endpoint_service.py` — `get_endpoint()` læser `staticGroupAssignment` fra ISE-response og mapper til `static_group`.
- **frontend**: `js/views/browse.js` — ny kolonne "Tilknytning" mellem Identity Group og Description. Viser "Statisk" eller "Dynamisk" (read-only). Colspan opdateret til 9.

## [1.6.0 build 0013] — 2026-04-17 — docs: opdateret README + GitHub beskrivelse

- **docs**: `README.md` — komplet omskrivning med alle aktuelle features: custom attributes (Type, Owner, Lokation, AuthzVlan, HypervisionISEPortal), Attributter-side, CSV template-system, "Kun portal" toggle, sidebar-oversigt. Danske tegn rettet.
- **github**: repo-beskrivelse opdateret til "hyperVision ISE Portal — web-baseret endpoint-administration for Cisco ISE 3.1+".

## [1.6.0 build 0012] — 2026-04-17 — chore: omdøbt til hyperVision ISE Portal

- **frontend**: `index.html` — `<title>` og sidebar-brand ændret til "hyperVision ISE Portal".
- **backend**: `main.py` — FastAPI title og opstartslog ændret til "hyperVision ISE Portal".
- **docs**: `README.md`, `INSTALL.md`, `CLAUDE.md` — alle overskrifter/referencer omdøbt.

## [1.6.0 build 0011] — 2026-04-17 — feat: Type attribut, Attributter-side, HypervisionISEPortal + bugfix

### Nye features
- **backend**: `core/custom_attr_store.py` — `MANAGED_ATTRS` udvidet med `Type`. Ny `HIDDEN_ATTR = "HypervisionISEPortal"` og `ALL_ATTRS` (managed + hidden) til ISE-definitioner.
- **backend**: `schemas/endpoint.py` — `EndpointDetail` har nu `endpoint_type` og `hypervision` felter. `CustomAttrs` har nu `Type` felt.
- **backend**: `services/endpoint_service.py` — `create_endpoint()` og `update_endpoint()` sætter automatisk `HypervisionISEPortal=true` på alle endpoints der oprettes/redigeres via portalen. `_ensure_ca_definitions()` sikrer alle attrs inkl. hidden.
- **frontend**: `js/views/attributes.js` (ny) — dedikeret sidebar-side "Attributter" til administration af værdier for Type, Owner, Lokation, AuthzVlan. Tilføj/fjern værdier + Sync fra ISE.
- **frontend**: `index.html` — ny sidebar-link "Attributter". `js/app.js` — ny route `attributes`.
- **frontend**: `js/views/browse.js` — ny "Type" kolonne med dropdown. Ny "Kun portal" / "Vis alle" toggle-knap der filtrerer på `HypervisionISEPortal`. Export eksporterer kun synlige (filtrerede) endpoints.
- **frontend**: `js/views/create.js` — Type dropdown tilføjet til custom attributes.
- **frontend**: `js/views/import.js` — simpelt format udvidet til `mac,group,description,type,owner,lokation,authz_vlan`. ISE format parser understøtter `CUSTOM.Type`.
- **frontend**: `js/csv.js` — ISE format parser og eksport inkluderer `CUSTOM.Type` og `CUSTOM.HypervisionISEPortal`. Default template udvidet med begge.
- **frontend**: `css/styles.css` — `.attr-tag`, `.attr-del`, `.active-toggle` styling.

### Bug fix
- **frontend**: `js/views/browse.js` — Refresh bevarer nu aktiv filter + portal-toggle. Tidligere blev filter nulstillet ved Refresh.

## [1.5.0 build 0010] — 2026-04-16 — feat: Identity Group + "ingen" → Unknown med static=false

- **backend**: `schemas/endpoint.py` — `EndpointUpdate` har nu `static_group_assignment: bool | None` felt.
- **backend**: `ise/endpoints.py` — `update()` accepterer `static_group_assignment` parameter. Når den er `False` sendes `staticGroupAssignment: false` til ISE, så endpoint kan re-profiles.
- **backend**: `services/endpoint_service.py` — videresender `static_group_assignment` til ISE-laget.
- **frontend**: `js/views/browse.js` — kolonneoverskrift ændret fra "Group" til "Identity Group". Når bruger vælger "— ingen —" i group-dropdown, flyttes endpoint til "Unknown"-gruppen og `staticGroupAssignment` sættes til `false` i ISE.

## [1.4.0 build 0009] — 2026-04-16 — feat: brugerdefinerbar CSV export template

- **frontend**: `js/csv.js` — hardkodet 100+ kolonne-array (`ISE_COLUMNS`) erstattet med dynamisk template-system. Default template: 34 ISE-kolonner. Nye eksporterede funktioner: `getCsvTemplate()`, `setCsvTemplate()`, `resetCsvTemplate()`, `parseTemplateHeader()`. Template persisteres i `localStorage`.
- **frontend**: `js/views/settings.js` — ny "CSV Export Template" sektion i Settings: viser aktiv template (antal kolonner + preview), import fra CSV-fil (kun header-rækken bruges), nulstil til standard-knap.
- **frontend**: `toIseCsv()` bruger nu den aktive template fra localStorage i stedet for hardkodet array. Alle kendte felter (MAC, Group, Description, custom attrs) udfyldes; ukendte kolonner er tomme.
- **docs**: `FEATURES.md` — CSV export template registreret som done.

## [1.3.0 build 0008] — 2026-04-16 — feat: ISE-kompatibel CSV import/export

- **frontend**: `js/csv.js` (ny) — fælles CSV-modul med RFC 4180 parser (håndterer double-quoted felter, kommaer i værdier), ISE format-detektion, ISE CSV-eksport med alle 100+ kolonner, `downloadCsv()` hjælpefunktion.
- **frontend**: `js/views/import.js` — auto-detekterer ISE CSV (header med `MACAddress`) vs. simpelt format. ISE-import mapper `MACAddress`→mac, `IdentityGroup`→group, `Description`→description, `CUSTOM.Owner`→Owner, `CUSTOM.Lokation`→Lokation, `CUSTOM.AuthzVlan`→AuthzVlan. Stripper single-quote wrapping (`'value'`→`value`). Viser detekteret format i preview.
- **frontend**: `js/views/browse.js` — ny **Export CSV** knap der genererer ISE-kompatibel CSV med alle ISE-kolonner (tom for felter ISE Portal ikke har). Filnavn: `ise-endpoints-YYYY-MM-DD.csv`.
- **docs**: `FEATURES.md` — ISE CSV import/export registreret som done.

## [1.2.0 build 0007] — 2026-04-16 — docs: README.md til GitHub

- **docs**: oprettet `README.md` — projektbeskrivelse, features, arkitekturoversigt, forudsaetninger, hurtig start-guide, REST API-tabel, projektstruktur, teknologier, sikkerhed, links til al dokumentation.

## [1.2.0 build 0006] — 2026-04-16 — feat: fuld browse/edit + fix Location-konflikt + group valgfri

### Bug fix
- **backend**: `Location` omdøbt til `Lokation` i hele systemet. ISE har et built-in profiler-attribut "Location" der returnerer 500 ved forsøg på at oprette som custom attribute. `Lokation` konflikter ikke.
- **backend**: `ise/custom_attributes.py` — `ensure_definitions()` håndterer nu også status 500 med "already exists"-lignende fejlmeddelelser.
- **backend**: `ise/client.py` — `close_ise_client()` nulstiller nu `_ca_definitions_ensured` flag, så definitioner re-tjekkes efter settings-ændring.

### Nye features
- **backend**: `schemas/endpoint.py` — `group_id` er nu valgfri i `CreateEndpointRequest` (tom = ISE default gruppe). `EndpointDetail` inkluderer `group_name` og `lokation`.
- **backend**: `ise/endpoints.py` — `create()` sender kun `groupId`/`staticGroupAssignment` når group er valgt.
- **backend**: `services/endpoint_service.py` — `get_endpoint()` resolver nu group-ID til group-navn via cached lookup. `_resolve_group_name()` tilføjet.
- **frontend**: `js/views/create.js` — Group dropdown har nu tom default "— ingen (ISE default) —". Attribut-labels bruger `Lokation`.
- **frontend**: `js/views/browse.js` — komplet omskrivning: viser MAC, Group (dropdown), Description, Owner, Lokation, AuthzVlan. Alle felter redigerbare inline. Save sender group + custom attributes til ISE. Filter søger i alle felter.
- **frontend**: `js/views/import.js` — CSV kolonnenavne og payload bruger `Lokation`.

## [1.1.1 build 0005] — 2026-04-16 — fix: custom attribute definitioner via Open API

### Bug fix
- **backend**: `ise/custom_attributes.py` — **ERS stien `/ers/config/endpointcustomattribute` returnerer 404** (ERS understøtter ikke custom attribute definition management). Skiftet til ISE **Open API** (`/api/v1/endpoint-custom-attribute`). Open API payload er flat JSON (ingen `ERSEndPointCustomAttribute` wrapper). Håndterer status 400 og 409 som "allerede eksisterer".
- **backend**: `ise/custom_attributes.py` — `ensure_definitions()` tjekker nu først hvilke definitioner der allerede eksisterer, og opretter kun manglende. Klar fejlmeddelelse med instruktioner til manuel oprettelse i ISE GUI hvis Open API heller ikke virker.
- **backend**: `endpoint_service.py` — `_ensure_ca_definitions()` logger nu tydeligt hvilke definitioner der fejlede, med GUI-instruktioner.
- **backend**: `main.py` — logger version ved opstart (`ISE Endpoint Portal v1.1.1-b0005 starting`).
- **docs**: `ISE_API_REFERENCE.md` — rettet custom attributes sektion: ERS returnerer 404, Open API er den korrekte sti, tilføjet GUI-instruktioner som fallback.

## [1.1.1 build 0004] — 2026-04-16 — fix: custom attributes + browse/edit med attributter

### Bug fix
- **backend**: `endpoint_service.py` — custom attribute definitioner (Owner, Location, AuthzVlan) oprettes nu automatisk i ISE ved første endpoint create/update med custom attrs (én gang per session via `_ensure_ca_definitions`). Tidligere blev de kun oprettet ved manuel sync, og ISE ignorerede stille attributter der ikke var defineret.

### Ny funktionalitet
- **backend**: `schemas/endpoint.py` — ny `EndpointDetail` model med id, name, mac, description, group_id, owner, location, authz_vlan.
- **backend**: `services/endpoint_service.py` — nye metoder `get_endpoint()` og `list_endpoint_details()` der henter fuld detalje inkl. custom attributes for hvert endpoint fra ISE.
- **backend**: `api/endpoints.py` — nye routes `GET /api/endpoints/details` (liste med fuld detalje) og `GET /api/endpoints/{id}` (enkelt endpoint detalje).
- **frontend**: `js/api.js` — tilføjet `listEndpointDetails()` og `getEndpoint()`.
- **frontend**: `js/views/browse.js` — tabellen viser nu Owner, Location, AuthzVlan kolonner med dropdown-redigering. Filter søger også i owner/location. Save sender custom attributes med til ISE.
- **frontend**: `css/styles.css` — `.browse-table-wrap` styling for bredere tabel.
- **docs**: `BUGS.md` — bug registreret og markeret fixed. `FEATURES.md` — browse/edit custom attrs markeret done.

## [1.1.0 build 0003] — 2026-04-16 — docs: installations- og driftsdokumentation

- **docs**: oprettet `INSTALL.md` — komplet guide med forudsætninger, installation, konfiguration (.env + UI), start (dev/prod/systemd), brug af alle fire views (opret, import, browse, settings), custom attributes workflow, REST API-reference med eksempler, logning og fejlsøgning, drift/backup, og sikkerhedsanbefalinger.
- **docs**: `FEATURES.md` — dokumentation feature registreret som done.

## [1.1.0 build 0002] — 2026-04-16 — feat: custom endpoint attributes (Owner, Location, AuthzVlan)

- **backend**: `app/core/custom_attr_store.py` — lokal registry for tilladte værdier per attribut. Persisterer til `backend/custom_attr_values.json`.
- **backend**: `app/ise/custom_attributes.py` — `IseCustomAttributeRepository` til at hente/oprette custom attribute definitioner i ISE ERS.
- **backend**: `app/schemas/custom_attribute.py` — DTOs: `AllCustomAttributes`, `AddValueRequest`, `SyncResult`.
- **backend**: `app/schemas/endpoint.py` — tilføjet `CustomAttrs` model (Owner, Location, AuthzVlan) og `custom_attributes` felt i `CreateEndpointRequest` og `EndpointUpdate`.
- **backend**: `app/services/custom_attribute_service.py` — forretningslogik: list/add/remove values, sync fra ISE (scanner endpoints, merger fundne værdier, sikrer attribute definitions).
- **backend**: `app/api/custom_attributes.py` — nye routes: `GET /api/custom-attributes`, `POST .../values`, `DELETE .../values/{value}`, `POST .../sync`.
- **backend**: `app/api/deps.py` — tilføjet `get_custom_attribute_service()` dependency.
- **backend**: `app/ise/endpoints.py` — create/update sender nu `customAttributes` double-nested til ISE.
- **backend**: `app/services/endpoint_service.py` — videresender `custom_attributes` til ISE-laget.
- **backend**: `app/main.py` — inkluderer `custom_attrs_api` router.
- **frontend**: `js/api.js` — tilføjet `listCustomAttributes`, `addCustomAttributeValue`, `removeCustomAttributeValue`, `syncCustomAttributes`.
- **frontend**: `js/views/create.js` — tre dropdown-selects (Owner, Location, AuthzVlan) med "(+ Tilføj ny…)" inline oprettelse.
- **frontend**: `js/views/import.js` — CSV format udvidet til `mac,group,description,owner,location,authz_vlan`.
- **frontend**: `css/styles.css` — `.ca-row`, `.ca-add` styling for custom attribute felter.
- **docs**: `ISE_API_REFERENCE.md` — tilføjet sektion om Custom Endpoint Attributes (ERS path, payloads, double-nesting).
- **docs**: `FEATURES.md` — custom attributes feature markeret som done.
- **.gitignore** — tilføjet `backend/custom_attr_values.json`.

## [1.0.0 build 0001] — 2026-04-16 — chore: versioneringssystem

- **version**: oprettet `version.json` (`1.0.0` build `0001`) som single source of truth.
- **backend**: `app/core/version.py` læser `version.json`. FastAPI `version=` sættes dynamisk. `/api/health` returnerer nu `version`, `build`, `full`.
- **backend**: `pyproject.toml` version sat til `1.0.0`.
- **frontend**: sidebar viser version fra `/api/health` response i `#version-info`.
- **frontend**: `css/styles.css` tilføjet `.version-label` styling.
- **regler**: `CLAUDE.md` regel 1 (UFRAVIGELIG) definerer versioneringsformat (`MAJOR.MINOR.PATCH` + build), bump-regler, og workflow.
- **changelog**: alle entries tagget med version + build.

## [pre-release] — 2026-04-16 — docs: ISE API reference + prioriteret feature-backlog

- **docs**: oprettet `ISE_API_REFERENCE.md` — ERS + Open API paths, payloads, filter-syntaks, bulk-throttling, status codes, error format, gotchas. Bruges som design-reference.
- **docs**: `CLAUDE.md` regel 5 tilføjet — konsulter ISE_API_REFERENCE.md ved al ISE-integration.
- **planning**: `FEATURES.md` opdateret med prioriteret backlog: P1 (bulk throttling, 409 skipped, server-side filter, Location header parse, ISE connectivity test), P2 (detalje-view, filter-operatorer, gruppevalg, pagination, Open API support), P3 (ANC quarantine, custom attributes, SGT, dark mode, CSV export, audit log).

## [pre-release] — 2026-04-15 — feat: sidebar + CRUD views + settings

- **backend**: `BulkCreateRequest`, `BulkResult`, `EndpointUpdate`, `BulkFailure` DTOs (`app/schemas/endpoint.py`).
- **backend**: generisk `IseEndpointRepository.update()` erstatter `update_group()` (`app/ise/endpoints.py`).
- **backend**: service-lag `update_endpoint`, `bulk_create` (`app/services/endpoint_service.py`).
- **backend**: nye routes `POST /api/endpoints/bulk`, `PUT /api/endpoints/{id}` (`app/api/endpoints.py`).
- **backend**: settings-lag — `app/core/settings_store.py` (JSON persistence), `Settings.refresh_settings()`, `app/schemas/settings.py`, `app/services/settings_service.py`, `app/api/settings.py`. Nye routes `GET/PUT /api/settings/backend`.
- **backend**: `IseClient` læser nu `config.settings` dynamisk, så reset efter settings-ændring virker.
- **backend**: `config.json` tilføjet til `.gitignore`.
- **frontend**: sidebar layout — `index.html` med venstre-menu (Opret / Import / Browse / Settings).
- **frontend**: hash-baseret router i `js/app.js`, views opdelt i `js/views/{create,import,browse,settings}.js`.
- **frontend**: Opret endpoint view med MAC-validering og group-dropdown.
- **frontend**: CSV Import view — fil-upload eller paste, parse, preview-tabel, bulk opret med succeeded/failed resultat.
- **frontend**: Browse/Edit view — tabel med inline description-edit, filter, delete.
- **frontend**: Settings view — backend ISE connection (url, user, password-write-only, api type, verify_tls, timeout) + frontend preferences i localStorage.
- **frontend**: `api.js` udvidet med `bulkCreateEndpoints`, `updateEndpoint`, `get/updateBackendSettings`.
- **frontend**: komplet CSS-omskrivning til sidebar layout (`css/styles.css`).

## [pre-release] — 2026-04-15 — chore: bootstrap

- **git**: initialiseret git-repo, initial commit med projektstruktur.
- **bootstrap**: oprettet projekt-regler og struktur — `CLAUDE.md`, `ARCHITECTURE.md`, `FEATURES.md`, `BUGS.md`, `CHANGELOG.md`, `.claude/settings.local.json`.
- **backend**: FastAPI skeleton — `app/main.py`, `app/core/config.py`, `app/core/logging.py`, `app/core/exceptions.py`.
- **backend**: ISE integrationslag — `app/ise/client.py` (async httpx), `app/ise/endpoints.py` (ERS endpoint + endpoint group kald).
- **backend**: service-lag — `app/services/endpoint_service.py`.
- **backend**: API-lag — `app/api/health.py`, `app/api/endpoints.py`, `app/api/groups.py`.
- **backend**: DTOs — `app/schemas/endpoint.py`.
- **backend**: pyproject.toml med FastAPI, httpx, pydantic, pytest, respx.
- **frontend**: statisk web UI — `index.html`, `css/styles.css`, `js/api.js`, `js/app.js`.
- **cleanup**: fjernet tidligere flad struktur (`src/ise_portal/`, rod `pyproject.toml`, `tests/`).
