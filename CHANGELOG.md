# Changelog

Alle kodeændringer registreres her. Nyeste øverst.
Versionering: `version.json` er single source of truth. Se [CLAUDE.md](CLAUDE.md) regel 1.

---

## [2.10.3 build 0074] — 2026-04-25 — feat: chromeless mobil-registreringsside med inline login/logout

PATCH-bump. UX-forbedring af 2.10.0-registrar-flowet. På en mobiltelefon
er der ikke plads til den fulde sidebar — registrar-brugere skal kun
have én ting på skærmen: registreringsformularen.

Ændringer:

- Ny body-class `register-route` toggles fra
  [frontend/js/app.js](frontend/js/app.js) når aktive rute er `register`
  *og* brugeren enten er udlogget eller har rollen `registrar`. Class'en
  skjuler `.sidebar` helt, gør app-grid'et til én kolonne og giver
  `.content` fuld viewport-højde. Admin/editor der besøger `/#register`
  beholder deres sidebar så de stadig kan navigere væk.
- `register-topbar` med brand + brugernavn/rolle + "Log ud"-knap er
  tilføjet øverst i [frontend/js/views/register.js](frontend/js/views/register.js).
  Logout kalder `api.logout()`, rydder tokenet via `auth.clear()` og
  reload'er siden — det sikrer at login-formen vises igen i samme
  chromeless mode (ingen sidebar).
- Login-formen (`renderLogin`) er uændret i logik, men styles tunet i
  [frontend/css/styles.css](frontend/css/styles.css): når `register-route`
  er aktiv bliver `.login-card` mindre/centreret og bruger fuld bredde
  på små skærme.
- Camera-barcode-scanning fra build 0071 (M8) er allerede tilgængelig
  for registrar-rollen via `📷`-knappen ved siden af MAC-feltet —
  denne udgivelse bekræfter at scan-overlay'et virker fra det
  chromeless-layout (ingen role-gating tilføjet, BarcodeDetector er
  feature-detect-only).

Berørte filer:

- [frontend/js/app.js](frontend/js/app.js) (ny `isChromelessRoute` +
  `applyChromeMode`, kaldes fra `renderView` og `showLogin`).
- [frontend/js/views/register.js](frontend/js/views/register.js) (importér
  `auth`, render topbar med logout, wire logout-handler).
- [frontend/css/styles.css](frontend/css/styles.css) (`body.register-route`
  rules + `.register-topbar` styling).

---

## [2.10.2 build 0073] — 2026-04-25 — fix: Browse/Edit kolonner forskudt pga. manglende Vendor-cell

PATCH-bump. Efter 2.11.0 var Browse/Edit-tabellen forskudt: alt fra
Identity Group og frem stod under den forkerte header.

Rodårsag i [frontend/js/views/browse.js](frontend/js/views/browse.js):
"Vendor" blev tilføjet til `COLUMNS`-arrayet (som driver header- og
filter-row), men `renderRows` blev aldrig opdateret til også at
emittere en `<td>` for vendor. Header havde 11 kolonner (efter
checkbox), body havde 10 — så indholdet rykkede én plads til venstre
under hver header.

Fix: tilføjet `<td class="vendor-cell-td">${esc(r.vendor || "")}</td>`
lige efter MAC-cellen i `renderRows`. Vendor er read-only (udledes fra
OUI), så ingen edit-handlers kræves.

---

## [2.10.1 build 0072] — 2026-04-25 — fix: rollback restore custom attributes korrekt

PATCH-bump. Audit-rollback af endpoint-updates ryddede alle custom
attributes i stedet for at restore før-værdierne (f.eks. AuthzVlan
ændret 64 → 100, rollback gav `""` i stedet for `64`).

Rodårsag i [backend/app/api/audit.py](backend/app/api/audit.py):
`_endpoint_update_from_snapshot` læste `snap.get("custom_attributes")`
og `snap.get("static_group_assignment")`, men før-snapshot'et er
`EndpointDetail.model_dump()` som *flader* custom attributes ud til
felterne `endpoint_type`, `owner`, `lokation`, `authz_vlan`,
`authz_acl`, `platform_type` og bruger `static_group` (ikke
`static_group_assignment`). Begge nøgler eksisterede dermed ikke i
snapshot'et — `custom_attributes` faldt tilbage til `{}`, og siden
build 0064 sender `set_custom_attributes` faktisk tomme strings til
ISE i stedet for at filtrere dem væk, så rollback'en endte med
eksplicit at rydde alle felter i stedet for at restore dem.

Fix: `_endpoint_update_from_snapshot` rekonstruerer nu `CustomAttrs`
fra de fladede snapshot-felter og læser `static_group` med det
korrekte navn.

Berørte filer: [backend/app/api/audit.py](backend/app/api/audit.py).
Smoke-testet: snapshot med `authz_vlan=64` rekonstrueres korrekt til
`AuthzVlan=64` i `EndpointUpdate`-payloaden.

---

## [2.10.0 build 0071] — 2026-04-25 — feat: M8 — MAC-scan + PWA + offline-kø

Andet og afsluttende milestone af 2.10.0 — markerer feature `done`.
Bygger oven på M7's mobile registreringsview med tre PWA-byggesten:
camera-baseret stregkode/QR-scan, web-app manifest så viewet kan
installeres på home screen, og en localStorage-baseret offline-kø der
fanger registreringer der laves uden netværk.

**Camera scan** ([frontend/js/views/register.js](frontend/js/views/register.js)):
Ny "📷"-knap ved siden af MAC-input (kun synlig hvis browseren har
`BarcodeDetector` — Chrome, Edge, Safari TP). Klik åbner et fullscreen
overlay med live-kamera (`facingMode: environment` så det er
bagkameraet der bruges). Detektor scanner pr. animation-frame og leder
efter QR/Code 128/Code 39/DataMatrix/PDF417. Første kode hvis indhold
indeholder et MAC-shaped substring (12 hex-cifre med valgfrie
separatorer) normaliseres til `AA:BB:CC:DD:EE:FF` og udfyldes i
input-feltet (auto-trigger af vendor-lookup). Annuller-knap nederst
stopper streamen og lukker overlay'et.

**PWA manifest** ([frontend/manifest.json](frontend/manifest.json),
[frontend/icons/icon-192.svg](frontend/icons/icon-192.svg),
[frontend/icons/icon-512.svg](frontend/icons/icon-512.svg)):
`start_url` peger direkte på `#/register` så field-tech åbner
registreringsformularen ved app-launch uden at skulle navigere.
`display: standalone`, `theme_color: #0b3d91` matcher portalens brand,
SVG-ikoner i 192×192 og 512×512 (sidstnævnte med `purpose: any
maskable` for Android adaptive icons).
[frontend/index.html](frontend/index.html): tilføjet manifest-link,
theme-color og apple-touch-icon.

**Service worker** ([frontend/service-worker.js](frontend/service-worker.js)):
Network-first cache for app-shell (`index.html`, CSS, ES-modules,
manifest, ikoner) så registreringssiden kan boote helt uden netværk
efter første besøg. API-kald (`/api/...`) og POST-requests
forwardes urørt så Bearer-token-flowet og 401-handling bevares.
[frontend/js/app.js](frontend/js/app.js): registrerer
`/service-worker.js` ved boot (silent failure hvis ikke supporteret).

**Offline-kø** ([frontend/js/offline_queue.js](frontend/js/offline_queue.js)):
localStorage-backed kø (`hv_ise_register_queue`) der fanger payloads
fra registreringsviewet når `api.createEndpoint()` fejler med en
netværksfejl (intet `NNN:`-prefix på error-message). Items gemmes med
`{id, payload, enqueued_at}`. `flushAll()` itererer og forsøger at
sende; netværksfejl stopper løkken (resterende beholdes), mens
HTTP-fejl markeres `failed` og fjernes så de ikke blokerer køen.
Auto-flush ved `window.online`-event så field-tech ikke selv skal
trykke når netværket kommer tilbage. Registreringsviewet viser et gult
banner med "N venter…" + "Send nu"-knap når køen ikke er tom.

**Lag**: frontend (ny `manifest.json`, `service-worker.js`,
`offline_queue.js`, scanner-overlay i register view, PWA-headers i
index.html, app.js SW-registrering, CSS for scan-overlay/queue-banner).

Markerer 2.10.0 som done.

---

## [2.10.0 build 0070] — 2026-04-25 — feat: M7 — registrar-rolle + mobile registreringsview

Første milestone af 2.10.0. Tilføjer den fjerde RBAC-rolle `registrar`
samt et dedikeret mobil-optimeret view designet til field-teknikere der
skal oprette endpoints on-the-spot uden adgang til browse, edit eller
admin-funktioner. M8 (MAC-scan via kamera + PWA offline-kø) er stadig
udestående.

**Backend RBAC**:

- [backend/app/schemas/user.py](backend/app/schemas/user.py): `Role`-literal
  + `ROLE_VALUES` udvidet med `"registrar"`.
- [backend/app/api/deps.py](backend/app/api/deps.py): nye dependencies
  `require_create_endpoint` (admin/editor/registrar) og
  `require_register_lookup` (admin/editor/viewer/registrar). Bruges på
  endpoints der er nødvendige for registreringsflowet.

**Backend API-guards**:

- [backend/app/api/endpoints.py](backend/app/api/endpoints.py): `POST /api/endpoints`
  bytter `require_editor` → `require_create_endpoint`. Alle andre
  endpoint-routes er fortsat låst til editor/viewer.
- [backend/app/api/groups.py](backend/app/api/groups.py),
  [backend/app/api/custom_attributes.py](backend/app/api/custom_attributes.py)
  (kun `GET /custom-attributes`),
  [backend/app/api/oui.py](backend/app/api/oui.py) (`GET /oui/{mac}`,
  `GET /oui/stats`), og
  [backend/app/api/dacls.py](backend/app/api/dacls.py) (kun
  `GET /dacls`): bytter `require_any` → `require_register_lookup` så
  registrar-rollen kan læse dropdown-værdier til opret-formularen.
- Alle øvrige routes (browse, edit, delete, settings, brugere, audit,
  cache, logs, attribut-CRUD, DACL CRUD) er fortsat utilgængelige for
  registrar (returnerer 403).

**Frontend**:

- [frontend/js/views/register.js](frontend/js/views/register.js) (NY):
  mobil-først registreringsview. MAC-input med auto-uppercase,
  blur-normalisering til `AA:BB:CC:DD:EE:FF`-format og inline
  OUI-vendor-detektion. Dropdowns til Identity Group, Type, Owner,
  Lokation og Platform. Auto-suggest-knap "Sæt Platform=X" når
  vendor matcher en kendt platform-type. Stor submit-knap (56 px)
  med loading-state.
- [frontend/js/app.js](frontend/js/app.js): ny `register`-rute med
  roles `[admin, editor, registrar]`. Settings-ruten åbnet for
  registrar (kun for password-skift). Login-flow router registrar
  direkte til `/#register` ved login. Hash-fallback respekterer
  rolle-restriktioner så registrar ikke kan navigere til /#browse.
- [frontend/index.html](frontend/index.html): nyt sidebar-link
  "Mobil-registrering" → `#/register` (skjules automatisk for roller
  uden adgang).
- [frontend/js/views/settings.js](frontend/js/views/settings.js):
  user-create + user-update dropdowns viser nu også `registrar` som
  valgmulighed.
- [frontend/css/styles.css](frontend/css/styles.css): nye klasser
  `.register-shell`, `.register-input`, `.register-vendor`,
  `.register-submit` mfl. + role-badge `.role-registrar`. Touch-targets
  på 48-56 px, 16 px input font (forhindrer iOS-zoom). Responsive
  `@media (max-width: 600px)` collapser sidebar til horisontal nav.

Non-breaking MINOR — eksisterende roller uændret.

---

## [2.11.0 build 0069] — 2026-04-25 — feat: OUI lookup + vendor-enrichment + auto-suggest

Markerer feature `done` for 2.11.0 — MAC OUI → vendor lookup. Komplet
end-to-end med offline IEEE OUI-database, berigelse af endpoint-responses,
vendor-badge i Browse, vendor-kolonne i CSV-export og auto-suggest af
PlatformType i Create-formularen.

**Phase 1 — OUI-database** ([backend/data/oui.csv](backend/data/oui.csv)):
~420 kuraterede entries fra IEEE MA-L (24 bit), MA-M (28 bit) og MA-S
(36 bit) registries. Dækker de almindelige vendors: Cisco Systems,
Cisco Meraki, Apple, Samsung, Microsoft, HP Inc/Enterprise, Canon,
Aruba Networks, Mikrotik, ASUSTek, Espressif (ESP32), Raspberry Pi,
Polycom, Avaya, AXIS Communications, Zyxel, Netgear, D-Link, TP-Link,
Ubiquiti, VMware, VirtualBox, QEMU, Hyper-V, Nokia, Fitbit, Garmin,
Sonos, NEC, Dell, Cisco-Linksys. Schema: `oui,vendor,registry`.

**Phase 2 — Lookup-service** ([backend/app/core/oui_lookup.py](backend/app/core/oui_lookup.py)):
Tre prefix-tabeller (`_PREFIX_6`, `_PREFIX_7`, `_PREFIX_9`) loaded lazily
ved første kald. `lookup(mac) -> str` normaliserer (strip non-hex,
uppercase) og bruger longest-prefix-wins: MA-S (9 hex) → MA-M (7 hex)
→ MA-L (6 hex). `stats()` returnerer entry-counts pr. registry.

**Phase 3 — Endpoint-berigelse** ([backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py),
[backend/app/schemas/endpoint.py](backend/app/schemas/endpoint.py)):
Nyt `vendor: str = ""` felt på `EndpointSummary` og `EndpointDetail`.
Udfyldes via `oui_lookup(mac)` i `list_endpoints`,
`_fetch_endpoint_detail` og begge fallback-branches. MAC-feltet hentes
som `raw.get("mac", "") or raw.get("name", "")` så vendor virker selv
når ISE returnerer tom `mac` og MAC-værdien står i `name`-feltet.

**Phase 4 — Frontend visning**:

- [frontend/js/views/browse.js](frontend/js/views/browse.js): ny
  "Vendor"-kolonne efter MAC i tabellen + "Vendor"-felt i detail-modal.
- [frontend/js/csv.js](frontend/js/csv.js): `toIseCsv` udfylder
  `Vendor`-kolonnen hvis den er en del af aktiv template.
- [frontend/css/styles.css](frontend/css/styles.css): styling for
  `.vendor-hint`, `.vendor-badge`, `.vendor-unknown`, `.vendor-cell`
  med dark-theme-varianter.

**Phase 5 — Auto-suggest i Create** ([frontend/js/views/create.js](frontend/js/views/create.js)):
Ny `<div id="vendor-hint">` under MAC-input. Debounced (250 ms)
`lookupVendor()` rammer `/api/oui/{mac}` ved indtastning. Ved match
viser den "Detekteret: <vendor>" badge plus en "Sæt
PlatformType=<x>"-knap der med ét klik sætter PlatformType-dropdown'en
(disables med "✓ Sat" efter klik). `VENDOR_TO_PLATFORM`-mapping i
frontend dækker Cisco Systems → iosxe, Cisco Meraki → meraki, Aruba
Networks → aruba, Espressif (ESP32) → esp32, Apple Inc → macos,
Samsung Electronics → android, Microsoft Corp → windows, HP/Canon →
printer, AXIS → ipcam, Raspberry Pi → linux.

**Backend API** ([backend/app/api/oui.py](backend/app/api/oui.py)):

- `GET /api/oui/{mac}` — returnerer `{mac, vendor}`. Tom string hvis
  ingen match. Tilgængeligt for alle roller.
- `GET /api/oui/stats` — returnerer entry-counts pr. registry
  (debug/diagnostik).

**Frontend API** ([frontend/js/api.js](frontend/js/api.js)):
`lookupOui(mac)` og `getOuiStats()`.

**Lifespan**: oui-routeren registreret i
[backend/app/main.py](backend/app/main.py).

Non-breaking MINOR — ingen ISE-impact, kun beriget response-data.

---

## [2.9.0 build 0068] — 2026-04-24 — feat: Audit log M4 (API + rollback + view + retention)

Andet og afsluttende milestone af 2.9.0 — markerer feature `done`. Bygger
oven på M3's audit-kerne med en komplet REST-API, frontend-viewer med
diff-visning, en-klik rollback for Endpoints og DACL'er samt daglig
retention-prune.

**Phase 3 — Audit API** ([backend/app/api/audit.py](backend/app/api/audit.py),
[backend/app/schemas/audit.py](backend/app/schemas/audit.py)):

- `GET /api/audit` — pagineret event-liste med filtre (`actor`,
  `resource_type`, `resource_id`, `from_ts`, `to_ts`, `limit`, `offset`).
  Tilgængelig for alle roller (admin/editor/viewer) så viewers kan
  auditere uden at kunne ændre.
- `GET /api/audit/{id}` — enkelt-event med parsed before/after-JSON.
- `POST /api/audit/{id}/rollback` — admin-only; understøtter rollback af
  `created` (→ delete) og `updated` (→ restore before-state) for resource
  types `endpoint` og `dacl`. Sletninger kan ikke rulles tilbage
  automatisk (ISE kan ikke garantere re-create med samme interne id).
  Rollback recorder selv et nyt `rolled_back`-event så historikken
  forbliver append-only.

**Phase 2 — Resterende services instrumenteret**:

- [backend/app/services/custom_attribute_service.py](backend/app/services/custom_attribute_service.py):
  `add_value` (→ async, audits `value_added`), `remove_value` (audits
  `value_removed` med scanned/cleared counts), `set_platform_mapping`
  (→ async, audits `mapping_updated` med hele row-diffen).
- [backend/app/services/dacl_service.py](backend/app/services/dacl_service.py):
  `create` (audits `created`), `update` (snapshotter before via `get()`,
  audits `updated`), `delete` (snapshotter før sletning, audits
  `deleted`).
- [backend/app/services/user_service.py](backend/app/services/user_service.py):
  `create_user`/`update_user`/`delete_user`/`change_password` → alle async
  med audit-record; password-ændringer registreres som separat event så
  man kan spore credential-udskiftninger uden at lagre hashen selv.
- [backend/app/services/settings_service.py](backend/app/services/settings_service.py):
  `update_backend_settings` snapshotter hele before-dict og audits
  `updated` med `ise_password_changed`-bool (password værdi lagres aldrig).

Konsekvensrettelser i API-laget for signatur-ændringerne:
[backend/app/api/users.py](backend/app/api/users.py),
[backend/app/api/auth.py](backend/app/api/auth.py),
[backend/app/api/custom_attributes.py](backend/app/api/custom_attributes.py).

**Retention-prune**
([backend/app/services/audit_retention.py](backend/app/services/audit_retention.py)):
baggrunds-worker kører `prune_older_than(audit_retention_days)` én gang
ved startup og derefter hver 24. time. Interval=0 eller
`audit_enabled=False` deaktiverer prune. Fejler graceful — prune-fejl
logges men stopper ikke workeren.

**Phase 4 — Frontend audit-view**
([frontend/js/views/audit.js](frontend/js/views/audit.js),
[frontend/index.html](frontend/index.html),
[frontend/js/app.js](frontend/js/app.js),
[frontend/js/api.js](frontend/js/api.js),
[frontend/css/styles.css](frontend/css/styles.css)):

- Ny "Audit"-post i sidebaren, tilgængelig for alle roller.
- Tabel med tidspunkt, aktør, handling (farvekodet badge), ressource-
  type/-id, summary og actions (Vis / Rollback).
- Filter-toolbar: resource-type, actor, resource_id, antal.
- Klik på "Vis" åbner en side-drawer med full before/after-JSON i
  side-ved-side-paneler. Rollback-knappen bag confirm-dialog, kun
  synlig for admins og for events hvor rollback er supporteret.
- CSS med light+dark theme + farve-kodede action-badges
  (created=grøn, updated=blå, deleted=rød, rolled_back=gul, osv.).

**Bump**: build 0067 → 0068 (samme MINOR 2.9.0 — sidste milestone af
in-progress-featuren).

**Berørte filer**:
- backend: `app/api/audit.py` (ny), `app/schemas/audit.py` (ny),
  `app/services/audit_retention.py` (ny),
  `app/services/custom_attribute_service.py`,
  `app/services/dacl_service.py`,
  `app/services/user_service.py`,
  `app/services/settings_service.py`,
  `app/api/users.py`, `app/api/auth.py`, `app/api/custom_attributes.py`,
  `app/main.py`.
- frontend: `js/views/audit.js` (ny), `js/app.js`, `js/api.js`,
  `index.html`, `css/styles.css`.
- top-level: `FEATURES.md`, `CHANGELOG.md`, `version.json`.

---

## [2.9.0 build 0067] — 2026-04-24 — feat: Audit log M3 (store + endpoint_service instrumentering)

Første milestone af 2.9.0 (`planned` → `in-progress`). Lægger audit-
kernen ind og instrumenterer endpoint-writes så vi fremover kan
svare på "hvem ændrede hvad hvornår". Ingen UI endnu — det kommer i M4.

**Phase 1 — Audit-store** ([backend/app/core/audit_store.py](backend/app/core/audit_store.py)):
SQLite append-only i `backend/audit.db` med skema
`(id, ts, actor_id, actor_username, action, resource_type, resource_id,
before_json, after_json, source_ip)` + indexer på ts, (resource_type,
resource_id) og actor_username. `init_db()` kaldes fra FastAPI lifespan
så filen oprettes idempotent ved startup. Sync-SQLite kaldt via
`asyncio.to_thread` for at holde event-loop fri. Alle record-failures
logges men propagerer aldrig — audit må aldrig bryde den primære
operation. `query(...)` understøtter filter på actor / resource_type /
resource_id / from_ts / to_ts med paginering.

**Actor-kontekst**: `ActorContext` + `actor_ctx: ContextVar` sættes i
[backend/app/api/deps.py](backend/app/api/deps.py) `get_current_user` med
aktuel brugers id/username og request `client.host`. Service-laget kan
optage events uden at tråde User gennem hver funktion.

**Phase 2 — Endpoint_service instrumentering** ([backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py)):
- `create_endpoint` → audit `created` med after-snapshot af MAC + gruppe +
  custom attrs.
- `update_endpoint` → snapshotter both før **og** efter ISE-kaldet (begge
  læses via cache-laget så det er billigt) og recorder `updated` med
  before/after diff som JSON.
- `delete_endpoint` → snapshotter før-tilstand (mens endpointet stadig
  eksisterer i ISE) og recorder `deleted` med before-payload så rollback
  kan re-skabe endpointet i M4.

Andre services (custom_attribute, dacl, user, settings) instrumenteres
i M4 sammen med UI-viewet.

**Settings** ([backend/app/core/config.py](backend/app/core/config.py)):
nye `audit_enabled` (default true) og `audit_retention_days` (default 90).
`audit_enabled=false` slår al recording fra — nyttig hvis SQLite-filen
bliver problem i et konkret deployment.

**.gitignore**: `backend/audit.db` + WAL/journal-sidecars (data må ikke
committerens i repoet).

Berørte filer:
- [backend/app/core/audit_store.py](backend/app/core/audit_store.py) — ny
- [backend/app/core/config.py](backend/app/core/config.py)
- [backend/app/api/deps.py](backend/app/api/deps.py) — actor_ctx set i get_current_user
- [backend/app/main.py](backend/app/main.py) — init_audit_db i lifespan
- [backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py) — audit i create/update/delete
- [.gitignore](.gitignore)
- [FEATURES.md](FEATURES.md) — 2.9.0 status `planned` → `in-progress`
- [version.json](version.json) — 2.8.0-b0066 → 2.9.0-b0067 (minor-bump: ny feature)

---

## [2.8.0 build 0066] — 2026-04-24 — feat: Endpoint-cache M2 (bg-sync worker + Settings UI)

Færdiggør 2.8.0 (`in-progress` → `done`). Bygger oven på M1 med
baggrund-sync + frontend-integration.

**Phase 2 — Baggrund-sync worker** ([backend/app/services/cache_sync.py](backend/app/services/cache_sync.py)):
`CacheSyncWorker` starter/stopper via FastAPI lifespan-hook i
[backend/app/main.py](backend/app/main.py). Hver
`cache_sync_interval_seconds` (default 300) itererer workeren de ids
der allerede ligger i cachen og revaliderer de entries der er ældre
end TTL/2 — bounded med semaphore(5) for at holde ISE's 5–10 req/sec
loft. Failure pr. entry invaliderer bare den entry (næste read
henter fresh); sync-fejl logges og vises via `last_sync_error` i stats.
Interval <= 0 slår workeren fra; cachen serverer stadig normalt via TTL.

**Phase 4 — Frontend**:
- [frontend/js/api.js](frontend/js/api.js): nye `getCacheStats` og `invalidateCache`.
- [backend/app/api/endpoints.py](backend/app/api/endpoints.py) `GET /api/endpoints/{id}`:
  tilføjer `X-Cache-Enabled` + `X-Cache-Age-Seconds` response-headers så
  klienter kan skelne cache-hits fra fresh fetches.
- [frontend/js/views/settings.js](frontend/js/views/settings.js): ny
  "Endpoint-cache"-card (admin-only) med toggles for `cache_enabled`,
  `cache_ttl_seconds`, `cache_stale_while_revalidate`,
  `cache_sync_interval_seconds` + live stats-tabel (hit-rate,
  entries, bg-refreshes, seneste sync). "Opdatér stats" og "Ryd cache"
  knapper.
- [frontend/css/styles.css](frontend/css/styles.css): minimal styling for
  stats-tabellen (light + dark theme).

**Settings-schema** ([backend/app/schemas/settings.py](backend/app/schemas/settings.py)):
`BackendSettingsUpdate` + `BackendSettingsResponse` udvidet med de fire
cache-felter; [backend/app/services/settings_service.py](backend/app/services/settings_service.py)
læser/skriver dem til `config.json` via den eksisterende override-sti.

Berørte filer:
- [backend/app/services/cache_sync.py](backend/app/services/cache_sync.py) — ny
- [backend/app/main.py](backend/app/main.py)
- [backend/app/core/config.py](backend/app/core/config.py) — `cache_sync_interval_seconds`
- [backend/app/core/endpoint_cache.py](backend/app/core/endpoint_cache.py) — `detail_ids` + `detail_age` helpers
- [backend/app/api/endpoints.py](backend/app/api/endpoints.py)
- [backend/app/schemas/settings.py](backend/app/schemas/settings.py)
- [backend/app/services/settings_service.py](backend/app/services/settings_service.py)
- [frontend/js/api.js](frontend/js/api.js)
- [frontend/js/views/settings.js](frontend/js/views/settings.js)
- [frontend/css/styles.css](frontend/css/styles.css)
- [FEATURES.md](FEATURES.md) — 2.8.0 `in-progress` → `done`
- [version.json](version.json) — 2.8.0-b0065 → 2.8.0-b0066 (build-bump: feature-afslutning)

Næste milestone: 2.9.0 M3 (audit-store + endpoint_service instrumentering).

---

## [2.8.0 build 0065] — 2026-04-24 — feat: Endpoint-cache M1 (core + write-invalidering)

Første milestone af 2.8.0 (`planned` → `in-progress`). Sigter mod N+1-ISE-
kald-problemet i Browse/Edit: hver filter-toggle / Refresh / tab-skift
udløste tidligere 1 list + N per-endpoint GET'er, hvilket ved 100+
endpoints giver mærkbar latency.

**Phase 1 — Cache-kerne** ([backend/app/core/endpoint_cache.py](backend/app/core/endpoint_cache.py)):
in-memory singleton med per-id detail-cache + groups-cache, TTL +
stale-while-revalidate (stale entries serveres op til 10× TTL mens en
baggrunds-refresh genopfrisker), in-flight-dedup så samtidige SWR-
refreshes for samme id ikke multiplicerer ISE-kald, stats
(hits/misses/stale-serves/bg-refreshes/invalidations).

**Phase 3 — Write-invalidering**:
- [backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py):
  `get_endpoint` læser nu via cache; `update_endpoint` og `delete_endpoint`
  invaliderer detail-entry synkront efter vellykket ISE-kald; `bulk_create`
  kører `invalidate_all` når noget lykkedes / blev overskrevet.
- [backend/app/services/custom_attribute_service.py](backend/app/services/custom_attribute_service.py):
  `remove_value`'s ISE-scan og `sync_platform_from_mnt` invaliderer per-id
  efter `set_custom_attributes`, så Browse/Edit ikke viser forældet custom-
  attr efter værdi-slet eller platform-sync.
- [backend/app/services/settings_service.py](backend/app/services/settings_service.py):
  `update_backend_settings` kører `invalidate_all` (URL/api-type kan være
  skiftet, cachede entries er potentielt fra en anden ISE).

**Settings** ([backend/app/core/config.py](backend/app/core/config.py)): nye felter
`cache_enabled` (default true), `cache_ttl_seconds` (60), `cache_stale_while_revalidate`
(true). Læses live pr. kald, så ændring i `config.json` slår igennem uden
restart. UI-toggles kommer i M2.

**Admin-API** ([backend/app/api/cache.py](backend/app/api/cache.py)):
`GET /api/cache/stats` viser hit-rate + entry-count; `POST /api/cache/invalidate`
manuel clear. Begge admin-only.

Berørte filer:
- [backend/app/core/endpoint_cache.py](backend/app/core/endpoint_cache.py) — ny
- [backend/app/core/config.py](backend/app/core/config.py)
- [backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py)
- [backend/app/services/custom_attribute_service.py](backend/app/services/custom_attribute_service.py)
- [backend/app/services/settings_service.py](backend/app/services/settings_service.py)
- [backend/app/api/cache.py](backend/app/api/cache.py) — ny
- [backend/app/main.py](backend/app/main.py) — registrér cache-router
- [FEATURES.md](FEATURES.md) — 2.8.0 status `planned` → `in-progress`
- [version.json](version.json) — 2.7.1-b0064 → 2.8.0-b0065 (minor-bump: ny feature)

M2 (bg-sync worker + frontend SWR-headers) kommer som næste commit.

---

## [2.7.1 build 0064] — 2026-04-24 — fix: Browse/Edit kan rydde custom attributes til tom

I Browse/Edit detail-modal kunne man ikke sætte nogen af custom attribute-
dropdowns (Type, Owner, Lokation, AuthzVlan, AuthzACL, PlatformType) til "—"
(tom): efter Gem vendte den forrige værdi tilbage, så endpoint endte i
authz-policyens fallback/"bypass"-regel. Rodårsag: `update`-metoderne i
[backend/app/ise/endpoints.py](backend/app/ise/endpoints.py) og
[backend/app/ise/openapi_endpoints.py](backend/app/ise/openapi_endpoints.py)
filtrerede empty-string-værdier fra `custom_attributes` før PUT-payloaden
blev sendt. ISE merger `customAttributes`-blokken på PUT, så en droppet
nøgle = forrige værdi beholdes (samme problem vi tidligere fik lukket i
`set_custom_attributes` i build 0058).

Fix: begge `update`-metoder sender nu hele `custom_attributes`-dict'et
uden at strippe empty strings. Kommentar tilføjet der forklarer ISE-merge-
adfærden for næste person der redigerer koden. `create`-stierne beholder
filteret — tomme felter skal ikke skrives ved oprettelse.

Berørte filer:
- [backend/app/ise/endpoints.py](backend/app/ise/endpoints.py)
- [backend/app/ise/openapi_endpoints.py](backend/app/ise/openapi_endpoints.py)
- [BUGS.md](BUGS.md) — ny fixed-entry
- [version.json](version.json) — 2.7.0-b0063 → 2.7.1-b0064 (patch-bump: bugfix)

---

## [2.7.0 build 0063] — 2026-04-24 — docs: Opdatér README til nuværende system

README.md afspejlede ikke længere det aktuelle system. Fuld opdatering:

- **Features**: tilføjet DACL editor, MnT session-status (grøn/rød), CoA
  reauth/disconnect, PlatformType-mapping, brugerstyring+RBAC (admin/editor/
  viewer), logs-side, dark mode, sticky toolbar, bulk-edit, skip/overskriv
  ved CSV-import, Tilknytning-roundtrip i CSV.
- **Custom attributes**: fra 4 til 6 managed attrs (tilføjet AuthzACL,
  PlatformType).
- **Sidebar-sider**: tilføjet ACL, Logs, Users — med rolle-kolonne.
- **REST API**: fuld liste med rolle-kolonne; tilføjet /auth/*, /users/*,
  /dacls/* (+validate), /endpoints/{id}/coa-*, /session-macs, /details/all,
  /logs, PlatformType sync-mnt + mapping, /settings/test.
- **Sikkerhed**: "ingen bruger-autentificering" erstattet med JWT + bcrypt
  + first-run setup + RBAC.
- **Forudsætninger**: ISE-krav opdateret fra 3.1+ til 3.4; tilføjet MnT
  Admin rolle til CoA/session-status.
- **Teknologier**: tilføjet PyJWT, bcrypt; MnT + CoA til ISE-integration.
- **Projektstruktur**: opdateret med nye moduler (auth, users, dacls, logs,
  coa, mnt_sessions, openapi_endpoints; login/logs/dacls views).

Rene docs — ingen kodeændringer.

**Filer**: `README.md`, `version.json`, `CHANGELOG.md`.

---

## [2.7.0 build 0062] — 2026-04-22 — docs: Planlæg 5 nye features (2.9.0 – 2.13.0)

FEATURES.md har fået fem nye `[planned]`-entries:

- **2.9.0 — Audit log + rollback**: append-only SQLite-historik over alle
  writes med aktør/før/efter; én-klik rollback; ny Audit-side +
  per-endpoint historik-knap. 4 faser.
- **2.10.0 — Ny RBAC-rolle "registrar" + mobile onboarding**: fjerde
  rolle (admin/editor/viewer/**registrar**) der kun må oprette endpoints.
  Mobile-optimeret PWA-installerbar view med MAC-QR-scan og NFC-read.
  5 faser.
- **2.11.0 — MAC OUI → vendor lookup**: offline IEEE OUI-database i
  backend, vendor-badge i Browse, auto-suggest Type/PlatformType i
  Create. 5 faser.
- **2.12.0 — Webhooks til ServiceNow CMDB**: HTTP POST på endpoint-events
  med retry-kø, HMAC-signatur, SNOW-template + generisk JSON. 6 faser;
  afhænger af 2.9.0 til delivery-log.
- **2.13.0 — Saved filter views + endpoint-templates**: gem filter-
  kombinationer per bruger + delte endpoint-skabeloner til Create +
  registrar-flow. 5 faser.

Ingen kodeændringer endnu — rene planer.

## [2.7.0 build 0061] — 2026-04-22 — docs: Planlæg endpoint-cache (2.8.0) + PxGrid-invalidering (3.0.0)

FEATURES.md har fået to nye `[planned]`-entries:

- **2.8.0 — Endpoint-cache + background sync**: 5-fase plan for stale-
  while-revalidate cache der eliminerer N+1 ISE-kald ved filter/refresh.
  In-memory dict + TTL + bg-sync-worker + delta-fetch via ERS
  `lastUpdateTime`-filter + frontend row-diff-render. Non-breaking MINOR.
- **3.0.0 — PxGrid event-invalidering af endpoint-cache**: Bygger videre
  på 2.8.0's cache. `com.cisco.ise.endpoint`-topic invaliderer cache-
  entries i real-time ved admin-ændringer i ISE-GUI. Kombineret med den
  allerede planlagte session-push giver det en cache der er altid
  aktuel uden periodisk poll; bg-sync-interval kan hæves eller slås fra.

Ingen kodeændringer endnu — rene planer.

## [2.7.0 build 0060] — 2026-04-22 — docs: Planlæg PxGrid server-push (3.0.0)

FEATURES.md har fået en `[planned 3.0.0]`-entry for server-push af
session/auth-status via Cisco PxGrid 2.0 (WebSocket+STOMP). Erstatter
den nuværende poll-baserede MnT-session-liste med ægte event-push.
Planen har 4 faser (infrastructure, session subscription, frontend SSE,
topic-udvidelse) og beskriver præ-krav (PxGrid enabled i ISE, approved
client-konto, X.509 cert-onboarding), nye settings-felter og lag.
Ingen kodeændringer endnu.

## [2.7.0 build 0059] — 2026-04-21 — feat: ACL-editor afviser ACE hvor src ≠ any

ACL-editorens real-time syntaks-check fanger nu den ISE-specifikke regel
om at *source* skal være `any` i alle ACE'er i en DACL. ISE afviser
ellers hele DACL'en med 400 `"Validation Error — While creating DACL,
the keyword 'Any' must be the source in all ACE in DACL"` fordi ISE
selv substituerer klient-IP'en for `any` ved push. Tidligere så
brugeren først fejlen når Gem-knappen blev trykket.

- **backend (`services/dacl_service.py`)**: `_validate_line` tjekker
  nu at første source-token er `any` før den kalder `_consume_address`.
  Alt andet (host X, prefix, object-group, eksplicit IP+wildcard) giver
  et `error`-issue med dansk besked der forklarer substitutionen.
  Destinations-reglen er uændret.
- **docs (`FEATURES.md`)**: Feature-entry tilføjet øverst.

## [2.6.5 build 0058] — 2026-04-21 — fix: Slettet attribut-værdi kommer tilbage efter sync

Når en værdi blev fjernet i Attribut-administrationen (f.eks. "hønsehus"
fra Owner) rapporterede UI'en korrekt "ryddet 1 i ISE", men en
efterfølgende "Sync fra ISE" gendannede værdien i den lokale liste.

Rodårsag: ISE ERS **merger** `customAttributes`-blokken på PUT frem for
at erstatte den. `set_custom_attributes` droppede den fjernede nøgle fra
payloaden (og filtrerede desuden empty-string-værdier væk), så ISE
beholdt den gamle værdi på endpointet. Ved næste scan af alle endpoints
blev værdien derfor "opdaget" igen og mergede tilbage i det lokale
value-store.

- **backend (`ise/endpoints.py`)**: `set_custom_attributes` sender nu
  payload uden at strippe empty strings, så empty-string-nøgler faktisk
  når ISE og rydder feltet. Docstring rettet — den gamle påstand om at
  "omitted keys are cleared" var direkte forkert.
- **backend (`services/custom_attribute_service.py`)**: `remove_value`
  sætter eksplicit `new_attrs[attr_name] = ""` i stedet for at droppe
  nøglen, så ISE får "clear"-signalet.
- **docs (`ISE_API_REFERENCE.md`)**: Tilføjet gotcha om merge-adfærden
  og den eksplicitte empty-string-konvention for at rydde et felt.
- **docs (`BUGS.md`)**: Bug-entry flyttet til Fixed.

## [2.6.4 build 0057] — 2026-04-21 — docs: Reklassificer Tilknytning-roundtrip som bug

Entry flyttet fra `FEATURES.md` til `BUGS.md` (fixed-sektion) — det
var en bug ikke et feature (CSV-roundtrip ændrede tilstand for
endpoints uforventet), så den hører hjemme under BUGS.md per regel 2
i CLAUDE.md. Ingen kodeændringer.

## [2.6.4 build 0056] — 2026-04-21 — fix: Tilknytning bevares ved export + re-import

StaticGroupAssignment (Tilknytning: Statisk/Dynamisk) kunne ændre sig
uforventet når man eksporterede et endpoint og importerede det igen:
export hardkodede "true" hvis der var en gruppe (uanset faktisk tilstand),
og import læste slet ikke feltet.

- **frontend (`csv.js`)**: `toIseCsv` skriver nu `r.static_group` i
  stedet for `r.group_name ? true : false`. `parseIseFormat` læser
  `StaticGroupAssignment` / `StaticAssignment` (ISE har historisk brugt
  begge) og parser true/false/1/0/yes/no case-insensitive via ny helper
  `parseBoolCell`. `parseSimpleFormat` returnerer `staticGroup: null`
  (ikke specificeret).
- **frontend (`views/import.js`)**: Sender `static_group_assignment` i
  bulk-create payload når kolonnen var til stede i CSV. `null` =
  backend bestemmer (bevar eksisterende ved overwrite, default true
  ved create).
- **backend (`schemas/endpoint.py`)**: `CreateEndpointRequest` fik
  `static_group_assignment: bool | None = None`.
- **backend (`services/endpoint_service.py`)**: `create_endpoint`
  sender `static=req.static_group_assignment` videre til ISE (fallback
  til True hvis None). `_overwrite_existing` bruger
  `item.static_group_assignment` hvis sat, ellers `bool(item.group_id)`
  — så roundtrip via CSV bevarer tilstanden.

## [2.6.3 build 0055] — 2026-04-21 — feat: Import CSV — valg mellem skip og overskriv eksisterende endpoints

I Import-view kan man nu vælge om eksisterende endpoints skal beholdes
som de er (skip, default) eller overskrives med værdierne fra CSV-filen
(description, gruppe, custom attributes).

- **backend (`schemas/endpoint.py`)**: `BulkCreateRequest` fik feltet
  `overwrite: bool = False`. `BulkResult` fik `overwritten: list[str]`
  så klienten kan vise en separat sektion.
- **backend (`services/endpoint_service.py`)**: `bulk_create` detekterer
  nu både `409 Conflict` OG `500 "already exists"` (ERS i ISE 3.4 giver
  500 for create på eksisterende MAC) som conflict. Ved conflict +
  `overwrite=True` kaldes ny `_overwrite_existing()`-metode der finder
  endpoint via `get_by_mac`, konverterer item til `EndpointUpdate` og
  kalder `update_endpoint`. Ved `overwrite=False` (default) går conflict
  som hidtil til `skipped`.
- **frontend (`api.js`)**: `bulkCreateEndpoints(items, overwrite=false)`
  — ny flag sendes med i body.
- **frontend (`views/import.js`)**: Ny radio-gruppe "Ved eksisterende
  endpoint" med Skip (default) og Overskriv. Result-panelet viser nu 4
  kolonner: Succeeded / Overwritten / Skipped / Failed, med antal-badge
  øverst.
- **frontend (`css/styles.css`)**: `.result-list` bruger `auto-fit` grid
  så 4 kolonner fitter pænt. Farver for `.overwritten` (blå) og
  `.skipped` (grå). Ny `.radio-row` styling.

## [2.6.2 build 0054] — 2026-04-21 — fix: Sticky toolbar klæber helt til top

Toolbaren i Browse/Edit havde et 2rem synligt gap over sig når man
scrollede, så endpoint-rækker kunne lige akkurat ses over toolbaren.

- **frontend (`css/styles.css`)**: `.content` padding flyttet fra
  `2rem 2.5rem` til `0 2.5rem` så scroll-viewportens top er flush med
  toolbar-sticky-position. Top-bufferen flyttet til `.content h2
  { margin-top: 1.25rem }` så man stadig ser lidt luft i toppen ved
  scroll=0 men rækkerne ikke scroller op "under" toolbaren.
- Toolbar fik `border-top-left-radius: 8px` + `border-top-right-radius:
  8px` så den matcher card'ets runde hjørner når den klæber til toppen.

## [2.6.1 build 0053] — 2026-04-21 — feat: Sticky toolbar i Browse/Edit

Toolbar'en øverst i Browse/Edit (Refresh / Export CSV / Kun portal / CoA
toggle / Gem alle / server-filter / Kolonner / bulk-actions / page-size /
count) er nu sticky — den bliver klæbet til toppen når man scroller ned
i endpoint-listen, så alle tools altid er tilgængelige.

- **frontend (`css/styles.css`)**: `.toolbar` fik `position: sticky;
  top: 0`, solid hvid baggrund, `z-index: 20`, `flex-wrap: wrap` og en
  subtil bottom-border. Negative margins (`margin: -1.5rem -1.5rem 1rem`
  + kompenserende padding) trækker toolbaren ud til card-kanterne så den
  lukker indholdet af nedenfor uden gap i sticky-mode.
- Dark mode: matching baggrundsfarve (`#16213e`) og border-farve.
- Ingen JS-ændringer. Virker kun fordi `.content` fik
  `overflow-y: auto` i 2.6.0 — sticky kræver en scrollende ancestor.

## [2.6.0 build 0052] — 2026-04-21 — feat: Sticky sidebar — menu og status altid synlig

Sidebar (venstre) står nu fast uanset hvor langt man scroller i content-området
til højre. Menu øverst, backend-status / version / user-info / "Log ud"
nederst — alt altid synligt.

- **frontend (`css/styles.css`)**: `.app` ændret fra `min-height: 100vh` til
  `height: 100vh` så grid-cellerne får fast højde. `.sidebar` får
  `height: 100vh` + `overflow-y: auto` (så en evt. meget lang menu kan
  scrolle internt uden at forstyrre content). `.content` får
  `overflow-y: auto` + `height: 100vh` så scroll sker inde i content-området
  i stedet for på hele siden.
- Ingen HTML- eller JS-ændringer — layoutet bevarer den eksisterende
  flex-column struktur hvor `nav` har `flex: 1` og skubber
  `.backend-status` til bunden.

## [2.5.1 build 0051] — 2026-04-21 — fix: CSV Export Template import/reset virker nu

Template-import i Settings → CSV Export Template opdaterede ikke templaten
korrekt når CSV-filen indeholdt en UTF-8 BOM (som Excel altid tilføjer),
og "Nulstil til standard" virkede ikke hvis man efterfølgende ville
re-importere den samme fil.

- **frontend (`js/csv.js`)**: `parseTemplateHeader` stripper nu BOM
  (`\uFEFF`) fra filens start, og kører `stripQuotes` på hver header-celle
  så kolonner som `"MACAddress"` normaliseres til `MACAddress`. Uden
  dette fik første kolonne et skjult BOM-prefix, så
  `extendTemplateWithPortalColumns` så den som "manglende" og tilføjede
  en duplikat.
- **frontend (`js/views/settings.js`)**: File-change handler wrapper nu
  læsning i try/catch så fejl bliver vist (før: silent crash). I
  `finally` sættes `e.target.value = ""` så brugeren kan vælge samme fil
  igen efter en fejl eller efter reset — ellers fyrer `change`-eventen
  ikke anden gang.
- Reset-knappen nulstiller også selve file-input'ets value så der ikke
  er en stale filreference efter nulstilling.

## [2.5.0 build 0050] — 2026-04-21 — feat: Auth-status farvning af række-checkbox i Browse/Edit

Række-checkboxen i Browse/Edit farves nu **grøn** (aktiv RADIUS session —
auth i access) eller **rød** (ingen aktiv session) baseret på ISE MnT
ActiveList. For at undgå unødige MnT-kald på sider med mange endpoints
hentes status **kun** når mindst ét filter er aktivt — portalOnly-toggle,
et kolonnefilter-checkbox, eller server-side MAC-filter. Uden filter vises
ingen farver.

- **backend (`api/endpoints.py`, `services/endpoint_service.py`)**: Nyt endpoint
  `GET /api/endpoints/session-macs` kalder `mnt_sessions.fetch_active_sessions()`,
  normaliserer MAC-feltet (calling_station_id / user_name) og returnerer
  en sorteret liste af MAC-adresser med aktiv session. Routet placeret før
  `/{endpoint_id}` for at undgå path-konflikt.
- **frontend (`api.js`)**: `listActiveSessionMacs()` wrapper.
- **frontend (`views/browse.js`)**: Nye helpers `anyFilterActive()`,
  `refreshActiveSessionMacs()`, `applyAuthStatusColors()`. `load()` og
  `onFilterChange()` kalder refresh efter filter-state ændres; når alle
  filtre fjernes ryddes farvningen. `renderRows()` kalder
  `applyAuthStatusColors()` efter hver re-render.
- **frontend (`css/styles.css`)**: `.row-select.auth-active` giver grøn
  accent-color + outline (#16a34a); `.auth-failed` tilsvarende rød (#dc2626).

**Berørte filer**:
- [backend/app/api/endpoints.py](backend/app/api/endpoints.py)
- [backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py)
- [frontend/js/api.js](frontend/js/api.js)
- [frontend/js/views/browse.js](frontend/js/views/browse.js)
- [frontend/css/styles.css](frontend/css/styles.css)

---

## [2.4.0 build 0049] — 2026-04-21 — feat: PlatformType 1-til-1 raw→lokal mapping + CoA-binding

PlatformType-strategien er ændret fra "lukket kanonisk værdiliste" til en **1-til-1
mapping** mellem ISE's raw-platformtyper (airos, iosxe, iossw, nxos, meraki) og
brugerens lokale labels. Det giver to ting:

1. **Lokale labels igen frie**: Brugeren kan oprette platform-labels manuelt
   på Attributter-siden (fx "Wireless-AireOS-3504", "Cat9k-Office") — fri-tekst
   "+ Tilføj"-input er genskabt på PlatformType-sektionen.
2. **CoA-metoden bindes pr. mapping**: Hver mapping-række har en CoA-dropdown
   (Reauth / Disconnect). Når CoA-on-save trigger i Browse/Edit, slås det
   gemte endpoints lokale label op i mappingen og dispatcheres derefter.
   Hardcoded `platformType === "airos"` er erstattet med dette opslag.

MnT-sync'en oversætter nu raw → lokal label via mappingen før den skriver til
endpoint. Endpoints med en raw-værdi der ikke har en mapping-række (eller
hvor lokal-feltet er tomt) springes over og rapporteres i `unmapped_raw` +
`skipped_unmapped` i sync-resultatet, så brugeren ved hvilke labels der mangler.

Mappingen gemmes i `backend/platform_mapping.json` (gitignored).

- **backend (`core/platform_mapping_store.py` ny)**: Persisterer `{raw, local, coa}`-rækker
  som JSON. `load_mapping()` validerer raw mod `KNOWN_PLATFORM_TYPES` og CoA mod
  `("reauth", "disconnect")`. `save_mapping()` enforce'r 1-til-1 på raw.
  `raw_to_local()` returnerer `{raw: local}` for mappingens skyld; `local_to_coa()`
  giver det omvendte opslag CoA-dispatcheren bruger.
- **backend (`schemas/custom_attribute.py`)**: Nye DTO'er `PlatformMappingRow`
  (`raw`, `local`, `coa`) og `PlatformMapping` (liste). `PlatformSyncResult` udvidet
  med `skipped_unmapped` + `unmapped_raw`.
- **backend (`services/custom_attribute_service.py`)**: `sync_from_ise()`'s tidligere
  PlatformType-special-case (canonicalisering + clearing af ukendte) er fjernet
  — PlatformType behandles nu som de øvrige attributter (fri-tekst opdagelse).
  `sync_platform_from_mnt()` rewrite'et: bruger `platform_raw_to_local()` til at
  oversætte hver derived raw → lokal label, springer over og logger unmapped raws.
  Nye metoder `get_platform_mapping()` (returnerer altid én række pr. KNOWN raw,
  padded med tomme rækker for raws brugeren ikke har bundet) og `set_platform_mapping()`.
- **backend (`api/custom_attributes.py`)**: `GET /custom-attributes/PlatformType/mapping`
  (require_any) og `PUT /custom-attributes/PlatformType/mapping` (require_editor).
- **frontend (`js/api.js`)**: `getPlatformMapping()`, `setPlatformMapping(mappings)`.
- **frontend (`js/views/attributes.js`)**: `SYNC_ONLY_ATTRS` fjernet — fri-tekst
  "+ Tilføj"-input igen tilgængelig for PlatformType. Ny mapping-editor
  rendres i PlatformType-sektionen: en tabel med én række pr. KNOWN raw,
  hver med dropdown over de lokale labels + CoA-dropdown + Gem-knap. MnT-sync
  result-panelet viser også "ikke-mappede raws sprunget over" når relevant.
- **frontend (`js/views/browse.js`)**: Henter mappingen ved load og bygger et
  `Map<localLabel, coa>` (`coaByLocal`). `runCoaForIds()` bruger nu opslaget
  i stedet for `platformType.toLowerCase() === "airos"`. Detail-modalens
  CoA-statusbesked er ligeledes opdateret.
- **`.gitignore`**: `backend/platform_mapping.json` tilføjet.

## [2.3.1 build 0048] — 2026-04-20 — feat: Auto-select dirty row i Browse/Edit

Når man ændrer et felt i Browse/Edit (rækken bliver gul / dirty) bliver
rækkens checkbox nu automatisk markeret. Det betyder at "Gem valgte" /
"Disconnect valgte" / "Slet valgte" og bulk-edit øjeblikkeligt inkluderer
de ændrede rækker uden ekstra klik.

- **frontend (`js/views/browse.js`)**: `markDirty(tr)` sætter nu også `tr.querySelector(".row-select").checked = true` (kun hvis ikke allerede valgt) og kalder `updateSelectionUI()` så selection-count + bulk-knapper opdateres med det samme.

## [2.3.0 build 0047] — 2026-04-20 — feat: PlatformType auto-sync fra ISE MnT + kanonisk værdiliste

PlatformType er ikke længere fri tekst. Værdilisten er lukket og kanonisk
(`airos`, `iosxe`, `iossw`, `nxos`, `meraki`) og kan kun udvides via to
syncs: en ny per-sektion "Sync platform fra MnT"-knap (henter aktive
RADIUS-sessions og deriverer platform pr. endpoint) og den eksisterende
globale "Sync fra ISE"-knap (canonicaliserer eksisterende værdier på
endpoints — synonymer normaliseres, ukendte ryddes). Manuel "+ Tilføj"-input
for PlatformType er fjernet på Attributter-siden.

- **backend (`app/core/platform_types.py` ny)**: `KNOWN_PLATFORM_TYPES = ["airos", "iosxe", "iossw", "nxos", "meraki"]` + `normalize(value)` der mapper case-insensitivt mod den kanoniske liste plus en synonym-tabel (catalyst9800/9800/c9800/ios-xe → iosxe, wlc/aireos/aire-os → airos, nexus/nx-os → nxos, ios → iossw, ...). Ikke-genkendte værdier returnerer `None`.
- **backend (`app/ise/mnt_sessions.py` ny)**: `fetch_active_sessions()` rammer `GET /admin/API/mnt/Session/ActiveList` (samme auth-mønster som `coa.py`), parser XML defensivt og returnerer en liste af dicts. `derive_platform(session)` søger efter vendor-markører (Airespace, Meraki, 9800/c9800/ios-xe, nx-os/nexus, ios-classic) i Cisco-AVPair/NAS-Identifier/device_type-felterne; falder tilbage på NAS-Port-Type (19=wireless → airos, 15=ethernet → iossw). `index_by_mac(sessions)` bygger `{NORMALIZED_MAC: canonical_platform}`.
- **backend (`app/schemas/custom_attribute.py`)**: Nyt `PlatformSyncResult` schema (active_sessions, matched_endpoints, updated_endpoints, skipped_existing, new_values_found, unmatched_macs).
- **backend (`app/services/custom_attribute_service.py`)**: `sync_from_ise()` special-caser nu PlatformType — pr. endpoint canonicaliserer eller rydder værdien direkte i ISE (logget med før/efter), og store'ets PlatformType-liste *erstattes* (ikke merges) med set af canonicalized værdier set under scan så stale entries ikke hænger fast. Ny `sync_platform_from_mnt(overwrite=False)`: henter MnT sessions, bygger MAC→endpoint mapping, opdaterer PlatformType pr. match (springer over hvis værdi findes og overwrite=False), opdaterer store, returnerer `PlatformSyncResult`.
- **backend (`app/core/custom_attr_store.py`)**: `save_values` exporteres så servicen kan skrive direkte (PlatformType-listen erstattes i stedet for merges).
- **backend (`app/api/custom_attributes.py`)**: Ny `POST /custom-attributes/PlatformType/sync-mnt?overwrite=<bool>` (require_editor). Mapper `IseApiError` til 502/HTTP-status.
- **frontend (`js/api.js`)**: `syncPlatformFromMnt(overwrite=false)` POST'er til ny endpoint.
- **frontend (`js/views/attributes.js`)**: `SYNC_ONLY_ATTRS = new Set(["PlatformType"])` skjuler "+ Tilføj"-input for sync-only attributter. PlatformType-sektionen får en `attr-sync-row` med "Sync platform fra MnT"-knap, "Overskriv eksisterende"-checkbox og resultat-output. Tags har stadig ×-knap så stale entries kan ryddes manuelt.

## [2.2.0 build 0046] — 2026-04-20 — feat: PlatformType attribut + AireOS-aware CoA + kolonne hide/unhide

Nyt managed custom attribute "PlatformType" på endpoints (frie værdier:
airos, iosxe, iossw, nxos, ...). Vises som ny "Platform"-kolonne i Browse/Edit
og kan redigeres inline, i detail-modal, i bulk-edit, via Opret og via CSV
import/export. Når global "CoA reauth"-toggle er TIL og et endpoint har
`platformType == "airos"` sender portalen en CoA-Disconnect i stedet for
CoA-Reauth — AireOS WLC honorerer ikke reauth pålideligt for policy-skift,
mens disconnect tvinger re-association og dermed fuld policy-genberegning.
Samtidig nyt toolbar-menu "Kolonner ▾" der lader brugeren skjule/vise
enkelte kolonner i Browse/Edit (persisteret pr. kolonne i `localStorage`).

- **backend (`app/core/custom_attr_store.py`)**: `PlatformType` tilføjet til `MANAGED_ATTRS` så definitionen auto-oprettes i ISE og dukker op i Attributter-view + sync.
- **backend (`app/schemas/endpoint.py`)**: `EndpointDetail.platform_type` og `CustomAttrs.PlatformType` felter tilføjet.
- **backend (`app/services/endpoint_service.py`)**: `get_endpoint()` mapper `ca.get("PlatformType", "")` ind i DTO'en.
- **frontend (`js/views/browse.js`)**: Ny kolonne `platform_type` i `COLUMNS`. `caValues.PlatformType` indlæses via `listCustomAttributes`. Ny `<select class="ca-platformtype">` i tabel-rækker, `<select id="d-platformtype">` i detail-modal og `<select id="be-platformtype">` i bulk-edit modal. `buildSavePayload()` returnerer nu `{ id, mac, payload, localUpdate, platformType }` så CoA-dispatcher kender platform per endpoint. `runCoaForIds(entries)` accepterer array af `{id, platformType}` og kalder `api.coaDisconnect(id)` hvis `platformType.toLowerCase() === "airos"`, ellers `api.coaReauth(id)`. Tæller separate `disconnects` og `reauths` i resultatet og viser dem i success-besked via `coaSummaryText()`. Detail-modal d-save passer `[{id, platformType}]` videre. Nyt `COLVIS_KEY` med `loadColVis()`/`saveColVis()`. Toolbar har `#col-vis-btn` ("Kolonner ▾") + `#col-vis-menu` med checkbox pr. kolonne + "Vis alle"-knap. `applyColVis()` toggler `.col-hidden` klasse på `<th>` og `<td>` for hver skjult kolonne (kaldes efter hver `renderRows()` så nye rækker også respekterer state).
- **frontend (`js/views/create.js`)**: `attrLabels` tilføjet `PlatformType: "Platform-type"` så feltet vises i Opret-formularen.
- **frontend (`js/views/import.js`)**: `hasCA` checker nu også `p.platformType`. Ny `<th>PlatformType</th>` kolonne + `<td>${escapeHtml(p.platformType)}</td>` i preview-tabellen. ImportBtn-payload mapper `if (p.platformType) { ca.PlatformType = p.platformType; hasCA = true; }`.
- **frontend (`js/views/attributes.js`)**: `ATTR_LABELS` tilføjet `PlatformType: "Platform-type (airos, iosxe, iossw, nxos, ...)"` så værdier kan administreres på Attributter-siden.
- **frontend (`js/csv.js`)**: `DEFAULT_TEMPLATE` udvidet med `CUSTOM.PlatformType`. `parseIseFormat()` læser `custom.platformtype`-kolonnen og udfylder `platformType` på items. `parseSimpleFormat()` læser `parts[8]` som `platformType`. `toIseCsv()` skriver `r.platform_type` til `CUSTOM.PlatformType`-kolonnen ved export.
- **frontend (`css/styles.css`)**: Nye styles for `.col-vis-wrap`, `.col-vis-menu`, `.col-vis-item`, `.col-vis-actions` (popup med checkboxes + "Vis alle"-knap) og en `.col-hidden { display: none !important; }` regel. Dark-mode varianter for menuen.

## [2.1.0 build 0045] — 2026-04-20 — feat: Persistente filtre i Browse/Edit

Filtre i Browse/Edit nulstilles ikke længere når man skifter rundt i portalen.
Alle aktive filtre gemmes i `localStorage` og restoreres ved næste render af
siden — de skal aktivt fjernes for at forsvinde.

- **frontend (`js/views/browse.js`)**: Nyt `BROWSE_FILTERS_KEY` + `loadBrowseFilters()`/`saveBrowseFilters()` helpers. `snapshotFilters()` opsamler portalOnly-toggle, server-side filter (field/op/value) og alle aktive kolonnefiltre (col + value). `persistFilters()` kaldes på enhver filter-ændring (toggle, checkbox, input, dropdown). `restoreFilters()` køres lige før første `load()`: sætter knap-tilstand, dropdowns, kolonne-checkboxes og deres input — `load()` ser herefter de restorede filtre via det eksisterende `needsFilterMode()`-flow og henter fuldt datasæt hvis nødvendigt.

## [2.0.1 build 0044] — 2026-04-20 — fix: Update af eksisterende DACL fejlede med "Mandatory fields missing: [Name,]"

ISE's ERS PUT på `/ers/config/downloadableacl/{id}` kræver `Name` i body som
mandatory field — også selv om navnet ikke ændres. Frontend har name-feltet
read-only efter oprettelse og sendte derfor kun description/dacl/dacl_type i
PUT-requesten, hvilket gav HTTP 400 fra ISE.

- **backend (`app/services/dacl_service.py`)**: `DaclService.update` henter nu det eksisterende DACL-navn via `repo.get(id)` og inkluderer det altid i PUT-bodyen, hvis frontend ikke sender et nyt navn.

## [2.0.0 build 0043] — 2026-04-20 — feat: AuthzACL attribut + Cisco IOS access-list editor

Major bump pga. ny top-level feature: portalen administrerer nu Cisco ISE
Downloadable ACLs (DACLs) direkte og knytter dem til endpoints via et nyt
custom attribute "AuthzACL" (samme navngivningsstil som AuthzVlan).

- **backend (`app/ise/dacls.py`)**: Nyt integrationsmodul med `IseDaclRepository` (ERS `/ers/config/downloadableacl`) og `OpenApiDaclRepository` (`/api/v1/downloadable-acl`). Begge eksponerer `list_all`, `get`, `get_by_name`, `create`, `update`, `delete` med samme signatur så service-laget kan dispatche på `ise_api_type`.
- **backend (`app/services/dacl_service.py`)**: Ny `DaclService` der vælger ERS- eller Open-API-repo baseret på settings, plus en `validate_dacl(text, type)` der parser hver linje som en Cisco IOS ACE: action (permit/deny/remark), valgfri sequence, protocol (ip/tcp/udp/icmp/…/numerisk), src/dst (any | host A.B.C.D | A.B.C.D wildcard | object-group <n> | IPv6 prefix), valgfri port-operator (eq/neq/gt/lt/range). Lenient — advarer fremfor at fejle på ukendte protokoller; ISE laver det endelige tjek ved gem.
- **backend (`app/schemas/dacl.py`)**: Nye DTOs `DaclSummary`, `DaclDetail`, `CreateDaclRequest`, `UpdateDaclRequest`, `ValidateDaclRequest`, `DaclLineIssue`, `DaclValidationResult`.
- **backend (`app/api/dacls.py`)**: Nye routes under `/api/dacls`: `GET` (list), `GET /{id}`, `POST`, `PUT /{id}`, `DELETE /{id}`, `POST /validate`. Read-only routes kræver `require_any`; mutationer kræver `require_editor`.
- **backend (`app/main.py`, `app/api/deps.py`)**: Registrér `dacls`-router og DI-funktion `get_dacl_service`.
- **backend (`app/core/custom_attr_store.py`)**: Tilføjet `AuthzACL` til `MANAGED_ATTRS`, så definitionen auto-oprettes i ISE ved første endpoint-write (sammen med eksisterende Type/Owner/Lokation/AuthzVlan).
- **backend (`app/schemas/endpoint.py`)**: `CustomAttrs` udvidet med `AuthzACL`. `EndpointDetail` udvidet med `authz_acl`-felt.
- **backend (`app/services/endpoint_service.py`)**: `get_endpoint` mapper `customAttributes.AuthzACL` ind i `EndpointDetail.authz_acl`.

- **frontend (`js/api.js`)**: Nye client-metoder `listDacls`, `getDacl`, `createDacl`, `updateDacl`, `deleteDacl`, `validateDacl`.
- **frontend (`js/views/dacls.js`)**: Helt ny side under `#/dacls` med to-spalte layout — DACL-liste (filtrerbar) til venstre, editor til højre. Navn/beskrivelse/type-felter + monospaced textarea med Cisco IOS access-list syntaks. Real-time backend-validering (debounced 350ms) viser inline fejl/advarsler per linje med kildelinje-citat. Opret/Gem/Slet med ISE som autoritativ validator. Dirty-tracking advarer ved afbrudt arbejde.
- **frontend (`index.html`, `js/app.js`)**: Ny sidebar-link "ACL" + route. Synlig for admin/editor.
- **frontend (`js/views/browse.js`)**: Ny kolonne "AuthzACL" i Browse/Edit-tabellen, dropdown-værdier hentet live fra `/api/dacls` (ikke fra det lokale value-store). Tilføjet i detail-modal, bulk-edit-modal og save-payload.
- **frontend (`js/views/create.js`)**: AuthzACL-dropdown i Opret endpoint, men uden "+ Tilføj ny..." — feltet henter sine værdier fra ISE's DACL-katalog. Inline hint linker til ACL-siden.
- **frontend (`js/views/import.js`)**: AuthzACL-kolonne i CSV-preview og inkluderet i bulk-create payload.
- **frontend (`js/csv.js`)**: `CUSTOM.AuthzACL` tilføjet til default CSV-template; parses fra ISE-format og fyldes ved export.
- **frontend (`js/views/attributes.js`)**: AuthzACL bevidst udeladt fra Attributter-siden — værdierne styres på ACL-siden, ikke i den lokale tilladte-værdier-store.
- **frontend (`css/styles.css`)**: Styling til `.dacl-layout`, `.dacl-list`, `.dacl-body` (monospaced editor), `.dacl-issue-list` med farvekodning af severity, plus dark-theme-varianter.

- **docs**: `FEATURES.md` — feature registreret. `version.json` bumpet til 2.0.0 build 0043.

## [1.21.1 build 0042] — 2026-04-19 — fix: Browser-reload tvang nyt login selvom token stadig gyldigt

- **frontend (`js/api.js`)**: `/auth/status` lå i `UNAUTH_PATHS`, hvilket gjorde at frontend ikke sendte Authorization-headeren med ved statuscheck. Backend returnerede så altid `authenticated: false` → `app.js` ryddede tokenen. Konsekvens: hver browser-reload tvang nyt login. Fjernet `/auth/status` fra listen; route'n er stadig public men læser nu tokenen når den er sendt.

## [1.21.0 build 0041] — 2026-04-19 — feat: CoA Disconnect (deauthenticate)

- **backend (`app/ise/coa.py`)**: Refaktoreret fælles MnT-kald ud i `_call_mnt(action, mac, type)`. Tilføjet `disconnect(mac)` der rammer `GET /admin/API/mnt/CoA/Disconnect/{psn}/{mac}/{disconnectType}`. Forcerer WLC/switch til at fjerne sessionen så klienten skal gen-associere og køre fresh DHCP DORA — nyttigt ved VLAN-skift hvor ny IP skal tvinges.
- **backend**: Ny config `coa_disconnect_type` (default 0 = DEFAULT deauth — rigtig for wireless/WLC; 1 = PORT BOUNCE og 2 = PORT SHUTDOWN er for wired). Persisteres i `backend/config.json` og eksponeres i Settings.
- **backend**: Ny route `POST /api/endpoints/{id}/coa-disconnect` (require_editor) der returnerer samme shape som reauth (`CoaReauthResponse`).
- **frontend (browse)**: Ny `Disconnect`-knap i detail-modal (destruktiv style, med confirm-dialog der advarer om at ny IP kun opnås ved VLAN-skift eller DHCP-lease udløb). Ny bulk-knap "Disconnect valgte" i toolbar der kører disconnect på alle valgte endpoints og viser sammenfatning.
- **frontend (settings)**: Nyt select til `coa_disconnect_type` med beskrivende labels og hint om at 0 er rigtig for trådløse klienter.
- **docs**: `FEATURES.md` — feature registreret som done.

## [1.20.1 build 0040] — 2026-04-19 — fix: CoA 401 — manglende MnT Admin-rolle + bedre diagnostik

- **backend**: `app/ise/coa.py` — MnT CoA-kaldet fejlede med HTTP 401 (HTML login-side) selvom credentials var korrekte. Rodårsag: ERS Admin-rollen giver ikke adgang til MnT REST API — MnT Admin eller Super Admin er nødvendig. Koden fanger nu eksplicit:
  - 3xx redirects (`follow_redirects=False`) → rolle-hint med lokation
  - HTML login-sider (`text/html` / `<html` / `login.jsp` i body) → rolle-hint
  - 401/403 → dansk besked "brugeren mangler formentlig MnT Admin-rolle (tildel 'MnT Admin' eller 'Super Admin' i ISE)"
- **frontend (settings)**: Advarselsboks ved CoA-felterne forklarer at MnT Admin / Super Admin er krav, og hvor i ISE rollen tildeles (Administration → System → Admin Access → Administrators → Admin Users).
- **docs**: `ISE_API_REFERENCE.md` — MnT CoA-sektion opdateret med rolle-kravet eksplicit. `BUGS.md` — bug registreret og markeret som fixed.

## [1.20.0 build 0039] — 2026-04-19 — feat: Refresh efter save + global CoA reauth toggle

- **frontend (browse/edit)**: Detail-modal save lukker nu modalen og kalder `load()` så tabellen genindlæses fra ISE efter ændring. Samme for "Gem alle" og "Gem valgte" — efter PUT reloades hele viewet så server-ændringer (staticGroupAssignment, profile re-match, m.m.) afspejles korrekt. Filter- og portal-toggle-state bevares (load() re-enterer filter-mode via `needsFilterMode()`).
- **frontend (browse/edit)**: Ny toolbar-knap "CoA reauth: TIL/FRA" (persisteret i `localStorage.coaReauthOnSave`). Når TIL: efter hver succesful endpoint-save (detail-modal, Gem alle, Gem valgte) kaldes `POST /api/endpoints/{id}/coa-reauth` for hvert gemt endpoint, og resultatet vises i success-beskeden (f.eks. "2 gemt, CoA: 2 ok").
- **backend**: Ny `POST /api/endpoints/{id}/coa-reauth` route (require_editor). Finder endpointets MAC via eksisterende `get()` og kalder nyt [coa.py](backend/app/ise/coa.py) modul der rammer ISE MnT: `GET /admin/API/mnt/CoA/Reauth/{psn}/{mac}/{reauth_type}`. Response er XML — status-besked ekstraheres løst og returneres som `CoaReauthResponse {ok, mac, message}`.
- **backend**: Nye config-felter `coa_psn_name` (tomt = afledes fra `ise_base_url`) og `coa_reauth_type` (default 1 = RERUN). Persisteres i `backend/config.json` via Settings. Admin-UI i Settings udvidet med to felter til at konfigurere disse.
- **backend**: `config.py`, `schemas/settings.py`, `services/settings_service.py`, `services/endpoint_service.py`, `api/endpoints.py`, `schemas/endpoint.py` opdateret.

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
