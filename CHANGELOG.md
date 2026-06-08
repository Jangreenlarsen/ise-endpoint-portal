# Changelog

Alle kodeændringer registreres her. Nyeste øverst.
Versionering: `version.json` er single source of truth. Se [CLAUDE.md](CLAUDE.md) regel 1.

## [6.2.5 build 0640] — 2026-06-08 — fix: Konsistens i Guest Registration settings

Tre mangler i portal settings / Guest registration (self-registration):
1. `selfregister_group_id`: fandtes i backend men ingen UI — tilføjet
   endpoint-gruppe-dropdown (henter fra /api/groups).
2. `guest_expiry_check_interval_seconds`: fandtes i config.py men manglede
   i BackendSettingsUpdate/Response schema og frontend — tilføjet overalt.
3. `<input type="time">` i settings: AM/PM-problem på Windows-locale —
   erstattet med to 24h selects (timer 00–23, minutter 00–59), samme
   mønster som b0637-fix i detail-modalen.

**Berørte filer:** `backend/app/schemas/settings.py`,
`backend/app/services/settings_service.py`,
`frontend/js/views/settings.js`, `frontend/js/views/settings/section-update.js`,
`frontend/js/i18n.js`

## [6.2.4 build 0639] — 2026-06-08 — fix: Default authz-regel tillader profil-edit men blokerer condition-edit

ISE tillader at ændre autoriseringsprofiler på Default-reglen, men ikke
conditions. Editoren åbner nu for Default med conditions-sektionen erstattet
af en info-besked ("Default matcher alt — betingelser kan ikke ændres i ISE").
Kun Delete-knappen er stadig blokeret. Backend: `condition` er nu optional
(None → sendes ikke i PUT-payload til ISE).

**Berørte filer:** `backend/app/api/policy.py`, `backend/app/ise/policy.py`,
`backend/app/services/policy_service.py`, `backend/app/schemas/policy.py`,
`frontend/js/views/policy.js`

## [6.2.3 build 0638] — 2026-06-08 — fix: Bloker redigering af ISE Default authz-regel

Default-reglen i ISE er read-only og returnerer 400 ved ændringer. Løsning:
- Backend `update_rule`/`delete_rule`: returnerer 422 med klar besked hvis regelnavnet er "default"
- Frontend `showRuleEditor()`: tidlig return med fejlbesked for default-regel
- Frontend `showRuleDetail`: skjuler Edit-knap, deaktiverer Delete-knap for default-regel
- Drag-drop: viser fejlbesked og afbryder hvis src eller dst er default-reglen

**Berørte filer:** `backend/app/api/policy.py`, `frontend/js/views/policy.js`

## [6.2.2 build 0637] — 2026-06-07 — fix: 24-timers ur til Guest Expiry time-picker

Erstattet `<input type="time">` (viser AM/PM på Windows/12h-locale) med to
`<select>`-elementer: timer 00–23 og minutter 00–59. Altid 24-timers format
uafhængigt af OS/browser-locale. Populeres via `_populateTimeSelects()` i
`initDetail`. Gem-handler kombinerer `HH` + `MM` til `YYYY-MM-DD:HH:MM`.

**Berørte filer:** `browse.js`, `browse-detail.js`, `styles.css`

## [6.2.1 build 0636] — 2026-06-07 — fix: Date+time picker til Guest Expiry date i edit-modal

Erstattet tekst-input med date+time input-par i Endpoint details edit.
Dato-del: `<input type="date">`, tid-del: `<input type="time" step="60">`.
Populate splitter `YYYY-MM-DD:HH:MM` på første kolon. Gem kombinerer de to
felter — mangler tidsværdi defaulter til `23:59`. CSS .expiry-dt-wrap med
dark/midnight theme support.

**Berørte filer:** `browse.js`, `browse-detail.js`, `styles.css`

## [6.2.0 build 0635] — 2026-06-07 — feat: Guest Expiry background worker

Ny periodisk baggrunds-worker der automatisk sætter GuestAccessExpire=true i ISE
når GuestExperyDate er passeret. Workflow:
  1. `guest_expiry_store.py` (SQLite, `backend/cache/guest_expiry.db`) tracker alle
     endpoints med GuestRegistration=true og en GuestExperyDate.
  2. `guest_expiry_worker.py` kører hvert 60s (`guest_expiry_check_interval_seconds`),
     finder udløbne poster og kalder ISE ERS for at sætte GuestAccessExpire=true.
  3. `endpoint_service._sync_guest_expiry()` opdaterer storen ved create/update/delete.
  4. Worker startes og stoppes rent i `main.py` lifespan.

**Berørte filer:** `core/guest_expiry_store.py` (ny), `services/guest_expiry_worker.py` (ny),
`services/endpoint_service.py`, `core/config.py`, `main.py`, `FEATURES.md`

## [6.1.4 build 0634] — 2026-06-07 — fix: Ret manglende PATCH-versionsbump fra b0633

b0633 var en fix-commit men PATCH blev ikke bumped (6.1.3 → 6.1.3 fejlagtigt).
Rettet til 6.1.4.

## [6.1.3 build 0633] — 2026-06-07 — fix: Omdøb guest expiry felter + skjul dem når GuestRegistration != true

Labels: "Guest Expiry date" og "Guest access expired" (DA+EN). Felterne i
detail-modal skjules automatisk når GuestRegistration er tom/false og vises
kun når GuestRegistration = true. Change-listener på #d-guestreg håndterer
live toggle. Tabelkolonnerne (browse) er uberørte da de styres af col-vis.

**Berørte filer:** `i18n.js`, `browse.js`, `browse-detail.js`

## [6.1.3 build 0632] — 2026-06-07 — feat: GuestExperyDate + GuestAccessExpire i edit-mode + kompakt detail-modal

Tilføjet GuestExperyDate (text input) og GuestAccessExpire (select) til:
- Detail modal (Endpoint details edit) — HTML + populate openDetail() + gem i #d-save
- Inline browse-tabel — ny kolonne + inline input/select + buildSavePayload()
ISE read-only metadata (Hypervision, Profile IDs, timestamps, Status) er flyttet til
en `<details>` collapsible sektion så edit-felterne fylder et vindue.
detail-grid er gjort kompakt: gap 0.28rem, margin 0.3rem, label-kolonne 130px,
font/padding reduceret. Ny .detail-meta-grid CSS (2+2 kolonner).

**Berørte filer:** `browse.js`, `browse-detail.js`, `browse-table.js`, `browse-utils.js`,
`i18n.js`, `styles.css`

## [6.1.2 build 0631] — 2026-06-07 — feat: Flyt tung sync-knap til Endpoint Attributes-side

Flyttet "↕ Synkronisér custom attributter med ISE" fra Settings → Advanced til toppen af
Endpoint Attributes-siden (`attributes.js`). Fjernet `#migration-sync-btn` og tilhørende
handler fra `section-update.js` — `if (!btn) return;` guard der brækkede resten af
`initAdvancedSection()` er nu også fjernet. Settings → Advanced viser kun "Tjek & opret".

**Berørte filer:** `frontend/js/views/attributes.js`, `frontend/js/views/settings/section-update.js`

## [6.1.2 build 0630] — 2026-06-07 — feat: Ny let knap "Tjek & opret attributter i ISE"

Ny backend `POST /custom-attributes/ensure-definitions` + ny knap i Settings → Advanced.
Kalder kun ISE Open API for at liste og oprette manglende attribut-definitioner — ingen
endpoint-scanning. Tager sekunder. Den tunge sync-knap viser nu også definitions-resultatet
via fælles `_renderDefsResult`-hjælpefunktion.
**Berørte filer:** `schemas/custom_attribute.py`, `services/custom_attribute_service.py`,
`api/custom_attributes.py`, `api.js`, `views/settings.js`, `section-update.js`, `i18n.js`

## [6.1.2 build 0629] — 2026-06-07 — fix: Sync viser nu oprettede vs. eksisterende attributter separat

`ensure_definitions` returnerer nu "existed"/"created"/"failed" pr. attribut.
`SyncResult` har tre nye lister: `definitions_existing`, `definitions_created`, `definitions_failed`.
Frontend viser grøn linje med navne på nyoprettede attributter, samlet tæller og evt. fejl.
**Berørte filer:** `ise/custom_attributes.py`, `schemas/custom_attribute.py`,
`services/custom_attribute_service.py`, `services/endpoint_service.py`,
`section-update.js`, `i18n.js`

## [6.1.1 build 0628] — 2026-06-07 — fix: Sync-knap tekst opdateret til bidirektionel synkronisering

Knaptekst, korttitel og confirm-dialog opdateret til at afspejle at synkroniseringen
går begge veje: opretter manglende attribut-definitioner i ISE OG importerer brugte
værdier fra endpoints. Loading-tekst tilsvarende opdateret.
**Berørte filer:** `i18n.js`

## [6.1.1 build 0627] — 2026-06-07 — fix: Sync-knap viser nu attribut-definitionsstatus fra ISE

Result-visningen efter "Importér custom attributter fra ISE" viser nu:
- Antal endpoints scannet + nye værdier (som før)
- Attribut-definitioner i ISE: X/Y ✓ (alle ok)
- Eller: hvilke attributter der mangler i ISE og skal oprettes manuelt (rød tekst)
**Berørte filer:** `section-update.js`, `i18n.js`

## [6.1.0 build 0626] — 2026-06-07 — feat: Gæsteadgang udløb (GuestExperyDate + GuestAccessExpire)

Ny settings-sektion under Gæste-registrering: admin vælger tidsperiode (N dage) eller bestemt dato + klokkeslæt for udløb.
Ved selvregistrering sættes `GuestExperyDate` (YYYY-MM-DD:HH:MM) og `GuestAccessExpire=false` som custom attributes.
`GuestAccessExpire` tilføjet til policy condition-builder og caValues (true/false dropdown).
**Berørte filer:** `core/config.py`, `schemas/settings.py`, `schemas/endpoint.py`, `services/settings_service.py`,
`api/selfregister.py`, `core/custom_attr_store.py`, `services/endpoint_service.py`, `services/policy_service.py`,
`views/settings.js`, `views/settings/section-update.js`, `i18n.js`, `views/policy-condition-builder.js`, `views/policy.js`

## [6.0.4 build 0625] — 2026-06-06 — release: Versionsbump til 6.0.4

Samler 6.0.4 fix: GuestRegistration + RegistretBy skipped i policy-simulering.

## [6.0.3 build 0624] — 2026-06-06 — fix: GuestRegistration + RegistretBy skipped i policy-simulering

`_ENDPOINT_ATTR_MAP` manglede entries for `GuestRegistration` og `RegistretBy` → conditions altid skipped.
`_fetch_ep_from_ise()` returnerede heller ikke disse felter for live-endpoint simulation.
**Berørt fil:** `backend/app/services/policy_service.py`

## [6.0.3 build 0623] — 2026-06-06 — release: Versionsbump til 6.0.3

Samler 6.0.x fixes: GuestRegistration i Browse/Policies, auto-scan authz-profiler,
ActiveList MnT fallback, CWA session-lookup via pxGrid + MnT, KNOWN_PROFILES import-fix.

## [6.0.2 build 0622] — 2026-06-06 — fix: KNOWN_PROFILES is not defined i policy.js

Manglende import af KNOWN_PROFILES fra policy-condition-builder.js.
**Berørt fil:** `frontend/js/views/policy.js`

## [6.0.2 build 0621] — 2026-06-06 — feat: Auto-scan ISE authz-profiler ved åbning af profile-dropdown

Første gang brugeren klikker/fokuserer dropdown'en i "Autoriseringsprofiler" i policy-editoren,
hentes alle ISE authz-profiler automatisk via `api.listAuthzProfiles()` og vises som options.
Viser "Henter profiler fra ISE…" mens hentning er i gang. `knownProfiles` initialiseres ved load.
**Berørte filer:** `policy.js`, `i18n.js`

## [6.0.2 build 0620] — 2026-06-06 — feat: GuestRegistration synlig og redigerbar i Browse + Policies

Browse-kolonne, inline-edit celle (select true/false), detail-panel felt, bulk-edit felt.
GuestRegistration + RegistretBy tilføjet til policy condition-builder EndPoints-dictionary.
GuestRegistration ["true","false"] injiceret i caValues (dropdown i conditions).
**Berørte filer:** `browse-utils.js`, `browse-table.js`, `browse.js`, `browse-detail.js`,
`browse-bulk.js`, `policy-condition-builder.js`, `policy.js`, `i18n.js`

## [6.0.1 build 0619] — 2026-06-06 — fix: ActiveList-fallback når ISE MnT Session/IPAddress returnerer 500

ISE 3.4 bug: `GET /Session/IPAddress/{ip}` returnerer HTTP 500 (CPM 34110) for visse sessioner.
Fix: ved HTTP 500 scannes `ActiveList` og filtreres på `framed_ip` — samme data, mere robust endpoint.
Ny `_session_from_active_list_row()` og `_session_by_ip_from_active_list()` i `mnt_sessions.py`.
**Berørt fil:** `backend/app/ise/mnt_sessions.py`

## [6.0.1 build 0618] — 2026-06-06 — fix: selfregister/session bruger kun MnT direkte (ikke cache)

Fjerner pxGrid-cache som kilde til session-lookup. Hvert polling-kald fra frontend
laver ét direkte MnT-kald. Tilføjet debug-logging så raw XML-svar fra ISE skrives til
app.log ved fejl — letter diagnosticering af MnT-adgang og parse-problemer.
**Berørte filer:** `api/selfregister.py`, `ise/mnt_sessions.py`

## [6.0.1 build 0617] — 2026-06-06 — release: Versionsbump til 6.0.1

## [6.0.0 build 0616] — 2026-06-06 — fix: selfregister/session bruger pxGrid-cache som primær kilde

`GET /api/selfregister/session` prøver nu pxGrid session-cache (in-memory) FØR MnT API.
`SessionInfo` har fået nyt `framed_ip`-felt populeret fra `framedIpAddress`/`ipAddresses[0]`
i pxGrid-payload. `SessionCache.get_by_ip()` scanner sessioner for matchende `framed_ip`.
Eliminerer fejlede MnT-opslag når pxGrid er aktiv — svar er øjeblikkeligt fra cache.
**Berørte filer:** `pxgrid/session_cache.py`, `pxgrid/session_worker.py`, `api/selfregister.py`

## [6.0.0 build 0615] — 2026-06-06 — feat: Komplet CWA-flow — MnT IP-session-lookup + upsert + CoA

**MnT IP-session-lookup** (`mnt_sessions.session_by_ip`):
Ny funktion der kalder `GET /admin/API/mnt/Session/IPAddress/{ip}` med retry-logik
(3 forsøg, 2 sek. mellemrum). Returnerer MAC, ACSSessionID, NAS-IP, NAS-Port-Id.

**Ny API-endpoint `GET /api/selfregister/session`:**
Frontend kalder dette efter sideload — portal bestemmer klientens IP fra
X-Forwarded-For/remote_addr og slår session op i ISE MnT. Returnerer MAC + session-data.

**Upsert-logik i `POST /api/selfregister`:**
Tjekker om MAC allerede eksisterer i ISE (ERS get_by_mac). Opdaterer (PUT) hvis ja,
opretter (POST) hvis nej. Eliminerer duplikat-fejl.

**Refaktoreret `selfregister.js`:**
Fjerner URL-param `?mac=...`. Kalder session-API i stedet med polling-UI (op til 5 runder,
3 sek. mellemrum). Viser "finder din enhed"-animation og retry-knap ved timeout.

**Berørte filer:** `ise/mnt_sessions.py`, `api/selfregister.py`, `frontend/js/selfregister.js`

## [5.30.1 build 0614] — 2026-06-04 — feat: Guest reg config i Settings + IPSK + CoA + GuestRegistration CA

**Ny CA `GuestRegistration`** — sættes til "true" på alle selvregistrerede endpoints.
**Settings → Portal Config → Advanced → "Gæste-registrering":**
- Aktivér/deaktivér selvregistrering, VLAN-dropdown (fra ISE CA-værdier), DACL-dropdown (fra ISE),
  IPSK-toggle, redirect URL og accepttekst.
**Selvregistrerings-siden:** valgfrit IPSK-felt vises hvis aktiveret i settings.
**CoA Reauth** sendes automatisk til NAS efter succesfuld registrering.
**HypervisionActive=Aktiv** sættes automatisk på alle selvregistrerede endpoints.
**Berørte filer:** `config.py`, `schemas/settings.py`, `services/settings_service.py`,
`api/selfregister.py`, `settings.js`, `section-update.js`, `selfregister.js`, `i18n.js`,
`custom_attr_store.py`, `schemas/endpoint.py`, `endpoint_service.py`

## [5.30.0 build 0611] — 2026-06-04 — feat: Public selvregistrerings-side + RegistretBy CA

Ny `selfregister.html` standalone side til wireless controller redirect.
Ny public API: `GET /api/selfregister/config` + `POST /api/selfregister` (ingen auth).
Ny endpoint CA `RegistretBy` i MANAGED_ATTRS, Browse-kolonne og edit-form.
Konfigurerbar via `selfregister_*` settings i `config.py`.
**Berørte filer:** `config.py`, `custom_attr_store.py`, `schemas/endpoint.py`, `endpoint_service.py`,
`api/selfregister.py`, `main.py`, `frontend/selfregister.html`, `frontend/js/selfregister.js`,
`browse-utils.js`, `browse-table.js`, `browse-detail.js`, `browse.js`, `i18n.js`

## [5.22.3 build 0610] — 2026-06-04 — release: Versionsbump til 5.22.3

## [5.22.2 build 0609] — 2026-06-04 — fix: HypervisionRegisteredAt stampes ved første portal-edit af pre-existing endpoints

`update_endpoint()` manglede samme check som `create_endpoint()`. Pre-existing ISE-endpoints
(oprettet udenfor portalen) fik aldrig `HypervisionRegisteredAt` sat i ISE ved efterfølgende edits.
Fix: sæt CA ved første portal-touch med bedste tilgængelige timestamp:
ISE createTime (Open API) → audit-tid → first_seen_store → now.
**Berørt fil:** `backend/app/services/endpoint_service.py`

## [5.22.2 build 0608] — 2026-06-04 — fix: Cache-engine 3 forbedringer (auto-restart, TTL, adaptiv drip)

**Fix 1 — Worker auto-restart:** `start()` bruger nu `_run_with_retry()` der fanger uhåndterede
exceptions, logger fejlen og genstarter workeren efter 60s — cache kan aldrig forblive kold pga.
et crash.
**Fix 2 — Standard TTL 60s → 300s:** Reducerer mismatch mellem drip-cyclus (30 min) og TTL.
Med 1000 endpoints og 1.8s drip-sleep refreshes 100 entries pr. 3 min → 10 min for fuld runde →
300s TTL dækkes med god margin.
**Fix 3 — Adaptiv drip-sleep:** Hvis >25% af cache er stale (fx efter server-genstart), switcher
drip-loopet til "sprint"-mode og refresher alle stale entries på interval/4 (7.5 min) i stedet
for 30 min.
**Berørte filer:** `backend/app/services/cache_prewarm.py`, `backend/app/core/config.py`

## [5.22.2 build 0607] — 2026-06-03 — release: Versionsbump til 5.22.2

## [5.22.1 build 0606] — 2026-06-03 — fix: first_seen_at bruger HypervisionRegisteredAt som seed

first_seen_store.record() får ny valgfri seed_ts-parameter. Når et endpoint
mødes for første gang i SQLite-DB'en, bruges HypervisionRegisteredAt fra ISE
som first_seen_at i stedet for time.time() — det rigtige registreringstidspunkt
bevares selv efter at SQLite-DB'en nulstilles (geninstallation).
**Berørte filer:** `backend/app/core/first_seen_store.py`, `backend/app/services/endpoint_service.py`

## [5.22.1 build 0605] — 2026-06-03 — feat: Uniform toolbar i Browse

Alle toolbar-knapper er nu `small` (ensartet højde). Logisk gruppering:
Data | Filtre → [spacer] → Gem/Undo | Selektion | Visning.
Undo-knap får label "↩ Fortryd". CoA Reauth-knap bruger i18n.
**Berørte filer:** `browse.js`, `i18n.js`

## [5.22.0 build 0604] — 2026-06-03 — fix: Rollback af template_applied fejlede 400

**Root cause 1:** `bulk_apply_template` optog ingen `before`-snapshot → rollback havde intet at gendanne fra.
**Root cause 2:** `_rollback_endpoint` i `audit.py` manglede `template_applied`-case → kastede altid 400.
**Fix:** Snapshottet before i `_one()`, tilføjet `template_applied` til rollback-handleren.
**Berørte filer:** `backend/app/services/endpoint_service.py`, `backend/app/api/audit.py`

## [5.22.0 build 0602] — 2026-06-03 — feat: Apply template/Delete/Decomm/Reactivate flyttet ind i bulk-edit modal

Fjerner `bulk-tpl-btn`, `bulk-del-btn`, `bulk-decomm-btn`, `bulk-undecomm-btn` fra toolbar.
Tilføjer "Handlinger"-sektion i bunden af "Edit selected endpoints"-modalen med de fire knapper.
Handlings-knapper lukker modal og ekskverer straks med bekræftelses-dialog.
**Berørte filer:** `browse.js` (HTML), `browse-bulk.js` (handlers), `browse-table.js` (updateSelectionUI), `styles.css`, `i18n.js`

## [5.21.1 build 0601] — 2026-06-03 — feat: Aktiv/Inaktiv status i bulk-edit "Edit selected endpoints"

Tilføjer `HypervisionActive` som valgfrit felt i bulk-edit dialogen. Sæt afkrydsning og vælg
"Aktiv" eller "Inaktiv" — alle valgte endpoints markeres dirty og gemmes til ISE ved næste save.
Badge i MAC-celle opdateres straks. `beActiveStatus` dataset ryddes korrekt ved undo/revert.
**Berørte filer:** `browse.js` (HTML), `browse-bulk.js` (apply), `browse-table.js` (save+undo), `i18n.js`

## [5.21.1 build 0600] — 2026-06-02 — fix: Sæt Aktiv-knap vises nu korrekt når active_status ikke er sat

`setAktivBtn` vistes kun ved status="Inaktiv" — endpoints uden sat status (tom streng) viste fejlagtigt
kun "Sæt Inaktiv". Fix: brug `isAktiv = active_status === "Aktiv"` som guard, så "Sæt Aktiv" vises
ved tom status OG "Inaktiv", og "Sæt Inaktiv" kun vises når status eksplicit er "Aktiv".
**Berørte fil:** `frontend/js/views/browse-detail.js` linje 148-152

## [5.21.0 build 0599] — 2026-06-02 — fix: Aktiv/Inaktiv chip har nu permanent grøn base-farve

`.mac-chip.chip-active-status` får lys grøn baggrund (#f0fdf4) + grøn kant (#86efac) + grøn tekst (#166534)
i sin neutrale tilstand — synligt adskilt fra Privat/Markeret/DeComm-chips der er grå. Aktiv-filter forbliver
solid grøn (#059669) og Inaktiv-filter solid amber (#b45309). Dark og midnight varianter tilføjet.
**Berørte filer:** `frontend/css/styles.css`

## [5.21.0 build 0598] — 2026-06-02 — release: Version 5.21.0

Versionsbump til 5.21.0 — samler alle features og bugfixes fra 5.20.x:
konfigurerbar decommission AuthzVlan/ACL (dropdowns fra ISE), drag-and-drop
reordering i policy condition-editor, HypervisionActive/Status + PSK_Mode
som dropdowns i policy-editor, system quality-check med 6 bugfixes.

## [5.20.3 build 0597] — 2026-06-02 — fix: 6 bugs fundet ved system quality-check

**Fix 1** `section-update.js:518` — decommForm submit-handler manglede `e.preventDefault()` → form-submit genindlæste siden.
**Fix 2** `browse.js:667` — clear-event nulstillede ikke `pxgridLive` → `refreshActiveSessionMacs` re-fetchede ukorrekt via MnT.
**Fix 3** `browse.js:636` — remove-event manglede `if (!mac) return`-guard (inkonsistent med upsert-event linje 619).
**Fix 4** `browse-table.js:219` — fjernede usikker `|| normalizeMac(macCell.textContent)` fallback; `tr.dataset.mac` er altid sat.
**Fix 5** `policy.js:117` — duplikerede faste caValues-injections i `.then()` og `.catch()` konsolideret til én `.finally()`.
**Fix 6** `section-update.js:477` — decommSaveBtn disables under dropdown-load-IIFE for at forhindre gem af tom `""` ved hurtigt klik.
**Berørte filer:** `section-update.js`, `browse.js`, `browse-table.js`, `policy.js`

## [5.20.3 build 0596] — 2026-06-02 — fix: Auth-status farver altid rød (badge-tekst i MAC + clear-event)

**Bug 1 (primær):** `applyAuthStatusColors()` brugte `macCell.textContent` til at udtrække MAC, men cellen indeholder badges (⚰ ⊘ ✓ 📌 ⏱) så `normalizeMac()` returnerede fx `"AB:CD:EF:12:34:56⚰"` som aldrig matchede Set'en → altid auth-failed (rød).
**Fix:** Brug `tr.dataset.mac` (altid ren normaliseret MAC sat ved row-render).
**Bug 2:** `clear`-event brugte `.clear()` på Sets der forblev truthy (tom Set ≠ null) → `!macs`-guard virkede ikke og alt blev rød.
**Fix:** Sæt `state.pxgridSessionMacs/Data/activeSessionMacs = null` i stedet.
**Berørte filer:** `browse-table.js`, `browse.js`

## [5.20.2 build 0595] — 2026-06-02 — fix: Gendan drag-and-drop (b0593) + opdateret drag-styling

Gendanner _wireDragDrop() fra b0593 (⠿-handle, e.target-walker). Opdaterer .cond-dragging til solid
blå baggrund (#dbeafe) med border og box-shadow — samme visuelle intensitet som øvrige editor-elementer.
**Berørte filer:** `policy-condition-builder.js`, `styles.css`, `i18n.js`

## [5.20.2 build 0594] — 2026-06-02 — fix: Erstat drag-and-drop med ▲/▼ move-knapper i policy condition-editor

HTML5 drag-and-drop erstattet med to små ▲/▼ knapper på hvert condition/gruppe-element.
Knapperne flytter elementet ét trin op eller ned inden for sin gruppe.
**Berørte filer:** `policy-condition-builder.js`, `styles.css`, `i18n.js`

## [5.20.2 build 0593] — 2026-06-02 — fix: Drag-and-drop virkede ikke — rewrite af _wireDragDrop

**Problem:** `draggable="true"` på hele `.cond-row` konflikter med select/input-felter; `composedPath()` i `dragstart` upålidelig på tværs af browsere.
**Fix:** `draggable="true"` flyttet til kun håndtag-spanned; `_wireDragDrop` omskrevet til at bruge `e.target` og en `_dropTarget()`-walker der finder nærmeste `.cond-group-children`-barn.
**Berørte filer:** `frontend/js/views/policy-condition-builder.js`

## [5.20.2 build 0592] — 2026-06-02 — feat: Drag-and-drop reordering af conditions i policy-editor

**Berørte filer:**
- `frontend/js/views/policy-condition-builder.js` — `⠿`-drag-handle tilføjet til `_rowHtml` og nested `_groupHtml`; `_wireDragDrop()` implementeret og kaldt fra `wireGroupEditor()`; drag kun tilladt fra handle (ikke fra select/input-felter)
- `frontend/css/styles.css` — `.cond-drag-handle`, `.cond-dragging`, `.cond-drop-before/.after` + dark mode varianter
- `frontend/js/i18n.js` — `pol.drag_handle_title` (da + en)

## [5.20.1 build 0591] — 2026-05-31 — fix: PSK_Mode dropdown i policy-editor

**Berørte filer:**
- `frontend/js/views/policy.js` — `caValues["PSK_Mode"] = ["true", "false"]` injiceret sammen med de øvrige faste værdier

## [5.20.1 build 0590] — 2026-05-31 — fix: HypervisionActive + HypervisionStatus tilgængelig i policy-editor

**Berørte filer:**
- `frontend/js/views/policy-condition-builder.js` — `HypervisionActive` og `HypervisionStatus` tilføjet til EndPoints-dictionaryet i `DICTIONARIES`
- `frontend/js/views/policy.js` — faste værdier `["Aktiv","Inaktiv"]` og `["Decommissioned"]` injiceres i `caValues` så value-widgetten viser dropdown i stedet for fritekst

## [5.20.0 build 0589] — 2026-05-31 — feat: Decommission AuthzVlan/ACL som dropdowns

**Berørte filer:**
- `frontend/js/views/settings.js` — `<input type="text">` skiftet til `<select>` for begge decommission-felter
- `frontend/js/views/settings/section-update.js` — `initAdvancedSection()` henter `api.listCustomAttributes()` (AuthzVlan-værdier) og `api.listDacls()` (DACL-navne) parallelt og populerer dropdowns; den gemte værdi pre-selectes (tilføjes listen hvis den ikke allerede er der)

## [5.20.0 build 0588] — 2026-05-31 — feat: Konfigurerbar decommission AuthzVlan/ACL

**Berørte filer:**
- `backend/app/core/config.py` — nye felter `decomm_authz_vlan` (default "999") og `decomm_authz_acl` (default "deny_all_ipv4_traffic")
- `backend/app/schemas/settings.py` — felterne tilføjet i `BackendSettingsUpdate` og `BackendSettingsResponse`
- `backend/app/services/settings_service.py` — `get_backend_settings()` og `update_backend_settings()` håndterer nye felter
- `backend/app/services/endpoint_service.py` — `decommission_endpoint()` læser fra `config.settings` i stedet for hardkodede værdier
- `frontend/js/views/settings.js` — nyt form-sektion i `pc-advanced` kort med VLAN + ACL felter
- `frontend/js/views/settings/section-update.js` — `initAdvancedSection()` udvidet med load + save af decommission-standarder
- `frontend/js/i18n.js` — 11 nye nøgler (da + en) for adv_decomm_*

## [5.19.9 build 0587] — 2026-05-31 — feat: Single toggle-chip + auto-sæt HypervisionActive ved save

**Berørte filer:**
- `backend/app/services/endpoint_service.py` — `update_endpoint()`: sætter `ACTIVE_ATTR="Aktiv"` automatisk hvis before-snapshot har tomt `active_status` og `ACTIVE_ATTR` ikke eksplicit sættes i dette kald
- `frontend/js/views/browse.js` — to chips → én `data-chip="active-status"` der cycler: ingen filter → Aktiv (grøn) → Inaktiv (amber) → ingen; state `activeStatusFilter: ""`
- `frontend/js/views/browse-filter.js` — `activeOnly`/`inaktivOnly` erstattet med `activeStatusFilter` overalt (filter, persist, snapshot, clear, URL encode/decode)
- `frontend/js/i18n.js` — ny default-label nøgle; titler opdateret

## [5.19.8 build 0586] — 2026-05-31 — feat: Aktiv/Inaktiv filter-chips i Browse + DeComm rename

**Berørte filer:**
- `frontend/js/i18n.js` — `detail.status_decomm` og `browse.decomm_chip_btn` omdøbt til "DeComm"; 6 nye nøgler for Aktiv/Inaktiv chips
- `frontend/js/views/browse.js` — 2 nye chip-knapper (`data-chip="aktiv"`, `data-chip="inaktiv"`); state init `activeOnly/inaktivOnly`; chip-handler udvidet
- `frontend/js/views/browse-filter.js` — `applyFiltersToRows()`, `updateClearBtn()`, `needsFilterMode()`, `snapshotFilters()`, `applyFilterSnapshot()`, clear-all og URL encode/decode — alle udvidet med `activeOnly`/`inaktivOnly`
- `frontend/css/styles.css` — `chip-aktiv.active` grøn; `chip-inaktiv.active` amber

## [5.19.7 build 0585] — 2026-05-31 — feat: Sæt Aktiv/Inaktiv-knapper i edit-modal + decommission sætter Inaktiv

**Berørte filer:**
- `backend/app/services/endpoint_service.py` — `decommission_endpoint()` sætter `ACTIVE_ATTR="Inaktiv"`; `undecommission_endpoint()` sætter `ACTIVE_ATTR="Aktiv"`; ny `set_active_status()` opdaterer kun `HypervisionActive`
- `backend/app/api/endpoints_ops.py` — `POST /{id}/active-status`; `SetActiveStatusRequest` schema; import af `HTTPException`, `status`
- `frontend/js/api.js` — `setActiveStatus(id, active_status)`
- `frontend/js/views/browse.js` — `#d-set-aktiv` (grøn) + `#d-set-inaktiv` (amber) knapper i modal-actions
- `frontend/js/views/browse-detail.js` — synlighedslogik for alle 4 action-knapper; `_handleSetActive()`; decommission-handler opdaterer active_status-badge og skjuler Aktiv/Inaktiv-knapper; undecommission-handler sætter Aktiv
- `frontend/js/i18n.js` — 10 nye nøgler (da + en) for Sæt Aktiv/Inaktiv-flow
- `frontend/css/styles.css` — `button.success` grøn stil

## [5.19.6 build 0584] — 2026-05-31 — feat: AuthzVlan/ACL ved dekommissionering + HypervisionActive-status

**Berørte filer:**
- `backend/app/core/custom_attr_store.py` — `ACTIVE_ATTR = "HypervisionActive"` tilføjet til `HIDDEN_ATTRS`
- `backend/app/schemas/endpoint.py` — `active_status: str = ""` i `EndpointDetail`; `HypervisionActive: str | None = None` i `CustomAttrs`
- `backend/app/services/endpoint_service.py` — import `ACTIVE_ATTR`; builder mapper `active_status`; `decommission_endpoint()` sætter `AuthzVlan=999` + `AuthzACL=deny_all_ipv4_traffic`; `undecommission_endpoint()` sætter `ACTIVE_ATTR="Inaktiv"`
- `backend/app/api/audit.py` — `_endpoint_update_from_snapshot()` gendanner `HypervisionActive` fra `active_status`
- `frontend/js/views/browse.js` — `#d-active-status` element tilføjet i detail-modal
- `frontend/js/views/browse-detail.js` — viser `active_status` badge; undecommission-handler opdaterer `active_status`
- `frontend/js/views/browse-table.js` — ⊘/✓ badge i MAC-celle for `active_status`
- `frontend/js/i18n.js` — 6 nye i18n-nøgler (da + en)
- `frontend/css/styles.css` — `active-status-inaktiv/aktiv` badge-stile + `active-status-row-badge`

## [5.19.5 build 0583] — 2026-05-31 — feat: Undecommission endpoint (enkelt + bulk)

**Berørte filer:**
- `backend/app/services/endpoint_service.py` — `undecommission_endpoint()` + `bulk_undecommission()`: sætter `HypervisionStatus=""`, auditerer som `"undecommissioned"`
- `backend/app/api/endpoints_ops.py` — `POST /{id}/undecommission` + `POST /bulk-undecommission`
- `frontend/js/api.js` — `undecommissionEndpoint()` + `bulkUndecommission()`
- `frontend/js/views/browse.js` — `#d-undecommission`-knap i detail-modal; `#bulk-undecomm-btn` i toolbar
- `frontend/js/views/browse-detail.js` — synlighedsstyring (mutex med decomm-knap); click-handler
- `frontend/js/views/browse-bulk.js` — bulk undecommission click-handler; opdaterer `state.allRows`
- `frontend/js/views/browse-table.js` — `#bulk-undecomm-btn` disabled/enabled ved selektion
- `frontend/js/i18n.js` — 12 nye i18n-nøgler (da + en) for undecommission-flow
- `frontend/css/styles.css` — `button.warning` amber-stil

## [5.19.4 build 0582] — 2026-05-31 — fix: Audit rollback nulstillede ikke HypervisionStatus ved decommissioned-rollback

**Berørte filer:**
- `backend/app/api/audit.py` — `_endpoint_update_from_snapshot()`: tilføjet `HypervisionStatus=snap.get("status") or ""` til `CustomAttrs`-bygningen — tom streng overlever `exclude_none=True` og ISE modtager eksplicit clearing af feltet

## [5.19.3 build 0581] — 2026-05-31 — fix: pxGrid SSE-stream brugte localStorage-token (ramt af cookie-migrering)

**Berørte filer:**
- `frontend/js/views/browse.js` — `startPxGridStream()`: fjernet `localStorage.getItem("hv_ise_token")`-check; EventSource bruger `{ withCredentials: true }` (cookie sendes automatisk)
- `backend/app/api/pxgrid.py` — `sessions/stream`: cookie-auth FØRST (`request.cookies.get("hv_token")`), `?token=` query-param som fallback; token_gen-tjek tilføjet

## [5.19.2 build 0580] — 2026-05-31 — fix: Token-revokation (token_gen) + log-sanitering

**Berørte filer:**
- `backend/app/core/user_store.py` — `increment_token_gen(users, user_id)` tilføjet
- `backend/app/core/auth.py` — `gen: int = 0` parameter tilføjet til `create_token()`; `gen`-claim inkluderet i payload
- `backend/app/api/deps.py` — `get_current_user()` afviser token hvis `gen != record.token_gen`; import af `increment_token_gen`
- `backend/app/api/auth.py` — logout incrementerer `token_gen`; refresh henter current gen fra user record; import af user_store helpers
- `backend/app/services/user_service.py` — login/setup_first_admin passerer `gen`; change_password og update_user (ved rolle-/passwordændring) incrementerer `token_gen`; import af `increment_token_gen`
- `backend/app/core/logging.py` — `_SensitiveDataFilter` tilføjet med regex-redaktion af password/secret/token/psk/api_key i log-beskeder

## [5.19.1 build 0579] — 2026-05-30 — fix: Audit rollback af decommissioned-handling

**Berørte filer:**
- `backend/app/api/audit.py` — `decommissioned`-gren tilføjet i `_rollback_endpoint_action()`; gendanner endpoint fra `before`-snapshot via `update_endpoint`

## [5.19.0 build 0578] — 2026-05-30 — feat: Sikkerhedsanalyse — 3 kritiske/høje sårbarheder lukket

**Berørte filer:**
- `backend/app/api/metrics_api.py` — `GET /metrics` kræver nu `require_any` (var uauthentificeret)
- `backend/app/api/config_backup.py` — backup redigerer `ise_password`, `pxgrid_password`, `tacacs_secret` ud (`__REDACTED__`); restore bevarer eksisterende credentials for redigerede felter; `credentials_redacted: true` i metadata
- `backend/app/core/auth.py` — `TOKEN_COOKIE_NAME`, `token_metadata()` hjælpefunktion, `import datetime`
- `backend/app/schemas/user.py` — `LoginResponse` udvides med `expires_at: str` og `auth_type: str`
- `backend/app/api/auth.py` — login/setup/refresh sætter httpOnly `SameSite=Strict`-cookie; logout sletter cookie; `auth_status` læser fra cookie eller Bearer; `_set_auth_cookie`/`_delete_auth_cookie` hjælpere
- `backend/app/api/deps.py` — `_extract_token()` læser cookie først, derefter Bearer-header
- `backend/app/services/user_service.py` — alle 3 `LoginResponse`-kald beregner og inkluderer `expires_at` + `auth_type`
- `frontend/js/auth.js` — token fjernet fra localStorage; gemmer kun `{expires_at, auth_type}`-metadata; `getToken()` returnerer null; `isTacacs/isTokenExpired/secondsUntilExpiry` læser fra metadata
- `frontend/js/api.js` — `Authorization`-header fjernet; `credentials: "include"` på alle fetch-kald inkl. pxGrid-upload/download; `UNAUTH_PATHS` fjernet (unødvendig)
- `frontend/js/app.js` — `getToken()`-check → `isTokenExpired()`; `save(token, user)` → `save(meta, user)`; alertBadge-guard opdateret
- `frontend/js/views/login.js` — `save(result.token, ...)` → `save({expires_at, auth_type}, ...)`
- `frontend/js/views/settings/section-backup.js` — `auth`-import fjernet; `authFetch` bruger `credentials: "include"`
- `frontend/js/views/audit.js` — token-header fjernet fra export-fetch; `credentials: "include"` tilføjet

## [5.18.1 build 0577] — 2026-05-30 — fix: 8 bugs fra code-review (Decomm-chip URL + profil-details)

**Berørte filer:**
- `frontend/js/views/browse-filter.js` — encode: `decommOnly` i stedet for `!hideDecommissioned`; decode: sæt `decommOnly=true`; `updateClearBtn`: tilføj `decommOnly`; `snapshotFilters`/`applyFilterSnapshot`: gem og gendan `decommOnly`
- `frontend/js/views/browse-table.js` — fjern duplikeret `decommOnly`-filtergren (dead code)
- `frontend/js/views/policy.js` — `document.contains(container)`-guard mod stale DOM efter async
- `backend/app/services/authz_profile_service.py` — VLAN `tagID: 0` falsy-zero: `is not None`-guard
- `backend/app/ise/authz_profiles.py` — `logger.warning` tilføjet i `get_by_name` except-blok

## [5.18.0 build 0576] — 2026-05-30 — feat: Authz Profile Details i Policy-panel

Ny feature: detail-view og editor i ISE Policies højre panel viser nu hvad de tilvalgte authz-profiler består af.

**Berørte filer:**
- `backend/app/schemas/authz_profile.py` — ny `AuthzProfileDetail`-schema
- `backend/app/services/authz_profile_service.py` — `_parse_profile_detail()` + `get_detail()`
- `backend/app/api/authz_profiles.py` — ny `GET /authz-profiles/{name}` endpoint (require_any)
- `frontend/js/api.js` — `getAuthzProfile(name)`
- `frontend/js/views/policy-condition-builder.js` — `wireProfileEvents()` udvides med onChange-callback
- `frontend/js/views/policy.js` — `renderProfileDetailCard()`, `loadAndRenderProfileDetails()`, profil-sektion i detail + editor
- `frontend/js/i18n.js` — 3 nye nøgler (da + en): `pol.pd_section_label`, `pol.pd_loading`, `pol.pd_unavailable`
- `frontend/css/styles.css` — styles: `.pol-pd-section`, `.pol-pd-card`, `.pol-pd-badge`, `.pd-attr` m.fl.

## [5.17.5 build 0573] — 2026-05-29 — chore: version bump 5.17.5

Samler bugfixes fra 5.17.4-serien (b0569–b0572) under 5.17.5.

## [5.17.4 build 0570] — 2026-05-29 — feat: Dekommissioneret chip-knap ved Privat/Markeret + fjern 📌

- `frontend/js/views/browse.js` — ny `data-chip="decomm"` chip i `.mac-type-chips` div; fjernet `#decomm-filter-btn` fra toolbar; chip-handler udvidet til at toggle `state.hideDecommissioned` (inverteret logik: chip aktiv = vis dekommissionerede)
- `frontend/js/views/browse-filter.js` — fjernet `decommFilterBtn` querySelector og click-handler; filterClearAllBtn og decodeFilterFromUrl bruger nu chippen direkte
- `frontend/js/i18n.js` — `browse.decomm_chip_btn`/`decomm_chip_title` tilføjet (DA + EN); 📌 fjernet fra `mac_marked_btn`

## [5.17.3 build 0569] — 2026-05-29 — fix: dekommissioneret badge manglede visuel indikator

- `frontend/css/styles.css` — `.decomm-status-badge` (rød pill, light + dark mode), `.decomm-row-badge` (⚰ ikon i MAC-celle), `tr.row-decomm` (dimmet + strikethrough på MAC-link)
- `frontend/js/views/browse-detail.js` — statusbadge bruger nu `.decomm-status-badge` CSS-klasse i stedet for inline styles (dark mode-kompatibelt)
- `frontend/js/views/browse-table.js` — `<tr>` får `row-decomm` klasse; MAC-cellen viser ⚰-badge med tooltip
- `frontend/js/i18n.js` — nøgle `browse.decomm_badge_title` tilføjet (DA + EN)

## [5.17.2 build 0568] — 2026-05-29 — fix: XSS/crash i import.js — escapeHtml → esc

- `frontend/js/views/import.js` — `escapeHtml()` (udefineret funktion) erstattet med `esc()` alle 12 steder. Undlod at rå brugerinput fra CSV (MAC, beskrivelse, custom attributes) blev indsat uden HTML-escaping i preview-tabel og import-resultat.

## [5.17.1 build 0567] — 2026-05-29 — fix: decommission-filter virkede ikke + clipboard-fejl på HTTP

**Bug fix — decommission-filter**
- `frontend/js/views/browse-filter.js` — fjernet `!state.hideDecommissioned` fra `needsFilterMode()` (var inverteret; begge states viste samme resultat)
- `frontend/js/views/browse-table.js` — `applyFilter()` ikke-filter-mode-sti filtrerer nu også dekommissionerede rækker klient-side

**Bug fix — share filter clipboard**
- `frontend/js/views/browse-filter.js` — `navigator.clipboard.writeText()` erstattet med try/catch + optional-chaining; fallback til `prompt(url)` på HTTP/non-secure-origin

## [5.17.0 build 0566] — 2026-05-29 — feat: Metrics-historik, bulk template-apply, decommission-flow og URL filter-deling

Fire nye features implementeret fuldt ud (backend + frontend + i18n):

**Feature 4 — Metrics-historik (SQLite time-series)**
- `backend/app/core/metrics_store.py` — ny SQLite-store: init_db, insert_snapshot, get_history, prune
- `backend/app/main.py` — init_metrics_db() ved startup + `_metrics_scrape_loop` background task (1 min interval, 6 serier)
- `backend/app/api/metrics_api.py` — ny GET /api/metrics/history (auth-beskyttet, maks 10 serier × 1440 punkter)
- `frontend/js/views/metrics.js` — SVG linjediagrammer for 4 metrics (cache-entries, stale %, ISE requests, circuit state)

**Feature 5 — Bulk template-apply**
- `backend/app/schemas/endpoint.py` — BulkApplyTemplateRequest
- `backend/app/services/endpoint_service.py` — bulk_apply_template() (Semaphore=3, audit per endpoint)
- `backend/app/api/endpoints_ops.py` — POST /api/endpoints/bulk-apply-template
- `frontend/js/views/browse.js` — "Anvend skabelon"-knap i selektion-toolbar + tpl-pick-overlay modal
- `frontend/js/views/browse-bulk.js` — bulkTplBtn handler: template-picker modal → POST bulk-apply-template
- `frontend/js/api.js` — bulkApplyTemplate()

**Feature 6 — Endpoint decommission-flow (soft-delete)**
- `backend/app/core/custom_attr_store.py` — STATUS_ATTR = "HypervisionStatus"; tilføjet til HIDDEN_ATTRS + ALL_ATTRS
- `backend/app/schemas/endpoint.py` — status: str = "" på EndpointDetail; HypervisionStatus på CustomAttrs; BulkDecommissionRequest
- `backend/app/services/endpoint_service.py` — decommission_endpoint(), bulk_decommission() (Semaphore=3, audit)
- `backend/app/api/endpoints_ops.py` — POST /api/endpoints/{id}/decommission + POST /api/endpoints/bulk-decommission
- `frontend/js/views/browse.js` — "Dekommissionér"-knap i toolbar; "Vis dekommissionerede"-toggle; dekommission-knap i detail-modal
- `frontend/js/views/browse-bulk.js` — bulkDecommBtn handler
- `frontend/js/views/browse-detail.js` — status-badge i detail-grid; d-decommission knap-handler
- `frontend/js/views/browse-filter.js` — state.hideDecommissioned (default=true); applyFiltersToRows-filter; needsFilterMode; decommFilterBtn

**Feature 7 — Filter-deling via URL**
- `frontend/js/views/browse-filter.js` — encodeFilterToUrl(), decodeFilterFromUrl(); shareFilterBtn handler; auto-decode ved init
- `frontend/js/views/browse.js` — "Del filter"-knap i filter-toolbar

**Fælles**
- `frontend/js/i18n.js` — ~44 nye nøgler (da + en) for alle 4 features
- `frontend/js/api.js` — decommissionEndpoint(), bulkDecommission(), bulkApplyTemplate(), getMetricsHistory()

## [5.16.0 build 0565] — 2026-05-29 — feat: i18n runde 3 — audit, metrics, import, settings backup + docs og gitignore

Fjerde og afsluttende runde af i18n-konvertering. Alle brugersyn­lige strenge i resterende views er nu lokaliserede. Dokumentation og gitignore bringes ajour.

- `frontend/js/views/audit.js` — meta-tæller, drawer-titel og export-fejlbesked via t()
- `frontend/js/views/metrics.js` — "Cache vedligehold"-kort og ISE PSN-noder-overskrift via t()
- `frontend/js/views/import.js` — hint-afsnit, preview-feedback og resultat-headers via t()
- `frontend/js/views/settings/section-backup.js` — fuldt lokaliseret; tilføjet import af t()
- `frontend/js/i18n.js` — ~45 nye nøgler (da + en): audit.meta/drawer_title/export_error, metrics.card_drip/drip_*/psn_nodes, import.hint_*/preview_*/list_*, settings.backup_*/restore_*
- `FEATURES.md` — tilføjet entries for v5.13.0 (i18n nav), v5.14.0 (i18n views runde 1), v5.15.0 (i18n browse runde 2)
- `BUGS.md` — tilføjet entries for v5.12.1–v5.13.1 (UI-fixes: markerings-flow, chips, knap-farve)
- `.gitignore` — tilføjet: cache/, logs/, temp/, backend/templates.json, backend/=*, IP-mapper

## [5.15.0 build 0564] — 2026-05-29 — feat: i18n runde 2 — browse-filter, browse-table, browse-bulk, browse-detail og browse

~110 nye i18n-nøgler (da + en) dækker LAA-tooltip, fortryd/gem-progress, filter-loading, views-menu (alle tekster), CoA-beskeder, PSK-fejl, RADIUS-placeholder, simulerings-UI, ANC-karantæne, historik-tab og session-tab. Alle berørte views er opdateret til at bruge t(). Ingen hardkodede danske strenge tilbage i browse-modulerne.

- `frontend/js/i18n.js` — ~110 nye nøgler i da og en (browse runde 2)
- `frontend/js/views/browse-table.js` — LAA-titel/count, markeret-pin, fortryd-dialog, gem-progress
- `frontend/js/views/browse-filter.js` — import t(), filter-loading, views-menu (al tekst + actions)
- `frontend/js/views/browse-bulk.js` — PSK-fejl, CoA-disconnect/reauth, RADIUS-placeholder, simulerings-UI
- `frontend/js/views/browse.js` — toolbar titles, new-group overlay, bulk-sim overlay, tab-knapper, MAC-chips
- `frontend/js/views/browse-detail.js` — statisk profil Ja/Nej, ISE-fejl, ANC-karantæne, historik, session

## [5.14.0 build 0563] — 2026-05-29 — feat: fuld i18n-oversættelse af lifecycle, dashboard, trends, audit, metrics

Alle synlige strenge i lifecycle-, dashboard-, trends-, audit- og metrics-views oversættes nu korrekt baseret på brugersprog. Tilføjet `lc.*`, `dash.*`, `trend.*`, `settings.cache_capacity_*`, `audit.btn_export/exporting`, `metrics.capacity_*` til i18n.js (da + en). Alle views importerer nu `t()` og bruger det til al tekst. Tildata-afhængige tidsenheder (t/h) er også i18n.

- `frontend/js/i18n.js` — ~100 nye nøgler i da og en
- `frontend/js/views/lifecycle.js` — komplet rewrite med t()
- `frontend/js/views/dashboard.js` — komplet rewrite med t()
- `frontend/js/views/trends.js` — komplet rewrite med t()
- `frontend/js/views/audit.js` — export-knap + eksporterings-tekst
- `frontend/js/views/metrics.js` — capacity-badges
- `frontend/js/views/settings/section-cache.js` — capacity-badges + "siden"

## [5.13.1 build 0562] — 2026-05-29 — fix: hvid tekst på "Ryd markeringer"-knap i Livscyklus

Fjernet `color`-override (`#92400e` / `#fcd34d`) fra `.lc-clear-marks` og dark-tema-varianten så knappen bruger standard hvid tekst som alle andre portals knapper.

- `frontend/css/styles.css`

## [5.13.0 build 0561] — 2026-05-29 — feat: fuld lokaliseringsunderstøttelse for alle menupunkter

Alle menupunkter og sidebar-labels oversættes nu korrekt ved sprogskcift. Tilføjet manglende i18n-nøgler (`nav.lifecycle`, `nav.trends`, `sidebar.role`, `sidebar.logout`) til begge sprogblokke (da/en). HTML-elementer for "Rolle:", "Log ud" og "Præferencer" forsynet med `data-i18n`-attributter. `updateNavLabels()` opdaterer nu `document.documentElement.lang` dynamisk. `<html lang>` skiftet fra hardkodet `da` til `en` (spejler default-fallback).

- `frontend/js/i18n.js`, `frontend/index.html`, `frontend/js/app.js`

## [5.12.9 build 0560] — 2026-05-28 — feat: fjernet Inaktiv-chip fra MAC-kolonne

"Inaktiv"-filterfunktionen er fjernet fra MAC-kolonnen da auth-status-kolonnen allerede viser session-tilstand. Fjernet: chip-HTML, `state.macInactive`, chip-handler-gren, `macInactive`-filterblok i `applyFiltersToRows`, `needsFilterMode`-reference, `updateInactiveChip`-funktion og `:disabled` CSS-regler.

- `frontend/js/views/browse.js`, `browse-filter.js`, `frontend/css/styles.css`.
- `version.json` — bump til 5.12.9 build 0560.

## [5.12.8 build 0559] — 2026-05-28 — fix: grundlæggende reimplementering af markerings-fjernelse

Rodårsager identificeret og løst:
1. **Inline/bulk save fjernede ALDRIG markering** — save-handlerne kaldte kun `refreshRows`, ikke nogen unmark-logik.
2. **Ingen pålidelig MAC-kilde på rækken** — `<tr>` havde ingen `data-mac`-attribut, så MAC-opslag var afhængigt af skrøbelig DOM-textContent eller state-lag der ikke altid er populeret.
3. **Forspildt kompleksitet** — unmark-kode spredt over detail-modal, refreshRows og inline-save med overlap og race conditions.

Ny implementering:
- `<tr data-mac="...">` tilføjet i `renderRows` — normaliseret MAC altid tilgængeligt på rækken.
- Centraliseret `unmarkSaved(id)` i browse-table.js: læser `tr.dataset.mac`, sletter fra localStorage, fjerner `.marked-pin` fra DOM, deaktiverer chip hvis sæt er tomt.
- `saveAllBtn` og `bulkSaveBtn` kalder `unmarkSaved` for hver vellykket gemt endpoint.
- browse-detail.js kalder `cb.unmarkSaved(savedId)` — al kompleks pin-logik fjernet herfra.

Berørte filer: `frontend/js/views/browse-table.js`, `frontend/js/views/browse-detail.js`, `version.json`.

## [5.12.7 build 0558] — 2026-05-28 — fix: 📌-pin fjernes direkte fra DOM ved gem

Tidligere delegerede gem-handleren pin-fjernelsen til `refreshRows` via localStorage-opdatering. Det er en asynkron kæde med for mange led der kan bryde. Fix: straks efter `saveMarkedMacs` fjernes pinnen direkte fra `<tr data-id="..."> .marked-pin` i DOM — dette sker synkront *inden* `closeDetail()` og *inden* `refreshRows`. `refreshRows` beholder sin pin-logik som backup.

- `frontend/js/views/browse-detail.js` — tilføjet direkte `container.querySelector('tr[data-id="..."] .marked-pin')?.remove()` efter `saveMarkedMacs`.
- `version.json` — bump til 5.12.7 build 0558.

## [5.12.6 build 0557] — 2026-05-28 — fix: markering fjernes nu korrekt efter gem (robust MAC-opslag)

Rodårsag: MAC-adressen til markerings-fjernelsen blev læst fra `#d-mac` DOM-elementets `textContent` på gem-tidspunktet. Afhængigt af browser-timing og evt. andre handlers der modificerer elementet, kunne værdien være tom eller forkert formateret.

Fix: MAC gemmes i `state.detailCurrentMac = normalizeMac(d.mac)` når detail åbner (data er netop hentet fra API), og bruges direkte ved gem. `closeDetail()` nulstiller `state.detailCurrentMac = ""`.

- `frontend/js/views/browse-detail.js` — `openDetail`: sætter `state.detailCurrentMac`; save-handler: bruger `state.detailCurrentMac` i stedet for DOM-læsning; `closeDetail`: nulstiller `state.detailCurrentMac`.
- `version.json` — bump til 5.12.6 build 0557.

## [5.12.5 build 0556] — 2026-05-28 — feat: Inaktiv-chip deaktiveres når pxGrid ikke har sessionsdata

"Inaktiv"-chippen er nu visuelt deaktiveret (grå, ikke-klikbar) når pxGrid ikke leverer sessionsdata. Tooltip forklarer årsagen. Hvis pxGrid-forbindelsen falder og chippen var aktiv, deaktiveres filteret automatisk og tabellen opdateres. Chippen re-enables automatisk når sessionsdata er tilgængeligt igen.

- `frontend/js/views/browse.js` — tilføjet `updateInactiveChip()` der sætter `chip.disabled` og tooltip ud fra `pxgridLive`/`activeSessionMacs`; kaldt fra `updatePxGridSourceBadge()`.
- `frontend/css/styles.css` — tilføjet `.mac-chip:disabled` og `:disabled:hover` styles for light/dark/midnight.
- `version.json` — bump til 5.12.5 build 0556.

## [5.12.4 build 0555] — 2026-05-28 — fix: 📌-badge forsvinder nu fra rækken efter gem

`refreshRows` opdaterede MAC-cellen delvist (kun `.mac-link`-indholdet) men fjernede ikke `.marked-pin`-`<span>`-badgen som sidder udenfor linket. Fix: `refreshRows` genindlæser nu marked-sættet fra localStorage og fjerner/tilføjer `.marked-pin` korrekt for den opdaterede række.

- `frontend/js/views/browse-table.js` — `refreshRows`: tilføjet pin-opdatering via `loadMarkedMacs()` + DOM-manipulation af `.marked-pin`.
- `version.json` — bump til 5.12.4 build 0555.

## [5.12.3 build 0554] — 2026-05-28 — fix: MAC-chips opdaterer nu tabellen automatisk

MAC-filter-chipsene (Privat / Inaktiv / Markeret) kaldte `applyFilter()` direkte, men det virker kun hvis filter-tilstand allerede er aktiv. Tabellen opdaterede sig derfor ikke når man klikkede en chip som den første filterhandling. Fix: chip-handleren kalder nu `onFilterChange()` som korrekt starter filter-tilstand (indlæser alle endpoints) hvis nødvendigt, opdaterer session-MACs og anvender filteret.

- `frontend/js/views/browse.js` — chip-handler: `cb.applyFilter?.()` → `cb.onFilterChange?.()`.
- `version.json` — bump til 5.12.3 build 0554.

## [5.12.2 build 0553] — 2026-05-28 — feat: gem i Browse fjerner automatisk markering

Efter vellykket gem i Browse/Edit-modal fjernes endpointets MAC fra den markerede sæt i localStorage. Hvis sættet herefter er tomt og "📌 Markeret"-chippen er aktiv, deaktiveres den automatisk (så tabellen ikke viser tomme resultater).

- `frontend/js/views/browse-detail.js` — tilføjet `loadMarkedMacs`, `saveMarkedMacs` til import; efter `api.updateEndpoint` success: fjern savedMac fra marked-sæt, nulstil chip + state.markedOnly hvis sæt bliver tomt.
- `version.json` — bump til 5.12.2 build 0553.

## [5.12.1 build 0552] — 2026-05-28 — fix: flyt markeret-filter fra toolbar til MAC-chip

Toolbar-knappen "📌 Markerede" er fjernet. I stedet er der tilføjet en tredje chip "📌 Markeret" direkte under MAC-kolonnen i filterpanelet — på linje med "Privat" og "Inaktiv". Chip-handleren er udvidet til at håndtere alle tre chips. CSS-regler for `#marked-filter-btn.active-toggle` er fjernet.

- `frontend/js/views/browse.js` — fjernet `#marked-filter-btn`-toolbar-HTML og `updateMarkedBtn()`; tilføjet "📌 Markeret"-chip; chip-handler dækker nu `private`/`inactive`/`marked`; auto-aktivering fra sessionStorage sætter chippen aktiv.
- `frontend/css/styles.css` — fjernet `#marked-filter-btn.active-toggle`-regler.
- `version.json` — bump til 5.12.1 build 0552.

## [5.12.0 build 0551] — 2026-05-28 — feat: livscyklus-markering og MAC-filter-chips i Browse

Ny workflow: fra Livscyklus-visningen kan admin afkrydse enkelt- eller alle stale endpoints og klikke "Marker valgte →". MAC-adresserne gemmes i `localStorage` (`ise_portal_marked_macs`) og Browse åbnes automatisk med "Vis kun markerede"-filter aktivt. Allerede-markerede endpoints viser 📌-ikon i Livscyklus og i Browse-tabellens MAC-celle.

Browse-filterrækken (MAC-kolonne) har fået to toggle-chips: "Privat" (LAA-detektion via bit 1 i første octet) og "Inaktiv" (endpoint ikke set i aktiv pxGrid-session). Begge chips er en del af den eksisterende filterpipeline og aktiveres i `needsFilterMode()`.

- `frontend/js/views/browse-utils.js` — tilføjet `MARKED_MACS_KEY`, `loadMarkedMacs`, `saveMarkedMacs`, `addMarkedMacs`, `clearMarkedMacs`.
- `frontend/js/views/lifecycle.js` — komplet omskrivning: checkboxkolonne, "Vælg alle"-header-checkbox, 📌-ikon på allerede-markerede rækker, gul highlight (`lc-marked`), "Marker valgte (N) →"-knap, "Ryd markeringer"-knap, klik på række/↗-knap åbner Browse.
- `frontend/js/views/browse.js` — tilføjet `macPrivate`, `macInactive`, `markedOnly` til state; MAC-type-chips i filter-th; `#marked-filter-btn`-toolbar-knap; auto-aktivering af markedOnly-filter via `sessionStorage.browse_marked_filter`.
- `frontend/js/views/browse-table.js` — `_markedMacs`-cache opdateres ved hver `renderRows`; 📌-badge i MAC-celle; `load()` understøtter `{ silent }` option (ingen loading-spinner).
- `frontend/js/views/browse-filter.js` — `needsFilterMode()` inkluderer `macPrivate`, `macInactive`, `markedOnly`; tre nye filter-blokke i `applyFiltersToRows`.
- `frontend/css/styles.css` — tilføjet styles for `.lc-marked`, `.lc-select-cell`, `.lc-pin`, `.lc-mark-btn`, `.lc-clear-marks`, `.mac-type-chips`, `.mac-chip` (inkl. dark/midnight), `.marked-pin`, `#marked-filter-btn.active-toggle`.
- `version.json` — bump til 5.12.0 build 0551.

## [5.11.6 build 0550] — 2026-05-27 — fix: kolonne-flips og selektion-tab ved pxGrid baggrunds-reload

Rodårsag: MnT beriger pxGrid-sessioner hvert 5. min, hvilket sender `endpoint_changed`-events. `scheduleEndpointReload()` kaldte herefter `cb.load()` (fuld reload) som satte `tbody.innerHTML = <indlæser>` — dette forårsagede kolonne-layout-thrash (flip) og tabte alle checkboks-selektioner fordi `renderRows` læste prevSelected fra den allerede-ryddede tbody.

Fix: `scheduleEndpointReload` kalder nu `cb.load(false, { silent: true })`. I silent-tilstand springer `load()` loading-spinneren over og lader eksisterende rækker stå frem til ny data er hentet. `renderRows` læser dermed korrekt selektion fra de eksisterende rækker og genopretter dem i de nye rækker.

- `frontend/js/views/browse-table.js` — `load()` accepterer nu `{ silent = false }` option; springer `tbody.innerHTML = <loading>` over i silent-tilstand.
- `frontend/js/views/browse.js` — `scheduleEndpointReload()` kalder `cb.load?.(false, { silent: true })`.

## [5.11.5 build 0549] — 2026-05-25 — feat: TACACS-brugere kan nu gemme præferencer og views server-side

TACACS+-brugere har ingen fast record i `users.json` — de er token-baserede. Det betød at `GET /me/prefs` altid returnerede tom UserPrefs og `PUT /me/prefs` returnerede 403. Kolonne-synlighed kunne dermed kun gemmes i localStorage — i incognito / ny browser var der intet at hente.

Fix: Backend opretter nu automatisk en `tacacs_shadow`-record i `users.json` første gang en TACACS-bruger gemmer præferencer eller views. `GET /me/prefs` returnerer shadow-recordens præferencer hvis den findes; ellers tom. `GET /me/views` returnerer tom liste hvis ingen record endnu (i stedet for 404).

- `backend/app/api/me.py` — fjernet `if user.id.startswith("tacacs:")` 403-blok fra `PUT /prefs` og early-return fra `GET /prefs`. Ny `_ensure_shadow_record()` opretter tacacs_shadow-record lazy. `POST /views` bruger også `_ensure_shadow_record`. `GET /views` returnerer tom liste i stedet for 404 for ukendte brugere.

## [5.11.4 build 0548] — 2026-05-25 — fix: applyBackendColPrefs overskriver ikke eksisterende lokal col_vis

Rodårsag til at incognito-session (og andre tom-localStorage-sessioner) ikke virkede: v5.11.2-kodens `restoreFilters()` uploadede all-true col_vis til backend via `saveColVis()`. Ved næste Browse-besøg overskrev `applyBackendColPrefs` localStorage med den korrupte all-true backend-tilstand — og nulstillede dermed brugerens korrekte lokale præference.

Fix: `applyBackendColPrefs` skriver nu kun backend-data til localStorage hvis localStorage er tom (incognito/ny enhed/ingen tidligere præference). Eksisterende lokal præference bevares — og `syncColPrefsNow()` uploader den korrekte lokale tilstand til backend ved hvert Browse-init, så backend altid har den seneste normale-sessions præference. Incognito-sessioner henter dermed den korrekte tilstand fra backend.

- `frontend/js/views/browse-utils.js` — `applyBackendColPrefs()` tjekker nu om `loadColVis()` er null før den skriver til localStorage (tilsvarende for col_order og col_widths).

## [5.11.3 build 0547] — 2026-05-25 — fix: kolonne-synlighed nulstilles ikke længere af filter-restore

Rodårsag: `snapshotFilters()` inkluderede `colVis` i det auto-gemte filter-snapshot (BROWSE_FILTERS_KEY). Når brugeren navigerede tilbage til Browse, kaldte `restoreFilters()` → `applyFilterSnapshot()` → overskrev `state.colVis` med den GAMLE snapshot-tilstand (fra FØR brugeren ændrede synlighed) og kaldte `saveColVis()` — hvilket effektivt nulstillede præferencen.

- `frontend/js/views/browse-filter.js` — `applyFilterSnapshot()` har nu parameter `{ skipColVis = false }`. `restoreFilters()` kalder `applyFilterSnapshot(…, { skipColVis: true })` — kolonne-synlighed gendannes nu udelukkende fra COLVIS_KEY (localStorage/backend), ikke fra filter-snapshot. Gemte views aktiverer fortsat colVis (skipColVis er false for view-aktivering).

## [5.11.2 build 0546] — 2026-05-25 — fix: kolonne-synlighed persisterer nu på tværs af navigationer + gemt-indikator

- `frontend/js/views/browse.js` — `syncColPrefsNow()` kaldes nu ubetinget ved hvert Browse-init (ikke kun første gang). Fjernet `_backendHasColPrefs`-betingelse — garanterer at localStorage-tilstand altid uploades til backend ved sideindlæsning.
- `frontend/js/views/browse-table.js` — ny `_flashColVisSaved()` viser "✓" i kolonne-knappen i 1,8 s når synlighed ændres, så brugeren har bekræftelse på at ændringen er gemt.
- `frontend/css/styles.css` — `#col-vis-btn[data-saved]::after` tilføjer grønt ✓-suffiks under flash.

## [5.11.1 build 0545] — 2026-05-25 — fix: col_vis synkroniseres ikke til backend ved første load

- `frontend/js/views/browse-utils.js` — ny eksporteret `syncColPrefsNow()` kalder `_syncColPrefs()` direkte, til brug ved init.
- `frontend/js/views/browse.js` — `_backendHasColPrefs` flag gemt fra `getMyPrefs()`-resultatet. Hvis backend mangler kolonnepræferencer (f.eks. første load efter feature-deploy), kaldes `syncColPrefsNow()` straks efter `setColPrefsSyncFn()` for at uploade eksisterende localStorage-tilstand. `.catch()` i sync-callback logger nu `console.warn` for non-403 fejl i stedet for at sluge dem stille.

## [5.11.0 build 0544] — 2026-05-25 — feat: kolonnebredder gemmes i backend (col_widths)

- `backend/app/schemas/user.py` — `UserPrefs`: ny `col_widths: dict[str, int] | None` felt.
- `backend/app/api/me.py` — ny `_safe_col_widths()` validator (20–2000 px, max 30 nøgler, max 32 tegn pr. nøgle). `_prefs_response()` inkluderer nu `col_widths`. `PUT /prefs` håndterer `col_widths` på linje med `col_order` og `col_vis`.
- `frontend/js/views/browse-utils.js` — `saveColWidths()` kalder nu `_syncColPrefs()` så bredder synkroniseres til backend. `_syncColPrefs()` inkluderer `col_widths` i payload. `applyBackendColPrefs(order, vis, widths)` skriver nu også bredder til localStorage fra backend.
- `frontend/js/views/browse.js` — sender `prefs.col_widths` til `applyBackendColPrefs()` ved browse-init.

## [5.10.8 build 0543] — 2026-05-25 — fix: resize-handle via th border + proximity-check

- `frontend/js/views/browse.js` — `<span class="th-resize-handle">` fjernet fra th-template; ikke nødvendig længere.
- `frontend/css/styles.css` — `.th-resize-handle` regler fjernet; erstattet med `border-right` på `th[data-col]` (3px, subtil grå → lilla ved hover/resize via `.col-resizing`). Dark/midnight varianter tilføjet.
- `frontend/js/views/browse-table.js` — `wireColResize()` omskrevet: `pointerdown` på `th` med proximity-check (`e.clientX < rect.right - 8` → ignorer). `setPointerCapture` på th. `th.draggable = false` under resize for at undgå column-drag interferens, gendannes til `true` ved `pointerup`/`pointercancel`.

## [5.10.7 build 0542] — 2026-05-25 — fix: resize-handle inline-block — undgår position:absolute i sticky th

- `frontend/css/styles.css` — `.th-resize-handle` omskrevet til `display: inline-block` i flow. `position: absolute` i en `position: sticky` `<th>` er upålidelig i table-layout på tværs af browsere — barnet positioneres i forhold til et ancestor-element uden for `<th>` og er dermed usynligt. Inline-block handle vises synligt efter kolonneheader-teksten med grå baggrund + lilla/blå highlight ved hover og resize.

## [5.10.6 build 0541] — 2026-05-25 — fix: resize via Pointer Events API — undgår draggable-interferens

- `frontend/js/views/browse-table.js` — `wireColResize()` omskrevet til Pointer Events API: `pointerdown` + `setPointerCapture(pointerId)` sikrer at alle pointer-events fanges af handle selv når musen bevæger sig hurtigt. `dragstart`-listener på handle forhindrer `draggable="true"` på `<th>` i at stjæle events. `pointermove`/`pointerup`/`pointercancel` erstatter `document.mousemove`/`mouseup`.

## [5.10.5 build 0540] — 2026-05-25 — docs: RELEASE_NOTES tilføjet for 5.10.2–5.10.4

- `RELEASE_NOTES.md` — sektioner tilføjet for 5.10.4 (resize-handle fix), 5.10.2 (chown fejlbesked).

## [5.10.4 build 0539] — 2026-05-25 — fix: resize-handle virker nu — overflow:hidden fjernet fra th

- `frontend/css/styles.css` — fjernet `overflow: hidden` fra `.browse-table-wrap table thead th` — det clippede den absolut-positionerede `.th-resize-handle` så den var usynlig og uklikbar. Tilføjet `.th-resize-handle.resizing` variant. Dark/midnight hover-farver bevaret.
- `frontend/js/views/browse-table.js` — `wireColResize()`: tilføjer/fjerner `.resizing`-klasse og sætter `document.body.style.userSelect = "none"` under drag så tekst ikke markeres ved resize.

## [5.10.3 build 0538] — 2026-05-25 — fix: "table is not defined" i wireColResize

- `frontend/js/views/browse-table.js` — `wireColResize()` brugte `table` fra `initColDrag()`s lokale scope. Rettet til `container.querySelector(".browse-table-wrap table")` direkte i funktionen.

## [5.10.2 build 0537] — 2026-05-25 — fix: git pull viser korrekt chown-fejl ved ejerskabsproblem

- `backend/app/services/update_service.py` — ny `_git_objects_writable()` tjekker om portal-processen kan skrive til `.git/objects/` (os.access). I `_git_pull_sync()` tjekkes dette FØR fetch: hvis ikke skrivbar returneres en klar fejl med præcis `chown -R <user>:<user> <root>/.git`-kommando og brugernavnet hentes fra `$USER`/`$LOGNAME` env. Den gamle misvisende chmod-fejlbesked er fjernet.

## [5.10.1 build 0536] — 2026-05-25 — fix: git pull fejler aldrig mere på filrettigheder

- `backend/app/services/update_service.py` — ny `_fix_git_object_permissions()`: gennemgår `.git/objects/` med `os.walk` og sætter dirs til 755 og filer til 644 (pure Python, ingen subprocess). Ny `_ensure_git_shared_repo()`: konfigurerer `core.sharedRepository=0644` så fremtidige git-objekter oprettes med korrekte rettigheder. Begge kaldes automatisk FØR `git fetch` i `_git_pull_sync()`. Den gamle "Kør disse chmod-kommandoer manuelt"-fejlbesked er fjernet.

## [5.10.0 build 0535] — 2026-05-25 — feat: Identity Group fuld sti + skalerbare kolonner

- `frontend/js/views/browse-utils.js` — `groupHierarchyOptionsHtml()` omskrevet: viser nu fuld sti med " / "-separator ("Profiled / Apple-Device / SubGroup") i stedet for indrykkede blade-navne. `EIG_PREFIX` eksporteret. Ny `groupPathParts()` hjælpefunktion til at parse en gruppe-navn til segments. Ny `COLWIDTHS_KEY`, `loadColWidths()`, `saveColWidths()`.
- `frontend/js/views/browse-detail.js` — importerer `groupPathParts`; ny `updateGroupPath(groupId)` der opdaterer `#d-group-path` med stakkede linjer (3 linjer med lille skrift, indrykket); kaldt ved åbning af detail og ved group-select ændring.
- `frontend/js/views/browse.js` — `<select id="d-group">` pakket i `<div class="group-select-wrap">` med `<div id="d-group-path" class="group-path-hint">` under; resize-handle `<span class="th-resize-handle">` tilføjet i hvert `<th>`.
- `frontend/js/views/browse-table.js` — importerer `loadColWidths`, `saveColWidths`; ny `wireColResize()`: tilføjer mousedown→mousemove→mouseup resize-logik på `.th-resize-handle` i header-row, gemmer bredder i localStorage; kaldt ved init.
- `frontend/css/styles.css` — `.th-resize-handle`: absolut positioneret 6px bred cursor:col-resize handle i højre kant af `<th>`; `.group-select-wrap`, `.group-path-hint`, `.grp-path-line`: stakkede gruppe-sti-linjer med 0.72rem font; dark/midnight tema varianter.

## [5.9.4 build 0534] — 2026-05-25 — fix: Release notes vises altid i update-check

- `backend/app/services/update_service.py` — `_extract_release_sections_since()` tilføjer Fallback 2: når der ikke findes en eksakt `## [X.Y.Z]`-sektion (f.eks. debug-builds som 5.9.3.1 der aldrig fik en RELEASE_NOTES-sektion), vises den seneste tilgængelige sektion med version ≤ target. Løser at "up to date"-visningen altid stod tom.

## [5.9.3.1 build 0533] — 2026-05-25 — debug: Ny gruppe — overgruppe-dropdown viser nu alle niveauer

- `frontend/js/views/browse.js` — `_populateParentDropdown()` slettet; erstattet med direkte `groupHierarchyOptionsHtml(state.groups, "", "...")` kald (samme funktion som Browse-dropdownene). Importerer `groupHierarchyOptionsHtml` fra browse-utils.js.

## [5.9.3 build 0532] — 2026-05-25 — perf: GitHub update-check paralleliseret

- `backend/app/services/update_service.py` — `check_github_version()`: `version.json` og `RELEASE_NOTES.md` hentes nu parallelt med `asyncio.gather` i stedet for sekventielt. Fjernet meningsløst forsøg på `RELEASE_{version}.md` (404 altid) som gav et ekstra round-trip. Fjernet ubrugt `_GITHUB_STANDALONE_RELEASE_TMPL` konstant.

## [5.9.2.1 build 0531] — 2026-05-25 — debug: gruppe-dropdown hierarki — indrykket træ-visning

- `frontend/js/views/browse-utils.js` — `groupHierarchyOptionsHtml()` omskrevet: én `<optgroup>` wrapper + `<option>` med depth-baseret indrykninig (3 NBSP pr. niveau) og "↳"-pil for børn. Alfabetisk sortering på sti-efter-prefix sikrer forælder altid vises før sine børn. Alle grupper er selekterbare (inkl. forældrgrupper).
- `frontend/js/views/browse.js` — `_populateParentDropdown()` følger samme indrykning-logik

## [5.9.2 build 0530] — 2026-05-25 — feat: Opret endpoint gruppe — vælg overgruppe

- `backend/app/schemas/endpoint.py` — `EndpointGroupCreate` tilføjer `parent_id: str | None`
- `backend/app/ise/endpoints.py` — `create()` sender `parentId` i ERS-payload hvis angivet
- `backend/app/services/endpoint_service.py` — `create_group()` videresender `parent_id`
- `backend/app/api/groups.py` — `POST /groups` sender `payload.parent_id` til service
- `frontend/js/views/browse.js` — "Ny gruppe"-modal: Overgruppe-dropdown populeret fra `state.groups` (sorteret alfabetisk); valgt parent-id sendes med som `parent_id` i `createGroup()`

## [5.9.1 build 0529] — 2026-05-25 — fix: Policy-view label — "Authz Policies" + "Authz : [navn]"

- `frontend/js/i18n.js` — `pol.title` DA+EN: "Politikker"/"Policies" → "Authz Policies"
- `frontend/js/views/policy.js` — `selectSet()`: `rulesTitle.textContent` ændret fra bare sæt-navn til `"Authz : <sætnavn>"`

## [5.9.0 build 0528] — 2026-05-25 — feat: opret endpoint gruppe + policy drag-and-drop rank

**Feature 1 — Opret endpoint identity group fra Browse (admin)**
- `backend/app/schemas/endpoint.py` — ny `EndpointGroupCreate` (name/description med validering) og `EndpointGroupCreated` response-schema
- `backend/app/ise/endpoints.py` — `IseEndpointGroupRepository.create()`: ERS POST med `return_response=True` for Location-header-parsing, returnerer nyt group-id
- `backend/app/services/endpoint_service.py` — `create_group()`: kalder `groups.create()` og `invalidate_groups()` på cache
- `backend/app/api/groups.py` — `POST /groups` (admin-only via `require_admin` override på router-niveau), returnerer `EndpointGroupCreated` med HTTP 201
- `frontend/js/api.js` — `createGroup(payload)` metode tilføjet
- `frontend/js/views/browse.js` — importerer `auth`; "+ Ny gruppe"-knap (kun synlig for admin); modal med navn/beskrivelse-input; genindlæser gruppe-dropdown efter oprettelse

**Feature 2 — Policy-regel rank-ændring via drag-and-drop (editor/admin)**
- `frontend/js/views/policy.js` — `wireRuleCards()` sætter `card.draggable = true` for editorer; dragstart/dragend/dragover/dragleave/drop event listeners; på drop: `api.updatePolicyRule(setId, srcRule.id, {..., rank: dstRule.rank})` + `loadRules(setId)` genindlæser
- `frontend/css/styles.css` — `.pol-rule-card[draggable]`: grab cursor; `.pol-rule-dragging`: opacity 0.4; `.pol-rule-drag-over`: amber highlight; dark mode variant

## [5.8.3 build 0527] — 2026-05-24 — feat: flytbare Browse-kolonner med backend-persistens

Kolonne-rækkefølge og synlighed gemmes nu i backend (pr. bruger) og gendannes automatisk på tværs af enheder og browsere. Drag-and-drop af kolonner fandtes allerede — nu synkroniseres ændringer til `PUT /api/me/prefs` i stedet for kun localStorage.

**Berørte filer:**
- `backend/app/schemas/user.py` — `UserPrefs` udvides med `col_order: list[str] | None` og `col_vis: dict[str, bool] | None`
- `backend/app/api/me.py` — `GET /me/prefs` returnerer nu `col_order`/`col_vis`; `PUT /me/prefs` bruger `model_fields_set` og validerer nye felter (max 30 nøgler, max 32 tegn pr. nøgle); hjælpefunktioner `_safe_col_order`, `_safe_col_vis`, `_prefs_response`
- `frontend/js/views/browse-utils.js` — `saveColOrder` og `saveColVis` kalder nu `_syncColPrefs()` efter localStorage; ny `applyBackendColPrefs(order, vis)` til loop-fri load fra backend; ny `setColPrefsSyncFn(fn)` til at injicere API-kald
- `frontend/js/views/browse.js` — importerer `applyBackendColPrefs`, `setColPrefsSyncFn`; henter `GET /api/me/prefs` ved browse-init FØR HTML renderes; sætter fire-and-forget sync-callback efter state init

## [5.8.2-P4 build 0526] — 2026-05-24 — sec: Security Patch 4 — cache-DoS, dead-code NameError, audit max_length

**Security Patch 4 (3 fixes fra ny sikkerhedsanalyse):**

- `backend/app/api/cache.py` — `/api/cache/invalidate` ændret fra `require_any` til `require_admin` — alle autentiserede brugere (inkl. viewer/registrant) kunne tømme cache og forårsage DoS mod ISE-API
- `backend/app/api/trends.py` — fjernet `_mac_from_json()` (ubrugt dead-code) der kaldte `json.loads()` uden at `json` var importeret — ville give `NameError` ved fremtidig kald
- `backend/app/api/audit.py` — `actor`, `resource_type`, `resource_id`, `from_ts`, `to_ts` på list-endpoint manglede `max_length` (fandtes kun på export-endpoint fra Patch 3)

## [5.8.2 build 0525] — 2026-05-24 — fix: Livscyklus tabel — kompakt enkelt-linje per endpoint

- `lifecycle.js`: `fmtFirstSeen` viser dato + alder på én linje (`2026-01-15 (129d)`)
- `styles.css`: `.lc-table td` padding reduceret til 3px vertikal + `white-space:nowrap`

## [5.8.2 build 0524] — 2026-05-24 — feat: Livscyklus — tid-telemetri + klik til Browse/Edit

**Ny kolonne: "Første gang set"** — viser dato (YYYY-MM-DD) og alder i dage siden portalen første gang observerede endpointet (fra `first_seen_store`). Inkluderes i CSV-eksport.

**Klik til Browse/Edit** — klik på en hvilken som helst række i Livscyklus-tabellen for at åbne endpointet direkte i Browse/Edit med MAC-søgning pre-fyldt. Implementeret via `sessionStorage` + `hashchange`-routing.

**Berørte filer:**
- `backend/app/api/lifecycle.py` — importerer `first_seen_store`; batch-opslag tilføjer `first_seen_at` til hver stale-entry
- `frontend/js/views/lifecycle.js` — `fmtFirstSeen()` helper, ny kolonne, click-handler per række, ↗-ikon i sidst kolonne, CSV-eksport inkluderer dato
- `frontend/js/views/browse.js` — læser `sessionStorage["browse_open_ep"]` efter `filterAPI.restoreFilters()` og pre-fylder `globalQInput` + `state.fullTextQ`
- `frontend/css/styles.css` — `cursor:pointer` på lc-table rækker, hover=blåt, `.lc-browse-link` med dark/midnight varianter

## [5.8.1 build 0523] — 2026-05-24 — feat: dashboard redesign — KPI-kort, mini trend-chart, livscyklus-summary

Komplet redesign af Dashboard-viewet. Visuel hierarki med store KPI-tal, inline sparkline-chart og Livscyklus-summary erstatter den tidligere tabel-baserede layout.

**Nyt layout (top → bund):**
1. **KPI-rad** — 5 kort med farvet top-accent: Total endpoints, Private MACs (LAA%), Inaktive endpoints (admin), Cache hit rate, Circuit Breaker status
2. **2-kolonne midtersektion** — venstre: 30-dages endpoint-bevægelse som mini sparkline (Tilgang/Fragang/Netto) med summering og link til Trend Analyse; højre: Systemstatus-kort (CB, sessioner, cache, prewarm) + Livscyklus-summary-kort (admin)
3. **Audit-hændelser** — renere tabel med farvekodet action-badge (create=grøn, delete=rød, update=gul)
4. **Systemlog** — uændret (admin only)

**Teknisk:**
- 3 parallelle API-kald: `getDashboard()` + `getTrends("30d")` + `getStaleEndpoints(90)` (admin)
- Livscyklus-sektionen vises kun for admin-rolle
- Trends-sektionen viser "cache loading" besked hvis ISE-sync endnu ikke er klar
- `import { auth }` tilføjet til dashboard.js for rolle-check

**Berørte filer:**
- `frontend/js/views/dashboard.js` — komplet omskrivning

## [5.8.0.3 build 0522] — 2026-05-24 — feat: hover-tooltip på Trend Analyse grafer

Interaktive tooltips på begge SVG-charts i Trend Analyse. Hover over et punkt viser dato og alle serie-værdier for den dag.

**Implementering:**
- `svgLineChart()` embedder chart-metadata i `data-chart`-attribut (JSON) og tilføjer skjulte hover-elementer: vertikal crosshair-linje + en highlight-dot per serie
- `attachChartTooltips(container)` attacherer `mousemove`/`mouseleave`-handlers efter DOM-insertion; konverterer musens skærmkoordinater til SVG-koordinater via `getBoundingClientRect()` og viewBox-ratio
- Floating tooltip-div (`_tip`) oprettet én gang på `document.body`, genbruges på tværs af loads

**Berørte filer:**
- `frontend/js/views/trends.js`

## [5.8.0.2 build 0521] — 2026-05-24 — debug: rettelse af version til debug-format (5.8.0.2)

- `version.json` — version rettet til `5.8.0.2` (debug-serie), build til 0521

## [5.8.0 build 0520] — 2026-05-24 — fix: Trend Analyse afspejler nu alle ISE-endpoints, ikke kun portal-audit

**Rodårsag:** Trend Analyse brugte `audit_events`-tabellen som datakilde — den registrerer kun portal-initierede handlinger. Endpoints oprettet direkte i ISE (uden om portalen) var usynlige og påvirkede aldrig graferne.

**Løsning:** Datakilden er skiftet til `first_seen_store.py` der populeres af prewarm-scanneren for ALLE ISE-endpoints.

**Ændringer i first_seen_store.py:**
- Nyt `deleted_at`-felt: soft-delete i stedet for hard DELETE — bevarer slettehistorik til trend-grafer
- Ny `get_added_since(since_ts)` — returnerer MACs første set siden timestamp
- Ny `get_removed_since(since_ts)` — returnerer soft-slettede MACs siden timestamp

**Berørte filer:**
- `backend/app/core/first_seen_store.py` — soft-delete, migration, indexes, nye query-funktioner
- `backend/app/api/trends.py` — skiftet fra audit_events til first_seen_store; fjernet no_audit_data
- `frontend/js/views/trends.js` — fjernet auditNote/no_audit_data; opdateret chart-beskrivelse til "portalen har observeret per dag (synkroniseres fra ISE hver 30. minut)"

## [5.8.0 build 0519] — 2026-05-24 — fix: Livscyklus og Trend Analyse viser 0 ved tom cache

**Rodårsag:** Lifecycle og Trend Analyse læser begge fra endpoint-cachen. Hvis cachen endnu ikke er populeret ved opstart (ingen disk-cache-fil), returnerer begge endpoints 0 — selv om ISE har tusindvis af endpoints. Brugere oplevede 0 resultater indtil de besøgte Browse/Edit som trigger prewarm.

**To separate problemer løst:**
1. **Tom cache ved opstart** — Lifecycle/Trend viser nu "Endpoint-cachen indlæses fra ISE" med auto-retry hvert 10s i stedet for 0-resultater
2. **Trend-grafer viser permanent 0 for pre-existerende endpoints** — viser nu forklarende note: "Graferne viser kun endpoints oprettet/slettet via portalen. Endpoints der eksisterede i ISE da portalen blev installeret tæller ikke."

**Berørte filer:**
- `backend/app/services/cache_prewarm.py` — `PrewarmStatus.first_scan_done` flag + `PrewarmWorker.cache_ready` property
- `backend/app/api/lifecycle.py` — returnerer `cache_loading: true` når cache er tom og prewarm ikke er færdig
- `backend/app/api/trends.py` — returnerer `snapshot.cache_loading` og `no_audit_data` flag
- `frontend/js/views/lifecycle.js` — håndterer `cache_loading`: spinner + auto-retry 10s
- `frontend/js/views/trends.js` — håndterer `cache_loading` + viser `auditNote` når pre-eksisterende endpoints forklarer tomme grafer

## [5.8.0 build 0518] — 2026-05-24 — fix: git pull rettighedsfejl — bedre fejlbesked + dokumentation

- `backend/app/services/update_service.py` — detekterer `insufficient permission`-fejl fra git fetch og returnerer klar fejlbesked med de to fix-kommandoer direkte i portal-UI'et
- `UPDATE_PROCEDURE.md` — ny sektion: `.git/objects` rettighedsfejl med symptom og løsning

## [5.8.0 build 0517] — 2026-05-24 — feat: update-check viser RELEASE_{version}.md for main; udvidet markdown-renderer

- `backend/app/services/update_service.py` — `check_github_version` henter nu `RELEASE_{version}.md` fra `main`-branch (standalone release note); fallback til RELEASE_NOTES.md-sektion; `dev`-branch uændret
- `frontend/js/views/settings/section-update.js` — `renderReleaseNotesMd` udvidet: håndterer `#` (titel), `####` (kategori-header), fenced code blocks (` ``` `), tabeller (`| ... |`) og blockquotes (`> `)
- `frontend/css/styles.css` — nye `.rn-*`-klasser: `.rn-h1`, `.rn-h4`, `.rn-pre`, `.rn-bq`, `.rn-table` med dark/midnight tema-varianter

## [5.8.0 build 0516] — 2026-05-24 — fix: lockout_store startup-crash og SQLite-locking

**Rodårsag til portal-nedbrud:**
- `init_lockout_db()` var ikke i try-except → en SQLite-fejl ved startup crashede hele backend
- `lockout_store` brugte samme `audit.db` som audit-systemet → write-lock-konflikt ved startup
- `sqlite3.connect()` uden timeout → concurrent logins kunne give "database is locked"-fejl

**Fix:**
- `backend/app/core/lockout_store.py` — bruger nu dedikeret `lockout.db`; alle funktioner er try-except wrapped med safe defaults; `conn.close()` eksplicit i finally-blok; `timeout=10` på alle connections; `_available`-flag forhindrer brug af utildannet DB
- `backend/app/main.py` — `init_lockout_db()` wrapped i try-except med warning-log; app starter altid uanset lockout DB-fejl

## [5.8.0 build 0514] — 2026-05-23 — feat: Trend Analyse — endpoint tilgang/fragang og private MACs

**Nyt view: Trend Analyse** tilgængeligt via sidebar under Overvågning.

**Berørte filer:**
- `backend/app/api/trends.py` (ny) — `GET /api/trends?period=7d|30d|90d|365d` spørger audit-loggen for endpoint create/delete-events og returnerer daglige tæller inkl. LAA-klassifikation
- `backend/app/main.py` — registrerer `trends_api.router`
- `frontend/js/api.js` — tilføjer `api.getTrends(period)`
- `frontend/js/views/trends.js` (ny) — SVG-linjediagrammer uden eksterne afhængigheder; to charts (endpoint-bevægelse + LAA-bevægelse) + stat-kort
- `frontend/js/app.js` — tilføjer `trends`-rute (alle roller undtagen registrant)
- `frontend/index.html` — nav-link "Trend Analyse" under Overvågning

## [5.8.0 build 0515] — 2026-05-23 — sec: Security Patch 3 — input-validering, ACL, persistent lockout

**Sikkerheds-patch (7 fixes implementeret fra dyb sikkerhedsanalyse):**

- `frontend/js/app.js` — importerer `esc()` og bruger den på `user.role` i innerHTML (XSS-fix)
- `backend/app/main.py` — CSP `script-src` fjerner `'unsafe-inline'`; tilføjer SECURITY-advarsler ved opstart for TLS=false og dev-CORS-origins
- `backend/app/core/settings_store.py` — Windows ACL enforcement via `icacls` (svarende til chmod 600 på Unix)
- `backend/app/core/lockout_store.py` — **ny fil**: persistent SQLite-baseret account lockout (overlever backend-genstart)
- `backend/app/services/user_service.py` — bruger `lockout_store` i stedet for in-memory dicts
- `backend/app/api/endpoints.py` — `search` max_length=500; `page`/`size` valideret med ge/le
- `backend/app/api/audit.py` — `search`, `actor`, `resource_type`, `resource_id` begrænset med max_length

## [5.7.12 build 0512] — 2026-05-23 — feat: apply skabelon sætter description til "Templet [navn]"

**Berørte filer:**
- `frontend/js/views/browse-detail.js` — `#d-tpl-apply` handler sætter altid `#d-description` til `Templet ${tpl.name}`
- `frontend/js/views/register.js` — `applyTemplate()` sætter altid `#r-desc` til `Templet ${tpl.name}`

## [5.7.11 build 0511] — 2026-05-23 — fix: 502 ved "Show 500" — ISE ERS max 100/side

**Rodårsag:** Admin-stien i `list_endpoint_details` kaldte `endpoints.list_page(size=500)` direkte til ISE, men ISE ERS accepterer max 100 per side → HTTP 400 → portal-502.

**Fix:**
- `endpoint_service.py` — når cache er varm, server admin-brugere via ny `_list_all_from_cache()` der henter alle IDs fra cache og paginerer i Python (samme mønster som `_list_from_roles_index`)
- ISE-fallback (kold cache): `size` cappes til 100 inden ISE-kald

**Berørte filer:**
- `backend/app/services/endpoint_service.py`

## [5.7.10.2 build 0510] — 2026-05-23 — debug: fix /endpoints/stats — value er EndpointDetail Pydantic, ikke dict

**Rodårsag:** `ep.get("mac")` fejler på Pydantic-objekt — `EndpointDetail` har ikke `.get()`. Cachet value er `EndpointDetail` (fra `_fetch_endpoint_detail`), ikke et dict.
**Fix:** Tjekker `isinstance(ep, dict)` og bruger ellers `getattr(ep, "mac")`.

**Berørte filer:**
- `backend/app/api/endpoints.py` — `/stats` bruger nu `getattr` for Pydantic-objekter

## [5.7.10.1 build 0509] — 2026-05-23 — debug: fix /endpoints/stats — cache._details.value korrekt tilgang

**Rodårsag:** `get_cache().values()` — `EndpointCache` er ikke et dict; har ingen `.values()`. Endpoint kastede `AttributeError` → frontend-catch returnerede null → badge forsvandt.
**Fix:** `cache._details` er `dict[str, CachedEntry]`; itererer nu `.values()` og læser `entry.value` (endpoint-dict) for MAC-feltet.

**Berørte filer:**
- `backend/app/api/endpoints.py` — `/stats` bruger nu `cache._details.values()` og `cached_entry.value`

## [5.7.10 build 0508] — 2026-05-23 — feat: LAA-tæller fra backend database — altid total uanset filter

**Berørte filer:**
- `backend/app/api/endpoints.py` — nyt `GET /api/endpoints/stats` endpoint: tæller LAA-MACs direkte fra in-memory cache (bit 1 check), returnerer `{total, laa_count}`
- `frontend/js/api.js` — `getEndpointStats()` API-kald
- `frontend/js/views/browse-table.js` — `epStats` tilføjet til `Promise.all` i `load()`; `state.laaTotal` gemmer DB-totalen; `laaTag()` bruger nu `state.laaTotal` i stedet for at tælle fra synlige rows

## [5.7.9 build 0507] — 2026-05-23 — feat: antal privat/LAA MAC vises i endpoint-tæller

**Berørte filer:**
- `frontend/js/views/browse-table.js` — `countLAA(rows)` og `laaTag(rows)` helpers; alle tre `countEl`-paths bruger nu `innerHTML` og tilføjer amber badge med antal LAA-MACs
- `frontend/css/styles.css` — `.laa-count` pill-badge (amber, alle temaer)

## [5.7.8.1 build 0506] — 2026-05-23 — debug: Cache-Control no-store på JS/CSS — tvinger browser til altid indlæse ny kode

**Berørte filer:**
- `backend/app/main.py` — `SecurityHeadersMiddleware` sætter nu `Cache-Control: no-store` på alle `.js`- og `.css`-svar, så browseren aldrig cacher statiske filer

## [5.7.8 build 0505] — 2026-05-23 — feat: privat MAC-adresse (LAA) fremhævning i browse-tabel

**Berørte filer:**
- `frontend/js/views/browse-table.js` — `isLocallyAdministered(mac)` checker bit 1 i første octet; `macDisplayHtml(mac)` wrapper første octet i `<span class="mac-laa">` ved LAA; render- og update-stier bruger `innerHTML` i stedet for `textContent`
- `frontend/css/styles.css` — `.mac-laa` amber baggrund (#f59e0b) med bold tekst; dark/midnight/slate tema-varianter

## [5.7.7.5 build 0504] — 2026-05-23 — debug: kritisk fix — TACACS login brudt af shadow-record

**Rodårsag:** `find_by_username` fandt shadow-recorden (username="adm", role="admin") → `is_admin_user=True` → TACACS springes over → lokal auth fejler med tomt password_hash → `bad_credentials`.

**Berørte filer:**
- `backend/app/services/user_service.py`:
  - `is_admin_user` tjekker nu `user_type == "user"` i stedet for `!= "operator"` — shadow-records ekskluderes eksplicit
  - `profile_record` lookup bruger nu inline-generator der filtrerer `tacacs_shadow` fra — shadow-record kan ikke misopfattes som operatørprofil
  - Lokal auth-blok blokerer nu også `tacacs_shadow` brugere (ikke kun `operator`)

## [5.7.7.4 build 0503] — 2026-05-23 — debug: fix 500 i users-liste — UserType + shadow-filter

**Berørte filer:**
- `backend/app/schemas/user.py` — `UserType` udvidet med `"tacacs_shadow"` (var `Literal["user", "operator"]`)
- `backend/app/services/user_service.py` — `list_users()` filtrerer nu shadow-records fra, så de ikke vises i admin-UI

## [5.7.7.3 build 0502] — 2026-05-23 — debug: TACACS shadow user — preferences og views virker nu

**Berørte filer:**
- `backend/app/services/user_service.py` — upsert af `user_type="tacacs_shadow"` record i `users.json` ved hvert vellykket TACACS-login; synkroniserer rolle, endpoint-roller og skabeloner fra operatørprofil

## [5.7.7.2 build 0501] — 2026-05-23 — debug: first-seen tid-input type=text HH:MM (fix AM/PM)

**Berørte filer:**
- `frontend/js/views/browse.js` — `type="time"` → `type="text" maxlength="5" placeholder="HH:MM"`
- `frontend/js/views/browse-filter.js` — `_fsDateTimeVal` parser og normaliserer HH:MM tekst; validerings `.invalid`-klasse ved forkert format
- `frontend/css/styles.css` — `.first-seen-time` text-align:center; `.first-seen-time.invalid` rød kant

## [5.7.7.1 build 0500] — 2026-05-23 — debug: first-seen filter splitter til date+time inputs (24t clock)

**Berørte filer:**
- `frontend/js/views/browse.js` — `datetime-local` → to par af `date`+`time` inputs med nye IDs (`first-seen-from-d/t`, `first-seen-to-d/t`)
- `frontend/js/views/browse-filter.js` — nye hjælpere `_fsDateTimeVal`, `firstSeenFromVal/ToVal`, `firstSeenAnySet`, `firstSeenClearAll`, `firstSeenRestore`; alle 7 gamle `firstSeenFrom()/To()` referencer erstattet; event-delegation opdateret
- `frontend/css/styles.css` — `.first-seen-dt-row` flex-row; `.first-seen-time` 52px; dark/midnight tema

## [5.7.7 build 0499] — 2026-05-23 — feat: first-seen filter bruger datetime-local (dato + tid)

**Berørte filer:**
- `frontend/js/views/browse.js` — `type="date"` → `type="datetime-local"` for begge first-seen filter inputs
- `frontend/js/views/browse-filter.js` — end-timestamp: `+ 86399` → `+ 59` (afrund til slutning af valgt minut)
- `frontend/css/styles.css` — `.first-seen-date` min-width 130px for datetime-local
- `frontend/js/i18n.js` — tooltip: "Fra dato" → "Fra dato/tid" (da + en)

## [5.7.6 build 0498] — 2026-05-23 — fix: update-check viser altid release notes (3-parts semver fallback + à-jour-visning)

**Berørte filer:**
- `backend/app/services/update_service.py` — `_extract_release_sections_since`: ny `_split_release_sections` hjælper; fallback matcher på 3-parts semver så debug-builds (5.7.4.5 → `## [5.7.4]`) virker; à-jour-tilstand viser altid aktuel versions noter
- `frontend/js/views/settings/section-update.js` — range-label bruger 3-parts base-version (ikke debug-suffix); logik uændret

## [5.7.5 build 0497] — 2026-05-23 — feat: skabelon gem/anvend i Browse-Edit og Registrering

**Berørte filer:**
- `frontend/js/views/browse.js` — tilføjet `detail-tpl-bar` med skabelon-dropdown og knapper over `modal-actions`
- `frontend/js/views/browse-detail.js` — `_templates`-closure, load skabeloner i `openDetail`, handlers for `#d-save-as-tpl` og `#d-tpl-apply`
- `frontend/js/views/register.js` — `applyTemplate` håndterer PSK_Mode; "Gem som skabelon"-knap for editor/admin; skabelon-liste genindlæses efter gem
- `frontend/js/i18n.js` — ny nøgler: `detail.btn_save_as_tpl`, `detail.btn_apply_tpl`, `detail.tpl_*` (da + en)
- `frontend/css/styles.css` — `.detail-tpl-bar` og `.detail-tpl-select`
- `version.json` — 5.7.5 build 0497
- `FEATURES.md`, `RELEASE_NOTES.md` — opdateret

## [5.7.4.5 build 0495] — 2026-05-23 — fix: first_seen ryddes ved prewarm-scan (scenario 3: slettet i ISE, aldrig tilbage)

**Berørte filer:**
- `backend/app/services/cache_prewarm.py` — _full_scan() kalder first_seen_store.delete(mac) for endpoints der forsvinder fra ISE-listen

## [5.7.4.4 build 0494] — 2026-05-23 — fix: first_seen nulstilles når endpoint genskabes i ISE med nyt ID

**Berørte filer:**
- `backend/app/core/first_seen_store.py` — record() sammenligner endpoint_id; nyt ID → UPDATE (nulstil tidsstempel)

## [5.7.4.3 build 0493] — 2026-05-23 — fix: first_seen slettes ved endpoint-delete via portal

**Berørte filer:**
- `backend/app/core/first_seen_store.py` — ny delete(mac) funktion
- `backend/app/services/endpoint_service.py` — delete_endpoint() kalder first_seen_store.delete(mac)

## [5.7.4.2 build 0492] — 2026-05-23 — fix: first_seen manglede td i renderRows — kolonneforskydning rettet

**Berørte filer:**
- `frontend/js/views/browse-table.js` — cells-objektet manglede first_seen nøgle

## [5.7.2 build 0483] — 2026-05-22 — feat: Første gang set — endpoint-historik database + dato-filter

**Berørte filer:**
- `backend/app/core/first_seen_store.py` (NY) — SQLite-store, INSERT OR IGNORE immutable timestamps
- `backend/app/schemas/endpoint.py` — EndpointDetail +first_seen_at: float|None
- `backend/app/services/endpoint_service.py` — _fetch_endpoint_detail kalder first_seen_store.record()
- `backend/app/main.py` — init_first_seen_db() ved startup
- `frontend/js/i18n.js` — col.first_seen, filter.first_seen_from, filter.first_seen_to
- `frontend/js/views/browse-utils.js` — erstatter age-kolonnen med first_seen
- `frontend/js/views/browse.js` — dato-filter inputs i HTML
- `frontend/js/views/browse-filter.js` — dato-range filter, change-listeners, snapshot save/restore
- `frontend/css/styles.css` — .first-seen-filter-wrap, .first-seen-date + dark/midnight themes

## [5.7.1 build 0482] — 2026-05-22 — feat: Batch-simulering RADIUS-parametre og templates

**Berørte filer:**
- `backend/app/api/policy.py` — BatchSimRequest +radius_attrs; sim_one sender radius_attrs til match_endpoint
- `frontend/js/api.js` — batchSimulate(setId, ids, radius_attrs)
- `frontend/js/views/browse.js` — RADIUS-sektion i batch-sim modal (datalist, rows container, template bar)
- `frontend/js/views/browse-bulk.js` — addBsimRadiusRow(), readBsimRadiusAttrs(), template load/save/del, sender radius_attrs

---

## [5.7.0 build 0481] — 2026-05-22 — feat: JSON-eksport, session anomali-detektion, silent token refresh

**Berørte filer:**
- `frontend/js/i18n.js` — nye nøgler: btn_export_json, export_json_done_*, anomaly_banner_dismiss (da+en)
- `frontend/js/views/browse.js` — #export-json-btn, #anomaly-banner, pollAnomalies(), renderAnomalyBanner()
- `frontend/js/views/browse-table.js` — JSON-eksport event listener
- `frontend/js/auth.js` — scheduleTokenRefresh(), cancelTokenRefresh() eksporteret
- `frontend/js/app.js` — doSilentRefresh() med scheduleTokenRefresh + polling-fallback; cancelTokenRefresh() ved logout
- `frontend/js/api.js` — getAnomalies()
- `backend/app/pxgrid/session_cache.py` — register_observer(), _observers[] kaldt i _broadcast()
- `backend/app/pxgrid/anomaly_detector.py` — ny: AnomalyDetector (bulk_disconnect + nas_ip_churn)
- `backend/app/api/pxgrid.py` — GET /pxgrid/anomalies
- `backend/app/main.py` — AnomalyDetector initialiseres ved startup

---

## [5.6.32 build 0480] — 2026-05-22 — feat: P2 kodebase-kvalitet — tests 190/190, service-split, API-split, disabled-regel-fix

**Berørte filer:**
- `backend/pyproject.toml` — tilføjet `pytest-cov>=5.0.0` og `mypy>=1.10.0`
- `backend/tests/test_endpoints.py` — ny: 20 unit-tests for EndpointService CRUD
- `backend/tests/test_policy.py` — ny: 35 unit-tests for policy condition matching og PolicyService
- `backend/tests/test_pxgrid.py` — ny: 30 unit-tests for PxGrid worker
- `backend/app/services/_endpoint_helpers.py` — ny: 144 linjer rene hjælpefunktioner udtrukket fra endpoint_service.py
- `backend/app/services/endpoint_service.py` — inline helpers fjernet (-149 linjer), imports fra _endpoint_helpers
- `backend/app/api/_endpoint_api_helpers.py` — ny: delte hjælpefunktioner for endpoint-routers
- `backend/app/api/endpoints_ops.py` — ny: operationelle ruter (CoA, ANC, historik) udtrukket fra endpoints.py
- `backend/app/api/endpoints.py` — operationelle ruter fjernet (-204 linjer), imports fra _endpoint_api_helpers
- `backend/app/main.py` — tilføjet endpoints_ops router
- `backend/app/services/policy_service.py` — bugfix: match_endpoint springer nu disabled-regler over
- `ARCHITECTURE.md` — tilføjet endpoint-cache, PxGrid, API-split og service-split sektioner

---

## [5.6.31 build 0479] — 2026-05-22 — fix: P1 UX/kvalitet/tests — esc() i metrics+policy, cleanup-returns, worker-loop fix, tests 89/89

**Berørte filer:**
- `frontend/js/views/metrics.js` — esc() centraliseret (fjernet lokal kopi); cleanup-funktion returneret (clearInterval ved nav)
- `frontend/js/views/policy.js` — esc() centraliseret; silent catches opgraderet til console.warn; cleanup-funktion returneret
- `backend/app/services/cache_sync.py` — `start()`: `self._stop = asyncio.Event()` i stedet for `.clear()` (fix: "bound to different event loop" ved genstart)
- `backend/app/services/cache_prewarm.py` — samme fix + `self._hot = asyncio.Queue()` resettet i `start()`
- `backend/app/services/audit_retention.py` — samme event-loop fix i `start()`
- `backend/app/services/user_service.py` — fjernet lokal `from app.core import audit_store` inde i `login()` der skygger modul-import og forårsager `UnboundLocalError` på Python 3.14
- `backend/tests/test_auth.py` — ny fil: 13 tests for auth-endpoints; module-scoped fixture + korrekte mock-targets
- `backend/tests/test_authz.py` — ny fil: 10 tests for rolle-håndhævelse; module-scoped fixture + korrekte mock-targets

**Ændringer:**
- 89 tests → 89 passed (fra 22 fejlende)
- Cleanup-returns i metrics.js og policy.js forhindrer timer-lækage ved navigation
- Worker `start()` opretter altid et nyt `asyncio.Event()` så de kan genstartes i en ny event loop (relevant ved test + fremtidig hot-reload)

---

## [5.6.30 build 0478] — 2026-05-22 — fix: P1 kritiske sikkerhedsfix — esc() centralisering + BulkCreateRequest grænse

**Berørte filer:**
- `frontend/js/views/browse-utils.js` — esc() opgraderet til fuld 5-tegns escape (`&<>"'`); kun `"` og `<` blev escaped før
- `frontend/js/views/import.js` — fjernet lokal `escapeHtml()` der aldrig blev brugt; tilføjet korrekt `import { esc }` (fix: ReferenceError ved fejlvisning)
- `frontend/js/views/attributes.js`, `audit.js`, `csv-template.js`, `dacls.js`, `dashboard.js`, `lifecycle.js`, `login.js`, `logs.js`, `policy-condition-builder.js`, `register.js`, `user-prefs.js` — lokale esc()-kopier erstattet med `import { esc } from "./browse-utils.js"`
- `frontend/js/views/settings/section-authz-profiles.js` — lokal esc() erstattet med `import { esc } from "../browse-utils.js"`
- `backend/app/schemas/endpoint.py` — `BulkCreateRequest.items` tilføjet `max_length=5_000`

---

## [5.6.29 build 0477] — 2026-05-22 — feat: policies-sektion refaktoreret til 3-panel sidebar-layout

**Berørte filer:**
- `frontend/js/views/policy.js` — ny HTML-struktur: sidebar (Policy Sets) + rules-panel + detail-panel (3-panel)
- `frontend/css/styles.css` — ny `.pol-sidebar`, `.pol-set-item`, `.pol-set-dot`, `.pol-set-state-pill`, `.pol-rules-panel`, `.pol-detail-panel`; fjernet: `.pol-sets-bar`, `.pol-set-card`, `.pol-inner`, `.pol-body`, `.pol-split`, `.pol-list-col`, `.pol-detail-col`; opdateret dark theme

**Ændringer:**
- Policy Sets vises nu i en vertikal sidebar (240px) til venstre med state-dot (grøn/grå), navn, service-navn og aktiv/inaktiv-pill
- Aktiv set markeres med blå venstre-kant og lys blå baggrund
- Regler-listen er nu et selvstændigt panel med scroll
- Detail/editor-panel fylder resten af bredden
- Dark theme opdateret med korrekte sidebar-farver

---

## [5.6.28 build 0476] — 2026-05-22 — docs: tilføjet manglende release notes for v5.6.25 og v5.6.26

**Berørt fil:**
- `RELEASE_NOTES.md` — tilføjet Bug fix release-sektioner for v5.6.25 (batch-simulate feltnavne) og v5.6.26 (selektion nulstillet ved re-render).

---

## [5.6.27 build 0475] — 2026-05-22 — feat: progress-indikator ved gem af multiple endpoints

**Berørte filer:**
- `frontend/js/views/browse-table.js` — fælles `runSaveLoop(ids)` erstatter de to separate save-loops i `saveAllBtn` og `bulkSaveBtn`. Kalder `showSaveProgress(done, total, mac)` på hver iteration: viser "Gemmer X / Y… [MAC]" + en blå progress-bar der fyldes op efterhånden som endpoints gemmes. MAC vises kun ved mere end ét endpoint.
- `frontend/css/styles.css` — `.save-progress-*` styles + dark/midnight theme.

---

## [5.6.26 build 0474] — 2026-05-21 — fix: selektion i browse-tabel nulstilles ved automatisk re-render

**Berørt fil:**
- `frontend/js/views/browse-table.js` — `renderRows()`: fanger nu `prevSelected` (Set af endpoint-IDs med aktiv checkbox) inden `tbody.innerHTML` erstattes. Checkboksen sættes til `checked` hvis ID'et var valgt inden genrender. Retter at pxGrid `endpoint_changed`-events (og manuel refresh) sletttede brugerens selektion.

---

## [5.6.25 build 0473] — 2026-05-21 — fix: batch-simulate brugte forkerte feltnavne på PolicyMatchResult

**Berørt fil:**
- `backend/app/api/policy.py` — `batch_simulate`: `result.matched_rule` → `result.matched_rule_name`, `result.matched_profile` → `", ".join(result.profiles)`. `matched`-check rettet tilsvarende. Fejlen betød at alle endpoints returnerede "has no attribute 'matched_rule'" i stedet for resultater.

---

## [5.6.24 build 0472] — 2026-05-21 — feat: opdatering viser alle release notes fra nuværende til nyeste version

**Berørte filer:**
- `backend/app/services/update_service.py` — ny `_parse_semver()` og `_extract_release_sections_since(current, latest)`: parser alle `## [x.y.z]`-sektioner fra RELEASE_NOTES.md, filtrerer dem i intervallet `current < v <= latest` og returnerer dem stacked med `---` separator, ældste øverst. Fallback til kun latest-sektionen hvis ingen matches. `check_github_version()` bruger nu denne funktion i stedet for `_extract_release_section()`.
- `frontend/js/views/settings/section-update.js` — `showInfo()`: summary-linjen viser nu `v{current} → v{latest}` ved opdatering i stedet for kun `v{latest}`.

---

## [5.6.23 build 0471] — 2026-05-21 — feat: config backup og restore

**Berørte filer:**
- `backend/app/api/config_backup.py` — ny router `GET /config/backup` (returnerer alle config-filer som JSON-download) og `POST /config/restore` (validerer og gendanner). Admin-only.
- `backend/app/main.py` — `config_backup_api` router registreret.
- `frontend/js/views/settings.js` — ny tab "Backup / Restore" i admin-settings. Panel med download-knap og fil-upload til gendannelse.
- `frontend/js/views/settings/section-backup.js` — backup/restore UI-logik: download som blob, restore via POST med confirm-dialog.

**Sikkerhed:** Backup indeholder credentials (ISE password, JWT-secret). Bruger får advarsel om dette ved download og restore.

---

## [5.6.22 build 0470] — 2026-05-21 — feat: batch-simulering af policy-match fra browse-tabellen

**Berørte filer:**
- `frontend/js/views/browse.js` — "Simulér match"-knap tilføjet i bulk-toolbar (disabled til endpoints vælges). Batch-simulate modal tilføjet med policy-sæt dropdown og resultattabel.
- `frontend/js/views/browse-bulk.js` — handler til bulk-sim-knap: loader policy-sæt via API, sender `batchSimulate(setId, ids)`, viser per-endpoint resultater med MAC, regel, profil og status-badge.
- `frontend/js/views/browse-table.js` — `updateSelectionUI()` enabler/disabler ny knap ved ændret selektion.
- `frontend/css/styles.css` — `.bsim-*` badge-styles (ok/fail/err/partial) med dark theme.

---

## [5.6.21 build 0469] — 2026-05-21 — feat: audit-log CSV-eksport

**Berørte filer:**
- `backend/app/api/audit.py` — ny `GET /audit/export`-endpoint (admin-only): returnerer alle matchende audit-events som CSV-fil (maks. 10 000 rækker). Understøtter samme filter-parametre som list-endpoint (actor, resource_type, resource_id, from_ts, to_ts, search). Returnerer `StreamingResponse` med `Content-Disposition: attachment`.
- `frontend/js/views/audit.js` — "Eksportér CSV"-knap tilføjet i toolbar. Henter CSV med auth-header, opretter blob-URL og trigger browser-download.

---

## [5.6.20 build 0468] — 2026-05-21 — feat: Livscyklus-viewer — inaktive endpoints

**Berørte filer:**
- `frontend/js/views/lifecycle.js` — ny view: viser endpoints uden portal-aktivitet i valgt periode (30/60/90/180/365 dage). Tabel med MAC, gruppe, profil, ejer, cache-alder. CSV-eksport direkte fra browseren. Admin-only.
- `frontend/index.html` — nav-item "Livscyklus" tilføjet under Overvågning.
- `frontend/js/app.js` — import og route `lifecycle` registreret (admin-only).
- `frontend/css/styles.css` — `.lc-*` styles + dark/midnight theme.

---

## [5.6.19 build 0467] — 2026-05-21 — fix: save endpoint langsom — after-audit ISE-kald fjernet fra hot path

**Berørt fil:**
- `backend/app/services/endpoint_service.py` — `update_endpoint()`: "after"-snapshot til audit-log køres nu som `asyncio.create_task` i baggrunden i stedet for at blokere HTTP-svaret. HTTP 200 returneres straks efter ISE PUT + cache-invalidation. Baggrunds-tasken henter friske data fra ISE og recorder audit-entry asynkront. Besparelse: ét ISE GET-kald (~300-600ms) fjernet fra hot path per save-operation.

---

## [5.6.18 build 0466] — 2026-05-21 — fix: cache-alert "Mange stale cache-entries" var permanent falsk alarm

**Berørte filer:**
- `backend/app/core/alert_store.py` — `_check_stale_pct()` bruger nu `very_stale_pct` i stedet for `stale_pct`. `stale_pct` (age > TTL=60s) er ~98% i normal drift med 30-min drip og SWR — var altid over threshold. `very_stale_pct` (age > TTL×30=1800s) er 0 i normal drift og stiger kun hvis drip ikke følger med. Threshold sænket til 10%; startup-suppression fjernet (ikke nødvendig med korrekt metric). Alerttitel og -tekst opdateret til at beskrive den reelle risiko (entries der KAN ikke serves fra cache).
- `backend/app/core/endpoint_cache.py` — `stats()` returnerer nu `very_stale_pct` i `staleness`-dict.

---

## [5.6.17 build 0465] — 2026-05-21 — fix: Dashboard cache "Disk stale" viser altid 0 — manglende observability

**Berørte filer:**
- `backend/app/api/dashboard.py` — Prewarm-blok tilføjer nu `disk_loaded_at_startup: pw.disk_loaded` til `prewarm_data`. Dashboard-response eksponerer den som `cache.disk_loaded_at_startup`. Forklaring: `disk_loaded` er antallet af entries indlæst fra disk ved seneste opstart og holdes stabil gennem sessionens levetid — den eneste permanente indikator for om disk-persistence fungerede.
- `frontend/js/views/dashboard.js` — Cache-kortet viser nu "Indlæst fra disk ved opstart: N" (eller "0 (ingen disk-cache fundet)" ved første opstart). "Disk stale (nu)"-rækken viser forklarende tekst: "0 ✓ (alle entries er live ISE-data)" i steady state, eller antal + "(afventer prewarm-refresh)" i startup-vinduet.

---

## [5.6.15 build 0464] — 2026-05-20 — docs: release notes v5.6.9–v5.6.15 tilføjet

**Berørt fil:**
- `RELEASE_NOTES.md` — Tilføjet release notes for v5.6.9, v5.6.10, v5.6.11, v5.6.12, v5.6.13, v5.6.14 og v5.6.15. Brugervende beskrivelser af alle ændringer siden v5.6.8.

---

## [5.6.15 build 0463] — 2026-05-20 — feat: simulate Auto-mode tester alle policy sets fra rank 0

**Berørte filer:**
- `frontend/js/views/browse-detail.js` — Ny `AUTO_SET = "--auto--"` sentinel. Policy set-dropdown har "Auto — test alle policy sets (fra rank 0)" som første og default valg. `runSimulate("--auto--")` itererer alle sets i rank-rækkefølge (sorteret af backend) og stopper ved første set der returnerer et match (definitivt eller partielt). Viser løbende hvilken set der testes. Indlæsning af RADIUS-template via "Indlæs"-knappen skifter automatisk dropdown til Auto. Simulate-knappen tjekker ikke længere `state.detailCurrentId` (unødvendig guard). `renderMatchResult` viser `.match-set-label` øverst i resultatkort med policy set-navn.
- `frontend/css/styles.css` — Ny `.match-set-label`-klasse: lille caps label over regelnavnet der viser hvilket policy set der matchede.

---

## [5.6.14 build 0462] — 2026-05-20 — fix: GitHub update-check CDN cache-bypass

**Berørt fil:**
- `backend/app/services/update_service.py` — `check_github_version()`: tilføjer `?t=<unix-timestamp>` cache-buster til begge `raw.githubusercontent.com` URL'er. CDN'en ignorerer `Cache-Control`/`Pragma`-headers fra klienter, men kan ikke ignorere en unik query-parameter — sikrer at "Check for update" altid returnerer frisk indhold.

---

## [5.6.14 build 0461] — 2026-05-20 — feat: RADIUS template-gemmer i simulate

**Berørte filer:**
- `frontend/js/views/browse-detail.js` — Template-bar tilføjet til RADIUS-sektionen. `localStorage`-nøgle `ise_radius_templates` gemmer array af `{ id, name, attrs }`. `renderTplSelect()` sorterer alfabetisk (dansk locale). "Indlæs" rydder rækker og udfylder fra valgt template. "Gem som template" prompter for navn og gemmer nuværende nøgle/værdier. "✕ Slet" fjerner valgt template efter confirm-dialog. Nyoprettet template vælges automatisk i dropdown.
- `frontend/css/styles.css` — Nye `.radius-tpl-bar`, `.radius-tpl-sel`, `.radius-tpl-del` klasser med light/dark theme support.

---

## [5.6.13 build 0460] — 2026-05-20 — feat: policy match ISE-editor-stil AND/OR visualisering

**Berørte filer:**
- `frontend/js/views/browse-detail.js` — `renderMatchResult()` omskrevet. Viser nu betingelsestræet med farvekodede AND/OR-blokke: ét AND-block ved flad politik; ét OR-block ved rene OR-grene; AND-block der wrapper OR-block ved kombinerede globale+OR-betingelser. Hvert betingelse: `Dict.Attr` i `pc-cond-dict`/`pc-cond-attr` notation, operator ogværdi. Matchede OR-grene = grøn kant; fejlede = rød kant. AND-inner-label ved >1 betingelse i en OR-gren. Partial-match-note bevaret.
- `frontend/css/styles.css` — Nye `.pc-*` klasser: `.pc-block`, `.pc-and-block`, `.pc-or-block`, `.pc-block-body`, `.pc-operator-label`, `.pc-and`, `.pc-or`, `.pc-or-sep`, `.pc-or-branch`, `.pc-branch-ok`, `.pc-branch-fail`, `.pc-and-inner-label`, `.pc-cond-row`, `.pc-cond-ok/fail/skip`, `.pc-cond-dict/attr/op/val`. Fuld dark mode support.

---

## [5.6.12 build 0459] — 2026-05-20 — fix: operator-profil med admin-rolle kan ikke logge ind via TACACS+

**Berørt fil:**
- `backend/app/services/user_service.py` — `login()`: `is_admin_user` tjekker nu `user_type != "operator"` foruden `role == "admin"`. Operator-profiler med admin-rolle (TACACS-brugere) fik tidligere `is_admin_user=True` → TACACS-sti sprunget over → lokal auth med random hash → altid 401. Nu routes de korrekt til TACACS-stien. Ægte lokale admins (`user_type` er None/ikke "operator") bypasser stadig TACACS som før.

---

## [5.6.11 build 0458] — 2026-05-20 — feat: Systemlog-sektion i Dashboard

**Berørte filer:**
- `frontend/js/views/dashboard.js` — Ny Systemlog-sektion nederst i Dashboard (admin-only; skjules stille ved 403). Niveau-filter med korrekt "og derover"-semantik (WARNING+ = WARNING+ERROR+CRITICAL) via client-side post-filtrering. Antal-selector (50/100/200 linjer). Fritekst-søgning med 400ms debounce. Farvekodet niveau-badge per log-linje (DEBUG grå, INFO blå, WARNING orange, ERROR rød, CRITICAL lilla). Logger-navn forkortet (fjerner "app."-prefix). Auto-refresh hvert 30s med resten af dashboard.

---

## [5.6.10 build 0457] — 2026-05-20 — fix: 6 resterende telemetri-problemer fra analyse (P2-P7)

**Berørte filer:**
- `backend/app/pxgrid/session_worker.py` — (P2) `_reconcile_from_pxgrid`: ny `session_fields_changed`-betingelse opdaterer eksisterende entries når vlan/dacl/sgt er ændret siden sidst (STOMP offline-vindue). (P3+P5) `_enrich_in_flight: set[str]` modul-sæt forhindrer duplikate MnT-tasks per MAC; `_enrich_single_from_mnt` fjerner MAC i `finally`-blok.
- `backend/app/pxgrid/session_cache.py` — (P4) `load_from_disk(max_age_s)`: sessions ældre end grænsen springes over ved indlæsning (default 4 timer via `pxgrid_session_disk_max_age_s`).
- `backend/app/main.py` — (P4) Kalder `load_from_disk` med `max_age_s`. (P6) `mnt_stale_reconcile_max_batch` læses fra settings (default hævet 50→100).
- `backend/app/ise/mnt_sessions.py` — (P7) `fetch_session_by_mac`: AuthStatus VLAN (RADIUS Accept AV-pair) foretrækkes over Session/MACAddress VLAN. VLAN samles til sidst: `out["vlan"] = auth_status_vlan or session_mac_vlan`.

---

## [5.6.9 build 0456] — 2026-05-20 — fix: _enrich_sessions_from_mnt overskrev korrekt pxGrid VLAN (5-min-cyklus)

**Berørt fil:**
- `backend/app/pxgrid/session_worker.py` — `_enrich_sessions_from_mnt`: ændret `vlan=data.get("vlan") or current.vlan` → `vlan=current.vlan or data.get("vlan")`. Funktionen kører hvert 5. minut på sessions med ufuldstændige felter — MnT lagger stadig bagud ved VLAN-ændringer i det vindue. Fix er parallel med v5.6.8-fix i `_enrich_single_from_mnt`. Identificeret i to-faset telemetri-analyse (Problem 1, HØJ prioritet).

---

## [5.6.8 build 0455] — 2026-05-20 — fix: _enrich_single_from_mnt overskrev pxGrid VLAN med stale MnT-data

**Berørt fil:**
- `backend/app/pxgrid/session_worker.py` — `_enrich_single_from_mnt`: ændret `vlan=data.get("vlan") or current.vlan` → `vlan=current.vlan or data.get("vlan")`. Funktionen kører straks efter STOMP-event mens MnT stadig returnerer gammelt VLAN → stale MnT overskrev korrekt pxGrid VLAN. Årsag til "ét step bagud"-symptom og til at CoA uden VLAN-ændring "syncede" portalen.

---

## [5.6.7 build 0454] — 2026-05-20 — fix: MnT AuthStatus parsedes med ældste session i stedet for nyeste

**Berørte filer:**
- `backend/app/ise/mnt_sessions.py` — `_parse_auth_status_elements()`: ny parser der returnerer én dict per `authStatusElement` i dokument-rækkefølge (nyeste-først). `fetch_session_by_mac`: ersatter `_parse_all_xml_fields(text2)` med iteration over `_parse_auth_status_elements()` — bruger FØRSTE element der har den relevante data per felt (auth_method, vlan, authz_profiles, identity_group osv.). Forhindrer at ældre sessions response (VLAN 210) overskrives NYERE sessions response (VLAN 64).

---

## [5.6.6 build 0453] — 2026-05-20 — fix: tunnelPrivateGroupId "(tag=0) N" normaliseres + getSessions bruger frisk VLAN

**Berørte filer:**
- `backend/app/pxgrid/session_worker.py` — `_parse_vlan()`: normaliserer `"(tag=0) 32"` → `"32"` ved at tage det numeriske suffix. `_build_session_info`: bruger `_parse_vlan()` på tunnelPrivateGroupId-udtræk. getSessions bulk-load: `vlan=info.vlan or existing.vlan` (frisk payload foretrækkes). `reconcile_stale_sessions._process()`: reverted v5.6.4-prioritering for vlan/policy-felter — MnT foretrækkes som primær kilde (RADIUS accounting er mere pålidelig end STOMP-events der kan komme i forkert rækkefølge eller mangle).

---

## [5.6.5 build 0452] — 2026-05-20 — fix: session debug mismatch-advarsel forklarer MnT-forsinkelse

**Berørte filer:**
- `frontend/js/views/browse-detail.js` — Probe MnT-resultatet: VLAN (cache) mærkes "pxGrid ✓"; VLAN (MnT) mærkes "kan være forældet"; mismatch-tekst forklarer at MnT normalt lagger bagud efter re-auth og at cache er autoritativ.

---

## [5.6.5 build 0451] — 2026-05-20 — fix: stale VLAN fra gammel session + ISE Session debug-tab

**Berørte filer:**
- `backend/app/pxgrid/session_worker.py` — `_handle_message_body`: detekterer nyt `audit_session_id` (ny session = re-auth); rydder `vlan`/`dacl`/`cts_security_group` fra gammel session i stedet for at arve dem; trigger MnT-berigelse ved tomt vlan. `_enrich_single_from_mnt`: log-output inkluderer nu vlan-ændringer (gammel→ny).
- `frontend/js/views/browse.js` — tilføjet "ISE Session"-tab i detail-modal
- `frontend/js/views/browse-detail.js` — `_lazyLoadSession()`: viser cache-indhold og admin Probe MnT-knap der kalder debug-endpoint og sammenligner cache vs. MnT (VLAN-mismatch fremhæves)
- `frontend/js/api.js` — `debugPxGridSession()` og `probeMntSession()`

---

## [5.6.4 build 0450] — 2026-05-20 — fix: reconcile_stale_sessions overskriver ikke pxGrid VLAN med MnT-data

**Berørte filer:**
- `backend/app/pxgrid/session_worker.py` — `_process()` i `reconcile_stale_sessions`: vendt prioritet i `if existing:` grenen fra `mnt_data or existing.field` til `existing.field or mnt_data` for alle felter (nas_ip, user_name, policy_set_name, authz_profiles, authz_rule_name, endpoint_policy, dacl, vlan, cts_security_group, auth_method, identity_group). pxGrid real-time data overskrives aldrig — MnT bruges kun til at fylde tomme felter.

---

## [5.6.3 build 0449] — 2026-05-20 — feat: endpoint historik viser sigende handlingsbeskrivelse

**Berørte filer:**
- `frontend/js/views/browse-detail.js` — `_describeAction()`: differ `before`/`after`-snapshot og viser ændrede felter (fx `VLAN:10`, `Gruppe:Unknown`) maks 32 tegn; for ikke-update-handlinger vises action-teksten uændret

---

## [5.6.2 build 0448] — 2026-05-20 — fix: fritekst-søgning 500 + MnT stale-session reconcile worker

**Berørte filer:**
- `backend/app/services/endpoint_service.py` — fix: `d.profile` → `d.profiler_name` i `_full_text_filter()` (AttributeError → 500)
- `backend/app/pxgrid/session_worker.py` — ny funktion `reconcile_stale_sessions()`: henter MnT-session for stale endpoint-cache entries, opretter/opdaterer session-cache entries for endpoints der ikke har modtaget pxGrid push-events
- `backend/app/main.py` — ny `_mnt_stale_reconcile_loop` task: kører `reconcile_stale_sessions` hvert 10. min (konfigurerbar via `mnt_stale_reconcile_interval_s`)

---

## [5.6.1 build 0447] — 2026-05-20 — fix: GitHub update-check sender nu Cache-Control: no-cache headers

**Berørte filer:**
- `backend/app/services/update_service.py` — `no-cache` headers + `follow_redirects=True` på httpx-kald til GitHub raw content

---

## [5.6.1 build 0446] — 2026-05-20 — fix: 5 bugs fra v5.6.0 — fritekst-søgning, historik-tab, session-auth-refresh, stale-alert, Dashboard-session-count

**Berørte filer:**
- `frontend/js/views/browse-filter.js` — fix: `enterFilterMode()` returnerede tidligt ved q-ændring fordi `state.filterMode` var true; ny guard er kun `state.loadingAll`
- `frontend/js/views/browse-detail.js` — fix: `_lazyLoadHistorik()` fallback til DOM-id hvis `state.detailCurrentId` er null
- `frontend/js/views/browse.js` — fix: `setInterval` re-henter pxGrid sessions hvert 5. min for at merge MnT-beriget data
- `backend/app/api/dashboard.py` — fix: `sess_stats.get("total")` → `"size"` (SessionCache.stats() bruger nøglen "size")
- `backend/app/core/alert_store.py` — fix: stale-alert supprimeres også når `total_endpoints == 0` (endnu ingen scan kørt)
- `frontend/css/styles.css` — tilføjet `.alert-badge-warn` klasse

---

## [5.6.0 build 0445] — 2026-05-19 — feat: v5.6.0 — Dashboard, Bulk CoA, Alert-system, Fritekst-søgning, Endpoint historik, ISE PSN noder, Batch policy-sim, Endpoint livscyklus

**Berørte filer:**
- `backend/app/api/dashboard.py` (ny)
- `backend/app/api/alerts.py` (ny)
- `backend/app/api/lifecycle.py` (ny)
- `backend/app/api/ise_nodes.py` (ny)
- `backend/app/ise/nodes.py` (ny)
- `backend/app/core/alert_store.py` (ny)
- `backend/app/api/endpoints.py` (+bulk-coa, +history, +q-param)
- `backend/app/api/policy.py` (+batch-simulate)
- `backend/app/services/endpoint_service.py` (+full_text_q filter)
- `backend/app/main.py` (+routers, +alert background task)
- `frontend/js/views/dashboard.js` (ny)
- `frontend/js/views/browse.js` (+Historik-tab, +Bulk CoA btn, +fritekst-søgefelt)
- `frontend/js/views/browse-detail.js` (+historik tab handler + _lazyLoadHistorik)
- `frontend/js/views/browse-bulk.js` (+bulkCoaBtn handler)
- `frontend/js/views/browse-table.js` (+bulkCoaBtn enable/disable)
- `frontend/js/views/browse-filter.js` (+fullTextQ state + q-input wiring)
- `frontend/js/views/metrics.js` (+ISE PSN nodes kort via `/api/ise/nodes`)
- `frontend/js/api.js` (+getEndpointHistory, +bulkCoa, +batchSimulate, +getIseNodes, +getStaleEndpoints, +getDashboard, +getAlerts, listAllEndpointDetails+q)
- `frontend/js/app.js` (+dashboard route, +alert badge polling)
- `frontend/index.html` (+Dashboard nav-link, +alert-badge)
- `frontend/css/styles.css` (+.alert-badge styles)
- `version.json`

**8 nye features som samlet release v5.6.0:**
1. **Dashboard** — Ny /#dashboard viser circuit breaker, endpoints, sessioner, cache-hit, prewarm-status og de 5 seneste audit-events. Opdateres automatisk hvert 30. sekund.
2. **Bulk CoA Reauth** — "CoA Reauth"-knap i Browse selection-toolbar kalder `/api/endpoints/bulk-coa` med op til 200 endpoints ad gangen (semaphore=3).
3. **Alert-badge** — Navigationsbadge med antal aktive systemadvarsler (orange=warning, rød=error). Polling hvert 60. sekund. Tre alert-betingelser: circuit breaker OPEN/HALF-OPEN, drip bagud, stale > 50%.
4. **Fritekst-søgning** — "Fritekst søgning…"-inputfelt i Browse-toolbar. Søger server-side via `q`-param i `/api/endpoints/details/all` på tværs af 10 felter (MAC, gruppe, profil, owner, lokation, beskrivelse, vendor, type, endpoint_type, platform_type).
5. **Endpoint historik** — "Historik"-tab i endpoint detail-modal. Lazy-loader via `GET /api/endpoints/{id}/history`. Viser audit-trail med tidspunkt, bruger og handling.
6. **ISE PSN noder** — Nyt "ISE PSN noder"-kort på Metrics-siden fetcher `/api/ise/nodes` og viser alle ISE-noder med reachability-dot, roller og version.
7. **Batch policy-simulering** — Ny `POST /api/policy/batch-simulate` backend-route. Kører policy-match for op til 100 endpoints parallelt (semaphore=5).
8. **Endpoint livscyklus** — Ny `GET /api/lifecycle/stale?days=90` backend-route. Returnerer endpoints der ikke har haft portal-aktivitet i X dage (krydstjek af cache mod audit-log).

## [5.5.9 build 0444] — 2026-05-19 — fix: cache vedligehold-metrics eksponeret via Prometheus og vist på Metrics-siden

**Berørte filer:** `backend/app/core/metrics.py`, `backend/app/services/cache_prewarm.py`, `frontend/js/views/metrics.js`, `version.json`

Drip-refresh og staleness-metrics tilføjet som Prometheus-gauges og counters, synlige på Metrics-siden som nyt "Cache vedligehold"-kort. Otte nye metrics: `drip_refreshed_total`, `drip_skipped_total`, `drip_sleep_seconds`, `drip_cycle_seconds`, `oldest_entry_age_seconds`, `avg_entry_age_seconds`, `stale_entries`, `stale_pct`. Kapacitetsindikator viser grøn/gul/rød badge ved siden af "Fuld rotation"-estimatet.

## [5.5.9 build 0443] — 2026-05-19 — feat: cache vedligehold-statistik — drip-metrics og staleness-fordeling

**Berørte filer:** `backend/app/services/cache_prewarm.py`, `backend/app/core/endpoint_cache.py`, `backend/app/api/cache.py`, `frontend/js/views/settings/section-cache.js`, `version.json`

Ny statistik i Settings → Cache der viser om drip-refresh-mekanismen kan følge med i takt med at systemet vokser:
- **Kapacitetsindikator (grøn/gul/rød):** sammenligner estimeret fuld-rotationstid med konfigureret scan-interval — grøn = drip'en er foran, rød = kan ikke følge med.
- **Drip-tæller:** total antal endpoints refreshet og sprunget over (friske) siden opstart.
- **Cache-alder:** ældste entry-alder, gennemsnitlig alder, stale-andel i procent.
- **Staleness-fordeling:** visuel søjle der viser andelen af friske (grøn), stale (gul) og meget-stale (rød) entries.

Backend: `PrewarmStatus` har fire nye felter (`drip_refreshed_total`, `drip_skipped_total`, `drip_current_sleep_s`, `drip_estimated_full_cycle_s`). `EndpointCache.stats()` returnerer nu et `staleness`-objekt med aldersfordeling.

## [5.5.9 build 0442] — 2026-05-19 — feat: cache drip-refresh — kontinuerlig baggrunds-opdatering af endpoint-cache

**Berørte filer:** `backend/app/core/endpoint_cache.py`, `backend/app/services/cache_prewarm.py`, `version.json`

Ny `_drip_loop()` i pre-warm worker kører parallelt med den periodiske liste-scan. Loopen finder løbende den ældste cachede entry og refresher den fra ISE, derefter sover den `interval / antal_endpoints` sekunder (fx 1000 endpoints / 1800s = 1,8s pr. opdatering). Resultatet er at alle endpoints opdateres jævnt over pre-warm-intervallet — i stedet for én burst hvert 30. minut kun udløst af bruger-interaktion. Friske entries (yngre end `cache_ttl_seconds`) og entries der allerede er ved at blive hentet (`_inflight_detail`) springes over. Ny `get_oldest_id()` metode på `EndpointCache` finder den ældste entry i O(N).

## [5.5.8 build 0441] — 2026-05-19 — fix: detail-modal loading-besked rykker ikke længere layout

**Berørte filer:** `frontend/css/styles.css`, `version.json`

`#detail-msg` sad i flex-flowet mellem `<h3>` og `.detail-tab-bar` — hvert gang loading/gem/fejl-besked dukkede op eller forsvandt rykkede tab-baren og alt indhold op/ned. Fix: `#detail-msg` er nu `position: absolute` (taget ud af flex-flowet) og overlayer indholdet øverst i modal uden at påvirke tab-barens position. `pointer-events: none` på wrapper sikrer at klik stadig virker igennem tom besked-area.

## [5.5.7 build 0440] — 2026-05-19 — fix: TACACS+ bootstrap → viewer (ikke admin); mismatch → 401 (uændret)

**Berørte filer:** `backend/app/services/user_service.py`, `version.json`

Bootstrap-tilstanden (ingen operatørprofiler konfigureret overhovedet) tildeler nu `viewer`-rollen i stedet for `admin`. Mismatch-tilstanden (profiler findes men ingen matcher brugeren) afviser stadig med 401. Auditeres som `tacacs_auto_viewer_bootstrap`.

## [5.5.7 build 0438] — 2026-05-19 — security+fix: audit-API admin-only + logout + circuit-breaker audit

**Berørte filer:** `backend/app/api/audit.py`, `backend/app/api/auth.py`, `backend/app/ise/client.py`, `BUGS.md`, `RELEASE_NOTES.md`, `version.json`

- **SEC (audit-API):** `GET /api/audit` og `GET /api/audit/{id}` kræver nu `require_admin` — tidligere `require_any` lod alle loggede brugere læse audit-historikken
- **fix (logout):** `POST /api/auth/logout` auditerer nu `logout`-event med aktør og auth-type når token er gyldigt
- **fix (circuit-breaker):** ISE-klienten auditerer `ise_circuit_open` ved CLOSED→OPEN transition og `ise_circuit_closed` ved recovery — begge med fejldetaljer

## [5.5.6 build 0437] — 2026-05-19 — release: v5.5.6-P1 — stabilitet og ydeevne

**Berørte filer:** `version.json`, `RELEASE_NOTES.md`, `CHANGELOG.md`

Releaseversion 5.5.6-P1. Samler tre stabilitets- og ydeevnerettelser: frontend hang (SSE zombie-leak), cache dead-zone (STALE_MAX_FACTOR 10→30) og API-timeout. Se RELEASE_NOTES.md [5.5.6] for brugerbeskrivelse.

## [5.5.5 build 0436] — 2026-05-19 — fix: frontend hang — SSE/interval zombie-leak ved view-skift

**Berørte filer:** `frontend/js/app.js`, `frontend/js/views/browse.js`, `frontend/js/api.js`, `BUGS.md`, `version.json`

MutationObserver-cleanup i browse.js kørte aldrig — `#view-container` forbliver i DOM ved view-skift (kun `innerHTML = ""`), så `!document.body.contains(container)` var altid `false`. Hvert browse-besøg efterlod en zombied EventSource og et `setInterval` der aldrig stoppede.

- **app.js:** `renderView()` kalder `currentCleanup()` (returneret fra forrige view) FØR `container.innerHTML = ""`
- **browse.js:** Returnerer eksplicit `cleanup()`-funktion der stopper EventSource, clearer interval og fjerner resize-listener. Fjernet MutationObserver. `viewActive`-flag guards pxGrid reconnect-setTimeout så det ikke starter ny SSE-forbindelse fra en gammel closure
- **api.js:** Alle `fetch()`-kald har nu `AbortSignal.timeout(30_000)` — forhindrer UI-blokering ved langsomme ISE-kald

## [5.5.5 build 0435] — 2026-05-19 — fix: cache STALE_MAX_FACTOR 10→30 — eliminer 20 min dead-zone

**Berørte filer:** `backend/app/core/endpoint_cache.py`, `BUGS.md`, `version.json`

`STALE_MAX_FACTOR = 10` × `cache_ttl_seconds = 60s` = 600s "too stale"-grænse. Pre-warm kørte hvert 1800s. I vinduet 600s–1800s var cachen ikke servérbar og browse hentede alle endpoints synkront fra ISE (ligner manuel refresh). Fix: hævet til 30 × 60s = 1800s — matcher pre-warm-intervallet præcist. Stale entries serveres nu via SWR (baggrunds-refresh) hele vejen til næste pre-warm scan.

## [5.5.5 build 0434] — 2026-05-19 — fix: release notes manglede sektioner for 5.5.4 og 5.5.5

**Berørte filer:** `RELEASE_NOTES.md`, `version.json`

Tilføjet `## [5.5.5]` og `## [5.5.4]` sektioner i RELEASE_NOTES.md. Uden disse sektioner returnerede backend tom streng og frontend skjulte release-notes-panelet selv ved korrekt version.

## [5.5.5 build 0433] — 2026-05-19 — security: Patch 2 — SEC-B/D/E/I/J/M implementeret

**Berørte filer:** `backend/app/services/settings_service.py`, `backend/app/core/config.py`, `backend/app/services/update_service.py`, `backend/app/services/user_service.py`, `backend/app/core/operator_profile_store.py`, `FEATURES.md`, `reports/SECURITY_ANALYSIS_V2.md`

- **SEC-B:** PSK-nøglegenerator bruger nu `secrets.choice()` + `secrets.randbelow()` i stedet for `random` (Mersenne Twister). Kryptografisk sikker PRNG.
- **SEC-D:** `ise_verify_tls` default ændret fra `False` til `True`. Nyinstallationer validerer ISE-certifikatet.
- **SEC-E:** Audit-records tilføjet i `git_pull()`, `apply_package()`, `schedule_restart()` og `setup_first_admin()`. Kritiske update-operationer er nu sporbare i audit-log.
- **SEC-I:** `operator_profiles.json` sættes til `chmod 0o600` ved skrivning på Unix-systemer (no-op på Windows).
- **SEC-J:** ZIP-bomb beskyttelse: ukomprimeret totalstørrelse tjekkes til max 500 MB i `validate_package()`.
- **SEC-M:** TACACS+ auto-admin bootstrap logges nu til audit-DB (`tacacs_auto_admin_bootstrap`-action) i tillæg til app.log.
- **SEC-A markeret By Design:** Auto-admin reaktivering ved tom operatørprofil-liste er intentionel adfærd.

## [5.5.4 build 0432] — 2026-05-19 — docs: Sikkerhedsanalyse V2 — to-faset statisk analyse med 13 fund (SEC-A til SEC-M)

**Berørte filer:** `reports/SECURITY_ANALYSIS_V2.md` (ny), `version.json`

To-faset white-box sikkerhedsgennemgang af v5.5.4 mod OWASP Top 10 2021. Fase 1 kortlægger 12 angrebsflader; fase 2 dokumenterer 13 specifikke fund inkl. 1 kritisk (SEC-A: TACACS+ auto-admin genaktivering), 3 høj, 6 medium og 3 lav. Top-10 handlingsliste og sammenligning med V1-rapport medfølger.

## [5.5.4 build 0431] — 2026-05-19 — fix: TACACS+ auto-admin crash — profile_record.get() på None

**Berørte filer:** `backend/app/services/user_service.py`

`tacacs_user`-opbygningen kaldte `profile_record.get("created_at", "")` selv når `profile_record` var `None` (ingen operatørprofiler konfigureret → auto-admin sti). Gav `AttributeError` → HTTP 500. Fix: `profile_record.get(...) if profile_record else ""`.

## [5.5.4 build 0430] — 2026-05-19 — feat: TACACS+ auto-admin når ingen operatørprofiler er konfigureret

**Berørte filer:** `backend/app/services/user_service.py`

Hvis TACACS+ auth lykkes men der ikke er oprettet nogen operatørprofiler i portalen (bootstrap-tilstand), tildeles TACACS-brugeren automatisk admin-rollen i stedet for at blive afvist med en fejl. Giver administrator mulighed for at logge ind via TACACS+ og oprette operatørprofiler uden at skulle bruge lokal fallback-konto.

Når mindst én operatørprofil er oprettet, gælder den eksisterende logik: TACACS-brugerens profilnavn skal matche en konfigureret profil — ellers afvises login.

## [5.5.3 build 0429] — 2026-05-19 — docs: pxGrid cert-opsætning præciserer at identitets-cert og CA-cert skal være separate filer

**Berørte filer:** `frontend/js/views/settings.js`, `frontend/js/i18n.js`

Upload-mode: tilføjet tydelig advarsel om at klient-cert-filen KUN må indeholde portalens eget identitets-certifikat (én BEGIN/END CERTIFICATE blok) — CA-certifikater uploades separat i CA-bundle-feltet.
CSR trin 2: ISE Internal CA-instruks præciserer at man downloader kun certifikatet (ikke chain-filen), og at CA-bundle hentes separat fra Certificate Authority Certificates. MS certsrv-instruks præciserer "Download certificate" (ikke "Download certificate chain"). Rød advarsel: identitets-cert og CA-bundle skal altid være separate filer.
CSR trin 3 hint: opdateret til "kun portalens eget identitets-certifikat — ikke en chain, ét certifikat i filen".
CSR trin 4 hint: præciseret at CA-bundle er separat fra trin 3, og at den godt må indeholde rod-CA + intermediates som sammensatte PEM-blokke.
Upload-cert label: ændret til "Identitets-certifikat (PEM) — kun klientcert, ikke chain" (DA + EN).

## [5.5.3 build 0428] — 2026-05-19 — feat: Release notes i GitHub-opdatering + RELEASE_NOTES.md

**Berørte filer:** `RELEASE_NOTES.md` (ny), `backend/app/services/update_service.py`, `frontend/js/views/settings/section-update.js`, `frontend/js/views/settings.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`

Ny `RELEASE_NOTES.md` i repo-roden med formaterede release notes per version: v5.5.0 (samlet første release med alle features), v5.5.1/5.5.2/5.5.3 som delta-noter fra forrige version.

Backend `check_github_version()` henter nu RELEASE_NOTES.md parallelt med version.json via `asyncio.gather()` og udtrækker sektionen for den seneste version med regex. Release notes returneres som `release_notes`-felt i API-responsen.

Frontend GitHub-opdatering-kortet viser release notes i et sammenklappeligt panel (`<details>`) med simpel markdown-renderer (headers, bold/italic, code, lister, separator) — altid synligt når data er tilgængeligt, uanset om der er en opdatering.

## [5.5.3 build 0427] — 2026-05-19 — fix: form select styled med tydelig chevron-pil (alle temaer)

**Berørte filer:** `frontend/css/styles.css`

`form select`-elementer har nu `appearance: none` + SVG-chevron som `background-image` så det er tydeligt at de er klikbare dropdowns. Padding-right justeret så tekst ikke overlapper pilen. Dark- og midnight-theme ovverides udskilt til separate regler der bevarer `background-image` med lys-farvet pil.

## [5.5.3 build 0426] — 2026-05-19 — feat: PxGrid settings UX — SAN-præcisering, INIT→PENDING auto-test, Phase 2b off by default, step5-status

**Berørte filer:** `frontend/js/views/settings.js`, `frontend/js/views/settings/section-pxgrid.js`, `frontend/js/i18n.js`

1. **Extra SAN label + hint**: Label ændret til "Ekstra SAN-navne — portalens FQDN skal med". Hint-tekst præciserer at portalens FQDN er påkrævet (pxGrid 2.0 / RFC 6125 validerer mod hostnavn), med eksempel på komma-separerede FQDN'er.
2. **Step 5 INIT→PENDING auto-flow**: Når "Opret pxGrid-konto" klikkes og ISE returnerer `accountState=INIT`, kører portalen automatisk en test-forbindelse. Første autentificerede forbindelsesforsøg fra klienten får ISE til at flytte kontoen fra INIT til PENDING-tilstand — klar til admin-approval. Step5-hint-tekst opdateret til at beskrive dette flow.
3. **Phase 2b (STOMP-worker) disabled by default**: `pxgrid_worker_enabled` initialiseres nu til `false` ved ny installation (var `true` pga. `!== false`-logik). Worker skal eksplicit aktiveres af admin efter vellykket pxGrid-opsætning.
4. **Test connection status under step 5**: Nyt `#pxgrid-step5-msg`-div under step 5-knappen viser resultat af både account-create-flowet og manuelle "Test forbindelse"-klik — så admin kan se status direkte i CSR-flowet uden at scrolle til bunden.

## [5.5.2 build 0425] — 2026-05-18 — fix: duplikat RADIUS-nøgle advarsel + hint om enkeltværdi-semantik

**Berørte filer:** `frontend/js/views/browse-detail.js`, `frontend/css/styles.css`

Når brugeren tilføjer to rækker med samme RADIUS-attributnøgle (fx to `Called-Station-ID`-rækker), blokeres simulering nu med en klar advarsel og de duplikerede felter fremhæves i gult. Tilføjet hint-tekst under sektionstitlen der forklarer enkeltværdi-semantikken: en RADIUS-pakke har én enkelt værdi per attribut; for at matche `contains "802"` OG `contains "hus"` i samme regel skal brugeren skrive én samlet værdi der indeholder begge substrings, fx `hus-802`.

## [5.5.2 build 0424] — 2026-05-18 — fix: dynamisk RADIUS-parameter UI i endpoint-simulator

**Berørte filer:** `frontend/js/views/browse-detail.js`, `frontend/css/styles.css`

RADIUS-sektionen i endpoint-detail / simulatoren (RADIUS-fanen) viste kun de attributter politikken selv rapporterede som manglende, og kun ét ad gangen. Ny permanent add/remove UI: `+ Tilføj parameter`-knap med nøgle/værdi-rækker og ✕-fjern-knap. Attributnavne har autocomplete (datalist) med 10 almindelige RADIUS-attributter. `radius_attrs_needed` fra simulationsresultatet merges automatisk ind som tomme rækker uden at nulstille eksisterende værdier. Fjernede den gamle `renderRadiusPrompt`-funktion og `#d-pol-refine-btn`-flowet.

## [5.5.1 build 0423] — 2026-05-18 — fix: git pull bruger nu FETCH_HEAD i stedet for origin/{branch}

**Berørte filer:** `backend/app/services/update_service.py`

`reset --hard origin/dev` fejlede med "ambiguous argument" fordi serveren ikke har en lokal remote-tracking-reference for `origin/dev` (repo opsat til kun at følge `main`). `git fetch origin dev` henter data korrekt men opretter ikke nødvendigvis `refs/remotes/origin/dev` på alle repo-konfigurationer. Fix: `reset --hard FETCH_HEAD` — FETCH_HEAD sættes altid af `git fetch` og peger på det netop hentede HEAD, uanset remote-tracking-opsætning.

## [5.5.1 build 0422] — 2026-05-18 — feat: NAS-scan viser nu alle rå ISE NDG device-typer direkte til mapping

**Berørte filer:** `backend/app/api/custom_attributes.py`, `backend/app/core/platform_types.py`

Tidligere normaliserede scanneren ISE NDG-paths til kanoniske typer ("airos", "iosxe" osv.) — enheder med type "Airespace-WLC" forsvandt ind i en "airos"-match og var usynlige hvis ingen "airos"-mapping-række fandtes. Nu præsenterer scanneren alle unikke NDG device-type-paths rå og direkte: `grouped` = paths der allerede har en mapping-række (exact case-insensitive match); `unmatched` = paths uden mapping-række → vises som pre-udfyldte forslag i mapping-editoren. Brugeren beslutter selv hvad hver ISE device-type mappes til. Normalisering (`normalize()`) fjernet fra scan-presentationslaget; bruges stadig internt i MnT session-sync (`derive_platform`). Tilføjet også synonym-varianter for Airespace/Airspace i `platform_types.py` (mellemrum-varianter og kortformer).

## [5.5.1 build 0421] — 2026-05-18 — fix: "Use dev branch" gemmer nu github_branch korrekt i config.json

**Berørte filer:** `backend/app/schemas/settings.py`, `backend/app/services/settings_service.py`

`github_branch` manglede i alle fire nødvendige steder: `BackendSettingsUpdate`-schema (Pydantic droppede feltet stille), `BackendSettingsResponse`-schema (returnerede aldrig værdien), `get_backend_settings()` (læste aldrig fra `config.settings`) og `update_backend_settings()` (gemte aldrig til `config.json`). Resultat: checkbox-toggle ændrede intet — GitHub-check hentede altid fra `main`. Fix: `github_branch: str = "main"` tilføjet til begge schemas og koblet i service-laget.

## [5.5.1 build 0420] — 2026-05-18 — fix: NAS-scan medtager nu devices der fejler under detail-fetch; "All Device Types" udelukkes fra unmatched

**Berørte filer:** `backend/app/ise/network_devices.py`, `backend/app/api/custom_attributes.py`

To supplerende rettelser til NAS-scan (efter b0417):
1. **Manglende device ved fejlet detail-fetch**: `_load_all()` step 2 fangedev undtagelser med `logger.debug` → enheder der fejler under GET `/networkdevice/{id}` (timeout, rettighedsproblem o.l.) forsvandt lydløst fra `_all_devices`. Fix: (a) step 1 bevarer nu `(id, name)`-tupler i stedet for bare `id`, (b) ved fejl logger vi `WARNING` og indsætter et fallback-`DeviceInfo(name=list_name)` så enheden altid er synlig i scannens resultat.
2. **Udeluk "All Device Types"**: devices med `device_type=""` og `path=""` (standard ISE NDG "All Device Types" — ingen specifik type konfigureret) vises ikke længere som unmatched. De bærer ingen platform-information og forurener mapping-editoren. Devices med en faktisk NDG-path der ikke kan normaliseres vises fortsat som unmatched.

## [5.5.0 build 0419] — 2026-05-18 — docs: OVA uploadet til GitHub Releases v5.5.0 + installationsguide opdateret med download-link

**Berørte filer:** `docs/02-INSTALLATION.md`, `FEATURES.md`

OVA-image (`hypervision-clean.ova`, 1,1 GB) uploadet som release-asset til GitHub Releases tag `v5.5.0`. Installationsguide opdateret: direkte download-URL tilføjet som fremhævet boks øverst i OVA-afsnittet, trin-numre justeret (Download → Import → Start → Første login).

## [5.5.0 build 0418] — 2026-05-18 — feat: CLAUDE.md opdateret — Claude spørger altid om merge til main efter commit

## [5.5.0 build 0417] — 2026-05-18 — fix: NAS-scan viser nu alle device-typer inkl. devices uden IP eller med tom NDG-type

**Berørte filer:** `backend/app/ise/network_devices.py`, `backend/app/api/custom_attributes.py`

`_load_all()` byggede kun `_by_ip`-dict (keyet på IP). `get_nas_devices_by_platform` itererede kun `_by_ip`, så NAS-devices uden IP-adresse eller med Device Type NDG "All Device Types" (tom type, `device_type=""`, `path=""`) var usynlige. Fix: `_load_all()` populerer nu også `_all_devices: list[DeviceInfo]` (én entry per device, uanset IP). `get_nas_devices_by_platform` itererer `_all_devices` i stedet for `_by_ip`. Devices med ukendt/tom type vises nu under unmatched med navn som label (f.eks. "Router-01 (ukendt type)") i stedet for at blive tabt.

## [5.5.0 build 0416] — 2026-05-18 — docs: 02-INSTALLATION.md opdateret med nvram-oprydning og DVD-afmontering

## [5.5.0 build 0415] — 2026-05-18 — docs: 02-INSTALLATION.md opdateret med OVA-metode, first-boot wizard og ovftool-eksport

## [5.5.0 build 0414] — 2026-05-18 — fix: prepare-ova-base.sh henter first-boot.sh fra GitHub hvis ikke lokalt tilgængelig

## [5.5.0 build 0413] — 2026-05-18 — feat: first-boot wizard oversat til engelsk

## [5.5.0 build 0412] — 2026-05-18 — feat: first-boot wizard viser versionsnummer i banner

## [5.5.0 build 0411] — 2026-05-18 — fix: first-boot bruger systemctl restart networking i stedet for manuel ip-manipulation

## [5.5.0 build 0410] — 2026-05-18 — fix: first-boot fjerner alle default routes og stopper DHCP-klienter inden netværkskonfiguration

## [5.5.0 build 0409] — 2026-05-18 — fix: first-boot netværkskonfiguration bruger ip-kommandoer og tester gateway/internet/DNS separat

## [5.5.0 build 0408] — 2026-05-17 — fix: first-boot wizard forsvandt ikke efter 15 sek — skiftet til auto-login + .bash_profile

Getty og first-boot.service konkurrerede om tty1 og getty vandt efter ~15 sek. Løsning: auto-login som root på tty1 via getty@tty1 override, wizard køres fra /root/.bash_profile i stedet for som systemd service.

## [5.5.0 build 0407] — 2026-05-17 — fix: prepare-ova-base.sh kører fuld OS-opdatering inden eksport

## [5.5.0 build 0406] — 2026-05-17 — feat: OVA first-boot wizard (netværk, hostname, root-password, auto-install)

Tilføjet tre nye deploy-filer til OVA-distribution:
- `deploy/first-boot.sh`: interaktiv wizard der ved første boot spørger om hostname, statisk IP, subnet, gateway, DNS og root-adgangskode, tester internetforbindelsen og kører install.sh automatisk
- `deploy/first-boot.service`: systemd oneshot-service der kører wizarden på /dev/tty1 ved første boot og deaktiverer sig selv bagefter
- `deploy/prepare-ova-base.sh`: klargøringsscript der køres på base-VM inden OVA-eksport — installerer first-boot, open-vm-tools, rydder machine-id/SSH-keys/logs og sætter netværk til DHCP

## [5.5.0 build 0405] — 2026-05-17 — fix: install.sh pipe-kompatibilitet (read /dev/tty) og PATH inkluderer /usr/sbin

Rettet to fejl ved kørsel via wget|bash:
- `read` læser nu fra /dev/tty i stedet for stdin så nginx-prompt virker korrekt ved pipe-kørsel
- PATH udvides med /usr/sbin så nginx og andre sbin-kommandoer findes ved su/pipe-kørsel

## [5.5.0 build 0404] — 2026-05-17 — fix: install.sh deaktiverer automatisk CD-ROM apt-kilde ved fresh DVD-installation

## [5.5.0 build 0403] — 2026-05-17 — fix: install.sh viser wget-alternativ når curl ikke er installeret

## [5.5.0 build 0402] — 2026-05-17 — feat: distributions-installationsscript og deploy-filer til Debian/Ubuntu

Tilføjet tre nye filer til nem distribution og installation på fresh Debian/Ubuntu server:
- `install.sh`: Komplet bash-installationsscript der håndterer Python-tjek/installation, system-bruger oprettelse, git-klon/opdatering, venv-setup, rettigheder, systemd-service og valgfri nginx-opsætning
- `deploy/hypervision.service`: Systemd service unit med User=hypervision, sikkerhedshærdning (NoNewPrivileges, PrivateTmp, ProtectSystem), Restart=always
- `deploy/nginx-hypervision.conf`: Nginx reverse proxy med HTTP→HTTPS redirect, TLS-pladsholdere til certbot, SSE-understøttelse (proxy_buffering off)

Brug: `curl -fsSL https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/main/install.sh | bash`

## [5.5.0 build 0401] — 2026-05-17 — feat: licensfooter i sidebar med copyright, email og AGPL v3-link

Tilføjet diskret footer nederst i sidebaren på alle sider:
- © 2026 Jan Green Larsen (klikbar mailto: hypervision@laces.dk)
- GitHub-link til kildekode
- AGPL v3-link til licenstekst

- `frontend/index.html` — `.portal-license`-div med links
- `frontend/css/styles.css` — `.portal-license`, `.portal-license-links` styling

## [5.5.0 build 0400] — 2026-05-17 — test: opdateringstest af fetch + reset --hard mekanisme

## [5.5.0 build 0399] — 2026-05-17 — fix: git pull erstattet med fetch + reset --hard

`git pull` fejler med "local changes would be overwritten" på produktionsserveren
fordi serveren aldrig laver egne commits. Fix: `_git_pull_sync()` bruger nu
`git fetch origin <branch>` + `git reset --hard origin/<branch>` — matcher
remote præcist uden merge-konflikter. Gitignored filer (config, logs, cache) berøres ikke.

- `backend/app/services/update_service.py` — fetch + reset --hard i stedet for pull

## [5.5.0 build 0398] — 2026-05-17 — fix: GitHub-tjek bypasser nu altid cache (force refresh)

"Tjek GitHub"-knappen sendte cached resultat selvom GitHub var opdateret.
Fix: API-endpointet sender `force=True` til `check_github_version()` — cachen
bruges kun af passive/automatiske opslag, aldrig ved aktiv knap-klik.

- `backend/app/api/update.py` — `github_check` sender `force=True`
- `backend/app/services/update_service.py` — `check_github_version(force=False)` parameter

## [5.5.0 build 0397] — 2026-05-17 — feat: GitHub-opdatering kan følge dev- eller main-branch

Admin kan nu vælge om portalen skal tjekke og hente fra `main` (stabil) eller `dev` (udviklingsversion) via en checkbox i Settings → GitHub-opdatering.

- `backend/app/core/config.py` — ny setting `github_branch` (default: "main")
- `backend/app/services/update_service.py` — branch-aware URL og git pull; cache invalideres ved branch-skift; `branch` returneres i check-respons
- `frontend/js/views/settings/section-update.js` — checkbox med gem-on-toggle + badge på seneste version
- `frontend/js/views/settings.js` — HTML til checkbox + hint + result-element
- `frontend/js/i18n.js` — DA + EN strings (gh_dev_branch_lbl/hint/saved)
- `frontend/css/styles.css` — `.gh-branch-badge`, `.gh-branch-main`, `.gh-branch-dev`

## [5.5.0 build 0396] — 2026-05-17 — fix: HSTS header + camera Permissions-Policy

- `backend/app/main.py` — `Permissions-Policy: camera=()` → `camera=(self)` (barcode-scanner i register-view kræver kameraadgang)
- `backend/app/main.py` — tilføjet `Strict-Transport-Security: max-age=31536000; includeSubDomains` (HSTS til TLS-deployments)

## [5.5.0 build 0395] — 2026-05-17 — docs: opdater install guide med git system-wide safe.directory og public repo

Tilføjet GNU Affero General Public License v3 (LICENSE-fil hentet fra gnu.org).
SPDX-identifier headers (`AGPL-3.0-or-later`) og copyright-notice (`Jan Green Larsen <jgl@laces.dk>`) tilføjet til alle 91 Python-filer, 39 JS-filer, index.html og styles.css.
README opdateret med license-badge og copyright-linje.

- `LICENSE` — ny fil (AGPL v3 fuldt licenstekst)
- `backend/app/**/*.py` — SPDX-header prepended (91 filer)
- `frontend/js/**/*.js` — SPDX-header prepended (39 filer)
- `frontend/index.html` — HTML-kommentar med SPDX + copyright
- `frontend/css/styles.css` — CSS-kommentar med SPDX + copyright
- `README.md` — license-badge + copyright-linje
- `version.json` — bump build 0393 → 0394

## [5.5.0 build 0393] — 2026-05-17 — feat: GitHub opdateringschek og git pull direkte fra portal

Admin kan nu tjekke om der er en ny version på GitHub og hente opdateringen direkte via git — uden at SSH til serveren.

- **Backend** (`update_service.py`): `check_github_version()` — henter `version.json` fra GitHub raw URL, sammenligner build-numre, cacher i 1 time. `git_pull()` — kører `git pull origin main` i projektroden via subprocess. `_is_git_repo()` — detekterer om serveren er et git-repo.
- **API** (`api/update.py`): `GET /api/update/github-check` og `POST /api/update/github-pull` (kun admin).
- **Frontend** (`section-update.js`): ny `initGithubUpdateSection()` — "Tjek for opdatering"-knap viser installeret vs. seneste version; "Hent og installer"-knap kører git pull og viser output; restart-knap er stadig tilgængelig bagefter.
- **Settings HTML** (`settings.js`): nyt GitHub-opdatering-kort under pc-update subtab.
- **CSS** (`styles.css`): `.gh-version-table` og `.gh-pull-output` styling.
- **i18n** (`i18n.js`): DA + EN strings for alle GitHub-opdatering UI-elementer.
- **api.js**: `githubCheck()` og `githubPull()` metoder.

**Berørte filer:** `backend/app/services/update_service.py`, `backend/app/api/update.py`, `frontend/js/views/settings/section-update.js`, `frontend/js/views/settings.js`, `frontend/js/i18n.js`, `frontend/js/api.js`, `frontend/css/styles.css`

## [5.4.0-P1 build 0392] — 2026-05-17 — docs: README opdateret med nye funktioner og sikkerheds-patch

Version bump til 5.4.0-P1. Tilfoejede: sammenfoldet regeliste, RADIUS-parameter prompt,
profilerings-data viewer, Sikkerheds-patch 1-sektion, GitHub-opdateringschek-bullet.

**Berørte filer:** `README.md`

## [5.4.0-P1 build 0391] — 2026-05-17 — docs: Linux-server GitHub-deploy guide i 02-INSTALLATION.md

Tilføjet sektion "Linux-server: opsætning af GitHub-deploy" med:
- git init + safe.directory + remote opsætning
- GitHub-autentificering: PAT (hurtigst) og SSH-nøgle (anbefalet til prod)
- credential.helper store for PAT
- git reset --hard origin/main workflow
- Fremtidige deploys: git pull + systemctl restart
- Sikkerhedsnotat om auth_secret.key chmod 600

**Berørte filer:** `docs/02-INSTALLATION.md`

## [5.4.0-P1 build 0390] — 2026-05-17 — fix: auth_secret.key check crash mid-request

`sys.exit(1)` inde i en aktiv Starlette ASGI-request-handler sprænger TaskGroup og
crasher hele portalen (SystemExit i BaseHTTPMiddleware → "No response returned").

To rettelser:
1. `sys.exit` → `os._exit(1)` i `_check_secret_file_permissions` — bypasser Python
   cleanup og er sikker fra async-kontekst.
2. Eager `_auth_core._secret()` kald i `main.py` lifespan startup — checket sker ved
   opstart (ikke mid-request) så portalen afbrydes rent inden den begynder at serve.

**På serveren (hurtig fix):**
```
chmod 600 /opt/hypervision/backend/auth_secret.key
systemctl restart hypervision
```

**Berørte filer:** `backend/app/core/auth.py`, `backend/app/main.py`

## [5.4.0-P1 build 0389] — 2026-05-17 — sec: Sikkerheds-patch 1 (fortsat) — SEC-5/6/9/10/11/12

- **SEC-5** (`config.py` + `client.py`): Ny `ise_ca_bundle`-indstilling — sti til ISE root-CA PEM. `verify=ise_ca_bundle or ise_verify_tls` i httpx-klienten.
- **SEC-6** (`settings_store.py` + `auth_config_store.py`): `chmod 600` på `config.json` og `auth_config.json` efter skrivning (Unix).
- **SEC-9** (`config.py` + `rate_limiter.py`): Ny `trusted_proxy_ips`-liste — X-Forwarded-For bruges kun til rate limiting når request-IP er i listen.
- **SEC-10** (`auth.py` + `auth.js` + `app.js` + `api.js` + `api/auth.py`): Token TTL reduceret 8h → 1h. Ny `POST /api/auth/refresh`. Silent refresh timer hvert minut — refresh ved < 5 min til udløb.
- **SEC-11** (`user_service.py`): Password-styrke-validator — min 10 tegn, mindst ét stort bogstav, ét lille bogstav, ét tal. Gælder ved oprettelse og password-skift.
- **SEC-12** (`schemas/policy.py` + `api/policy.py`): `EndpointMatchRequest` Pydantic-schema erstatter fri `dict` på `/match`-endpoint.

**Berørte filer:** `backend/app/core/config.py`, `backend/app/ise/client.py`, `backend/app/core/settings_store.py`, `backend/app/core/auth_config_store.py`, `backend/app/core/rate_limiter.py`, `backend/app/core/auth.py`, `backend/app/api/auth.py`, `backend/app/services/user_service.py`, `backend/app/schemas/policy.py`, `backend/app/api/policy.py`, `frontend/js/auth.js`, `frontend/js/api.js`, `frontend/js/app.js`

## [5.4.0-P1 build 0388] — 2026-05-17 — sec: Sikkerheds-patch 1 — SEC-1/2/3/4/7/8

Implementeret seks sikkerhedsforbedringer identificeret i to-fase sikkerhedsanalysen:

- **SEC-1** (`auth.py`): Startup-check af `auth_secret.key` filrettigheder; `sys.exit(1)` hvis world-readable på Unix; `chmod 600` ved oprettelse.
- **SEC-2** (`main.py`): `SecurityHeadersMiddleware` — X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-XSS-Protection, Permissions-Policy, Content-Security-Policy.
- **SEC-3** (8 frontend-filer): Alle `err.message`-interpolationer i `innerHTML` wrappes med `esc()` / inline-escape for at forhindre reflekteret XSS.
- **SEC-4** (`user_service.py`): Per-bruger sliding-window lockout — 5 fejl inden for 10 min → 15 min lockout; returnerer HTTP 429.
- **SEC-7** (`audit_store.py` + `user_service.py`): Login-success og login-failed events registreres nu i audit-db via ny `record_sync()` funktion.
- **SEC-8** (`main.py`): CORS strammet — `allow_methods` og `allow_headers` begrænset til eksplicitte lister.

**Berørte filer:** `backend/app/core/auth.py`, `backend/app/main.py`, `backend/app/services/user_service.py`, `backend/app/core/audit_store.py`, `frontend/js/app.js`, `frontend/js/views/attributes.js`, `frontend/js/views/browse-detail.js`, `frontend/js/views/browse-table.js`, `frontend/js/views/browse-filter.js`, `frontend/js/views/browse-bulk.js`, `frontend/js/views/import.js`, `frontend/js/views/metrics.js`

## [5.4.8 build 0387] — 2026-05-17 — docs: Ny reports/-mappe med sikkerheds- og systemrapporter

Oprettet `reports/`-mappe. Flyttet `SYSTEM_DESCRIPTION.md` og tilføjet
`SECURITY_ANALYSIS.md` (to-fase sikkerheds- og funktionsanalyse med
13 fund og Top-10 handlingsliste).

## [5.4.8 build 0386] — 2026-05-17 — ux: Omdøb side-menu punkter med prefix-kategori

Register → Endpoint Register, Import → Endpoint Import, Browse → Endpoint Browse/Edit,
Attributes → Endpoint Attributes, DACLs → Endpoint DACLs,
Monitoring → Portal Monitoring, Settings → Portal Settings.
Opdateret i begge sprog (DA + EN).

**Berørte filer:** `frontend/js/i18n.js`

## [5.4.8 build 0385] — 2026-05-17 — docs: SYSTEM_DESCRIPTION.md tilføjet

Ny fil `SYSTEM_DESCRIPTION.md` med komplet beskrivelse af systemets formål,
brugerroller og alle 11 funktionsområder samt teknisk arkitektur-oversigt.

## [5.4.8 build 0384] — 2026-05-17 — feat: Policy-regler foldet sammen som liste — klik for at åbne

Reglerne under en policy set vises nu som en kompakt liste (kun rank + navn + state).
Klik på en regel folder den ud inline og viser conditions + profiles.
Klik igen kollapser den. Kun én regel er udfoldet ad gangen.
Højre panel (editor) åbner som før ved udvidelse.

**Berørte filer:**
- `frontend/js/views/policy.js` — `renderRuleCard()` og `wireRuleCards()` omskrevet
- `frontend/css/styles.css` — `.pol-rule-expand`, `.pol-rule-chevron` styles

## [5.4.7 build 0383] — 2026-05-17 — feat: Simulate match spørger efter RADIUS-parametre

Simulator viser nu hvilke RADIUS-attributter (`Radius.*`) der indgår i reglerne
og promper brugeren for at udfylde dem — så RADIUS-conditions evalueres præcist
frem for altid at blive skippet.

**Flow:**
1. Første simulate returnerer match-resultat + `radius_attrs_needed: [...]` —
   alle RADIUS-attributter der bruges på tværs af alle regler, minus dem der
   allerede er angivet.
2. Frontend viser et kompakt input-panel med et felt per RADIUS-attribut.
3. Bruger udfylder (f.eks. `Called-Station-ID = hus-ap:802`) og klikker
   "Præciser match" → ny simulate med `{ endpoint_id, radius_attrs: {...} }`.
4. Backend evaluerer nu RADIUS-conditions ordentligt og vælger præcis den regel
   ISE ville matche.

**Berørte filer:**
- `backend/app/schemas/policy.py` — nyt felt `radius_attrs_needed`
- `backend/app/services/policy_service.py` — `Radius` fjernet fra `_UNEVALUABLE_DICTS`,
  ny `_collect_radius_attrs()`, `_get_ep_value` håndterer Radius-dict,
  `_inject()` tilføjer `radius_attrs_needed` til alle returneringer
- `frontend/js/views/browse-detail.js` — `runSimulate()` abstraherer simulate-loop,
  ny `renderRadiusPrompt()`, "Præciser match"-knap re-simulerer med RADIUS-værdier
- `frontend/css/styles.css` — `.radius-prompt` styles

## [5.4.6 build 0382] — 2026-05-17 — fix: Simulate match henter live endpoint-data fra ISE ERS

Rodårsag til alle tidligere simulate-match-fejl: frontend sendte formularværdier
som basis for simuleringen — stale group_name, stale custom attributes, alt hvad
der sidst var gemt i HTML-formularen, ikke hvad ISE faktisk har.

**Løsning:**
- `collectEndpointAttrs()` sender nu kun `{ endpoint_id: <id> }` til backend.
- Backend `match_endpoint()`: hvis `endpoint_id` er sat, henter den ALLE
  endpoint-attributter live fra ISE ERS (`IseEndpointRepository.get()`) og
  resolver group_name til fuld hierarkisk sti via `IseEndpointGroupRepository.list_all()`.
- Simulationen er nu 100% baseret på hvad ISE ser for den pågældende endpoint.

**Berørte filer:**
- `frontend/js/views/browse-detail.js` — `collectEndpointAttrs()` simplificeret
- `backend/app/services/policy_service.py` — ny `_fetch_ep_from_ise()` + logik i `match_endpoint()`

## [5.4.5 build 0381] — 2026-05-17 — fix: Simulate match — robust group-matching + korrekt OR-score

To yderligere fejl i match-simulatoren:

1. **IdentityGroup fallback for korte navne** — Hvis backend ikke er genstartet efter gruppe-fix,
   kan `group_name` være et kortnavnet ("ADM-Apple-iPhone" uden prefix). `_eval_identity_group`
   matcher nu også hvis `rule_val` ender med `":<ep_val>"` (suffix-fallback), så reglen stadig
   matcher selv med stale cache-data.

2. **OR-blok dobbelttælling** — OR-regler (sub-rules) tæller evaluable conditions fra ALLE grene,
   hvilket kunstigt oppuster scoren (PSK_Mode tælt 2× for 2 sub-rules). Fix: scorer kun fra
   `global_conds + bedste sub-rule` (den gren med flest matches).

**Berørte filer:** `backend/app/services/policy_service.py`

---

## [5.4.5 build 0380] — 2026-05-17 — fix: Simulate match — specificitetbaseret valg af partial matches

Stop-ved-første-match valgte regel 2 "SSID 802 PSK Mode" (rank 2, 1 evaluable + 2 Radius-skipped)
frem for den korrekte regel med 5 evaluable betingelser (Owner, Type, Lokation, PlatformType,
IdentityGroup + 1 Radius-skipped). Ny tre-kategori match-strategi:

a) **No-condition (Default/catch-all)** → bruges kun som absolut sidste udvej.
b) **Definitivt match** (alle conditions evaluable, alle passer) → returner straks (ISE-semantik).
c) **Partial match** → vælg den med FLEST evaluable betingelser der faktisk passer.
   Uafgjort brydes af laveste rank (ISE prioritetsrækkefølge).

**Berørte filer:** `backend/app/services/policy_service.py`

---

## [5.4.5 build 0379] — 2026-05-17 — revert: to-pass strategi fjernet — Default-regel altid vandt

To-pass strategien fra build 0378 var forkert: Default-reglen (ingen betingelse) er altid et
"definitivt match" (ingen skipped conditions) → simulatoren sprang alle regler over og landede
altid på Default med DenyAccess. Tilbagerullet til stop-ved-første-match, som er korrekt
semantisk — ConditionReference behandles som "benefit of doubt = True" og markeres som partial.

**Berørte filer:** `backend/app/services/policy_service.py`

---

## [5.4.5 build 0378] — 2026-05-17 — fix: Simulate match — to-pass strategi + korrekt regelsortering

**To fejl rettet:**

1. **ConditionReference stopper simulatoren for tidligt** — `match_endpoint` returnerede ved første
   `matched=True`, inkl. partial matches (ConditionReference = benefit-of-doubt True). En regel tidligt
   i listen med `ConditionReference(Wireless_MAB) AND IdentityGroup(X)` rapporteres som "muligt match"
   selvom ISE ville fejle den (Wireless_MAB=False ved runtime) og gå videre til en anden regel.
   Fix: to-pass strategi — fortsætter forbi partial matches, returnerer første **definitive** match;
   falder tilbage til første partial match kun hvis ingen definitiv match findes.

2. **Regelsortering søgte rank på forkert niveau** — `r.get("rank", 0)` søgte på wrapper-objektet
   `{"rule":{...}, "profile":[...]}` i stedet for inde i `r["rule"]`. Alle regler fik sort-key `0`.
   Fix: `(r.get("rule") or r).get("rank", 0)`.

**Berørte filer:** `backend/app/services/policy_service.py`, `backend/app/ise/policy.py`

---

## [5.4.5 build 0377] — 2026-05-17 — fix: Simulate match — ISE hierarkisk IdentityGroup equals implementeret

ISE's `IdentityGroup.Name equals "Endpoint Identity Groups:Profiled"` matcher **alle** endpoints
i Profiled og undergrupper (hierarkisk). Simulatoren brugte simpel string-equal → endpoints i
`"...Profiled:ADM-Apple-iPhone"` matchede aldrig regler skrevet mod `"...Profiled"`.

Fix: ny `_eval_identity_group()` bruger prefix-tjek `ep.startswith(rule + ":")` for `equals`/`notEquals`.
`_eval_condition` kalder denne i stedet for `_eval_operator` når `dictionaryName == "IdentityGroup"`.

**Berørte filer:** `backend/app/services/policy_service.py`

---

## [5.4.5 build 0376] — 2026-05-17 — chore: version bump til 5.4.5

---

## [5.4.4 build 0375] — 2026-05-17 — fix: Simulate match brugte kortnavnet som group_name — ISE-sammenligning fejlede

`collectEndpointAttrs()` sendte kortnavnet (`"ADM-Apple-iPhone"`) som `group_name` fordi den læste
`.selectedOptions[0].text` fra `#d-group`. Backend `_get_ep_value` sammenlignede med ISE-regelens
fulde condition-value (`"Endpoint Identity Groups:Profiled:ADM-Apple-iPhone"`) — `equals` fejlede
altid og simulator rapporterede "ingen match" selvom reglen faktisk ville ramme.
Fix: lookup i `state.groups` via gruppe-ID → fuld ISE-sti.

**Berørte filer:** `frontend/js/views/browse-detail.js`

---

## [5.4.4 build 0374] — 2026-05-17 — fix: Identity Group-condition i RADIUS-wizard fik forkert sti (manglede mellemled)

Wizard-koden brugte `.selectedOptions[0].text` (display-teksten = kortnavnet `"ADM-Apple-iPhone"`) til at
pre-fylde IdentityGroup-condition. `normalizeIdentityGroupValue` prefixede kun med `"Endpoint Identity Groups:"`,
så mellemniveauet (f.eks. `"Profiled"`) forsvandt → `"Endpoint Identity Groups:ADM-Apple-iPhone"`.
Fix: lookup gruppen i `state.groups` via `g.id` og brug den fulde sti direkte.

**Berørte filer:** `frontend/js/views/browse-detail.js`

---

## [5.4.4 build 0373] — 2026-05-17 — fix: Identity Group-dropdown viste alt fladt — backend bygger nu fulde stier via parentId

ISE ERS `/ers/config/endpointgroup` list-respons returnerer kun korte navne
(`"Profiled"`, `"ADM-Apple-iPhone"`) — ingen parent-info. Fix:

`IseEndpointGroupRepository.list_all()` udfører nu:
1. Henter alle gruppe-summaries (pagineret som før)
2. GET'er hvert gruppe individuelt i parallel (sem=8) for at hente `parentId`
3. Bygger fuld hierarkisk sti rekursivt via parent-kæden:
   `ADM-Apple-iPhone` → `Endpoint Identity Groups:Profiled:ADM-Apple-iPhone`

`_fetch_groups()` i service bruger nu `_full_path` fra listen.
Frontend-kode (optgroup-logik) var allerede korrekt — problemet var manglende path.

Berørte filer: `backend/app/ise/endpoints.py`, `backend/app/services/endpoint_service.py`, `version.json`

---

## [5.4.4 build 0372] — 2026-05-17 — feat: Hierarkisk Identity Group-dropdown overalt

Alle steder der viser ISE endpoint-grupper bruger nu hierarkiske optgroups:
- **Root-optgroup** "Endpoint Identity Groups" — direkte børn (Blocked List, GuestEndpoints, Profiled, …)
- **Sub-optgroup** "↳ Profiled" — under-grupper (ADM-Apple-iPhone, Android, Apple-Device, …)
- Fuld ISE-sti bruges som `value` (korrekt til API-kald), kort navn vises som display-tekst

Ny delt hjælpefunktion `groupHierarchyOptionsHtml(groups, selId, emptyLabel?)` i `browse-utils.js`.
Bruges i: browse-tabel inline-edit, endpoint detail-modal, policy condition-builder,
registrer-formular og skabeloner-sektion i settings.

Berørte filer: `frontend/js/views/browse-utils.js`, `browse-table.js`,
`policy-condition-builder.js`, `register.js`, `settings/section-templates.js`, `FEATURES.md`

---

## [5.4.3 build 0371] — 2026-05-17 — fix: Detail modal fanepanel viste ingen indhold (flex height bug)

`max-height` → `height: 92vh` på `.modal.detail-modal` så `flex: 1 1 0` på
fanepanelcontaineren fungerer korrekt og indholdet er synligt.

**Berørte filer:** `frontend/css/styles.css`, `BUGS.md`, `version.json`

---

## [5.4.3 build 0370] — 2026-05-17 — feat: Endpoint detail modal konverteret til fane-layout

Detail-modal bruger nu tre faner i stedet for scrollende accordions:
- **Endpoint** — alle redigerbare felter + ANC-sektion
- **RADIUS** — policy match-simulator + regel-wizard (lazy-loaded ved første faneskift)
- **Profil & IDs** — Profileringsdata + ISE IDs & Profil (begge lazy-loaded ved første faneskift)

Modal-actions (Gem/Disconnect/Luk) er altid synlige under fanepanelet uden scroll.
Modal er bredere (800px) og bruger `flex-column` med scrollbart fanepanel.

Berørte filer: `frontend/js/views/browse.js`, `frontend/js/views/browse-detail.js`,
`frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

---

## [5.4.3 build 0369] — 2026-05-17 — feat: Endpoint detail — ny "ISE IDs & Profil" accordion-sektion

Ny collapsible sektion i endpoint detail-modal. Viser ved åbning:
- **ISE Identifikatorer**: Endpoint ID og Profile ID i monospace
- **Profilerprofile Definition**: lazy-loadet fra ny backend-route der kalder ISE ERS `GET /ers/config/profilerprofile/{profileId}` — viser profil-navn, beskrivelse, Min. Certainty Factor, system-defineret flag, exception action og øvrige felter fra ISE. Sektionen nulstilles ved lukning af modal så næste endpoint lazy-loader frisk.

**Berørte filer**: `backend/app/api/endpoints.py` (+GET /{id}/profiler-profile), `frontend/js/api.js` (+getProfilerProfile), `frontend/js/views/browse.js` (HTML-sektion), `frontend/js/views/browse-detail.js` (toggle + _renderProfilerProfile + closeDetail reset), `frontend/js/i18n.js` (+15 nøgler DA/EN), `FEATURES.md`, `version.json`

## [5.4.2 build 0368] — 2026-05-17 — feat: IdentityGroup:Name dropdown bruger optgroup — præfiks øverst, korte navne herunder

Dropdown til IdentityGroup:Name-conditions renderes nu med `<optgroup label="Endpoint Identity Groups">` som header. Hver option viser kun det korte gruppenavn (fx "Profiled", "Blacklist") mens den fulde sti stadig er option-værdien bag scenen — matching og gemning virker uændret. Lettere at overskue og skelne identity groups.

**Berørte filer**: `frontend/js/views/policy-condition-builder.js` (valueWidgetHtml optgroup-gren for IdentityGroup:Name), `version.json`

## [5.4.2 build 0367] — 2026-05-17 — fix: IdentityGroup condition-dropdown viser korrekt valgt gruppe ved re-edit

`listGroups()` returnerer korte navne ("Profiled") men gemte condition-værdier er fulde stier ("Endpoint Identity Groups:Profiled"). `caValues.__IdentityGroup_Name__` præfikses nu med "Endpoint Identity Groups:" ved indlæsning, så dropdown kan matche den gemte værdi og forvælge den korrekt — i stedet for at falde tilbage til "--- select ---".

**Berørte filer**: `frontend/js/views/policy.js` (listGroups map + præfiks), `version.json`

## [5.4.2 build 0366] — 2026-05-17 — fix: Politik condition-editor bredere layout + fjern "Other" for IdentityGroup:Name

Policy-sideens max-width øget fra 1100px til 1600px så condition-rækker ikke er klemt. Feltbredder øget: Dictionary 120→150px, Attribut 120→140px, Operator 110→120px — fuld tekst synlig uden afskæring. "Other"-option fjernet fra værdidropdown specifikt for `IdentityGroup:Name` da man altid skal vælge fra listen; reglen fra b0364 om auto-præfiks bevares som sikkerhedsnet.

**Berørte filer**: `frontend/css/styles.css` (.pol-inner max-width, .cond-dict/.cond-attr/.cond-op bredder), `frontend/js/views/policy-condition-builder.js` (allowCustom-guard i valueWidgetHtml), `version.json`

## [5.4.2 build 0365] — 2026-05-17 — chore: Version bump til 5.4.2

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.4.1 build 0364] — 2026-05-17 — fix: Politik condition-builder auto-præfikser IdentityGroup:Name med "Endpoint Identity Groups:"

Når man tilføjer eller redigerer en betingelse med `IdentityGroup:Name` i politik-editoren, præfikses værdien nu automatisk med `Endpoint Identity Groups:` hvis præfikset mangler. Gælder for: (1) blur på tekstfelt — feltet opdateres live så brugeren ser den fulde sti; (2) read/save — sikkerhedsnet ved gemning. Forhindrer stille-og-roligt virkningsløse betingelser (fx `equals Profiled` → matches aldrig; `equals Endpoint Identity Groups:Profiled` → matcher hierarkisk).

**Berørte filer**: `frontend/js/views/policy-condition-builder.js` (normalizeIdentityGroupValue, _readRow, readCondRows, _bindRowChangeEvents blur-handler), `version.json`

## [5.4.1 build 0363] — 2026-05-17 — feat: Auth-status som sortérbar kolonneheader i Browse

"Status" er nu en rigtig kolonne i tabel-headeren (placeret efter MAC). Klik på "Status" i kolonnenavnrækken for at sortere: auth-endpoints øverst (↑) eller sidst (↓), med tredje klik nulstiller sortering. Filtrerings-dropdown (Alle/Auth/Ikke auth) er flyttet til denne kolonnes filter-celle. Kolonnen viser ●/○-indikator i grøn/rød baggrundsfarve svarende til MAC-cellens farver. Kolonnens synlighed styres via Kolonner-menuen. Sort-logik bruger `activeSessionMacs` ligesom MAC-cellefarverne.

**Berørte filer**: `frontend/js/views/browse-utils.js` (+auth_status kolonne), `frontend/js/views/browse-table.js` (celle + applyAuthStatusColors), `frontend/js/views/browse-filter.js` (auth_status sort-case), `frontend/js/views/browse.js` (filter-celle template), `frontend/js/i18n.js` (+col.auth_status DA/EN), `frontend/css/styles.css` (.auth-status-col + oprydning), `version.json`

## [5.4.1 build 0362] — 2026-05-17 — fix: Auth-status filter — i18n tekster + Status-label over dropdown

Dropdown-optionerne ("Alle"/"All", "Auth", "Ikke auth"/"Not auth") og label over feltet ("Status") bruger nu i18n-systemet via `t()`. Label vises som lille tekst over dropdown'en i MAC-filtercelleen.

**Berørte filer**: `frontend/js/i18n.js` (+4 nøgler DA/EN), `frontend/js/views/browse.js` (t()-kald + .auth-status-wrap/.auth-status-label), `frontend/css/styles.css` (.auth-status-wrap, .auth-status-label, dark/midnight), `version.json`

## [5.4.1 build 0361] — 2026-05-17 — feat: Auth-status filter i MAC-søgefelt (Browse)

Dropdown ved siden af MAC regex-søgefeltet giver mulighed for at filtrere endpoints på auth-status: "Alle" (default), "Auth" (kun endpoints med aktiv RADIUS-session, grøn) og "Ikke auth" (endpoints uden aktiv session, rød). Filteret kombineres frit med regex-søgning og indgår i filter-persistens og saved views. Dropdown vises compakt i MAC-filtercelleen og understøtter dark/midnight-temaer.

**Berørte filer**: `frontend/js/views/browse.js` (MAC filter-celle template), `frontend/js/views/browse-filter.js` (authStatusSelect logik, snapshot/restore, needsFilterMode, applyFiltersToRows), `frontend/css/styles.css` (.mac-filter-wrap, .auth-status-select, dark/midnight themes), `version.json`

## [5.4.0 build 0360] — 2026-05-17 — feat: Profileringsdata-viewer i endpoint detail-modal

Ny "Profileringsdata" accordion-sektion i endpoint detail-modal. Klik ▶ Vis for at se alle probe-attributter ISE har indsamlet om et endpoint (DHCP, HTTP/User-Agent, MDM, netværk, profiler-assignment og andre). Data lazy-loades fra ISE Open API `GET /api/v1/endpoint/{id}` ved første åbning — attributter er organiseret i navngivne kategorier. Nulstilles automatisk ved lukning af modal.

**Berørte filer**: `backend/app/ise/profiling.py` (ny), `backend/app/api/endpoints.py` (+route GET /endpoints/{id}/profiling-data), `frontend/js/api.js`, `frontend/js/views/browse.js`, `frontend/js/views/browse-detail.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

## [5.3.41 build 0358] — 2026-05-16 — feat: Browse-tabel header fastgjort ved scroll

**Berørte filer**: `frontend/css/styles.css`, `frontend/js/views/browse.js`, `version.json`

- `.browse-table-wrap` får `overflow-y: auto` + JS-beregnet `height` (viewport minus toolbar/pagination-bar/margin). Tabellens indhold scroller inden i wrappers; toolbar og pagination forbliver synlige.
- `thead th` sættes til `position: sticky; top: 0; z-index: 9` — begge rækker (kolonnenavne + filterinput) sidder fast.
- `box-shadow: 0 1px 0` giver en tydelig linje under den fastgjorte header.
- Dark/midnight-tema: korrekte baggrunds- og shadow-farver.
- `fitStickyTable()` genberegnes automatisk ved `window.resize` og ryddes op via MutationObserver når viewet unmountes.

## [5.3.40 build 0357] — 2026-05-16 — feat: Simulate match opdeler OR-grene som sub-rules med profiler per gren

**Berørte filer**: `backend/app/schemas/policy.py`, `backend/app/services/policy_service.py`, `frontend/js/views/browse-detail.js`, `frontend/css/styles.css`, `version.json`

- Ny `SubRuleGroup` model i `schemas/policy.py` + `sub_rules: list[SubRuleGroup]` felt på `PolicyMatchResult`.
- Ny `_split_into_subrules()` i `policy_service.py`: detekterer top-level `ConditionOrBlock` (eller som direkte barn af top-level AND). Hvert OR-barn evalueres separat og returneres som `SubRuleGroup`. AND-betingelser udenfor OR-blokken forbliver i `condition_details` (global).
- `match_endpoint` bruger nu `_split_into_subrules` og sætter `sub_rules` på resultatet.
- Frontend `renderMatchResult`: ved `sub_rules.length > 1` vises grupperet visning: global ✓-betingelser øverst, note om antal skippede, derefter et kort per sub-rule med egne betingelser + "Authz Profiles:" i bunden af hvert kort.
- CSS: `.match-subrule` (gul venstrekant, subtil baggrund), `.match-subrule-label` (fed label) inkl. dark-theme.

## [5.3.39 build 0356] — 2026-05-16 — feat: Simulate match viser ukendte RADIUS-betingelser enkeltvist

**Berørte filer**: `frontend/js/views/browse-detail.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

- Skippede betingelser (RADIUS/reference) vises nu én pr. linje som `? Radius.Dict.Attribut operator <value>` i stedet for blot tælle dem.
- Ny CSS: `.match-skip` (orange/gul), `.match-cond-op` (grå operator), `.match-cond-ref` (kursiv reference).
- Overskriften ændret til "Følgende N betingelse(r) kræver live RADIUS-session for komplet match:".
- Reference-betingelser (`[navn]`) vises som kursiv tekst uden operator/value.

## [5.3.38 build 0354] — 2026-05-16 — feat: Session-kolonne profil-kontekst — WLC ACL, PSK-nøgle og DACL vist inline

**Berørte filer**: `frontend/js/views/browse-table.js`, `version.json`

- `Endpoint_AirSpaceACL` → `Endpoint_AirSpaceACL:[authz_acl]` — WLC ACL-værdi fra endpointets `authz_acl` felt.
- `Endpoint_PSK-KEY` → `Endpoint_PSK-KEY:***` (maskeret) eller `Endpoint_PSK-KEY:[nøgle]` (klartekst) afhængigt af om "PSK Key"-kolonnen viser nøgler (`state.pskShowKey`).
- `Endpoint_DACL` → `Endpoint_DACL:[dacl-navn]` — DACL-navn fra ISE session. Separat DACL-badge vises ikke hvis profilen allerede viser det.
- `Endpoint_VLAN` → `Endpoint_VLAN:32` (uændret fra v5.3.37).

## [5.3.37 build 0353] — 2026-05-16 — fix: Session-kolonne — fjern Group + Authz-label, VLAN flettes ind i profil-navn, 25% bredere

**Berørte filer**: `frontend/js/views/browse-table.js`, `frontend/css/styles.css`, `version.json`

- Fjernet "Group:" linje (identity_group vises ikke længere i kolonnen).
- Fjernet "Authz:" label — authz-profiler vises nu én pr. linje uden præfix.
- VLAN-nummer flettes ind i profil-navne der indeholder "VLAN": `Endpoint_VLAN` → `Endpoint_VLAN:32`. Separat "VLAN:"-linje fjernet.
- Kolonne-bredde: 150px → 188px (+25%).
- `max-height` på `.ise-sess-combo` hævet til 88px (5 linjer).

## [5.3.36 build 0352] — 2026-05-16 — feat: Threading watchdog timer — tvinger genstart ved hængt asyncio event loop

**Berørte filer**: `backend/app/core/watchdog.py` (ny), `backend/app/main.py`, `version.json`

- Ny `watchdog.py`: daemon-tråd udenfor asyncio event loop overvåger heartbeat-timestamp via `beat()`.
- Hvis heartbeat er ældre end `timeout_s` (default 120s): `logger.critical(...)` + `logging.shutdown()` + `os._exit(1)`.
- Startup grace period: watchdog sover `timeout_s` ved start inden første tjek.
- `main.py`: `start_watchdog(timeout_s=120)` + asyncio `_heartbeat_task` (kalder `watchdog_beat()` hvert 10s) startes i lifespan startup. Task cancelles ved shutdown.

## [5.3.35 build 0351] — 2026-05-16 — chore: Session-kolonne 25% bredere + op til 4 linjer

**Berørte filer**: `frontend/css/styles.css`, `version.json`

- `th/td[data-col="ise_session"]`: 120px → 150px (+25%).
- `.ise-sess-combo`: `max-height: 66px` (≈ 4 × ~15px linjer + gaps), `overflow: hidden`, `vertical-align: top` på `td.ise-session-col`.

## [5.3.34 build 0350] — 2026-05-16 — fix: Simulate match viser ⚠ ved RADIUS-betingelser + authzACL refresh

**Berørte filer**: `backend/app/schemas/policy.py`, `backend/app/services/policy_service.py`, `frontend/js/views/browse-detail.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

- **Simulate match partial_match**: `PolicyMatchResult` har nyt felt `partial_match: bool`. Sættes `True` når den matchede regel har én eller flere skippede (RADIUS/reference) betingelser. Frontend viser gult ⚠ kort "Muligt match" med forklaring i stedet for grønt ✓ — brugeren ser nu tydeligt at matchet IKKE er bekræftet.
- **authzACL refresh**: `openDetail()` henter nu `api.listDacls()` parallelt med `api.listCustomAttributes()` og opdaterer `state.caValues.AuthzACL` — dropdown afspejler nu aktuelle ISE DACLs uden sidgenindlæsning.
- **CSS**: `.match-possible` (gul), `.match-partial-note` badge inkl. dark-theme varianter.

## [5.3.33 build 0349] — 2026-05-16 — fix: Session-kolonne viser auth_method + authz_profiles fra MnT back-fill

**Berørte filer**: `backend/app/ise/mnt_sessions.py`, `backend/app/pxgrid/session_cache.py`, `backend/app/pxgrid/session_worker.py`, `backend/app/schemas/settings.py`, `backend/app/api/pxgrid.py`, `frontend/js/views/browse-table.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

- **Root cause bekræftet**: ISE 3.4 MnT AuthStatus returnerer IKKE `ISEPolicySetName`/`AuthorizationPolicyMatchedRule` for dette deployment. Policy-navne er ISE-interne og ikke tilgængelige via REST.
- **Nye SessionInfo-felter**: `auth_method` (f.eks. "mab") og `identity_group` (f.eks. "ADM-Apple-iPhone") fra AuthStatus.
- **authz_profiles back-fill**: `_enrich_single_from_mnt`/`_enrich_sessions_from_mnt` back-fylder `authz_profiles` fra AuthStatus `selected_azn_profiles` (komma-sep. string) hvis pxGrid-event leverede tomt.
- **VLAN-parsing**: Udtrækkes nu også fra `response` AV-pair (`Tunnel-Private-Group-ID=(tag=N) NN`) som fallback.
- **Session-kolonne**: Viser nu `Auth: MAB` (grønt badge), authz_rule_name ELLER profiler (ikke kun hvis authz_rule_name er tom), DACL, VLAN, SGT, Group.
- **CSS**: Ny `.ise-sess-method` badge-klasse (grøn, light/dark/midnight).

## [5.3.32 build 0348] — 2026-05-16 — feat: real-time MnT trigger ved pxGrid-event + debug endpoint

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `backend/app/pxgrid/client.py`, `backend/app/api/pxgrid.py`, `version.json`

- **Real-time MnT enrichment**: `_handle_message_body` trigger nu `_enrich_single_from_mnt(mac)` som asyncio task ved enhver ny/opdateret pxGrid session der mangler policy_set_name/authz_rule_name. 15s timeout. Logger hvad MnT returnerer.
- **pxGrid native feltudtræk**: `_build_session_info` udtrækker nu `securityGroup`→cts_security_group, `vlan`→vlan, `dacl`→dacl, `endpointProfile`→endpoint_policy direkte fra pxGrid payload (disse felter er spec'et i pxGrid 2.0 og var aldrig udtrukket).
- **Debug endpoint**: `GET /api/pxgrid/sessions/{mac}/debug` (admin) returnerer cached session, alle pxGrid raw-felter, frisk MnT enrichment-resultat og fuld MnT probe.
- **getSessions logging**: Viser nu alle policy-relevante felter (policySetName, authorizationRuleName, securityGroup, vlan, dacl, endpointProfile) fra første session ved reconnect.

## [5.3.31 build 0347] — 2026-05-16 — fix: MnT-data slettes ved STOMP-events + periodisk enrichment

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `backend/app/main.py`, `version.json`, `BUGS.md`, `FEATURES.md`

- **Kritisk bug**: `_handle_message_body` oprettede ny `SessionInfo` med tomme MnT-felter og overskrev `policy_set_name`, `authz_rule_name`, `dacl`, `vlan`, `cts_security_group` ved enhver pxGrid STOMP-event. Fix: merge af MnT-felter fra existing cache-entry inden upsert.
- **Reconcile fix**: `_reconcile_from_pxgrid` bevarede ikke MnT-felter fra existing entry — rettet.
- **Startup enrichment**: Ny `_mnt_enrich_loop()` i `main.py` — 45s delay + hvert 5. min. Sikrer berigelse af disk-cache sessioner uden pxGrid-reconnect.
- **Bredere feltnavn-dækning**: `_build_session_info` prøver `ISEPolicySetName`/`isePolicySetName` + `AuthorizationPolicyMatchedRule` for policy_set_name/authz_rule_name.

## [5.3.30 build 0346] — 2026-05-16 — fix: Session-kolonne Auth/Authz politik-navne + fjern redundant ISE Profil-kolonne

**Berørte filer**: `backend/app/ise/mnt_sessions.py`, `backend/app/pxgrid/session_worker.py`, `frontend/js/views/browse-utils.js`, `frontend/js/views/browse-table.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`, `BUGS.md`, `FEATURES.md`

- **Bug fix**: `fetch_session_by_mac` kaldte kun MnT Session/MACAddress — `policy_set_name`/`authz_rule_name` sidder i MnT **AuthStatus**. Probe brugte forkert URL (manglede `/{seconds}/{records}/{framed}`). Fix: `fetch_session_by_mac` kalder nu BEGGE endpoints parallelt; AuthStatus-URL korrekt til `/3600/25/All`; `_enrich_sessions_from_mnt` popule­rer alle 6 felter inkl. `policy_set_name` + `authz_rule_name`.
- **Enrichment trigger**: udvider fra `not endpoint_policy and not dacl` til at inkludere sessions der mangler `policy_set_name` eller `authz_rule_name`.
- **Fjernet redundant kolonne**: `ise_profile`-kolonnen (b0345) viste samme data som den eksisterende "Profil"-kolonne — fjernet fra `browse-utils.js`, `browse-table.js`, `i18n.js`, `styles.css`.
- **Fix probe URL**: `probe_session_detail` AuthStatus-path rettet med `/3600/25/All` så `GET /api/pxgrid/probe/mnt/{mac}` nu returnerer AuthStatus-data korrekt.

## [5.3.29 build 0345] — 2026-05-15 — feat: ISE Profil-kolonne + MnT-berigelse (DACL, VLAN, SGT)

**Berørte filer**: `backend/app/pxgrid/session_cache.py`, `backend/app/pxgrid/session_worker.py`, `backend/app/ise/mnt_sessions.py`, `backend/app/schemas/settings.py`, `backend/app/api/pxgrid.py`, `frontend/js/views/browse-utils.js`, `frontend/js/views/browse-table.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`, `FEATURES.md`

- Ny **"ISE Profil"-kolonne** i Browse viser ISE Profiler-tildelt policy (`endpoint_policy`) som badge (blå pill).
- **Session-kolonnen** udvides med MnT-felter: DACL-navn (lilla badge), VLAN og TrustSec SGT-navn (gul badge).
- Ny `fetch_session_by_mac(mac)` i `mnt_sessions.py` kalder `GET /admin/API/mnt/Session/MACAddress/{mac}` og udtrækker `endpoint_policy`, `dacl`, `vlan`, `cts_security_group`.
- Ny baggrundstask `_enrich_sessions_from_mnt(cache)` i `session_worker.py` køres efter pxGrid-reconnect/reconcile og beriger alle sessioner der mangler MnT-data (100ms pause mellem kald for at skåne ISE MnT).
- `SessionInfo` dataclass udvidet med 4 nye felter; SSE `upsert`-broadcast inkluderer dem; `load_from_disk` håndterer dem.
- `PxGridSessionInfoResponse` schema + `list_sessions`/`get_session` API-endpoints returnerer de nye felter.

## [5.3.28 build 0344] — 2026-05-15 — chore: version bump til 5.3.28

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.3.27 build 0343] — 2026-05-15 — docs: ISE_API_REFERENCE.md — komplet MnT API-dokumentation

**Berørte filer**: `ISE_API_REFERENCE.md`, `version.json`

MnT-sektionen udvidet med: komplet endpoint-liste (14 paths, 3 kategorier verificeret fra Cisco DevNet), Session/MACAddress feltliste (bekræftet via Ansible ISE SDK — ISEPolicySetName/AuthorizationPolicyMatchedRule IKKE tilgængeligt), endelig konklusion om auth/authz policy-navne, og AcctStatusTT/AuthStatus tilføjet. Nye nyttige felter fra Session/MACAddress: endpoint_policy, dacl, vlan, cts_security_group.

## [5.3.27 build 0342] — 2026-05-15 — docs: ISE_API_REFERENCE.md opdateret med ERS SDK-analyse og session policy-findings

**Berørte filer**: `ISE_API_REFERENCE.md`, `version.json`

Tre nye sektioner: (1) ERS SDK komplet ressource-oversigt verificeret fra ERS_V1.json (376 operationer, 80 ressourcer) — tabel over hvad vi bruger, hvad har portal-potentiale, hvad er irrelevant; (2) Auth/Authz policy-navne i sessioner — samlet oversigt over bekræftede negative resultater (ERS, pxGrid, MnT ActiveList) og uafprøvede kandidater (MnT Session detail, probe b0341); (3) MnT Session API ud over CoA — alle kendte paths, feltbegrænsninger og auth-krav.

## [5.3.27 build 0341] — 2026-05-15 — feat: MnT diagnostik-probe for auth/authz policy-data

**Berørte filer**: `backend/app/ise/mnt_sessions.py`, `backend/app/api/pxgrid.py`, `version.json`

Ny admin-only probe: `GET /api/pxgrid/probe/mnt/{mac}` kalder `MnT/Session/MACAddress/{mac}` og `MnT/AuthStatus/MACAddress/{mac}` og returnerer alle XML-felter ISE leverer. Bruges til at undersøge om `ISEPolicySetName` og `AuthorizationPolicyMatchedRule` er tilgængelige — disse endpoints har aldrig været testet mod live-systemet.

## [5.3.27 build 0340] — 2026-05-15 — feat: diff-markering i audit log før/efter visning

**Berørte filer**: `frontend/js/views/audit.js`, `frontend/css/styles.css`, `version.json`

Ændrede felter fremhæves nu med farvet baggrund i audit log-drawerens før/efter JSON-visning: gul for ændret, grøn for tilføjet, rød for fjernet. Implementeret via `renderJsonDiff(before, after)` der sammenligner top-level nøgler og returnerer HTML med `.audit-diff-changed/added/removed` spans. Fungerer kun for objekt-typer — falder tilbage til plain `renderJson` for primitive værdier og arrays.

## [5.3.26 build 0339] — 2026-05-15 — feat: debug pxGrid session-logging toggle i Settings → Avanceret

**Berørte filer**: `backend/app/schemas/settings.py`, `backend/app/services/settings_service.py`, `backend/app/core/logging.py`, `frontend/js/views/settings.js`, `frontend/js/views/settings/section-update.js`, `frontend/js/i18n.js`, `version.json`

Ny checkbox i Settings → Avanceret: "Debug pxGrid session-logging". Gemmes via `PUT /api/settings/backend` (`debug_pxgrid_sessions: bool`). Logger opdateres øjeblikkeligt ved ændring (ingen genstart kræves) — `setup_logging()` genkaldes og sætter/nulstiller session_worker-loggerens niveau.

## [5.3.25 build 0338] — 2026-05-15 — cleanup: fjern debug-logging og MnT enrichment efter diagnose

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `backend/config.json`, `version.json`

Diagnosen er afsluttet: pxGrid getSessions og MnT ActiveList leverer ikke `ISEPolicySetName`/`AuthorizationRuleName`. Fjerner: debug-log i `_build_session_info`, MnT-feltlog i `_reconcile_from_mnt`, og hele `_enrich_from_mnt`-funktionen. `debug_pxgrid_sessions` sat til `false` i config.json.

## [5.3.25 build 0337] — 2026-05-15 — fix: _enrich_from_mnt reapply i session_worker efter linter-revert

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `version.json`

Genindlæser `_enrich_from_mnt()` og kaldet herfra i `_reconcile_cache_with_mnt` efter linter rullede session_worker.py tilbage til gammel kode (b0335 → reverted).

## [5.3.25 build 0336] — 2026-05-15 — fix: browse-table.js Authz-label reapply efter linter-revert

**Berørte filer**: `frontend/js/views/browse-table.js`, `version.json`

Genindlæser frontend-rettelse fra b0335 (komma-separerede profiler med "Authz:"-label) efter linter rullede filen tilbage til gammel kode.

## [5.3.25 build 0335] — 2026-05-15 — fix: session-kolonne viser Authz-profiler korrekt + MnT enrichment for policySetName

**Berørte filer**: `frontend/js/views/browse-table.js`, `backend/app/pxgrid/session_worker.py`, `version.json`

ISE pxGrid getSessions returnerer ikke `policySetName` eller `authorizationRuleName` — bekræftet via debug-logging. To rettelser:
1. **Frontend**: Authz-profiler vises nu som `Authz: Profil1, Profil2, ...` (komma-separeret med label) i stedet for separate unlabeled blokke der kørte sammen uden separator.
2. **Backend**: Ny `_enrich_from_mnt()` funktion kaldes efter pxGrid reconcile — henter MnT ActiveList og beriger sessions med `isepolicysetname` og `authorizationrule` felter (hvis ISE MnT leverer dem). Logger MnT feltnavne for videre diagnose.

## [5.3.24 build 0334] — 2026-05-15 — debug: pxGrid session feltnavne logges ved DEBUG-niveau

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `backend/app/core/config.py`, `backend/app/core/logging.py`, `backend/config.json`, `version.json`

Ny `debug_pxgrid_sessions: bool` config-flag. Når `true` sættes `app.pxgrid.session_worker`-loggeren til DEBUG uden at oversvømme hele loggen. Logger alle nøgler + relevante feltnavne fra pxGrid-payload og MnT-seed data. Aktiveret i `config.json` nu for at diagnosere manglende `policy_set_name`/`authz_rule_name`.

## [5.3.24 build 0333] — 2026-05-15 — fix: authz_rule_name manglede i REST API schema og responses

**Berørte filer**: `backend/app/schemas/settings.py`, `backend/app/api/pxgrid.py`, `version.json`

`authz_rule_name` manglede i `PxGridSessionInfoResponse`-schema og i de to manuelle konstruktioner i `list_sessions` + `get_session`. SSE-stream bruger `to_dict()` og var allerede korrekt.

## [5.3.24 build 0332] — 2026-05-15 — feat: session-kolonne viser Auth/Authz regel i stedet for profilnavne

**Berørte filer**: `backend/app/pxgrid/session_cache.py`, `backend/app/pxgrid/session_worker.py`, `frontend/js/views/browse-table.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

Nyt `authz_rule_name` felt i `SessionInfo` — captures `authorizationRuleName` fra pxGrid-topic og `authorizationrule` fra MnT-data. Session-kolonnen viser nu `Auth: <policySetName>` og `Authz: <authorizationRuleName>` i stedet for profilnavne. Fallback: vises profilnavne hvis hverken policy set name eller regel-navn er tilgængeligt (ældre ISE-versioner).

## [5.3.23 build 0331] — 2026-05-15 — fix: platform-kolonne badge-layout og sortering

**Berørte filer**: `frontend/css/styles.css`, `frontend/js/views/browse-table.js`, `frontend/js/views/browse-filter.js`, `version.json`

**Bug 1 — badge synker til bunden**: `display:flex` direkte på `<td>` bryder table-layout og giver uforudsigelig vertikal alignment. Fix: flex fjernet fra `.platform-auto-td`, indhold wrappes i `<div class="platform-auto-wrap">` (flex-container). Dynamiske opdateringsveje (refreshRows/updateRow) opretter/fjerner wrapperen on-the-fly.

**Bug 2 — sortering virker ikke**: Sort brugte `r.platform_type` (ISE-gemt), men auto-afledte rækker viser `nas_device_type` fra pxGrid — ingen synlig effekt. Fix: `browse-filter.js` special-caser `platform_type`-sort og læser `state.pxgridSessionData` med fallback til `r.platform_type`.

## [5.3.22 build 0330] — 2026-05-15 — fix: platform ⚡-badge inline efter navn i browse-edit tabel

**Berørte filer**: `frontend/css/styles.css`, `version.json`

`.platform-auto-td` manglede flex-layout — `select` fyldte hele celle-bredden og ⚡-badget faldt ned på næste linje. Fix: `display:flex; align-items:center; gap:0.25rem` på `.platform-auto-td`, `flex:1; min-width:0` på select inden i cellen, badge til `inline-flex; flex-shrink:0`.

## [5.3.22 build 0329] — 2026-05-15 — feat: "Anvend + Genstart"-knap i system opdatering

**Berørte filer**: `frontend/js/views/settings/section-update.js`, `frontend/js/views/settings.js`, `frontend/js/i18n.js`, `version.json`

Ny primær knap "Anvend + Genstart" der udfører apply og server-genstart i ét klik. Den eksisterende "Anvend opdatering"-knap er nedgraderet til sekundær (til de tilfælde hvor kun frontend-filer opdateres). Begge knapper aktiveres/deaktiveres synkront med validering. Ved fejl i apply-fasen afbrydes genstarten.

## [5.3.22 build 0328] — 2026-05-15 — feat: auto-valider firmware-pakke ved indlæsning

**Berørte filer**: `frontend/js/views/settings/section-update.js`, `version.json`

Validering køres automatisk så snart en fil vælges i fil-dialogen — brugeren behøver ikke trykke "Valider pakke" manuelt. Validate-knappen forbliver synlig som en "Genvalider"-mulighed ved fejl. Validate-logikken er udtrukket til `runValidation(file)` og deles af begge kodestier.

## [5.3.22 build 0327] — 2026-05-15 — fix: profil-kolonne viser nu altid profil-navn

**Berørte filer**: `backend/app/ise/profiler.py`, `backend/app/services/endpoint_service.py`, `version.json`

`/ers/config/profilerprofile` (bulk list) fejlede gentagne gange med transport errors → profiler-cache forblev tom → Profil-kolonne viste ingenting. Fix: ny `resolve_name_lazy()` henter én enkelt profil via `/ers/config/profilerprofile/{uuid}` (lille request). `_fetch_endpoint_detail` bruger lazy-fetch i stedet for `ensure_loaded + sync`. Open API-fallback bruger `endpointProfile` direkte fra respons hvis tilgængeligt. Ny `store()` helper til at populere cache fra inline data.

## [5.3.21 build 0326] — 2026-05-15 — fix: NAS-kolonne viser kun NAS-navn, ikke local mapping label

**Berørte filer**: `frontend/js/views/browse-table.js`, `version.json`

`nas_device_type` (local mapping label) fjernet fra NAS-cellen. Kolonnen viser nu udelukkende NAS-enhedens navn (`nas_name`).

## [5.3.21 build 0325] — 2026-05-15 — feat: ny NAS-kolonne i browse-edit; NAS type flyttes fra Session-celle

**Berørte filer**: `frontend/js/views/browse-table.js`, `frontend/js/views/browse-utils.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

Ny `nas`-kolonne (120px) viser NAS-enhedens navn (fed, blå) og device type (lille, grå) fra pxGrid session-data. NAS-navne fjernes fra Session-cellen som nu kun viser Authz-profiler. Begge kolonner kan skjules/reordres som de øvrige. CSS: `.nas-info-combo`, `.nas-info-name`, `.nas-info-type` med dark/midnight theme-overrides.

## [5.3.20 build 0324] — 2026-05-15 — chore: bump version til 5.3.20 (korrekt versionering af bug-fix build 0323)

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.3.19 build 0323] — 2026-05-15 — fix: platform type forsvinder efter portal-genstart (reconcile sletter nas_device_type)

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `version.json`

**Root cause (2 bugs):**
1. `_reconcile_from_pxgrid`: `info_with_mac` kopierede ikke `nas_name`/`nas_device_type` fra `_build_session_info()`, selv om de var beregnet korrekt. Alle sessions der re-seededes ved pxGrid reconnect fik `nas_device_type=""`.
2. `_reconcile_from_mnt`: Fallback-reconcile via MnT seedede nye sessions uden NAS-opslag (ingen `_nd.get_device_info()` kald). Disk-loadede sessions der ikke var i MnT-listen blev evicted → platform type tabt for inaktive sessions.

**Fix:** Begge reconcile-flows bevarer nu `nas_device_type`/`nas_name`:
- pxGrid-reconcile kopierer begge felter fra `info` + falder tilbage til disk-cachet værdi hvis NAS-cachen endnu ikke er indlæst
- MnT-reconcile tilføjer NAS device-opslag (identisk pattern som `_build_session_info`) + bevaer disk-cachet `nas_device_type` som fallback hvis NAS-cache ikke indlæst endnu

## [5.3.19 build 0322] — 2026-05-15 — fix: mapping-tabel kolonne-rækkefølge: ISE NAS Devices → Lokalt label

**Berørte filer**: `frontend/js/views/attributes.js`, `version.json`

ISE NAS Devices-kolonnen placeres nu som første kolonne, Lokalt label som anden. Input for ny raw-værdi vises i NAS Devices-cellen så det er tydeligt at det er ISE-device-typen der mappes til et lokalt label.

## [5.3.19 build 0321] — 2026-05-15 — fix: Raw→local mapping fjerner fejlagtig "ISE raw"-kolonne

**Berørte filer**: `frontend/js/views/attributes.js`, `version.json`

"ISE raw"-kolonnen fjernet fra mapping-tabellen. Struktur tilbage til 3 kolonner: Lokalt label | CoA | ISE NAS Devices | ×. For nye rækker vises raw-input nu i NAS Devices-cellen (tekst-input med placeholder). Eksisterende rækker viser NAS device-tags som før.

## [5.3.18 build 0320] — 2026-05-15 — feat: Raw→local mapping dynamisk + Scan NAS knap

**Berørte filer**: `backend/app/core/platform_mapping_store.py`, `backend/app/schemas/custom_attribute.py`, `backend/app/services/custom_attribute_service.py`, `backend/app/ise/network_devices.py`, `backend/app/api/custom_attributes.py`, `frontend/js/api.js`, `frontend/js/views/attributes.js`, `frontend/js/i18n.js`, `version.json`

Mapping-editoren viser nu kun gemte rækker (ingen "tom padding" for kendte raw-typer). Nye rækker tilføjes med "+ Tilføj mapping"-knap (maks. 20); hver række kan slettes individuelt. Raw-kolonnen er redigerbar ved nye rækker. "Scan NAS fra ISE"-knap kaller ny `POST /PlatformType/nas-devices/refresh` der invaliderer og genindlæser NAS device-cachen fra ISE ERS uden portal-genstart. Backend: `MAX_MAPPINGS = 20` enforces i `save_mapping()`; `PlatformMapping`-schema eksponerer `max_mappings`; `get_platform_mapping()` returnerer kun gemte rækker.

## [5.3.17 build 0319] — 2026-05-15 — fix: halvér whitespace i browse-edit tabel (th/td/input padding)

**Berørte filer**: `frontend/css/styles.css`, `version.json`

`th`/`td` padding: 0.5rem 0.75rem → 0.25rem 0.4rem. Input/select padding: 0.3rem 0.5rem → 0.15rem 0.3rem. Filter-row: 0.2rem 0.3rem → 0.1rem 0.25rem. Samme rækker fylder nu ca. halvt så meget lodret plads.

## [5.3.17 build 0318] — 2026-05-15 — feat: vendor-kolonne bruger nu ISE profiler-navn i stedet for lokal OUI-CSV

**Berørte filer**: `backend/app/services/endpoint_service.py`, `backend/app/core/endpoint_cache.py`, `frontend/js/i18n.js`, `version.json`

"Vendor"-kolonnen (nu omdøbt til "Profil"/"Profile") viser nu ISE's eget profiler-resultat (fx "Apple-iPhone", "Cisco-IP-Phone-7942", "HP-LaserJet") med lokal OUI-CSV som fallback for endpoints ISE endnu ikke har profileret. Den bundlede OUI-CSV var begrænset til ~400 OUI-entries. Disk-cache version bumpes til 3 så gammel cache med OUI-vendor invalideres automatisk ved næste genstart.

## [5.3.16 build 0317] — 2026-05-15 — feat: pxGrid session-cache disk-persistens overlever portal-genstart

**Berørte filer**: `backend/app/pxgrid/session_cache.py`, `backend/app/core/config.py`, `backend/app/main.py`, `version.json`

Session-cachen (MAC → authz-profiler, NAS-navn, NAS device type m.m.) gemmes nu til `backend/cache/sessions.json` hvert 5. minut samt ved clean shutdown. Ved portal-genstart indlæses filen synkront inden pxGrid-workeren starter, så session-info er tilgængelig fra allerførste request. Konfigureres via `pxgrid_session_disk_path` og `pxgrid_session_autosave_interval_s` i settings.

## [5.3.15 build 0316] — 2026-05-15 — feat: ny søge-UX (auto-aktivering, global reset) + undo-knap i browse-edit

**Berørte filer**: `frontend/js/views/browse.js`, `frontend/js/views/browse-filter.js`, `frontend/js/views/browse-table.js`, `frontend/css/styles.css`, `version.json`

Søgefelterne i browse-edit aktiveres nu automatisk ved tekstindtastning — de individuelle checkboxe er fjernet. En rød ×-knap vises i venstre hjørne af filter-rækken når mindst ét felt er aktivt og nulstiller alle felter med ét klik. Escape-tast rydder enkelt felt. Derudover er der tilføjet en "↩ Fortryd"-knap i toolbaren der ruller alle ikke-gemte inline-ændringer tilbage til serverværdierne uden at genindlæse siden.

## [5.3.14 build 0315] — 2026-05-15 — feat: dropdown-pil erstattet med venstre-border i browse-edit select-felter

**Berørte filer**: `frontend/css/styles.css`, `version.json`

Select-felter i browse-edit tabellen viser ikke længere den native dropdown-pil (`appearance: none`). En blå venstre-kant (3px) bruges i stedet som visuelt cue for at feltet er redigerbart — giver mere plads til tekst. Dark/midnight-temaerne tilpasses med matchende blåtoner.

## [5.3.13 build 0314] — 2026-05-15 — feat: kompakt browse-edit — faste bredder på read-only kolonner + kortere navne

**Berørte filer**: `frontend/js/i18n.js`, `frontend/js/views/browse-table.js`, `frontend/css/styles.css`, `version.json`

Fire read-only kolonner er nu faste bredder: "Tilkn./Assign." (68px), "PSK" (44px), "Alder/Age" (70px), "Session" (148px). Kolonnenavne forkortet i begge sprog. ISE Session-cellen viser ikke længere NAS device type (duplikat af Platform-kolonnen) — kun NAS-navn + authz-politikker.

## [5.3.10 build 0309] — 2026-05-14 — feat: træk-og-slip kolonne-rækkefølge i browse-edit tabel

**Berørte filer**: `frontend/js/views/browse-utils.js`, `frontend/js/views/browse.js`, `frontend/js/views/browse-table.js`, `frontend/css/styles.css`, `version.json`

Kolonnerne i browse-edit tabellen kan nu trækkes til ny position. Klik og træk en kolonneoverskrift til ønsket placering — rækkefølgen gemmes i localStorage og bevares på tværs af sider og genindlæsninger. Kolonne-synlighed (col-vis) fungerer uændret. Implementeret med HTML5 Drag API uden eksterne afhængigheder; `applyColVis` bruger nu `[data-col]`-attributter i stedet for `nth-child`.

## [5.3.9 build 0306] — 2026-05-14 — feat: umappede NDG-stier vises som redigerbare rækker i platform mapping

**Berørte filer**: `backend/app/core/platform_mapping_store.py`, `backend/app/services/custom_attribute_service.py`, `backend/app/api/custom_attributes.py`, `backend/app/pxgrid/session_worker.py`, `frontend/js/views/attributes.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

Umappede ISE NDG device type-stier (f.eks. "IOS-SW", "IOS-WLC") vises nu som ekstra rækker i Raw→local mapping-tabellen med gul baggrund. Brugeren kan vælge local label + CoA og gemme — de bliver permanente rækker. Den gule advarselsboks er fjernet. Backend accepterer nu vilkårlige raw-værdier (ikke kun KNOWN_PLATFORM_TYPES), session_worker slår direkte NDG-sti op som fallback, og nas-devices API flytter brugermappede NDG-stier fra unmatched til matched.

## [5.3.8 build 0305] — 2026-05-14 — feat: auto-sæt Platform kolonne fra NAS device type i browse/detail

**Berørte filer**: `frontend/js/views/browse-table.js`, `frontend/js/views/browse-detail.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

Platform-kolonnen i browse-tabellen og detail-modal auto-sættes nu fra NAS device type (via pxGrid session + platform mapping) når endpoint ikke har en manuelt sat Platform-værdi. Viser ⚡-badge som indikator. Brugeren kan stadig overskrive værdien manuelt i dropdown'en. Kun manual edit tillades når der ikke er noget NAS mapping.

## [5.3.7 build 0304] — 2026-05-14 — fix: ISE NAS Devices viser NDG-sti med count — ikke hostname

**Berørte filer**: `backend/app/api/custom_attributes.py`, `frontend/js/views/attributes.js`, `version.json`

Skalerer ikke med 1000+ devices at vise hostnavn pr. device. API grupperer nu efter unik NDG-sti med antal devices: `{path, count}`. UI viser f.eks. `Wireless > Airspace-WLC (3)` i stedet for individuelle device-navne.

## [5.3.7 build 0303] — 2026-05-14 — fix: tilføj Airspace-WLC synonym + vis unmatched devices

**Berørte filer**: `backend/app/core/platform_types.py`, `backend/app/api/custom_attributes.py`, `frontend/js/views/attributes.js`, `frontend/js/i18n.js`, `version.json`

`"airspace-wlc"` og `"airespace-wlc"` tilføjet som synonymer for `"airos"` i `platform_types.normalize()`. API filtrerer nu devices uden NDG fra unmatched-listen. Frontend viser unmatched devices med Device Type NDG som gul advarsel under tabellen.

## [5.3.7 build 0302] — 2026-05-14 — debug: nas-devices logger unmatched device types

**Berørte filer**: `backend/app/api/custom_attributes.py`, `version.json`

API returnerer nu `unmatched`-liste med devices der ikke matchede normalize(). Logger hvilke `device_type`-værdier ISE NDG returnerer så synonymer kan tilføjes.

## [5.3.7 build 0301] — 2026-05-14 — fix: fjern ISE raw-kolonne + fix tom NAS Devices + loading-state

**Berørte filer**: `backend/app/api/custom_attributes.py`, `frontend/js/views/attributes.js`, `frontend/js/i18n.js`, `version.json`

ISE raw-kolonnen fjernet fra platform mapping-tabellen (redundant nu ISE NAS Devices kolonne viser device-navne). NAS Devices var altid tom fordi `ensure_loaded()` kun blev kaldt fra pxGrid worker — nu kaldes den også fra `GET /PlatformType/nas-devices` API-endpointet. API returnerer nu `{devices, loaded, loading}` så UI viser "(indlæser...)" eller "(ikke indlæst — pxGrid skal forbinde)" i kolonneheaderen. Logger cache-state ved hvert API-kald.

## [5.3.6 build 0300] — 2026-05-14 — feat: Raw→local mapping viser ISE NAS Devices kolonne

**Berørte filer**: `backend/app/api/custom_attributes.py`, `frontend/js/api.js`, `frontend/js/views/attributes.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`

Ny kolonne "ISE NAS Devices" i Raw→local mapping-tabellen (Attributter → PlatformType). Viser hvilke ISE network devices der matcher hvert raw platform type via NDG → normalize() lookup. Ny API endpoint `GET /custom-attributes/PlatformType/nas-devices` returnerer devices grupperet efter raw type. Devices vises som klikkable tags med tooltip (device_type_path / IP).

## [5.3.5 build 0299] — 2026-05-14 — feat: NAS device type linket til platform_mapping local labels

**Berørte filer**: `backend/app/ise/network_devices.py`, `backend/app/pxgrid/session_worker.py`, `version.json`

NDG device type kædes nu: NDG last-segment → `platform_types.normalize()` → `platform_mapping_store.raw_to_local()` → brugerens lokale label. Eks: NDG "Wireless > WLC" → last="WLC" → normalize("WLC")="airos" → raw_to_local["airos"]="Wireless-AireOS". Fallback til fuld NDG-sti hvis ingen lokal mapping er sat. `DeviceInfo` tilføjet `device_type_path` (fuld sti) og `device_type` (last segment).

## [5.3.5 build 0298] — 2026-05-14 — feat: NAS device name + type fra ISE Network Device Groups i ISE Session kolonne

**Berørte filer**: `backend/app/ise/network_devices.py` (ny), `backend/app/pxgrid/session_cache.py`, `backend/app/pxgrid/session_worker.py`, `backend/app/schemas/settings.py`, `backend/app/api/pxgrid.py`, `backend/app/services/settings_service.py`, `frontend/js/views/browse-table.js`, `frontend/css/styles.css`, `version.json`

Ny `network_devices.py` cache: henter alle network devices fra ERS `/ers/config/networkdevice`, bygger IP → {name, device_type, location}-map. `device_type` ekstraheres fra NDG "Device Type#All Device Types#WLC" → "WLC". Background load triggers ved første pxGrid worker-connect. SessionInfo tilføjet `nas_name` + `nas_device_type`. ISE Session-kolonnen viser nu en tredje linje: `wlc-dc-01 · WLC`. Cache invalideres ved ISE settings-ændring.

## [5.3.5 build 0297] — 2026-05-14 — fix: ISE Session kolonne viser kun authz-resultater, ingen Auth-linje

**Berørte filer**: `frontend/js/views/browse-table.js`, `version.json`

Fjernet Auth/useCase-linjen — kun authz-profiler (resultater) vises, én per linje uden labels.

## [5.3.5 build 0296] — 2026-05-14 — version bump 5.3.4 → 5.3.5

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.3.4 build 0295] — 2026-05-14 — feat: ISE Session kolonne viser Auth/Authz labels + useCase som auth-kilde

**Berørte filer**: `backend/app/pxgrid/session_cache.py`, `backend/app/pxgrid/session_worker.py`, `backend/app/schemas/settings.py`, `backend/app/api/pxgrid.py`, `frontend/js/views/browse-table.js`, `frontend/css/styles.css`, `version.json`

ISE Session-kolonnen viser nu "Auth: [useCase]" og "Authz: [første profil]" i stedet for komma-separeret profilliste. `use_case`-felt tilføjet til SessionInfo, broadcast og schema. `useCase` fra ISE pxGrid getSessions (f.eks. "Host Lookup", "Wireless_802.1x") bruges som auth-label. Kun første authz-profil vises. "Auth:"/"Authz:" prefixes styled med `.ise-sess-prefix` (dæmpet opacity).

## [5.3.4 build 0294] — 2026-05-14 — fix: ISE Session authz-data tom — getSessions bruger selectedAuthzProfiles (ikke selectedAznProfiles)

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `backend/app/pxgrid/client.py`, `version.json`

pxGrid REST `getSessions` returnerer `selectedAuthzProfiles` (ikke `selectedAznProfiles` som STOMP-events). `_build_session_info` kiggede ikke på dette felt → authz_profiles altid tom. Fix: tilføjet `selectedAuthzProfiles` som fallback i `_build_session_info`. `_reconcile_from_pxgrid` update-condition tjekker nu `authz_profiles` i stedet for kun `policy_set_name` (policySetName er ikke i getSessions-svaret fra ISE 3.4).

## [5.3.4 build 0293] — 2026-05-14 — debug: getSessions logger nu antal sessioner + felt-navne + policy-data count

**Berørte filer**: `backend/app/pxgrid/client.py`, `version.json`

Tilføjet INFO-logs i `get_sessions()` der viser: antal returnerede sessioner, felt-navne i første session og antal sessioner med policy-data. Gør det muligt at diagnosticere om ISE pxGrid REST returnerer `policySetName`/`selectedAznProfiles`.

## [5.3.4 build 0292] — 2026-05-14 — feat: pxGrid getSessions som primær reconcile-kilde — ISE Session kolonne får nu policy + authz data

**Berørte filer**: `backend/app/pxgrid/client.py`, `backend/app/pxgrid/session_worker.py`, `version.json`

`_reconcile_cache_with_mnt` kalder nu `PxGridClient.get_sessions()` (pxGrid REST API `{restBaseUrl}/getSessions`) som primær kilde ved reconnect. pxGrid REST returnerer fuld session-payload inkl. `policySetName` og `selectedAznProfiles` — præcis de felter ISE Session-kolonnen viser. MnT ActiveList bruges kun som fallback hvis getSessions fejler. Tilføjet `_reconcile_from_pxgrid()` der evicterer stale entries, seeder manglende sessioner og opdaterer eksisterende entries der mangler policy-data.

## [5.3.4 build 0291] — 2026-05-14 — version bump 5.3.3 → 5.3.4

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.3.3 build 0290] — 2026-05-14 — fix: ISE Session kolonne tom — MnT-seed ekstraherer nu policy_set_name + authz_profiles

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `version.json`

MnT-seedede sessioner havde tomme `policy_set_name` og `authz_profiles` → ISE Session-kolonne viste "—" for alle rækker. Fix: seeding-koden forsøger nu at udtrække policy-data fra MnT-sessionen (ISE-feltnavne varierer pr. version: `isepolicysetname`, `ise-policy-set-name`, `selectedazprofiles`, `authorizationprofiles` etc.). Tilføjet debug-log af MnT-felter ved første session så fremtidige felt-navne er lette at identificere.

## [5.3.3 build 0289] — 2026-05-14 — version bump 5.3.2 → 5.3.3

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.3.2 build 0288] — 2026-05-14 — fix: TACACS+-brugere fik 401 på pxGrid SSE-stream → PULL-badge

**Berørte filer**: `backend/app/api/pxgrid.py`, `version.json`, `BUGS.md`

SSE-stream endpointet (`/api/pxgrid/sessions/stream`) lavede sin egen manuel auth der manglede TACACS+-håndteringen fra `deps.get_current_user`. TACACS+-brugere har ingen record i `users.json` — `find_by_id(load_users(), payload["sub"])` returnerede None → 401 → EventSource fejlede → `pxgridLive` forblev false → badge viste 🟡 PULL selvom worker var connected og cache havde 29 sessioner. Fix: tilføjet `auth_type == "tacacs"`-check svarende til `deps.py`-logikken.

## [5.3.2 build 0287] — 2026-05-14 — version bump 5.3.1 → 5.3.2

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.3.1 build 0286] — 2026-05-14 — fix: pxGrid cache seedet fra MnT ved connect — ISE replayer ikke sessioner

**Berørte filer**: `backend/app/pxgrid/session_worker.py`, `frontend/js/views/browse.js`, `version.json`, `BUGS.md`

ISE pxGrid sender ikke eksisterende sessioner ved subscribe — kun fremtidige events. `_reconcile_cache_with_mnt` evicted kun stale entries men seede ikke nye. Cache startede altid på 0 → SSE snapshot sendte 0 → badge viste PUSH 0 eller PULL (MnT-data overskrevet med tom Set). Fix (backend): reconcile-funktionen upsert'er nu MnT-sessioner der mangler i cachen (`state=STARTED`; pxGrid-events raffinerer med policy_set_name/authz_profiles). Fix (frontend): snapshot-handler overskriver kun `activeSessionMacs` når snapshot faktisk har sessioner; badge bruger `activeSessionMacs.size` (fusioneret) som tæller.

## [5.3.1 build 0285] — 2026-05-14 — version bump 5.3.0 → 5.3.1

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.3.0 build 0284] — 2026-05-14 — fix: pxGrid SSE-stream genopbygges ikke efter worker-genstart

**Berørte filer**: `frontend/js/views/browse.js`, `version.json`, `BUGS.md`

`pxgrid_disabled`-event handleren parsede ikke `reason`-feltet og kaldte altid `stopPxGridStream()` — permanent dræbning af EventSource. Når pxGrid-settings gemmes restarter backend workeren og broadcaster `pxgrid_disabled (reason: worker_stopped)` → frontend dræbte SSE-stream og kom aldrig tilbage → badge viste PULL selvom workeren var OK. Fix: handler parser nu `reason`; ved `worker_stopped` schedules `startPxGridStream()` med 5s delay. `pxgrid_enabled=false` er fortsat permanent (ingen reconnect).

## [5.3.0 build 0283] — 2026-05-14 — feat: ISE Session kolonne i browse viser Auth/Authz fra pxGrid

**Berørte filer**: `backend/app/pxgrid/session_cache.py`, `backend/app/pxgrid/session_worker.py`, `backend/app/schemas/settings.py`, `backend/app/api/pxgrid.py`, `frontend/js/views/browse.js`, `frontend/js/views/browse-table.js`, `frontend/js/views/browse-utils.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`, `FEATURES.md`

Ny "ISE Session"-kolonne i browse-edit-tabellen. Viser `Auth: [ISE policy set name]` og `Authz: [authz-profiler]` for endpoints med aktiv pxGrid RADIUS-session. Kilde: `policySetName` og `selectedAznProfiles`/`authorizationProfiles` fra pxGrid session-events. Backend: `SessionInfo` udvidet med `policy_set_name` og `authz_profiles`; `_build_session_info()` ekstraherer dem; `_broadcast()` sender dem med i SSE upsert-events; `PxGridSessionInfoResponse`-schema og API-endpoints opdateret. Frontend: `state.pxgridSessionData` Map (mac → sessiondata) vedligeholdes af snapshot/upsert/remove/clear SSE-handlers; `renderRows` genererer `.ise-sess-combo` med Auth-linje (fed) og Authz-linje (lille skrift); kolonne tilføjet i `getColumns()`; CSS + i18n (DA+EN).

## [5.2.2 build 0282] — 2026-05-14 — ux: flyt Portal Opdatering til sidst i Portal Config undermenu

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/js/i18n.js`, `version.json`

"Opdatering" omdøbt til "Portal Opdatering" (DA) / "Portal Update" (EN) og flyttet til sidst i Portal Config-undermenuen: PSK → Sprog → ISE Config → Authz Profiler → Avanceret → Portal Opdatering.

## [5.2.2 build 0281] — 2026-05-14 — version bump 5.2.1 → 5.2.2 (akkumulerede bugfixes b0270–b0280)

**Berørte filer**: `version.json`

PATCH-bump for bugfixes landet i b0270–b0280: advancedAttributes feltnavn-typo, forkert RADIUS dictionary, Endpoint_VLAN common task → advancedAttributes, pxGrid Windows cert-sti på Linux, IdentityGroup dropdown tom i politik-editor.

## [5.2.1 build 0280] — 2026-05-14 — ux: omroker settings subtabs til Brugere → Endpoint grupper → Skabeloner

**Berørte filer**: `frontend/js/views/settings.js`, `version.json`

Subtab-rækkefølge under "Portal Bruger Config": Endpoint grupper↔Brugere byttet om. Ny orden: Brugere & Bruger grupper → Endpoint grupper → Skabeloner.

## [5.2.1 build 0279] — 2026-05-14 — ux: omdoeb nav-punkt Politikker til ISE Politikker

**Berørte filer**: `frontend/js/i18n.js`, `version.json`

DA: "Politikker" → "ISE Politikker". EN: "Policies" → "ISE Policies".

## [5.2.1 build 0278] — 2026-05-14 — docs: opdater README.md til v5.2.1

**Berørte filer**: `README.md`, `version.json`

Version bump til 5.2.1 build 0277. Ny sektion "RADIUS Policy administration" beskriver Politik-dashboard, nested gruppe-editor, standard autoriseringsprofiler og Policy match preview. Hurtigstart opdateret med Linux/Windows split og korrekt `source`-kommando.

## [5.2.1 build 0277] — 2026-05-14 — docs: opdater ISE_API_REFERENCE, FEATURES og BUGS

**Berørte filer**: `ISE_API_REFERENCE.md`, `FEATURES.md`, `version.json`

ISE_API_REFERENCE: ny sektion "ERS — Authorization Profiles" med advancedAttributes-feltnavns-typos, kendte RADIUS dictionary-navne, Tunnel-tag-format, VLAN- og PSK-eksempler. FEATURES: nested gruppe-editor markeret done (5.2.1).

## [5.2.1 build 0276] — 2026-05-14 — fix: IdentityGroup:Name dropdown tom i politik-editor

**Berørte filer**: `frontend/js/views/policy.js`, `version.json`

`caValues["__IdentityGroup_Name__"]` var aldrig sat i politik-editoren — kun EndPoints custom attributes blev indlæst. Tilføjet `api.listGroups()` parallelt med `listCustomAttributes()`, så gruppe-navne injiceres i `caValues` og dropdown vises korrekt.

## [5.2.1 build 0275] — 2026-05-14 — fix: pxGrid aldrig forbundet — Windows cert-sti brugt på Linux

**Berørte filer**: `backend/app/pxgrid/cert_manager.py`, `BUGS.md`, `version.json`

`_resolve()` detekterer nu Windows drive-letter-mønster (`C:\` / `C:/`) i gemt cert-sti og extracter kun filnavnet mod `BACKEND_ROOT/pxgrid/`. Uden fix: `Path("C:\\...").is_absolute() == False` på Linux → sti joinedes til `BACKEND_ROOT/"C:\..."` → cert aldrig fundet → pxGrid fejlede permanent → stale portal.

## [5.2.1 build 0274] — 2026-05-14 — fix: Endpoint_VLAN tilføj Tunnel-Type/Medium-Type med tagged værdier

**Berørte filer**: `backend/app/services/authz_profile_service.py`, `version.json`

Tunnel-Type og Tunnel-Medium-Type genindsat med tag-prefixed værdier `"1:13"` og `"1:6"`. `Radius` dictionary bekræftet korrekt fra b0273. Profilen sætter nu alle tre RADIUS Tunnel-attributter med tunnel-tag 1.

## [5.2.1 build 0273] — 2026-05-14 — fix: Endpoint_VLAN 500 — fjern Tunnel-Type/Medium-Type fra advancedAttributes

**Berørte filer**: `backend/app/services/authz_profile_service.py`, `version.json`

ISE returnerede generisk 500 ved tre Tunnel-advancedAttributes. Stripbet til kun `Radius:Tunnel-Private-Group-ID = EndPoints:AuthzVlan`. Tunnel-Type/Medium-Type sættes på NAD-niveau og er ikke nødvendige i profilen.

## [5.2.1 build 0272] — 2026-05-14 — fix: Endpoint_VLAN 500 — common task vlan.nameID accepterer ikke EndPoints

**Berørte filer**: `backend/app/services/authz_profile_service.py`, `BUGS.md`, `version.json`

Fjernet `vlan`-common-task-feltet; erstattet med `advancedAttributes`: `Radius:Tunnel-Type=13`, `Radius:Tunnel-Medium-Type=6`, `Radius:Tunnel-Private-Group-ID=EndPoints:AuthzVlan` (dynamisk).

## [5.2.1 build 0271] — 2026-05-14 — fix: Endpoint_PSK-KEY 500 — forkert RADIUS dictionary navn

**Berørte filer**: `backend/app/services/authz_profile_service.py`, `BUGS.md`, `version.json`

ISE-dictionary for cisco AV-pairs er `Cisco` med attribut `cisco-av-pair`, ikke `Cisco-AV-Pair:Cisco-AV-Pair`. `Endpoint_PSK-KEY` rettet i begge `leftHandSideDictionaryAttribue`-entries.

## [5.2.1 build 0270] — 2026-05-14 — fix: Endpoint_PSK-KEY oprettelse fejlede 400 pga. forkert feltnavn

**Berørte filer**: `backend/app/services/authz_profile_service.py`, `BUGS.md`, `version.json`

`rightHandSideAttribValue` → `rightHandSideAttribueValue` i alle tre standard-profilers `advancedAttributes`. ISE bruger konsekvent "Attribue" (mangler 't') som typo for "Attribute" — samme mønster som det kendte `leftHandSideDictionaryAttribue`.

## [5.2.0 build 0269] — 2026-05-14 — feat: nested AND/OR gruppe-editor i politik-redigering og browse-wizard

**Berørte filer**: `frontend/js/views/policy.js`, `frontend/js/views/browse-detail.js`, `frontend/js/views/policy-condition-builder.js`, `frontend/css/styles.css`, `frontend/js/i18n.js`, `version.json`

Politik-editoren og browse-wizard'en bruger nu den rekursive gruppe-editor (`groupEditorHtml`/`wireGroupEditor`/`readGroupCondition`) i stedet for den flade `condRowHtml`-tilgang. AND/OR-nesting fra ISE bevares fuldt ud ved redigering. CSS tilføjet for `.cond-group*`-klasser inkl. dark-mode. i18n-nøgler `pol.ed_add_group` og `pol.ed_del_group` tilføjet til begge locales.

## [5.2.0 build 0268] — 2026-05-14 — fix: klik på regelkort viser nu detail-view, ikke editor

**Berørte filer**: `frontend/js/views/policy.js`, `frontend/css/styles.css`, `version.json`

Edit/slet-knapper fjernet fra regelkortene — kortene er nu kun klik-til-detail. Al redigering sker via "Rediger"-knappen i detail-panelet til højre. `wireRuleCards` simplificeret til ét click-listener på hele kortet.

---

## [5.2.0 build 0267] — 2026-05-14 — refactor: detail-panel delt i betingelser (venstre) og authz profiles (højre)

**Berørte filer**: `frontend/js/views/policy.js`, `frontend/css/styles.css`, `version.json`

`showRuleDetail` bruger nu `.pol-detail-split` grid med to kolonner: betingelsestræ til venstre, authz profiler som kort til højre med blå chips. Rank-badge genbruges i kortets header. Dark mode tilføjet.

---

## [5.2.0 build 0266] — 2026-05-14 — refactor: policy-side master-detail layout + max-width

**Berørte filer**: `frontend/js/views/policy.js`, `frontend/css/styles.css`, `version.json`

Layout ændret fra enkelt fuld-bredde kolonne til master-detail: regelkort i venstre kolonne (380px fast), detail/editor i højre panel. `max-width: 1100px` via `.pol-inner` wrapper sikrer at indholdet ikke strækker sig over hele skærmen på bred skærm. Aktivt regelkort fremhæves blåt. Klik på aktiv regel lukker detail. Cancel i editor genviser detail eller rydder panel.

---

## [5.2.0 build 0265] — 2026-05-14 — feat: grafisk redesign af Politikker-siden + i18n fix

**Berørte filer**: `frontend/js/views/policy.js`, `frontend/js/views/policy-condition-builder.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`, `version.json`, `BUGS.md`, `FEATURES.md`

**i18n fix**: `nav.policy` nøglen manglede fra begge locales — nav-linket viste altid hardkodet "Politikker". Alle strings i `policy.js` og `policy-condition-builder.js` brugte hardkodet dansk; nu erstattet med `t()` og ~60 nye nøgler i DA+EN.

**Grafisk redesign**: Tre-rude tekst-layout erstattet af:
- Policy set-kort øverst som horisontal klik-bar med navn, servicenavn og state-badge (grøn/rød)
- Regelkort med rank-badge (blå cirkel), betingelses-chips (`Dict:Attr op value`), pil → profil-chips
- Klik på regelkort/rank udfoldar inline-detail med fuld betingelsestræ
- Editor erstatter liste midlertidigt (ikke separat rude)
- Dark mode support på alle nye klasser

---

## [5.1.1 build 0264] — 2026-05-14 — fix: authz-profile list bruger Open API som primær kilde

**Berørte filer**: `backend/app/ise/authz_profiles.py`, `version.json`

`list_all()` forsøger nu Open API `/api/v1/policy/network-access/authorization-profiles` før ERS-pagineringen. ISE 3.4 returnerede transport-fejl (TCP RST) på ERS-list-endpointet, mens Open API fungerer. ERS bruges stadig som fallback. Løser "502: ISE API 0: transport error:" i "Hent alle profiler fra ISE".

---

## [5.1.0 build 0262] — 2026-05-14 — feat: ISE Authorization Profile Manager

**Berørte filer**: `backend/app/ise/authz_profiles.py` (ny), `backend/app/schemas/authz_profile.py` (ny), `backend/app/services/authz_profile_service.py` (ny), `backend/app/api/authz_profiles.py` (ny), `backend/app/api/deps.py`, `backend/app/main.py`, `frontend/js/api.js`, `frontend/js/i18n.js`, `frontend/js/views/settings/section-authz-profiles.js` (ny), `frontend/js/views/settings.js`, `frontend/css/styles.css`, `version.json`, `FEATURES.md`

Ny settings-sektion: **Settings → Portal Config → Authz Profiler**.

- **Standard profil status**: Viser en tabel over de 4 standard-profiler (`Endpoint_VLAN`, `Endpoint_DACL`, `Endpoint_PSK-KEY`, `Endpoint_AirSpaceACL`) med ✓/✗ status fra ISE — autocheck ved åbning af sektionen.
- **Opret manglende**: Ét klik opretter alle manglende profiler i ISE via ERS med korrekte attributter (VLAN, DACL, PSK cisco-av-pair, Airespace ACL — alle dynamiske fra EndPoints-attributter).
- **Alle ISE profiler**: Knap der henter og viser alle eksisterende autorisationsprofiler fra ISE til reference.
- Backend: `GET /api/authz-profiles`, `GET /api/authz-profiles/standard/status`, `POST /api/authz-profiles/standard/ensure` — alle kræver admin.

---

## [5.0.4 build 0261] — 2026-05-14 — fix: simuler match viser "Authz Profiles:" i stedet for "Profiles:"

**Berørte filer**: `frontend/js/i18n.js`, `version.json`

`detail.policy_profiles` nøglen opdateret til "Authz Profiles:" i begge locales (da + en).

---

## [5.0.4 build 0260] — 2026-05-14 — feat: ANC hide-pref + RADIUS policy synlig som standard + i18n-fix

**Berørte filer**: `frontend/js/i18n.js`, `frontend/js/views/browse.js`, `frontend/js/views/browse-detail.js`, `frontend/js/views/user-prefs.js`, `version.json`

- **Præferencer**: ny `hideAnc`-checkbox i bruger-præferencer (Præferencer-siden) — skjuler ANC/Quarantine-sektionen i endpoint-editor når aktiveret.
- **RADIUS policy**: sektionen er nu synlig som standard (ikke sammenfoldet) — policy sets hentes automatisk når endpoint åbnes.
- **i18n**: alle hardkodede danske tekster i RADIUS policy-sektionen og wizard er erstattet med `t()`-nøgler. Nye nøgler tilføjet til begge locales (`da` + `en`): `detail.policy_*`, `detail.wiz_*`, `prefs.hide_anc`.
- **Vis/Skjul-knap**: bruger nu `t("detail.policy_show")` / `t("detail.policy_hide")` — vises korrekt på det valgte locale.

---

## [5.0.4 build 0259] — 2026-05-14 — fix: fjern Network-dictionary fra condition-builder

**Berørte filer**: `frontend/js/views/policy-condition-builder.js`, `version.json`

ISE afviser `Network:Device Name` (og øvrige Network-attributter) i autorisationsregler med
"Condition attributes are illegal for requested scope". Network-dictionary er kun gyldig i
autentificeringspolitikker. Fjernet `Network` fra `DICTIONARIES` så brugeren ikke kan vælge
ulovlige betingelser.

---

## [5.0.4 build 0258] — 2026-05-14 — fix: simuler match returnerede altid "ingen regel matchede"

**Berørte filer**: `backend/app/services/policy_service.py`, `version.json`

ISE Open API returnerer autorisationsregler som `{"rule": {id, name, rank, condition}, "profile": [...]}`.
`_rule_summary`, `_rule_detail` og `match_endpoint` læste fejlagtigt felter direkte fra det ydre objekt
(`rule.get("id")` → `""`) i stedet for fra det indre `rule["rule"]`-objekt.
Alle tre funktioner bruger nu `inner = entry.get("rule") or entry` som unwrap-mønster.

---

## [5.0.4 build 0257] — 2026-05-13 — fix: make_update_package.py fjerner doc-filer og START.bat fra INCLUDE_PATHS

**Berørte filer**: `make_update_package.py`, `version.json`

`INCLUDE_PATHS` synkroniseret med `_ALLOWED_PREFIXES` — de 6 filer (CHANGELOG.md, FEATURES.md, BUGS.md, ARCHITECTURE.md, ISE_API_REFERENCE.md, START.bat) er fjernet. BUILD_PACKAGE.bat genererer nu pakker der kun indeholder `frontend/`, `backend/app/`, `backend/pyproject.toml` og `version.json`.

## [5.0.4 build 0256] — 2026-05-13 — fix: fjern CHANGELOG/FEATURES/BUGS/ARCHITECTURE/ISE_API_REFERENCE/START.bat fra update-pakken

**Berørte filer**: `backend/app/services/update_service.py`, `version.json`

Disse seks filer var i `_ALLOWED_PREFIXES` og blev forsøgt skrevet ved deployment — men `/opt/hypervision/` giver portal-processen `[Errno 13] Permission denied` på dem. Fjernet fra listen så de behandles som blokerede (vises i validerings-info, forsøges aldrig skrevet). Update-pakken indeholder nu kun `frontend/`, `backend/app/`, `backend/pyproject.toml` og `version.json`.

## [5.0.3 build 0255] — 2026-05-13 — feat: detail-modal bredere (760px) + condition rows bryder ikke linje

**Berørte filer**: `frontend/css/styles.css`, `version.json`

`.modal.detail-modal` udvidet fra 560px til 760px (`max-width: 96vw`). `.cond-row` ændret fra `flex-wrap: wrap` til `flex-wrap: nowrap` — condition rows (dict/attr/op/val/slet) forbliver nu på én linje. Faste bredder på `.cond-dict` (120px), `.cond-attr` (120px), `.cond-op` (110px) og flex-1 på value-widget.

## [5.0.3 build 0254] — 2026-05-13 — fix: PSK_Mode condition + Endpoint_PSK-KEY profil synkroniseret via fælles flag

**Berørte filer**: `frontend/js/views/browse-detail.js`, `version.json`

Refaktoreret wizard-attribut-læsning: ét fælles `pskActive`-flag (`=== true` strict check) bruges til BÅDE at tilføje betingelsen `EndPoints:PSK_Mode = true` og profilen `Endpoint_PSK-KEY`. De to kan aldrig komme ud af sync. `authzVlan`, `authzAcl` og `groupName` læses også øverst i ét pass.

## [5.0.3 build 0253] — 2026-05-13 — fix: policy wizard profiler mapper til korrekte ISE-profilnavne

**Berørte filer**: `frontend/js/views/browse-detail.js`, `frontend/js/views/policy-condition-builder.js`, `version.json`

AuthzVlan → `Endpoint_VLAN`, AuthzACL → `Endpoint_DACL`, PSK_Mode → `Endpoint_PSK-KEY`. Tilføjet `Endpoint_DACL` til `KNOWN_PROFILES` dropdown. Brugeren kan fortsat tilføje egne profiler via preset-dropdown eller fritekst.

## [5.0.3 build 0252] — 2026-05-13 — fix: autoriseringsprofiler viser nu "AuthzVlan: værdi" + "AuthzACL: værdi"

**Berørte filer**: `frontend/js/views/browse-detail.js`, `version.json`

Profil-tags i wizard viste kun den rå værdi uden kontekst. Nu formateres de som "AuthzVlan: VLAN_100" og "AuthzACL: ACL_PERMIT" så det er tydeligt hvorfra de stammer.

## [5.0.3 build 0251] — 2026-05-13 — fix: AuthzVlan/AuthzACL fjernet fra betingelsessektion i policy wizard

**Berørte filer**: `frontend/js/views/browse-detail.js`, `version.json`

AuthzVlan og AuthzACL hørte ikke til i betingelseslisten — de er autoriseringsprofil-værdier og preudfyldes korrekt i profil-sektionen. Fjernet fra `epAttrs`-arrayet.

## [5.0.3 build 0250] — 2026-05-13 — fix: policy wizard IdentityGroup dropdown + autoriseringsprofiler preudfyldt

**Berørte filer**: `frontend/js/views/policy-condition-builder.js`, `frontend/js/views/browse-detail.js`, `version.json`

To fejl i browse-detail policy wizard: (1) `IdentityGroup:Name`-betingelse viste kun et fritekst-input — nu renderes en `<select>` med alle kendte identity groups (fra `state.groups`) via en generisk lookup-mekanisme i `valueWidgetHtml` (synthetic key `__DictName_AttrName__` i caValues-objektet). (2) Autoriseringsprofiler var altid tomme — wizard preudfylder nu profilerne med endpointets `AuthzVlan`- og `AuthzACL`-værdier.

## [5.0.2 build 0249] — 2026-05-13 — feat: policy wizard preudfylder alle endpoint-attributter + reaktivt detail-vindue

**Berørte filer**: `frontend/js/views/browse-detail.js`, `frontend/css/styles.css`, `version.json`

Policy-wizard (Idé 2) preudfylder nu **alle** endpoint-attributter som betingelser: Owner, Type, Lokation, AuthzVlan, AuthzACL, PlatformType, PSK_Mode (kun hvis aktivt) og IdentityGroup:Name (undtagen Unknown/tomt). Detail-modal har fået `max-height: 90vh; overflow-y: auto` så vinduet aldrig overskrider viewport-højden — scrollbar aktiveres automatisk ved langt indhold (mange betingelser, wizard åben osv.).

## [5.0.1 build 0248] — 2026-05-13 — fix: deployment-opdatering fejler ved PermissionError på read-only filer

**Berørte filer**: `backend/app/services/update_service.py`, `version.json`

`apply_package` kastede fejl ved `[Errno 13] Permission denied` på root-niveau dokumentationsfiler og `START.bat` i Linux-deployment (`/opt/hypervision/`), hvilket markerede hele opdateringen som fejlet. Fix: `PermissionError` fanges nu separat og tilføjes `skipped`-listen (med log-advarsel) i stedet for `errors`-listen — opdateringen fortsætter og lykkes for de filer der kan skrives.

## [5.0.1 build 0247] — 2026-05-13 — fix: policy regel-oprettelse 400 ved kolon i navn + Open API fejlparsing

**Berørte filer**: `frontend/js/views/browse-detail.js`, `backend/app/api/policy.py`, `backend/app/ise/client.py`, `BUGS.md`, `version.json`

ISE Open API kræver regelnavne matcher `^[\w\-\.\(\)\ ]+$`. Tre fixes: (1) standardnavnet i wizard bruger nu `AA-BB-CC-DD-EE-FF` (kolon erstattet med bindestreg). (2) Backend validerer navn mod regex og returnerer 400 med dansk fejlbesked inden ISE-kald. (3) `client.py` parser nu begge fejlformater: ERS (`ERSResponse.messages[0].title`) og Open API (`message`-felt).

## [5.0.1 build 0246] — 2026-05-13 — chore: version bump til 5.0.1

**Berørte filer**: `version.json`, `CHANGELOG.md`

## [5.0.0 build 0245] — 2026-05-13 — refactor: policy condition builder delt modul + caValues-dropdowns

**Berørte filer**: `frontend/js/views/policy-condition-builder.js` (ny), `frontend/js/views/policy.js` (refaktoreret), `frontend/js/views/browse-detail.js` (refaktoreret), `frontend/css/styles.css` (+cond-val-wrap/sel/custom), `version.json`

Udtrukket al condition-builder-logik til delt modul `policy-condition-builder.js` der importeres af både `policy.js` og `browse-detail.js`. Fjernede duplikeret kode (~150 linjer). Værdifelt i condition rows bruger nu kendte værdier fra `caValues` (custom attribute værdier) som dropdown med autocomplete-select for EndPoints-attributter (Owner, Type, Lokation, AuthzVlan m.fl.) — viser alle kendte værdier + "Andet…"-option med fri tekst. `policy.js` fetcher `caValues` via `api.listCustomAttributes()` ved opstart. `browse-detail.js` wizard bruger `state.caValues` der allerede er tilgængeligt. CSS tilføjet for `.cond-val-wrap`, `.cond-val-sel`, `.cond-val-custom`. `#profiles-tags` id erstattet af `.profiles-tags` class.

## [5.0.0 build 0244] — 2026-05-13 — feat: RADIUS Policy Builder (Idé 1 + 2 + 3)

**Berørte filer**: `backend/app/ise/policy.py` (ny), `backend/app/schemas/policy.py` (ny), `backend/app/services/policy_service.py` (ny), `backend/app/api/policy.py` (ny), `backend/app/api/deps.py` (+get_policy_service), `backend/app/main.py` (+policy_router), `frontend/js/views/policy.js` (ny), `frontend/js/views/browse-detail.js` (+policy-sektion), `frontend/js/views/browse.js` (+policy HTML), `frontend/js/api.js` (+policy-metoder), `frontend/js/app.js` (+policy-route), `frontend/index.html` (+nav-link), `frontend/css/styles.css` (+policy CSS), `version.json`, `FEATURES.md`

**Idé 1 — Policy Match Preview**: I browse-detail tilføjet en "RADIUS Policy"-accordion. Brugeren vælger et policy set og klikker "Simuler match" — backend evaluerer endpointets EndPoints-attributter (Owner, Type, Lokation, PSK_Mode, AuthzVlan m.fl.) og IdentityGroup mod policy settets autoriseringsregler (rank-rækkefølge) og returnerer den første regel der matcher, med profiler og per-betingelse OK/FAIL-status. RADIUS-attributter og ConditionReferences markeres som "ikke evalueret (kræver live session)".

**Idé 2 — Rule Builder Wizard**: Fra policy-preview-sektionen i browse-detail: "Opret regel baseret på dette endpoint" åbner en inline wizard med betingelserne preudfyldt fra endpointets Owner, Type og Lokation. Brugeren kan tilrette AND/OR-logik, tilføje/fjerne betingelser, vælge autoriseringsprofiler og oprette reglen direkte i ISE via Open API.

**Idé 3 — Policy Dashboard**: Nyt menupunkt "Politikker" (tilgængeligt for viewer/editor/admin). Tre-pane-layout: policy sets → autoriseringsregler → regeldetalje/editor. Viser conditions som træ (ConditionAndBlock/OrBlock/Reference/Attributes). Editor/admin kan oprette nye regler, redigere og slette (sletning kræver admin). Condition builder med AND/OR-blokke, dictionary/attribut/operator/værdi dropdowns og profilmærker.

**Backend**: ISE Open API `/api/v1/policy/network-access/policy-set` + `{id}/authorization`. Condition-match-simulator i `policy_service.py` evaluerer EndPoints- og IdentityGroup-attributter; unevaluable dicts (Radius, Network) springer over med `skipped=True`. 7 nye API-endpoints under `/api/policy/`.

## [4.2.6 build 0243] — 2026-05-11 — refactor: opsplit settings.js (2788 linjer) i 13 sektionsfiler

**Berørte filer**: `frontend/js/views/settings.js` (ny: 797 linjer), `frontend/js/views/settings/` (ny mappe med 13 filer), `version.json`, `CHANGELOG.md`

`settings.js` er nu en tynd orkestrator med HTML-skabelon + imports. Sektionerne er flyttet til `settings/`: `shared.js` (hjælpefunktioner + tema), `tabs.js`, `section-backend.js`, `section-cache.js`, `section-pxgrid.js`, `section-purge.js`, `section-roles.js`, `section-users.js`, `section-templates.js`, `section-psk.js`, `section-auth.js`, `section-update.js`, `section-prefs.js`. `applyTheme`/`initTheme` re-eksporteres fra `settings.js` så `app.js` er uændret. Ingen funktionel ændring.

## [4.2.6 build 0242] — 2026-05-11 — fix(i18n): fuldfør settings.js oversættelse (update-labels, CSR-beskeder, csv-tpl, pw, dup-ID)

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/js/i18n.js`, `version.json`, `CHANGELOG.md`

Fjernet hardkodet DA fra settings.js: update-card preview-labels (Pakke-info, Filer der opdateres, Blokerede filer) får IDs + t()-binding; CSR-success/download-beskeder bruger `pxgrid_csr_done`/`pxgrid_csr_dl_ok_note`/`pxgrid_csr_dl_fail_note`; csv-template-fejlbeskeder bruger `csv_tpl.*`; frontend-prefs og password-beskeder bruger `prefs.*`; duplikat `id="adv-btn"` på migration-knap fjernet. Nye i18n-nøgler (DA + EN): `settings.update_pkg_info_lbl`, `settings.update_file_list_lbl`, `settings.update_blocked_lbl`, `settings.pxgrid_csr_done`, `settings.pxgrid_csr_dl_ok_note`, `settings.pxgrid_csr_dl_fail_note`.

## [4.2.6 build 0241] — 2026-05-11 — fix(i18n): fuldfør i18n-dækning af settings.js (Advanced, adminCell, TACACS-hint)

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/js/i18n.js`, `version.json`, `CHANGELOG.md`

`initAdvancedSection`: h3 og knaptekst sættes via `t()`, confirm/loading/done-beskeder oversættes. `adminCell` i `renderEndpointRoleCell` bruger nu `t("settings.users_admin_roles")`. `users-section-hint` og `users-tacacs-hint` populeres i `initUsersSection`. Nye i18n-nøgler: `settings.users_section_hint`, `settings.users_tacacs_hint` (DA + EN).

## [4.2.5 build 0240] — 2026-05-11 — fix(i18n): oversæt sidebar "Overvågning" + settings-faner/-undertabs

**Berørte filer**: `frontend/js/i18n.js`, `frontend/index.html`, `frontend/js/app.js`, `frontend/js/views/settings.js`, `version.json`, `CHANGELOG.md`

`nav.monitoring`-nøgle tilføjet (DA: "Overvågning", EN: "Monitoring"). `<span class="nav-group">` i index.html tildelt `data-i18n="nav.monitoring"`. `updateNavLabels()` i app.js opdaterer nu også alle `[data-i18n]`-elementer. Settings-sidens titel, alle 5 hoved-faner og alle undertabs oversættes via nye `settings.tab_*`/`settings.subtab_*`-nøgler.

## [4.2.4 build 0239] — 2026-05-11 — fix(i18n): oversæt hardkodet hint-tekst i DACL-view

**Berørte filer**: `frontend/js/i18n.js`, `frontend/js/views/dacls.js`, `version.json`, `CHANGELOG.md`

`dacl.hint`-nøgle tilføjet i DA og EN; hardkodet dansk paragraf i DACL-view erstattet med `t("dacl.hint")`.

## [4.2.3 build 0238] — 2026-05-11 — fix(i18n): oversæt resterende hardkodede strenge i browse, app, csv-template, metrics, attributes

**Berørte filer**: `frontend/js/i18n.js`, `frontend/js/views/browse.js`, `frontend/js/views/browse-table.js`, `frontend/js/app.js`, `frontend/js/views/csv-template.js`, `frontend/js/views/attributes.js`, `frontend/js/views/metrics.js`, `version.json`, `CHANGELOG.md`

Fase 3 i18n: fuld codebase-audit. Alle resterende hardkodede DA/EN strenge oversat. Browse toolbar-tooltip `title=""`-attributter på alle 6 grupper samt pxGrid-status-badge (PUSH/PULL/inaktiv + endpoint-events) oversættes nu via `t()`. Browse-table: alle dynamiske strenge — save all / gem valgte / CoA-progress / gemt/fejlede, pagination (Side X af Y), filtered/total count, load-spinner og export-beskeder — oversat med `{n}`/`{total}`/`{msg}`-placeholders. App.js: status-dot tekst ("ok"/"down") og rolle-adgangsfejl-besked bruger `t()`. csv-template.js: hele filen oversættes (importerede t() som manglede). metrics.js: circuit-breaker-labels (CLOSED/HALF-OPEN/OPEN) og "hit-rate" oversat. attributes.js: `COA_OPTIONS` konverteret til `getCoaOptions()` der kalder `t()` ved render-tid. Tilføjet ~70 nye nøgler i begge sprogfiler.

## [4.2.2 build 0237] — 2026-05-11 — fix(i18n): oversæt register, import, attributes, dacls, audit, logs, metrics

**Berørte filer**: `frontend/js/i18n.js`, `frontend/js/views/register.js`, `frontend/js/views/import.js`, `frontend/js/views/attributes.js`, `frontend/js/views/dacls.js`, `frontend/js/views/audit.js`, `frontend/js/views/logs.js`, `frontend/js/views/metrics.js`, `version.json`, `CHANGELOG.md`

Fase 2 i18n: alle resterende views oversættes til DA/EN. i18n.js ryddet for duplikerede nøgler og udvidet med ~150 nye nøgler fordelt på 7 sektioner (reg.*, import.*, attr.*, dacl.*, audit.*, logs.*, metrics.*). Alle 7 view-filer importerer nu `t()` og anvender det konsekvent. Statiske opslag som `ACTION_LABEL` i audit og `ATTR_LABELS` i attributes er konverteret til funktioner der kalder `t()` ved render-tid. Dato/tid-formattering i audit og metrics bruger `getLocale()` til at vælge korrekt locale-string (da-DK / en-GB). Metrics-tal-formattering følger ligeledes aktivt locale.

## [4.2.1 build 0236] — 2026-05-10 — fix(i18n): COLUMNS→getColumns() + oversæt alle browse-strenge

**Berørte filer**: `frontend/js/i18n.js`, `frontend/js/views/browse-utils.js`, `frontend/js/views/browse.js`, `frontend/js/views/browse-table.js`, `frontend/js/views/browse-filter.js`, `frontend/js/views/browse-bulk.js`, `frontend/js/views/browse-detail.js`, `version.json`, `CHANGELOG.md`

Bugfix: Kolonneoverskrifter og celleværdier i browse-tabellen blev ikke oversat ved sprogskift fordi `COLUMNS` var et statisk modul-level array evalueret ved import-tid. Rettet ved at konvertere til `getColumns()` funktion der returnerer et nyt array med `t()`-kald ved hvert render. Samme mønster: `fmtRelativeAge()` bruger nu `t("age.*)` i stedet for hardkodede danske strenge. Alle resterende browse-strenge oversat: celleværdier (Statisk/Dynamisk, Ja/Nej), modal-titler og labels (detail + bulk-edit), ANC-badges, PSK-knaptekster, bekræftelsesdialogs og fejlbeskeder. Tilføjet ca. 40 nye i18n-nøgler i begge sprogfiler.

## [4.2.0 build 0235] — 2026-05-10 — feat(i18n): lokalisering dansk/engelsk per bruger + global portal-default

**Berørte filer**: `backend/app/schemas/user.py`, `backend/app/schemas/settings.py`, `backend/app/api/me.py`, `backend/app/api/settings.py`, `backend/app/api/auth.py`, `backend/app/services/settings_service.py`, `backend/app/main.py`, `frontend/js/i18n.js` (ny), `frontend/js/api.js`, `frontend/js/app.js`, `frontend/js/views/login.js`, `frontend/js/views/user-prefs.js`, `frontend/js/views/settings.js`, `frontend/js/views/browse.js`, `frontend/js/views/browse-detail.js`, `version.json`, `CHANGELOG.md`, `FEATURES.md`

Fase 1 i18n-implementering. Portalen understøtter nu dansk og engelsk med følgende prioritetsrækkefølge:
1. Brugerens personlige præference (server-side i `users.json` via `GET/PUT /api/me/prefs`)
2. Portal global default (admin-konfigurerbar via `GET/PUT /api/settings/locale`, gemt i `config.json`)
3. Browser-sprog (`navigator.language`)
4. Hardcoded fallback: `"en"`

`AuthStatus`-response bundler `default_language` (tilgængeligt pre-login). Sprogskift sker øjeblikkeligt via re-render. TACACS+-brugere: server-side `PUT /api/me/prefs` returnerer 403 — præference gemmes i `localStorage` som fallback. Nyt `Sprog`-panel under Settings → Portal Config (kun admin). Sprogvælger i Præferencer for alle brugere.

## [4.1.0 build 0234] — 2026-05-10 — feat(ui): fire frontend-temaer: Light, Dark, Midnight, Slate

**Berørte filer**: `frontend/css/styles.css`, `frontend/js/views/user-prefs.js`, `version.json`, `CHANGELOG.md`

To nye temaer tilføjet via `[data-theme]`-CSS-blokke:
- **Midnight**: dyb marineblå/sort (GitHub Dark-inspireret) med hvid tekst og blå accenter
- **Slate**: neutral grå/blå med mørk sidebar og lyst indholdsareal — professionel mellemtone

Tema-dropdown i Præferencer udvidet med "Midnight" og "Slate". `applyTheme()` kræver ingen ændring.

---

## [4.0.5 build 0233] — 2026-05-10 — docs: opdater al dokumentation til v4.0.5

**Berørte filer**: `README.md`, `docs/INDEX.md`, `docs/01-OVERBLIK.md`, `docs/02-INSTALLATION.md`, `docs/03-BRUGERGUIDE.md`, `docs/04-ADMIN.md`, `docs/05-DRIFT.md`, `version.json`, `CHANGELOG.md`

Komplet dokumentationsopdatering for v4.0.x-serien: Bruger/Operatør-type, kopiér bruger, sidebar Login auth-badge, Præferencer-adfærd for TACACS-brugere, eget System adm-tag fremhævet i lyserød.

---

## [4.0.5 build 0232] — 2026-05-10 — fix(ui): omdøb "Profil" → "Operatør" i type-dropdown for brugere

**Berørte filer**: `frontend/js/views/settings.js`, `version.json`, `CHANGELOG.md`

Type-dropdown viser nu "Bruger" / "Operatør". Bekræftelsestekst ved ændring opdateret tilsvarende.

---

## [4.0.5 build 0231] — 2026-05-10 — fix(ui): farv egen System adm-rolle lyserød i stedet for lyseblå

**Berørte filer**: `frontend/css/styles.css`, `version.json`, `CHANGELOG.md`

`.own-role-chip` ændret fra lyseblå (`#e0f2fe`) til lyserød (`#fee2e2`) med tilsvarende checked- og dark mode-varianter.

---

## [4.0.5 build 0230] — 2026-05-10 — feat(users): fremhæv brugerens egen System adm-rolle med lysblå farve

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/css/styles.css`, `version.json`, `CHANGELOG.md`

System adm-tagget der matcher brugerens eget username (den implicitte/auto-oprettede rolle) vises med lysblå baggrund og fed skrift — både checked og unchecked tilstand, med dark mode variant.

---

## [4.0.4 build 0229] — 2026-05-10 — fix(users): type-valg som dropdown (select) i stedet for klikbar badge

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/css/styles.css`, `version.json`, `CHANGELOG.md`

Type-kolonnen bruger nu en `<select>` med "Bruger" / "Profil" — samme interaktionsmønster som Rolle-kolonnen. Badge-CSS fjernet. Change-handler i tbody trigger API-kald ved valg.

---

## [4.0.4 build 0228] — 2026-05-10 — fix(users): omdøb type-label Operatør → Profil i UI og fejlbeskeder

**Berørte filer**: `frontend/js/views/settings.js`, `backend/app/services/user_service.py`, `version.json`, `CHANGELOG.md`

Badge-label og confirm-dialog bruger nu "Profil" (TACACS+-operatørprofil) i stedet for "Operatør". Intern `user_type`-værdi uændret ("operator"/"user").

---

## [4.0.4 build 0227] — 2026-05-10 — feat(users): Operatør/Bruger-markering med lokal-login-spærring for operatørprofiler

**Berørte filer**: `backend/app/schemas/user.py`, `backend/app/services/user_service.py`, `frontend/js/views/settings.js`, `frontend/css/styles.css`, `version.json`, `CHANGELOG.md`

- Nyt felt `user_type: "user" | "operator"` på bruger-records (default "user", bagud-kompatibelt)
- `UserUpdate` accepterer `user_type` — toggling via eksisterende PUT /api/users/{id}
- Login: operatørprofiler (`user_type=operator`) blokeres fra lokal auth med klar besked; admin-rollen er undtaget
- Brugertabel viser klikkbar type-badge: "Operatør" (amber) / "Bruger" (grå) — klik toggler med confirm-dialog
- Dark mode styling til begge badge-varianter

---

## [4.0.3 build 0226] — 2026-05-10 — fix(users): copy-række styling matcher øvrige inline-former (blå venstre-kant)

**Berørte filer**: `frontend/js/views/settings.js`, `version.json`, `CHANGELOG.md`

Copy-rækkens `<td>` bruger nu `border-left: 3px solid var(--accent)` + stiplet top-kant — samme visuelle mønster som øvrige inline-sektioner i portalen.

---

## [4.0.3 build 0225] — 2026-05-10 — feat(users): kopiér bruger/operatørprofil med præudfyldt navn og kopierede roller/skabeloner

**Berørte filer**: `frontend/js/views/settings.js`, `version.json`, `CHANGELOG.md`

"Kopiér"-knap på hver bruger-række åbner en inline form direkte under rækken. Brugernavn præudfyldes med `<original>_copy` (redigerbart). Rolle, System adm-tags og skabeloner kopieres automatisk til den nye bruger. Password-felt er valgfrit i TACACS+-mode. Duplikerede `_copy`-suffikser undgås (kun ét `_copy` uanset hvor mange gange man kopierer).

---

## [4.0.2 build 0224] — 2026-05-10 — feat(ui): omstrukturér sidebar brugerinfo til struktureret layout

**Berørte filer**: `frontend/index.html`, `frontend/js/app.js`, `frontend/css/styles.css`, `version.json`, `CHANGELOG.md`

Sidebar brugerinfo viser nu:
  backend STATUS: ok / down
  vX.Y.Z build NNNN
  User: <brugernavn>
  Rolle: <rolle>
  Login auth: TACACS+ (blå) / LOCAL (grøn)
  [Log ud]  [Præferencer]

---

## [4.0.2 build 0223] — 2026-05-10 — fix(ui): Præferencer-link synligt for TACACS-brugere — kun password-formular skjules

**Berørte filer**: `frontend/js/app.js`, `version.json`, `CHANGELOG.md`

Præferencer-linket i sidebar vises for alle brugere. Kun selve password-formularen på Præferencer-siden er skjult for TACACS+-brugere.

---

## [4.0.2 build 0222] — 2026-05-10 — feat(ui): TACACS+-badge i sidebar + skjul Præferencer/password-skift for TACACS-brugere

**Berørte filer**: `frontend/js/auth.js`, `frontend/js/app.js`, `frontend/js/views/user-prefs.js`, `frontend/css/styles.css`, `version.json`, `CHANGELOG.md`

- `auth.isTacacs()` dekoder JWT-payload og returnerer true ved `auth_type=tacacs`
- Sidebar viser blåt "TACACS+"-badge ved siden af rolle-badgen for TACACS-brugere
- "Præferencer"-linket i sidebar skjules for TACACS-brugere (ingen password at skifte)
- Præferencer-siden viser informationsbesked i stedet for password-formular for TACACS-brugere
- Frontend-preferences (tema, page size) stadig tilgængeligt for alle

---

## [4.0.1 build 0221] — 2026-05-09 — docs: opdater README + docs/ til v4 (TACACS+, registrant-roller, Portal Auth Config)

**Berørte filer**: `README.md`, `docs/INDEX.md`, `docs/01-OVERBLIK.md`, `docs/02-INSTALLATION.md`, `docs/03-BRUGERGUIDE.md`, `docs/04-ADMIN.md`, `docs/05-DRIFT.md`, `version.json`, `CHANGELOG.md`

Dokumentation opdateret til version 4.0.1: TACACS+-autentisering forklaret (principper, konfiguration, TACACS+-serveropsætning, dataflow-scenarie), Portal Auth Config-sektion tilføjet til 04-ADMIN, registrar → registrant + registrant_templet opdateret overalt, tacacs-plus tilføjet til teknologiliste og forudsætninger, auth_config.json tilføjet til konfigurationsfil-oversigt.

---

## [4.0.1 build 0220] — 2026-05-09 — fix(tacacs): send secret som str, ikke bytes (six.b() kalder .encode() internt)

**Berørte filer**: `backend/app/services/tacacs_service.py`, `version.json`, `CHANGELOG.md`

`crypt()` i tacacs-plus 2.6 pakker secret via `six.b(secret)` som kalder `.encode()`. Sendes secret allerede som bytes, fejler det med `'bytes' object has no attribute 'encode'`. Rettede til at sende secret som plain str.

---

## [4.0.1 build 0219] — 2026-05-09 — fix(tacacs): TAC_PLUS_AUTHEN_TYPE_ASCII importeres fra tacacs_plus.client, ikke .packet

**Berørte filer**: `backend/app/services/tacacs_service.py`, `version.json`, `CHANGELOG.md`

Konstanten lever i `tacacs_plus.client` i version 2.6 — ikke i `tacacs_plus.packet`. Rettede import så TACACS+-test og login ikke fejler med `AttributeError`.

---

## [4.0.1 build 0218] — 2026-05-09 — fix(auth): fjern separat operatørprofil-katalog, brugere i users.json er nu profiler i TACACS+-mode

**Berørte filer**:
- `frontend/js/views/settings.js` — fjernet Operatørprofiler-CRUD-blok fra Portal Auth Config; password-felt valgfrit i TACACS+-mode
- `backend/app/main.py` — fjernet operator_profiles_api router (ubrugt)
- `version.json`, `CHANGELOG.md`

**Beskrivelse**:
Droppes det separate `operator_profiles.json`-katalog. Brugere i `users.json` fungerer nu direkte som operatørprofiler i TACACS+-mode: TACACS+-serveren returnerer `portal-operator-profile`-attributten, portalen slår brugernavnet op og bruger rolle + endpoint-roller + skabeloner derfra. Password-feltet i opret-bruger-formularen er ikke påkrævet i TACACS+-mode.

---

## [4.0.0 build 0217] — 2026-05-09 — feat(auth): TACACS+ portal-autentisering + operatørprofiler + registrar→registrant rename

**Berørte filer**:
- `backend/app/services/tacacs_service.py` (ny)
- `backend/app/core/auth_config_store.py` (ny)
- `backend/app/core/operator_profile_store.py` (ny)
- `backend/app/schemas/operator_profile.py` (ny)
- `backend/app/api/operator_profiles.py` (ny)
- `backend/app/core/auth.py` (+create_tacacs_token)
- `backend/app/api/deps.py` (+TACACS+ transient user)
- `backend/app/api/auth.py` (+TACACS+ login-gren, auth_status, change_password)
- `backend/app/services/user_service.py` (+TACACS+ login flow)
- `backend/app/api/settings.py` (+auth_config_router)
- `backend/app/services/settings_service.py` (+portal auth config service)
- `backend/app/schemas/settings.py` (+PortalAuthConfig*, TacacsTest*)
- `backend/app/schemas/user.py` (registrar→registrant, registrar_templet→registrant_templet)
- `backend/app/api/templates.py` (registrar_templet→registrant_templet)
- `backend/app/main.py` (+operator_profiles router, +auth_config_router, +role migration)
- `backend/pyproject.toml` (+tacacs-plus>=2.8)
- `frontend/js/views/settings.js` (+Portal Auth Config tab, +operator profil UI, +mode-aware labels)
- `frontend/js/api.js` (+getPortalAuthConfig, +updatePortalAuthConfig, +testTacacs, +operatørprofil CRUD)
- `frontend/js/app.js` (registrar→registrant)
- `frontend/js/views/register.js` (registrar_templet→registrant_templet)
- `version.json`

**Ændringer**:
- TACACS+ auth: portal sender credentials til TACACS+-server (TCP/49). Ved Access-Accept hentes rolle (`portal-role`) og operatørprofil (`portal-operator-profile`) fra server-attributter.
- Admin-brugere: valideres ALTID lokalt uanset TACACS+-konfiguration.
- Fallback til lokal auth ved TACACS+-nedbrud (konfigurerbart `tacacs_fallback_to_local`).
- Operatørprofiler: katalog med profilnavn → standard-rolle + endpoint-roller. TACACS+-login slår profil op og arver roller.
- TACACS+-brugere: ingen lokal record — al info i JWT (transient session). Saved views og per-bruger overrides ikke tilgængelige.
- Ny `create_tacacs_token()` med `auth_type=tacacs` og `endpoint_roles` i payload.
- `get_current_user()` i deps.py: TACACS+-token path opretter transient User-objekt fra token uden users.json-opslag.
- Ny settings-tab "Portal Auth Config": server-host/port/secret/timeout, fallback-toggle, attribut-mapping, TACACS+ test-login, operatørprofil-katalog.
- Startup-migration: eksisterende `users.json` med rolle "registrar"/"registrar_templet" omdøbes til "registrant"/"registrant_templet".
- Rolleomdøbning: `registrar`→`registrant`, `registrar_templet`→`registrant_templet` overalt i backend + frontend for konsistens med TACACS+-attribut-konvention.
- UI: "Brugernavn"-kolonne i bruger-tabel omdøbt til "Brugernavn/Operatør profil" med mode-aware tekst.
- Oprettet `backend/auth_config.json` og `backend/operator_profiles.json` (gitignored).

---

## [3.30.2 build 0216] — 2026-05-08 — fix(nav): saml Log/Audit/Metrics under "Overvågning"-gruppe i sidebar

**Berørte filer**: `frontend/index.html`, `frontend/css/styles.css`, `version.json`

- Tilføjet `.nav-group` CSS: ikke-klikbar sektion-label i sidebar (uppercase, dæmpet farve)
- Log, Audit og Metrics er nu sub-links under "Overvågning"-headeren

---

## [3.30.1 build 0215] — 2026-05-08 — fix(nav): omdøb "ACL" → "DACL" i sidebar

**Berørte filer**: `frontend/index.html`, `version.json`

- Sidebar-link `#/dacls` label ændret fra "ACL" til "DACL"

---

## [3.30.1 build 0214] — 2026-05-08 — chore: PATCH-bump + tilføj manglende FEATURES.md-entries for browse-features

**Berørte filer**: `version.json`, `FEATURES.md`, `CHANGELOG.md`

- Bumpet version 3.30.0 → 3.30.1 (PATCH for bugfix i b0213 manglede PATCH-increment)
- Tilføjet FEATURES.md-entries for: fjern ISE server-side MAC-filter (b0210) og klik-sortering på alle kolonner (b0212)

---

## [3.30.0 build 0213] — 2026-05-08 — fix(browse): "Ryd alle filtre" nulstiller nu filtre og sort korrekt

**Berørte filer**: `frontend/js/views/browse-filter.js`, `BUGS.md`, `version.json`

- Fjernet ugyldig reference til `filterFieldSel`/`filterOpSel` (fjernet i b0210) i `views-clear`-handler
- Tilføjet `state.sortCol`/`state.sortDir` reset + `updateSortHeaders()` i `applyFilterSnapshot()` — nulstiller nu sort ved Ryd alle, Apply view og Restore

---

## [3.30.0 build 0212] — 2026-05-08 — feat(browse): klik-sortering på alle kolonner, fjern Alder-filter fra toolbar

**Berørte filer**: `frontend/js/views/browse.js`, `frontend/js/views/browse-filter.js`, `frontend/css/styles.css`, `version.json`

- Fjernet `age-filter-wrap` (— Alder — dropdown + dage-input) fra browse-toolbar
- Alle kolonnehoveder er nu klikbare: klik 1 → ↑ (A→Z / ældst først), klik 2 → ↓ (Z→A / nyest først), klik 3 → ingen sortering
- Alder-kolonnen sorterer på faktisk timestamp; alle andre kolonner sorterer alfabetisk
- Erstattet `ageSort`/`ageDaysFilter` state med generisk `sortCol`/`sortDir`
- Fjernet `applyAgeFilter`, age-event-listeners og gammel age-header-klik-kode
- Tilføjet CSS: `.sortable-col` (cursor + hover), `.sort-active` (blå label i lys/mørk tema)

---

## [3.30.0 build 0211] — 2026-05-08 — fix(browse): fjern tilbageværende referencer til buildServerFilters/triggerFilterChange i return-objekt

**Berørte filer**: `frontend/js/views/browse-filter.js`, `version.json`

- Fjernet `buildServerFilters` og `triggerFilterChange` fra return-objektet i `initFilter()` — begge funktioner er slettet i b0210

---

## [3.30.0 build 0210] — 2026-05-08 — feat(browse): fjern ISE server-side MAC-filter fra browse-toolbar

**Berørte filer**: `frontend/js/views/browse.js`, `frontend/js/views/browse-filter.js`, `version.json`

- Fjernet `<div class="server-filter">` HTML-blok (MAC/CONTAINS dropdown + value input) fra browse-toolbar
- Fjernet DOM-selectors: `filterFieldSel`, `filterOpSel`, `filterValueInp`
- Fjernet `buildServerFilters()` og `triggerFilterChange()` funktioner
- Forenklet `anyFilterActive()`: server-filter-led fjernet
- Ryddet `snapshotFilters()` og `applyFilterSnapshot()` for server-filter persistens
- `state.currentFilters` fastholdes som `[]` (bruges stadig i API-kald i browse-table.js)

---

## [3.30.0 build 0209] — 2026-05-08 — fix(settings): omdøb sub-tabs i Portal Bruger Config

**Berørte filer**: `frontend/js/views/settings.js`, `version.json`

**Ændring**: Sub-tab labels og kortoverskrifter i Portal Bruger Config omdøbt: "System adm" → "Endpoint grupper", "Brugere & Roller" → "Brugere & Bruger grupper".

## [3.30.0 build 0208] — 2026-05-08 — fix(settings): Skabeloner flyttet til Portal Bruger Config

**Berørte filer**: `frontend/js/views/settings.js`, `version.json`

**Ændring**: Skabeloner (endpoint-skabeloner) er nu sub-tab under **Portal Bruger Config** (System adm · Brugere & Roller · Skabeloner). Portal Config sub-tabs er nu: PSK-politik · ISE Purge Config · Opdatering · Avanceret.

## [3.30.0 build 0207] — 2026-05-08 — fix(settings): PSK-politik som første sub-tab i Portal Config

**Berørte filer**: `frontend/js/views/settings.js`, `version.json`

**Ændring**: Rækkefølge i Portal Config sub-tabs rettet til PSK-politik · Skabeloner · ISE Purge Config · Opdatering · Avanceret.

## [3.30.0 build 0206] — 2026-05-08 — feat(settings): sub-tab navigation inden for hoved-tabs i Settings

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/css/styles.css`, `version.json`

**Ændring**: Indhold inden for hver Settings-hoved-tab er nu opdelt i separate sub-menu valg (kun ét underpunkt vises ad gangen):
- **ISE Forbindelse Config**: REST API / PxGrid
- **Portal Bruger Config**: System adm / Brugere & Roller
- **Portal Config**: Skabeloner / PSK-politik / ISE Purge Config / Opdatering / Avanceret

Implementeret med flydende `.settings-subtab-nav[data-for-tab]` bars og `.card[data-subtab]` attributter. Tab-navigations-logik udvidet med `activeSubTab`-map der tracker aktivt underpunkt pr. hoved-tab. Editor-psk brugere ser Portal Config uden sub-nav (kun PSK-politik kort direkte). CSS tilføjet for `.settings-subtab-nav` og `.settings-subtab` med dark-mode support.

## [3.30.0 build 0205] — 2026-05-08 — feat(settings): omstrukturering af Settings-menu + bruger-preferences i sidebar

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/js/views/user-prefs.js` (ny), `frontend/js/views/csv-template.js` (ny), `frontend/js/app.js`, `frontend/index.html`, `frontend/css/styles.css`, `FEATURES.md`, `version.json`

**Ændring**: Settings-faner reduceret fra 10 til 4 via logisk konsolidering:
- **ISE Forbindelse Config** — REST API-forbindelsen + PxGrid samlet i én fane
- **Portal Performance** — omdøbt fra "Performance"
- **Portal Bruger Config** — omdøbt fra "Adgang"
- **Portal Config** — ny samlet fane med: Skabeloner, PSK-politik, ISE-config, Opdatering, Avanceret

Konto-fanen fjernet fra Settings:
- Password-skift + frontend-præferencer → ny `#/user-prefs` route (link "Præferencer" i sidebar bruger-info-sektion)
- CSV Export Template → ny `#/csv-template` route (sidebar som indrykket sub-link under "Import fra CSV")

Settings-siden er nu kun synlig for admin og editor-psk. Alle andre roller har `#/user-prefs` til personlige indstillinger.

## [3.29.3 build 0204] — 2026-05-08 — fix(browse): custom attribut-dropdowns forældede ved aktivt filter

**Berørte filer**: `frontend/js/views/browse-detail.js`, `BUGS.md`

**Ændring**: `openDetail` hentede endpoint-detail og tegnede dropdowns med det samme `state.caValues` der lå i hukommelsen fra sidst `load()` kørte. Hvis backenden opdagede nye custom attributter under `_fetch_endpoint_detail` (via `auto_discover_values`), så afspejlede dropdowns dem ikke — fordi `load()` ikke kørte igen ved aktivt filter. Fix: efter `api.getEndpoint(id)` hentes `api.listCustomAttributes()` sekventielt (ikke parallelt — JSON-skrivet skal nå at lande), og `state.caValues` opdateres in-place inden dropdowns renderes. Næste `renderRows`/`refreshRows` bruger også de friske værdier.

---

## [3.29.2 build 0203] — 2026-05-08 — chore: ret "CA-værdier" → "custom attributter" + stavefejl i attributes.js

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/js/views/attributes.js`, `backend/app/core/custom_attr_store.py`, `CHANGELOG.md`, `FEATURES.md`

**Ændring**: Konsekvente tekstrettelser: "CA-værdier" erstattet med "custom attributter" alle steder (UI, log, docs). Stavefejl i attributes.js rettet: "Attribut-vaerdier" → "Custom attributter", "Administrer de tilladte vaerdier" → "Administrér de tilladte værdier", "Vaerdierne" → "Værdierne".

---

## [3.29.2 build 0202] — 2026-05-08 — feat: auto-opdagelse af custom attributter ved endpoint-visning

**Berørte filer**: `backend/app/core/custom_attr_store.py`, `backend/app/services/endpoint_service.py`, `FEATURES.md`

**Ændring**: Passiv discovery af custom attributter: når `_fetch_endpoint_detail` henter et endpoint fra ISE, sammenlignes dets custom attributter for alle MANAGED_ATTRS (Type, Owner, Lokation, AuthzVlan, AuthzACL, PlatformType) med portalens kendte dropdown-værdier. Ukendte ikke-tomme værdier tilføjes automatisk til `custom_attr_values.json` og logges til `app.log`. In-memory cache i `custom_attr_store` (`_cache`) sikrer disk kun læses én gang pr. server-opstart — alle efterfølgende kald er dict-lookup. `load_values()` og `save_values()` opdaterer cachen in-place. Ny funktion `auto_discover_values(ca)` returnerer `True` hvis noget nyt blev gemt.

---

## [3.29.1 build 0201] — 2026-05-08 — refactor: flyt "Sync fra ISE" til Settings → Avanceret

**Berørte filer**: `frontend/js/views/settings.js`, `frontend/js/views/attributes.js`

**Ændring**: "Sync fra ISE"-knappen fjernet fra Attributter-siden (var en N×ISE-kald migrationsoperation, ikke løbende vedligehold). Genimplementeret som "Importér custom attributter fra ISE" under Settings → Avanceret-fane (kun synlig for admin). Ny fane tilføjet i settings-nav. Bekræftelsesdialog advarer om omfang og belastning. Resultats-visning viser antal scannede endpoints og importerede værdier.

---

## [3.29.0 build 0200] — 2026-05-08 — feat(modularisering): browse.js opdelt i 6 moduler

**Berørte filer**: `frontend/js/views/browse.js` (rewritten), `browse-utils.js` (ny), `browse-filter.js` (ny), `browse-table.js` (ny), `browse-detail.js` (ny), `browse-bulk.js` (ny), `FEATURES.md`

**Ændring**: 2236-linje monolitfil opdelt i 6 selvstændige ES-moduler uden funktionsændringer. Delt mutable `state`-objekt indeholder al runtime-data (allRows, groups, caValues, dirtyIds, pxGrid-state m.fl.). `cb`-callbacks-objekt populeres efter alle modul-inits og bruges til krydskald (late binding løser cirkulære afhæniggheder). Moduler: `browse-utils.js` (106 linjer, pure utilities + COLUMNS), `browse-filter.js` (409 linjer, filter-toolbar + saved views), `browse-table.js` (516 linjer, render + inline-edit + pagination + col-vis + save/export), `browse-detail.js` (273 linjer, detail-modal + ANC + CoA + d-save), `browse-bulk.js` (190 linjer, bulk-edit-modal + bulk-delete + bulk-disconnect). `browse.js` er nu 465-linje orchestrator (HTML-template + state-oprettelse + pxGrid-stream + CoA-toggle + module-init).

## [3.28.2 build 0199] — 2026-05-08 — fix(alder): audit-fallback for tomme timestamps

**Berørte filer**: `backend/app/core/audit_store.py`, `backend/app/services/endpoint_service.py`

**Bug**: Alder-kolonnen viste intet for eksisterende endpoints fordi ERS ikke returnerer timestamps og `HypervisionRegisteredAt` CA kun eksisterer på endpoints oprettet efter v3.28.0.

**Fix**: `audit_store.get_endpoint_create_time(endpoint_id)` forespørger `MIN(ts)` fra `audit_events WHERE resource_type='endpoint' AND action='created' GROUP BY resource_id` og bygger et in-memory dict ved første opkald. `_fetch_endpoint_detail` bruger dette som tredje fallback (efter ISE-timestamps og CA). `record_endpoint_create_time()` opdaterer cachen synkront ved nye oprettelser så nye endpoints også straks får alder uden at reloade.

## [3.28.1 build 0198] — 2026-05-08 — fix(profiler): non-blokerende baggrunds-load

**Berørte filer**: `backend/app/ise/profiler.py`, `backend/app/services/endpoint_service.py`

**Bug**: `profiler._cache_lock` blev holdt mens `_load_all` lavede paginerede ISE-kald mod `/ers/config/profilerprofile` (100+ profiler = 5+ API-kald). Alle 5 samtidige `_fetch_endpoint_detail`-tasks ventede på låsen → browse hang på "Henter detaljer fra ISE..." og ISE-circuit-breakeren åbnede (503).

**Fix**: `resolve_name` blokerer aldrig. `ensure_loaded(client)` starter en `asyncio.ensure_future`-baggrundstask første gang; `resolve_name_sync` er et rent dict-opslag (ingen lock, ingen ISE-kald). `_fetch_endpoint_detail` kalder `ensure_loaded` + `resolve_name_sync` — begge returner øjeblikkeligt. Profiler-navne vises fra næste Browse-load (typisk < 5s) når baggrundstasken er færdig.

## [3.28.0 build 0197] — 2026-05-08 — Endpoint-alder filter/sort + ISE Profiler-data

**Berørte filer**: `backend/app/schemas/endpoint.py`, `backend/app/core/custom_attr_store.py`, `backend/app/ise/profiler.py` (ny), `backend/app/services/endpoint_service.py`, `frontend/js/views/browse.js`, `frontend/css/styles.css`

### Endpoint-alder: sort og filter (3.28.0)
- **Open API-mode**: ISE `createTime` + `updateTime` parses direkte fra endpoint-svar og gemmes i `EndpointDetail.create_time` / `update_time`
- **ERS-mode**: ny skjult custom attr `HypervisionRegisteredAt` (ISO 8601 UTC) stemples automatisk ved `create_endpoint` og `bulk_create` — fungerer som permanent fallback-timestamp
- `REGISTERED_AT_ATTR = "HypervisionRegisteredAt"` tilføjet til `HIDDEN_ATTRS` (auto-bootstrappes i ISE)
- **Browse — ny "Alder"-kolonne**: viser relativ tid (fx "3 mdr.", "45 dage") med fuldt dato+tid som tooltip
- **Klik på "Alder"-header**: toggle sort nyeste ↓ / ældste ↑ / ingen (→ filter-mode aktiveres automatisk)
- **Toolbar age-filter**: dropdown "Ældre end" / "Nyere end" + dage-input; client-side filter i filter-mode
- `applyFiltersToRows` udvidet med age-filter + age-sort logik
- `needsFilterMode` opdateret til at inkludere age-filter + age-sort

### ISE Profiler-data i detail-modal (3.28.0)
- **Ny `backend/app/ise/profiler.py`**: slår profil-navn op fra `profileId` UUID via `/ers/config/profilerprofile` — in-memory cache loaded on first use, invalidated ved settings-change
- **`EndpointDetail.profiler_name`**: nyt felt populeret ved `_fetch_endpoint_detail` via `profiler_module.resolve_name()`
- **Group-name + profiler-name fetches parallelt** via `asyncio.gather` for nul overhead
- **Detail-modal**: nye rækker "Profil-navn", "Registreret" (create_time) og "Sidst opdateret" (update_time)
- CSS: `.age-filter-wrap`, `.age-filter-mode`, `.age-filter-days`, `td.age-cell` + dark-mode varianter

## [3.27.0 build 0196] — 2026-05-08 — Versionsbump til 3.27.0

**Berørte filer**: `version.json`

- MINOR-bump fra 3.26.0 → 3.27.0

## [3.27.0 build 0195] — 2026-05-08 — Kodebase-analyse + fremtidige features registreret

**Berørte filer**: `FEATURES.md`

- Fuld kodebase-analyse gennemført: kortlagt alle API-endpoints, services, ISE-integrationer, frontend-views og teknisk gæld
- Tilføjet 12 nye planlagte features til `FEATURES.md` fordelt på tre prioritetsniveauer:
  - **Prioritet 1**: Endpoint-alder filter/sort, SGT-tildeling, Webhook til CMDB, ISE Profiler-data
  - **Prioritet 2**: Multi-ISE HA failover, Metrics-historik, Bulk template-anvendelse, Decommission-flow, Filter-deling via URL, JSON-eksport
  - **Prioritet 3**: browse.js modularisering, Session anomali-detektion, Access token silent refresh
- Endpoint-alder feature analyseret i detalje: Open API-mode bruger `createTime`/`updateTime` fra ISE; ERS-mode bruger ny skjult custom attr `HypervisionRegisteredAt` stemplet ved oprettelse

---

## [3.26.0 build 0194] — 2026-05-08 — feat(anc): ANC quarantine actions i endpoint detail-modal

**`backend/app/ise/anc.py`** (ny):
- `list_policies()` — GET `/ers/config/ancpolicy` — henter alle ANC policy-navne fra ISE
- `apply(mac, policy_name)` — POST `/ers/config/ancendpoint/apply` — sætter endpoint i karantæne
- `clear(mac)` — POST `/ers/config/ancendpoint/clear` — fjerner karantæne
- `get_endpoint_status(mac)` — GET `/ers/config/ancendpoint?filter=macAddress.EQ.{mac}` + detalje-GET — returnerer aktiv policy eller None

**`backend/app/schemas/endpoint.py`**:
- Ny `AncPoliciesResponse`, `AncStatusResponse`, `AncQuarantineRequest`, `AncActionResponse`

**`backend/app/services/endpoint_service.py`**:
- Ny `list_anc_policies()`, `anc_status()`, `anc_quarantine()`, `anc_clear()` — audit-logger quarantine/clear

**`backend/app/api/endpoints.py`**:
- `GET /api/endpoints/anc-policies` — lister policies (editor+)
- `GET /api/endpoints/{id}/anc-status` — henter nuværende ANC-status
- `POST /api/endpoints/{id}/anc-quarantine` — sætter karantæne (body: `{policy_name}`)
- `POST /api/endpoints/{id}/anc-clear` — fjerner karantæne

**`frontend/js/api.js`**: +`listAncPolicies`, `ancStatus`, `ancQuarantine`, `ancClear`

**`frontend/js/views/browse.js`**:
- ANC-sektion i endpoint detail-modal (editor/admin): viser badge (Fri/Karantæne: policy), policy-dropdown + "Sæt i karantæne"-knap, "Fjern karantæne"-knap
- `loadAncStatus()` henter status async efter modal åbner — ingen forsinkelse af modal-åbning
- ANC policy-liste caches pr. session

**`frontend/css/styles.css`**: `.anc-section`, `.anc-badge`, `.anc-free`, `.anc-quarantined`, dark-mode varianter

---

## [3.25.5 build 0193] — 2026-05-08 — fix(cache): disk-cache indlæses synkront ved opstart — ingen race-condition

**`backend/app/services/cache_prewarm.py`**:
- Ny `preload_disk_cache()` metode der indlæser disk-cachen synkront
- `_run()` springer disk-load over hvis `preload_disk_cache()` allerede kørte (tjekker `status.disk_loaded`)
- `start()` bevarer `disk_loaded`-tæller fra preload i ny `PrewarmStatus`

**`backend/app/main.py`**:
- Kalder `get_prewarm_worker().preload_disk_cache()` synkront *før* `yield` — disk-entries er garanteret indlæst inden FastAPI begynder at serve HTTP-requests

---

## [3.25.4 build 0192] — 2026-05-08 — fix(auth): token udløber nu korrekt — client-side exp-tjek + 8h TTL

**`frontend/js/auth.js`**:
- Tilføjet `isTokenExpired()` der dekoder token-payload client-side og tjekker `exp`-feltet uden at kalde backend

**`frontend/js/app.js`**:
- `boot()` kalder nu `auth.isTokenExpired()` inden `authStatus()`-kaldet — udløbet token ryddes straks uden at afvente backend-svar
- catch-blok i `boot()` rydder nu session og viser login i stedet for blindt at bruge cached bruger når backend er utilgængelig

**`backend/app/core/auth.py`**:
- `TOKEN_TTL_SECONDS` reduceret fra 24 h til 8 h

**`BUGS.md`**: Bug registreret og markeret fixed.

---

## [3.25.3 build 0191] — 2026-05-07 — fix(templates): viewer fjernet fra skabelon-synlighed

**`frontend/js/views/settings.js`**:
- `viewer` fjernet fra "Synlig for roller" checkboxes — viewer kan ikke oprette endpoints og har ingen brug for skabeloner
- `renderTemplateCell()` viser "—" for viewer-brugere i brugertabellen

---

## [3.25.3 build 0190] — 2026-05-07 — feat(users): synlige skabeloner vist pr. bruger i Adgang-tabellen

**`frontend/js/views/settings.js`**:
- `renderTemplateCell()` viser nu effektiv skabelonadgang for alle roller:
  - `admin` → "Alle (N)" (læs: altid fuld adgang)
  - `registrar_templet` → redigerbare checkboxes som før (admin tildeler eksplicit)
  - Alle andre roller (`editor`, `editor-psk`, `viewer`, `registrar`) → read-only tags med skabeloner der matcher `visible_to` (tom liste = alle; ellers kun matchende)
  - Ingen matchende skabeloner → "Ingen adgang"
- Ny hjælpefunktion `visibleTemplatesForRole(role)` beregner effektiv liste

---

## [3.25.3 build 0189] — 2026-05-07 — style+copy: skabelon-formular layout + hint-tekst

**`frontend/js/views/settings.js`**:
- Skabelon-redigér-formular pakket i `<form onsubmit="return false;">` så `.field`-CSS (flex-column) virker korrekt — felter stacker nu pænt under hinanden
- `editor` tilføjet som checkbox under "Synlig for roller"
- Hint-tekst opdateret: "plus admin/editor" → "admin se alle roller default"

**`frontend/css/styles.css`**:
- Ny `.checkbox-label` utility-klasse (inline-flex, gap, cursor:pointer)

---

## [3.25.2 build 0185] — 2026-05-07 — fix(update): genstart-knap permanent synlig i Settings/Opdatering

**`frontend/js/views/settings.js`**:
- "Genstart server"-knappen lå i `#update-result.hidden` og forsvandt efter global `.hidden`-CSS-fix
- Knappen flyttet til permanent-synlig sektion under upload-formularen
- Restart-besked vises nu i `#update-msg` frem for `#update-result-msg`

---

## [3.25.3 build 0186] — 2026-05-07 — fix(users): skabeloner opdateres live uden manuel reload

**`frontend/js/views/settings.js`**:
- `allTemplates`-fetch flyttet fra `initUsersSection`-init til `reload()` så nyoprettede skabeloner er synlige i brugertabellen uden sideopdatering

---

## [3.25.1 build 0184] — 2026-05-07 — feat+fix: per-bruger skabelontildeling + registrar_templet-rename + nav-lås

**`backend/app/schemas/user.py`**:
- Rolle `registrant` omdøbt til `registrar_templet`
- Nyt felt `assigned_templates: list[str]` på `User`
- Ny `UserTemplates`-schema (body for PUT `/users/{id}/templates`)

**`backend/app/api/deps.py`**:
- `get_current_user` populerer `assigned_templates` fra user-record
- Alle rolle-referencer opdateret til `registrar_templet`

**`backend/app/api/users.py`**:
- Ny `PUT /api/users/{user_id}/templates` — admin tildeler skabeloner til `registrar_templet`-bruger

**`backend/app/services/user_service.py`**:
- `_to_public()` inkluderer `assigned_templates`
- Ny `set_user_templates()` — validerer IDs mod skabelon-katalog, gemmer, audit-logger

**`backend/app/api/templates.py`**:
- `registrar_templet` med `assigned_templates` → ser kun tildelte skabeloner; uden tildeling → `visible_to`-filtrering

**`frontend/js/api.js`**:
- Ny `setUserTemplates(id, template_ids)`

**`frontend/js/views/settings.js`**:
- Users-tabel: ny "Skabeloner (registrar_templet)"-kolonne med checkboxes for `registrar_templet`-brugere
- `initUsersSection` henter templates og renderer `user-tpl-chip` checkboxes
- `change`-handler for `.user-tpl-chip` kalder `api.setUserTemplates()`

**`frontend/js/app.js`**:
- `registrar` og `registrar_templet` fjernet fra `settings`-routens roller — de lander direkte på Registrér ved login og kan ikke tilgå Settings

---

## [3.25.0 build 0180] — 2026-05-07 — feat(templates): synlighed per rolle + registrar_templet-systemrolle

**`backend/app/schemas/user.py`**:
- Tilføjet `"registrant"` til `Role` Literal og `ROLE_VALUES`

**`backend/app/api/deps.py`**:
- `require_create_endpoint` og `require_register_lookup` inkluderer nu `"registrant"`

**`backend/app/schemas/template.py`**:
- `Template`, `TemplateCreate`, `TemplateUpdate` — nyt felt `visible_to: list[str]`

**`backend/app/core/template_store.py`**:
- `add_template(visible_to=)` og `update_template(visible_to=)` — gemmer adgangslisten

**`backend/app/api/templates.py`**:
- `GET /api/templates` filtrerer nu: admin/editor ser alle; andre roller ser kun skabeloner hvor `visible_to` er tom (alle) eller indeholder deres rolle
- `_coerce()` normaliserer `visible_to` til liste

**`frontend/js/views/settings.js`**:
- Skabelon-formular: checkboxes for `visible_to` (editor-psk, viewer, registrar, registrant) — tom = synlig for alle
- Skabelon-tabel: ny "Synlig for"-kolonne
- `fillForm()` / `resetForm()` / `buildPayload()` håndterer `visible_to`
- Brugertabel og opret-form: `registrant` tilføjet til rolle-dropdowns
- Hint-tekst opdateret med forklaring af `registrant`-rollen

**`frontend/js/views/register.js`**:
- `isRegistrant`-detektering baseret på `user.role === "registrant"`
- Registrant: gruppe, custom attrs, PSK og System adm-sektion skjult via `r-advanced-section hidden`
- Registrant: template-row altid synlig; "Ingen skabeloner"-blokeringsbesked hvis katalog er tomt
- Submit-validering: registrant skal vælge skabelon inden indsendelse

**`frontend/js/app.js`**:
- `register` og `settings` routes inkluderer `registrant`
- `currentRoute()`, `isChromelessRoute()`, `showLogin()` behandler `registrant` som `registrar`

---

## [3.24.0 build 0178] — 2026-05-07 — feat(templates): endpoint-skabeloner Phase 3-5

**`backend/app/core/template_store.py`** (ny):
- JSON-baseret skabelon-katalog (`backend/templates.json`); delt, ikke per-bruger
- `load_templates()`, `save_templates()`, `get_template(id)`, `add_template()`, `update_template()`, `delete_template()`
- Auto-genereret UUID + `created_at` ISO-timestamp pr. skabelon

**`backend/app/schemas/template.py`** (ny):
- `TemplateFields`: `group_id`, `description`, `static_group_assignment`, `custom_attributes: dict[str, str]`
- `Template`, `TemplateCreate`, `TemplateUpdate`, `TemplateListResponse`

**`backend/app/api/templates.py`** (ny):
- `GET /api/templates` → `require_register_lookup` (alle inkl. registrar)
- `POST /api/templates` → `require_editor` (admin + editor)
- `GET /api/templates/{id}` → `require_register_lookup`
- `PUT /api/templates/{id}` → `require_editor`
- `DELETE /api/templates/{id}` → `require_editor`
- `_coerce()` normaliserer store-records til TemplateFields-kompatibel dict

**`backend/app/main.py`**:
- Registreret `templates_api.router`

**`frontend/js/api.js`**:
- `listTemplates`, `getTemplate`, `createTemplate`, `updateTemplate`, `deleteTemplate`

**`frontend/js/views/register.js`**:
- "📋 Skabelon"-dropdown øverst i registreringsformularen
- `applyTemplate(tplId)` pre-udfylder group, description og custom attributes
- Dropdown skjult hvis ingen skabeloner er defineret

**`frontend/js/views/settings.js`**:
- Ny Settings-tab "Skabeloner" (kun synlig for admin/editor)
- `initTemplatesSection()`: tabel med alle skabeloner, opret/redigér/slet
- Formular med name, description, group-dropdown, endpoint-description, custom-attributes-dropdowns, static-group-assignment

---

## [3.23.0 build 0177] — 2026-05-07 — test: bulk-operationer (13 tests)

**`backend/tests/test_bulk_create.py`** (ny):
- `test_bulk_all_succeed` — alle items succeeds + `invalidate_all()` kaldt
- `test_bulk_skip_on_409_no_overwrite` — 409 → skipped, ingen cache-invalidation
- `test_bulk_skip_on_500_already_exists` — ISE ERS 3.4 "already exists" 500 → skipped
- `test_bulk_overwrite_on_conflict` — 409 + overwrite=True → overwritten + cache invalideret
- `test_bulk_overwrite_fails_with_ise_error` — `_overwrite_existing` fejler → failed, ingen invalidation
- `test_bulk_overwrite_fails_not_found` — `_overwrite_existing` kaster ValueError → failed
- `test_bulk_non_conflict_error_goes_to_failed` — 400-fejl → failed (ikke conflict)
- `test_bulk_mixed_outcomes` — success + overwritten + 2×failed i én request
- `test_bulk_no_cache_invalidation_when_all_skipped` — kun skips → ingen invalidation
- `test_bulk_no_cache_invalidation_when_all_failed` — kun fails → ingen invalidation
- `test_bulk_semaphore_caps_concurrency` — max aktive tasks ≤ `bulk_create_concurrency`
- `test_bulk_ensures_ca_definitions_when_custom_attrs_present` — `_ensure_ca_definitions` kaldt
- `test_bulk_skips_ca_ensure_when_no_custom_attrs` — `_ensure_ca_definitions` ikke kaldt

Total test-suite: **66 tests** (13 cache + 13 bulk + 7 retry + 7 parallel + 5 circuit-breaker + 6 rate-limiter + 7 audit-FTS + 2 health + 6 prewarm-adjacent).

---

## [3.22.0 build 0176] — 2026-05-07 — feat(prewarm): inkrementel scan + detekter slettede endpoints

**`backend/app/services/cache_prewarm.py`**:
- `PrewarmStatus` får nye felter `skipped: int` og `deleted: int`
- `_full_scan()` sammenligner ISE ID-liste med `cache.detail_ids()` og kalder `invalidate_detail()` for endpoints slettet fra ISE
- Ny `should_fetch()` helper: springer detail-fetch over for entries friskere end `cache_prewarm_skip_fresh_s` (standard 1800s); hot-queue IDs fetchets altid; disk-loaded entries fetchets altid
- Opdaterede log-beskeder viser fetches/skipped/slettet pr. scan

**`backend/app/core/config.py`**:
- Ny setting `cache_prewarm_skip_fresh_s: float = 1800.0` — threshold for inkrementel skip (0 = klassisk fuld-scan)

**`backend/app/api/cache.py`**:
- `/cache/stats` eksponerer nu `prewarm.skipped` og `prewarm.deleted`

---

## [3.21.0 build 0175] — 2026-05-07 — feat(cache): memory-baseret eviction (300 MB grænse)

**`backend/app/core/endpoint_cache.py`**:
- `CachedEntry` får nyt felt `size_bytes: int = 0` — størrelse estimeres via `model_dump_json()` ved indsættelse
- `EndpointCache._total_bytes` — løbende byte-tæller, nulstilles ved `invalidate_all`
- `_max_memory_bytes()` — læser ny `cache_max_memory_mb` setting (default 300 MB)
- `_estimate_size()` — estimerer entry-størrelse fra JSON-serialisering; fallback 8 KB
- `put_detail()` — eviction-løkken tjekker nu **begge** grænser: `max_entries` og `max_memory_bytes`
- `_evict_oldest()` / `invalidate_detail()` / `invalidate_all()` — fratrækker korrekt fra `_total_bytes`
- `_fetch_and_store()` og fallback i `get_detail()` bruger nu `put_detail()` i stedet for direkte dict-assignment
- `load_from_disk()` bruger `put_detail()` + bevarer original `fetched_at`
- `stats()` eksponerer `total_bytes` og `max_memory_bytes`

**`backend/app/core/metrics.py`**:
- Ny Prometheus gauge `ise_portal_cache_memory_bytes` — estimeret hukommelsesforbrug

**`backend/app/core/config.py`**:
- Ny setting `cache_max_memory_mb: int = 300` — konfigurerbar memory-grænse (0 = ubegrænset)

---

## [3.20.0 build 0174] — 2026-05-07 — feat(frontend): metrics-dashboard

**`frontend/js/views/metrics.js`** (ny):
- Ny admin-only side der henter `GET /metrics` (Prometheus text format) og viser live data.
- Parser Prometheus text format direkte i browseren (ingen externe biblioteker).
- Viser: circuit-breaker state (farvet badge: grøn/gul/rød), ISE request totals + gennemsnitlig svartid, cache entries/hit-rate/evictions, rate-limit blocks, bulk-outcomes.
- Auto-refresh hvert 15 sek. (clearInterval når containeren fjernes fra DOM).

**`frontend/index.html`**:
- Tilføjet `<a href="#/metrics" data-view="metrics">Metrics</a>` i sidebar-nav.

**`frontend/js/app.js`**:
- Importeret `renderMetrics` fra `views/metrics.js`.
- Registreret route `metrics` med `roles: ["admin"]`.

**`frontend/css/styles.css`**:
- Tilføjet metrics-specifik CSS: `.metrics-grid`, `.metrics-card`, `.metric-stat`, `.cb-badge` (CLOSED/HALF-OPEN/OPEN farver), dark-mode varianter.

---

## [3.19.0 build 0173] — 2026-05-07 — feat: circuit-breaker + rate limiting + FTS5 audit-søgning

**`backend/app/ise/circuit_breaker.py`** (ny):
- `CircuitBreaker` — tre-tilstands state-maskine (CLOSED/OPEN/HALF_OPEN). Tripper til OPEN
  efter `ise_cb_failure_threshold` (default 5) på hinanden følgende request-fejl. Fast-failer
  efterfølgende kald med IseApiError(503) i `ise_cb_recovery_timeout_s` (default 60s).
  Skifter til HALF_OPEN efter recovery-vinduet, lader én probe-request igennem.
  Succes → CLOSED, fejl → OPEN igen.

**`backend/app/ise/client.py`:**
- `__init__`: opretter `self._cb = CircuitBreaker(...)` fra settings
- `request()`: tjekker `self._cb.is_open()` FØR retry-loop — open circuit hæver IseApiError(503)
  med remaining_s i beskeden. `record_failure()` / `record_success()` efter henholdsvis
  transport-fejl og succes. `CIRCUIT_STATE` gauge opdateres (0=closed, 1=half_open, 2=open)

**`backend/app/core/rate_limiter.py`** (ny):
- `_SlidingWindow`: sliding-window counter pr. IP (rullende 60s vindue)
- `RateLimitMiddleware`: Starlette BaseHTTPMiddleware — tjekker X-Forwarded-For / client.host
  mod `rate_limit_per_minute` (default 200, 0=deaktiveret). Blokerede requests returnerer
  429 med Retry-After + X-RateLimit-* headers. Gælder kun `/api/`-stier.

**`backend/app/main.py`:**
- `app.add_middleware(RateLimitMiddleware)` — tilføjet FØR CORSMiddleware (ydre lag)

**`backend/app/core/audit_store.py`:**
- `_FTS_SCHEMA`: FTS5 virtual table `audit_fts` med `tokenize="trigram case_sensitive 0"` —
  case-insensitiv substrings-søgning ækvivalent til `LIKE '%q%'` men O(log N) via indeks
- `_ensure_fts()`: opretter tabel + triggers ved første opstart, backfiller eksisterende rækker.
  Sætter modul-flag `_fts_available = True`
- `init_db()`: kalder `_ensure_fts()` efter SCHEMA
- `_query_sync()`: bruger `id IN (SELECT rowid FROM audit_fts WHERE audit_fts MATCH ?)` når
  `_fts_available`. Fallback til LIKE hvis FTS5 ikke er tilgængeligt (graceful degradation)
- INSERT/DELETE-triggers på `audit_events` holder FTS-indeks synkroniseret automatisk

**`backend/app/core/config.py`:**
- Tilføjet `ise_cb_failure_threshold` (default 5), `ise_cb_recovery_timeout_s` (default 60),
  `rate_limit_per_minute` (default 200)

**`backend/app/core/metrics.py`:**
- Tilføjet `CIRCUIT_STATE` (Gauge, 0/1/2) og `RATE_LIMIT_BLOCKED` (Counter)

**Tests (25 nye, 53 total — alle passed):**
- `test_circuit_breaker.py` (13): CLOSED/OPEN/HALF_OPEN state-maskine, threshold, recovery,
  probe success/failure, stats
- `test_rate_limiter.py` (6): allow/block/independent-IPs/window-expire/remaining-counter
- `test_audit_fts.py` (7): FTS-tabel oprettelse, MAC i JSON, case-insensitiv, false positives,
  kombineret resource_type-filter

---

## [3.18.0 build 0172] — 2026-05-07 — obs(metrics) + test: Prometheus + udvidet test-suite

**`backend/pyproject.toml`:**
- Tilføjet `prometheus-client>=0.20.0`

**`backend/app/core/metrics.py`** (ny):
- Definerer alle Prometheus metric-objekter som module-level singletons:
  `CACHE_HITS/MISSES/STALE_SERVES/EVICTIONS` (Counter), `CACHE_ENTRIES/DISK_STALE` (Gauge),
  `ISE_REQUESTS` (Counter, labels: method+outcome), `ISE_REQUEST_DURATION` (Histogram, 9 buckets 50ms–30s),
  `ISE_RETRIES` (Counter), `BULK_ITEMS` (Counter, label: outcome)

**`backend/app/api/metrics_api.py`** (ny):
- `GET /metrics` — Prometheus text scrape endpoint (CONTENT_TYPE_LATEST, ikke auth-beskyttet)

**`backend/app/main.py`:**
- Inkluderer `metrics_api.router` (uden prefix — `/metrics` direkte)

**`backend/app/core/endpoint_cache.py`:**
- Inkrementerer `CACHE_HITS/MISSES/STALE_SERVES/EVICTIONS` ved siden af eksisterende `_stats` dict
- Opdaterer `CACHE_ENTRIES` gauge i `put_detail`, `_fetch_and_store`, `invalidate_detail`, `invalidate_all`
- Opdaterer `CACHE_DISK_STALE` gauge i `put_detail`, `invalidate_all`

**`backend/app/ise/client.py`:**
- `request()`: måler `time.perf_counter()` rundt om hele retry-loop, recorder i `ISE_REQUEST_DURATION`
- Incrementerer `ISE_REQUESTS` (method+outcome: 2xx/4xx/5xx/error) ved hvert kald
- `_on_retry` callback inkrementerer `ISE_RETRIES` + logger WARNING (erstatter separat log-linje)

**`backend/app/services/endpoint_service.py`:**
- Efter `asyncio.gather` i `bulk_create`: inkrementerer `BULK_ITEMS` (outcome: succeeded/skipped/overwritten/failed)

**`backend/tests/conftest.py`** (ny):
- Sætter ISE_BASE_URL/USERNAME/PASSWORD env-vars inden app-moduler importeres

**`backend/tests/test_endpoint_cache.py`** (ny, 13 tests):
- fresh hit, TTL miss, stale-while-revalidate, FIFO-eviction (3 varianter), zero-max=unlimited,
  invalidate_detail, invalidate_all, roles_index (populate/cleanup/case-insensitive), disabled-cache passthrough

**`backend/tests/test_ise_retry.py`** (ny, 7 tests):
- retry succeeds on 3rd attempt, retry exhausted → IseApiError, timeout triggers retry,
  no retry on 404, no retry on 500, retry_attempts configured, connection_pool is AsyncClient

**`backend/tests/test_parallel_fetch.py`** (ny, 7 tests):
- single page (no parallel), exact 100 (no parallel), 250 → 3 pages, 1000 → 10 pages,
  filters passed through, groups single page, groups multipage

**`backend/tests/test_health.py`:**
- Opdateret assertion: `r.json()["status"] == "ok"` (health-endpoint returnerer nu også version-felter)

**`FEATURES.md`:** tilføjet circuit-breaker, rate limiting, FTS5 audit-søgning som `[planned]`

**Testresultat:** 28/28 passed

---

## [3.17.0 build 0171] — 2026-05-07 — perf(scale): Tier 1 skalerbarhedsforbedringer (10K endpoints)

**`backend/pyproject.toml`:**
- Tilføjet `tenacity>=8.2.0` som dependency (retry-bibliotek)

**`backend/app/core/config.py`:**
- Tilføjet `ise_max_connections` (default 10) — styrer httpx connection pool mod ISE
- Tilføjet `ise_retry_attempts` (default 3) — antal genforsøg ved transport-fejl
- Tilføjet `cache_max_entries` (default 5000) — max entries i in-memory cache; 0 = ubegrænset
- Tilføjet `bulk_create_concurrency` (default 3) — parallelle ISE-kald under bulk import

**`backend/app/ise/client.py`:**
- `httpx.AsyncClient` initialiseres nu med `httpx.Limits(max_connections, max_keepalive_connections)` — forhindrer connection-reset under load ved at begrænse concurrent ISE-forbindelser eksplicit
- `request()` omgiver nu `self._http.request()` med `tenacity.AsyncRetrying` — retrier op til `ise_retry_attempts` gange på `httpx.TransportError` (timeout, connection reset) med exponential backoff 1s → 8s. HTTP 4xx/5xx retries IKKE.

**`backend/app/ise/endpoints.py`:**
- `IseEndpointRepository.list_all()`: parallel page-fetching — henter side 1 for at kende total, spawner derefter de resterende sider parallelt med `asyncio.Semaphore(5)`. Reducerer 10K endpoint scan fra ~20s (serial) til ~5s (parallel)
- `IseEndpointGroupRepository.list_all()`: samme parallel strategi via ny `_list_groups_page()` helper
- Tilføjet `import asyncio, math`

**`backend/app/core/endpoint_cache.py`:**
- Tilføjet `_evict_oldest()` — FIFO-eviction: fjerner første entry i `_details` (oldest by insertion order), rydder op i roles_index og disk_stale_count
- `put_detail()`: hvis ny entry (ikke update) og `cache_max_entries > 0`, evictes ældste entries indtil `len(_details) < max_entries` inden insert
- `stats()`: tilføjet `max_entries` og `evictions` felter
- `_stats`: tilføjet `"evictions": 0` tæller

**`backend/app/services/endpoint_service.py`:**
- `bulk_create()`: erstattet seriel for-loop med `asyncio.gather()` + `asyncio.Semaphore(bulk_create_concurrency)`. Hvert item behandles i `_process_one()` coroutine — conflict/overwrite/fail-logik bevaret uændret. 150ms sleep per item fjernet; throttling sker naturligt via semaphore + ISE svartid (~10 req/s ved 3 concurrent + 100ms ISE). Import af 1000 endpoints: ~2,5 min → ~30s

**`FEATURES.md`:** registreret som `in-progress 3.17.0`

---

## [3.16.0 build 0170] — 2026-05-07 — perf(scale): roles-indeks + async disk-save + group-paginering (10K-fix)

**`backend/app/core/endpoint_cache.py`:**
- Tilføjet `_roles_index: dict[str, set[str]]` — mappes `lowercase_rolle → {endpoint_id}`, vedligeholdes inkrementelt i `put_detail`, `invalidate_detail`, `invalidate_all` og `load_from_disk`. Non-admin Browse slipper for at hente alle 10K endpoints for at finde de synlige
- Tilføjet `get_ids_for_roles(roles)` — O(1) opslag returnerer alle endpoint-IDs synlige for brugerens effektive roller
- Tilføjet `detail_count()` — returnerer cache-størrelse; bruges til at skelne varm vs. kold cache
- Tilføjet `save_to_disk_async(path)` — kører `save_to_disk` i `run_in_executor` så event loop ikke blokeres under JSON-serialisering af 10K entries (300–700 ms synkront)
- `disk_stale_count()` returnerer nu `_disk_stale_count` counter (O(1)) i stedet for O(N) iteration over hele `_details`-dict
- `put_detail` / `invalidate_detail` / `invalidate_all` / `load_from_disk` vedligeholder alle `_roles_index` og `_disk_stale_count`
- `stats()` eksponerer `roles_index_roles` (antal unikke roller i indekset)

**`backend/app/services/cache_prewarm.py`:**
- `_save_to_disk` gjort `async` og awaiter `cache.save_to_disk_async()` — fjerner event-loop-blokering ved pre-warm scan-afslutning og portal-shutdown
- `stop()` og `_full_scan()` awaiter nu `_save_to_disk()`

**`backend/app/services/endpoint_service.py`:**
- `list_endpoint_details`: varm cache + non-admin → delegerer til ny `_list_from_roles_index()` i stedet for ISE list_page + post-filter
- `list_all_endpoint_details`: varm cache + non-admin → bruger roles-indeks (registrars "Mine endpoints" reduceret fra ~7 min til sub-sekund)
- Ny `_list_from_roles_index(roles, page, size, is_psk_editor, search)`: henter IDs fra indekset, fetcher details fra cache (typisk < 1 ms per hit), filtrerer på search i Python, sorterer på MAC, paginerer
- Kold cache falder tilbage til eksisterende ISE-baseret sti (startup-periode inden pre-warm)

**`backend/app/ise/endpoints.py`:**
- `IseEndpointGroupRepository.list_all()`: paginerer nu korrekt over alle ISE-sider (identisk med `IseEndpointRepository.list_all()`). Retter fejl ved ISE-deployments med >100 endpoint-identity-groups — tidligere returnerede kun de første 100

**`version.json`:** 3.15.5 build 0169 → 3.16.0 build 0170

---

## [3.15.5 build 0169] — 2026-05-07 — docs: komplet systemmanual (README + docs/INDEX + 01–05)

**`README.md`:**
- Komplet omskrivning med en-sides forklaring af portal-systemet, hvorfor REST + pxGrid, opdateret funktionsliste, hurtigstart, forudsætninger og links til docs/-sektioner

**`docs/INDEX.md`** (ny):
- Hoveddokument med indholdsfortegnelse, sektionsoversigt og ændringslog for manualen

**`docs/01-OVERBLIK.md`** (ny):
- Systemoverblik: formål, ASCII-arkitekturdiagram, REST-integration (ERS/Open API/MnT), pxGrid 2.0, cache-arkitektur (to-lags + pre-warm), roller/System adm-scoping, tre dataflow-eksempler

**`docs/02-INSTALLATION.md`** (ny):
- Forudsætninger, trin-for-trin installation, ISE ERS/Open API aktivering, ISE-bruger opsætning, pxGrid-aktivering, konfigurationsfiler, START.bat og NSSM Windows Service, verificeringstjekliste

**`docs/03-BRUGERGUIDE.md`** (ny):
- Browse/Edit (kolonner, søg/filter, sessionsfarve, edit-modal, bulk-edit, CoA), opret endpoint, CSV-import (ISE-format og simpelt format), attribut-administration, PlatformType-mapping, CoA-binding, ACL-editor, PSK-workflow, register-view (registrar), fejlbesked-oversigt

**`docs/04-ADMIN.md`** (ny):
- Brugerstyring (opret/slet/roller/System adm-tags), alle Settings-sektioner, cache-parametre, pxGrid-opsætning (tre certifikatmetoder + STOMP-prober), system-opdatering via ZIP, Logs-siden

**`docs/05-DRIFT.md`** (ny):
- Start/stop/genstart (START.bat + NSSM), backup-oversigt og -procedure, log-rotation, fejlsøgningsguide (tabel med symptomer og løsninger), ydelsestuning (TTL/interval/concurrency), ISE-timeout anbefalinger

**`version.json`:** build 0168 → 0169

---

## [3.15.5 build 0168] — 2026-05-07 — ux(errors): brugervenlige fejlbeskeder ved ISE-utilgængelighed

**`backend/app/api/endpoints.py`:**
- Ny `_ise_http_error(exc)` helper erstatter alle `raise HTTPException(502, str(exc))` i hele filen
- Transport-fejl (status 0): returnerer **503** med "ISE er midlertidigt utilgængelig — prøv igen om lidt"
- Uventet ISE-fejl: returnerer **502** med "ISE returnerede en uventet fejl (HTTP NNN)"
- 404: uændret → "Endpoint ikke fundet"

**`frontend/js/views/browse.js`:**
- `openDetail()` catch-blok parser HTTP-statuskode fra `err.message`
- 503: viser warning + "Prøv igen"-knap der kalder `openDetail(id)` igen
- 404: viser "Endpoint ikke fundet i ISE."
- Andet: viser generisk fejlbesked uden teknisk jargon

## [3.15.4 build 0167] — 2026-05-07 — fix(logs+cache): korrekt log-sti i API + 502-fallback til cached data

**`backend/app/api/logs.py`:**
- `GET /logs`: resolverer relativ log-sti med `_BACKEND_DIR = Path(__file__).resolve().parents[2]` i stedet for `Path.cwd()`. Portalen viste `projekt-root/logs/app.log` (gammel fil, aldrig opdateret) mens logger skrev til `backend/logs/app.log`.

**`backend/app/core/endpoint_cache.py`:**
- `get_detail()` miss/force_fresh-path: fanger ISE transport-fejl og returnerer cached entry (markeret `cache_stale=True`) hvis en eksisterer. Brugeren ser cached data med ⏱ i stedet for 502. Kun ved totalt cache-miss propageres fejlen videre som 502.

## [3.15.3 build 0166] — 2026-05-07 — fix(cache): fjern "Task exception was never retrieved" + coalescer group-fetches

**`backend/app/core/endpoint_cache.py`:**
- `_get_or_create_inflight()`: tilføjet `task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)` — markerer exception som "retrieved" for asyncio så SWR fire-and-forget tasks ikke genererer ERROR-log. Direkte awaits propagerer stadig exception normalt.
- Ny `_fetch_and_store_groups()` + `_get_or_create_groups_inflight()`: samme coalescing-mønster for groups som for detail-entries — kun ét ISE `endpointgroup`-kald ad gangen uanset antal samtidige kaldte.
- `get_groups()` miss-path: `await _get_or_create_groups_inflight()` i stedet for direkte `await fetch_fn()`.
- `_spawn_groups_refresh()`: thin wrapper om `_get_or_create_groups_inflight()`.

**`backend/app/services/endpoint_service.py`:**
- `_resolve_group_name()`: tilføjet `asyncio.Lock` (double-checked locking) — forhindrer N samtidige endpoint-fetches i at kalde `groups.list_all()` når den lokale `_group_cache` er kold.

## [3.15.2 build 0165] — 2026-05-05 — fix(cache): koalescer concurrent ISE-fetches, fjern race condition i edit-modal

**Root cause:** `openDetail()` affyrede `prioritizeEndpoint` (pre-warm hot-queue) og
`getEndpoint` (force_fresh=True ISE-fetch) simultant → to uafhængige ISE-kald for
samme endpoint. Pre-warm workeren (Semaphore 5) optog alle ISE-forbindelser, og
brugerens fetch ventede i kø. Ingen coalescing i `get_detail()` miss-path.

**Backend (`backend/app/core/endpoint_cache.py`):**
- Ny `_fetch_and_store()`: fælles coroutine der fetcher fra ISE, gemmer i cache og returnerer værdien
- Ny `_get_or_create_inflight()`: returnerer eksisterende in-flight task eller opretter ny — alle concurrent requests for samme endpoint deler ét ISE-kald
- `get_detail()` miss-path: `await _get_or_create_inflight()` i stedet for direkte `await fetch_fn()`
- SWR background refresh: bruger `_get_or_create_inflight()` (fire-and-forget, stadig ikke-blokerende)
- `_spawn_detail_refresh()` er nu en tynd wrapper om `_get_or_create_inflight()`

**Backend (`backend/app/api/endpoints.py`):**
- `GET /{endpoint_id}`: `force_fresh = True` altid — edit-modal viser altid friske ISE-data, ikke SWR-serveret gammel cache

**Frontend (`frontend/js/views/browse.js`):**
- `openDetail()`: fjernet `api.prioritizeEndpoint(id)` fire-and-forget — det medvirkede til dobbelt ISE-kald. Force_fresh=True i backend håndterer cache-bypass direkte.

## [3.15.1 build 0164] — 2026-05-04 — ux(settings): opdater Endpoint-cache sektion til pre-warm + disk-cache arkitektur

Settings → Endpoint-cache afspejler nu den intelligente to-lags cache fra v3.14.0.

**Frontend (`frontend/js/views/settings.js`):**
- Ny beskrivelse forklarer pre-warm worker, disk-persistens og ⏱-badge
- Tre nye indstillingsfelter: `cache_prewarm_interval_s` (scanning-interval), `cache_prewarm_concurrency` (parallel ISE-forbindelser), `cache_disk_path` (disk-cache sti)
- `renderCacheStats()` viser nu disk-stale entries, disk-loads og fuld pre-warm worker status (scanning-fremskridt, seneste fuld scan, disk-gem, hot-queue, fejl)
- `initCacheSection()` loader/gemmer de tre nye settings

**Backend (`backend/app/schemas/settings.py`):**
- `BackendSettingsUpdate` og `BackendSettingsResponse` udvidet med `cache_disk_path`, `cache_prewarm_concurrency`, `cache_prewarm_interval_s`

**Backend (`backend/app/services/settings_service.py`):**
- `get_backend_settings()` returnerer de tre nye felter
- `update_backend_settings()` persisterer de tre nye felter til overrides

## [3.15.0 build 0162] — 2026-05-05 — feat(update): portal system opdatering via admin UI

Ny "Opdatering"-tab i Settings (kun synlig for admin). Upload ZIP-pakke →
validér (version, filstruktur, blokerede stier) → preview → anvend → genstart.

**Sikkerhedsmodel:**
- Kun admin-brugere (require_admin dependency)
- Tilladt: `frontend/`, `backend/app/`, `version.json`, docs, `START.bat`
- Blokeret altid: `.env`, `backend/logs/`, `backend/cache/`, `backend/data/`
- Path-traversal (`..`) afvises
- Max 100 MB pr. pakke
- Paranoid path-check: target skal ligge under PROJECT_ROOT

**Genstart-mekanisme:**
- `POST /api/update/restart` → `os._exit(0)` efter 2.5s delay
- `START.bat` opdateret til genstart-loop (timeout /t 3 + goto start)
- Frontend venter 8s og genindlæser siden automatisk

**Berørte filer:**
- `backend/app/services/update_service.py` (ny)
- `backend/app/api/update.py` (ny)
- `backend/app/main.py` (+update router)
- `frontend/js/api.js` (+validateUpdate/applyUpdate/restartServer + _noContentType)
- `frontend/js/views/settings.js` (+Opdatering tab + initSystemUpdateSection)
- `START.bat` (loop-genstart)

---

## [3.14.0 build 0158] — 2026-05-05 — feat(perf): fuld pre-warm cache + offline disk-cache med stale-badge

**PrewarmWorker** (`services/cache_prewarm.py`, ny):
- Scanner ALLE ISE endpoints i baggrunden ved startup (pagineret list → N×detail-fetch)
- Konfigurerbar concurrency: `cache_prewarm_concurrency` (default 10 parallelle ISE-kald)
- Hot-queue: `POST /endpoints/{id}/prioritize` sætter et endpoint forrest i scannen
- Periodisk rescan: `cache_prewarm_interval_s` (default 1800s = 30 min)
- Gemmer til disk ved hvert fuldt scan og ved shutdown

**Offline disk-cache** (`core/endpoint_cache.py`):
- `save_to_disk(path)` / `load_from_disk(path)` — JSON-format med version-guard
- Entries fra disk markeres `from_disk=True` så UI ved de er stale
- Live ISE-fetch overskrivet altid disk-entries

**Staleness-flow** (browse.js + styles.css):
- Rækker med `cache_stale=True` viser ⏱-badge i MAC-cellen + cream-gul baggrund
- Edit-modal viser advarsel "Data fra gammel cache — henter friske ISE-data..."
- `GET /endpoints/{id}` bypasser disk-stale entries (`force_fresh=True`) → returnerer altid friske ISE-data til edit-modal

**Nye config-settings** (`core/config.py`):
- `cache_disk_path` (default `cache/endpoints.json`)
- `cache_prewarm_concurrency` (default 10)
- `cache_prewarm_interval_s` (default 1800.0)

**Berørte filer:**
- `backend/app/services/cache_prewarm.py` (ny)
- `backend/app/core/endpoint_cache.py` (+disk persistence, +from_disk, +force_fresh)
- `backend/app/core/config.py` (+3 settings)
- `backend/app/schemas/endpoint.py` (+cache_stale)
- `backend/app/services/endpoint_service.py` (+force_fresh, +cache_stale sættes)
- `backend/app/api/endpoints.py` (+prioritize route, +force_fresh ved GET /{id})
- `backend/app/main.py` (+PrewarmWorker start/stop)
- `frontend/js/api.js` (+prioritizeEndpoint)
- `frontend/js/views/browse.js` (+stale-badge render, +prioritize ved openDetail)
- `frontend/css/styles.css` (+.stale-badge, +.cache-stale styling)

---

## [3.13.7 build 0157] — 2026-05-04 — fix(pxGrid): backoff-reset logik fikset — worker reconnecte hurtigt efter disconnect

`connected_ok` i `_run_loop` var kun True ved graceful shutdown (stop_event). Enhver
exception (inkl. recv_timeout) efterlod `connected_ok=False` → backoff nulstilles aldrig
→ efter ~9 fejl er backoff maxet på 300s. Worker sidder i 5-minutters cykler selv når
forbindelsen bare droppede pga. idle-timeout.

Fix: backoff-reset baseres på `last_connect_at > iter_start` — hvis SUBSCRIBE lykkedes
denne iteration (uanset hvad der siden fejlede) nulstilles backoff til min_s. Worker
logger nu også backoff-ventetid og reconnect-tæller ved hvert forsøg.

**Ændringer:**
- `backend/app/pxgrid/session_worker.py`: backoff-reset via `last_connect_at`, `_one_session()` ændret til `-> None`

---

## [3.13.6 build 0156] — 2026-05-04 — fix(pxGrid): recv_timeout øget til 600s for at undgå falske reconnects under idle

pxGrid STOMP-worker disconnectede hvert 120s under perioder uden session-events
fordi `recv_timeout = 120.0` (hardkodet) overskred ISE brokerens normale idle-vindue.
WebSocket ping/pong (ping_interval=20, ping_timeout=10) detekterer dead TCP inden for
30s uafhængigt af STOMP-frames — recv_timeout er kun nødvendig som backstop mod en
broker der er TCP-alive men helt tavs.

**Ændringer:**
- `backend/app/core/config.py`: Ny setting `pxgrid_stomp_recv_timeout_s` (default 600.0s)
- `backend/app/pxgrid/session_worker.py`: `recv_timeout` læses fra config i stedet for hardkodet 120s; forbedret fejlbesked

---

## [3.13.5 build 0155] — 2026-05-03 — feat(PSK): portal-indstilling til at skjule/vise PSK Key i browse-tabel

Ny checkbox i Settings → PSK Pass Key Politik: "Vis PSK Key i klartekst
i browse-tabellen". Default: slukket — PSK Key vises som •••••• i tabellen.
Slår man den til, vises den faktiske nøgle (kun for PSK-editors — backend
maskerer stadig for andre roller).

Browse.js henter PSK-politik via getPskPolicy() i load() og anvender
pskShowKey-flaget i renderRows og refreshRows.

**Berørte filer:** `backend/app/schemas/settings.py`, `backend/app/core/config.py`,
`backend/app/services/settings_service.py`, `frontend/js/views/browse.js`,
`frontend/js/views/settings.js`

## [3.13.4 build 0154] — 2026-05-03 — ux(browse): PSK Key tilbage på gammel plads med cream-gul baggrund

PSK Key er tilbage mellem PSK Mode og AuthzVlan. Alle tre (PSK Key, AuthzVlan, AuthzACL) har nu samme cream-gule `authz-col` baggrund.

**Berørte filer:** `frontend/js/views/browse.js`

## [3.13.3 build 0153] — 2026-05-03 — ux(browse): PSK Key kolonne yderst til højre (foran System adm)

PSK Key rykket til næstsidste kolonne — rækkefølge nu: ... PSK Mode, AuthzVlan, AuthzACL, PSK Key, System adm.

**Berørte filer:** `frontend/js/views/browse.js`

## [3.13.2 build 0152] — 2026-05-03 — fix(browse): AuthzVlan+ACL rettet til yderst højre (næst-sidst)

Rettelse af 3.13.1: kolonner var placeret yderst venstre — skal yderst
højre (næstsidst og tredje-sidst, foran System adm).

**Berørte filer:** `frontend/js/views/browse.js`

## [3.13.1 build 0151] — 2026-05-03 — ux(browse): AuthzVlan + AuthzACL yderst til venstre med fløde-gul baggrund

AuthzVlan og AuthzACL er rykket til de to første datakolonner (efter
checkbox). Baggrunden er cream-gul (`#fef9e7` / header `#fdf3c0`) via
`.authz-col` CSS-klassen — dark mode bruger mørke amber-toner.
COLUMNS-arrayet er reordered; `renderRows` og header-rendering følger.

**Berørte filer:** `frontend/js/views/browse.js`, `frontend/css/styles.css`

## [3.13.0 build 0150] — 2026-05-03 — feat(PSK): IPSK vs MPSK mode-type i Settings

Ny indstilling i PSK-politik-kortet (Settings → PSK Pass Key Politik):
radio-buttons til at vælge **MPSK** (standard) eller **IPSK**-mode.

I **IPSK**-mode tilføjer backend transparant `psk=`-prefix på nøglen
inden den skrives til ISE (`_psk_encode_ca` efter `_validate_psk`).
Ved read fra ISE strippes præfikset igen (`_psk_decode`) — UI-brugeren
ser og redigerer altid den rene nøgle uden prefix.

Validering (min. længde, store bogstaver osv.) kører altid på den rå
nøgle inden encoding, så policy-reglerne gælder den del brugeren angiver.

**Berørte filer:**
- `backend/app/schemas/settings.py` (+psk_type felt)
- `backend/app/core/config.py` (+psk_type config-felt)
- `backend/app/services/settings_service.py` (get/update psk_policy +psk_type)
- `backend/app/services/endpoint_service.py` (+PSK_IPSK_PREFIX, _psk_encode, _psk_decode, _psk_encode_ca; koblet ind i create + update)
- `frontend/js/views/settings.js` (+radio-buttons + applyPolicy/payload psk_type)
- `frontend/css/styles.css` (+.radio-group/.radio-label CSS)

## [3.12.5 build 0149] — 2026-05-03 — fix(bulk-edit): fast modal-bredde, ikke resize ved Vis/PSK

Bulk-edit modalen manglede `detail-modal` klassen (560px). Den arvede kun
base `.modal` (420px) og reflowede ved PSK Key-aktivering og Vis-klik.
Tilføjet `detail-modal` til modal-div i bulk-edit overlay.

**Berørte filer:** `frontend/js/views/browse.js`

## [3.12.4 build 0148] — 2026-05-03 — fix(bulk-edit): paritet med Endpoint detaljer-modal

Tilføjet manglende felter til "Rediger valgte endpoints" så den matcher
"Endpoint detaljer" modal:
- **Tilknytning** (static group checkbox) — toggle Statisk/Dynamisk på
  alle valgte endpoints. Sendes i save-payload via data-attribut på row.
- **PSK Mode** — checkbox (kun synlig for PSK-editors). Toggler psk-mode-cb
  i tabellen direkte.
- **PSK Key** — password input + Vis/Skjul + Generer (kun PSK-editors).
  Nøglen sendes i custom_attributes.PSK_Key ved save; sentinel "****" afvises.

Vis/Generer knapper i bulk-edit modal er fuldt kablet.
Toggle-mekanisme (be-cb) udvidet til også at enable inner inputs i div-wrappere.
refreshRows rydder data-attributter (beStaticGroup, bePskKey) efter save.

**Berørte filer:** `frontend/js/views/browse.js`

## [3.12.3 build 0147] — 2026-05-03 — ux(browse): PSK Mode-kolonne viser interaktiv checkbox

PSK Mode-kolonnen i browse-tabellen viser nu en checkbox i stedet for tekst
"Ja"/"". For PSK-editors er den interaktiv og inkluderes i save-payloaden
(PSK_Mode i custom_attributes). For andre brugere er den disabled/visuel.
refreshRows patcher checkbox-state korrekt efter save.

**Berørte filer:** `frontend/js/views/browse.js`

## [3.12.2 build 0146] — 2026-05-03 — ux(roles): skjul "admin"-chip i Settings → Brugere → System adm

`renderEndpointRoleCell` i settings.js filtrerer nu "admin" fra kataloglisten
så systemrollen ikke vises som tilvalgbar System adm-tildeling for brugere.

**Berørte filer:** `frontend/js/views/settings.js`

## [3.12.1 build 0145] — 2026-05-03 — ux(roles): skjul "admin"-chip i System adm-kolonne

`"admin"`-rollen er en systemrolle, ikke et endpoint-tag. Den filtreres nu
fra i `rolesChipsHtml` (både katalog-chips og ekstern-chips) og fra `roleCatalog`
ved load, så den aldrig vises i System adm-kolonnen eller detail-modalen.

**Berørte filer:** `frontend/js/views/browse.js`

## [3.12.0 build 0144] — 2026-05-03 — fix+ux(roles): editor-psk kan redigere roller + auto-select ved opret

**Bug fix**: `canEditRoles` i browse.js og `canPickRoles` i register.js ekskluderede
`editor-psk`, så psk-editors ikke kunne redigere System adm-chips. Rettet ved at
tilføje `editor-psk` til begge guards.

**Feature**: Register-view pre-selekterer nu automatisk chippen med navn =
brugerens username (brugerens egen System adm-rolle) ved visning. Brugeren
kan fravælge den eller tilføje andre.

**Berørte filer:** `frontend/js/views/browse.js`, `frontend/js/views/register.js`

## [3.11.7 build 0143] — 2026-05-03 — fix(browse): opdatér PSK-kolonner i tabel efter gem i detail-modal

`refreshRows` patchede ikke PSK Mode / PSK Key cellerne i tabellen efter et
endpoint blev gemt via detail-modalen. Tilføjet in-place patch af
`.psk-mode-cell` og `.psk-key-cell` i `refreshRows()`.

**Berørte filer:** `frontend/js/views/browse.js`

## [3.11.6 build 0142] — 2026-05-03 — ux(RBAC): brugere ser kun tildelte System adm-roller ved opret/rediger

Non-admin brugere ser nu kun de System adm-roller der er tildelt dem af
admin (via Settings → Brugere → System adm-tildeling) når de redigerer
eller opretter endpoints. Roller på et endpoint der ikke er i brugerens
tildelte sæt bevares som read-only "externe" chips og overskrives ikke.
Admin ser stadig hele rolle-kataloget.

Gælder i browse/edit detail-modal, bulk-edit og register-viewet.

**Berørte filer:** `frontend/js/views/browse.js`, `frontend/js/views/register.js`

## [3.11.5 build 0141] — 2026-05-03 — fix(PSK): editor-psk login-fejl pga. manglende route-adgang

`editor-psk` manglede i alle frontend route-definitioner i `app.js`.
Efter login blev brugeren sendt til `browse` (default landing), men
`browse.roles` indeholdt ikke `editor-psk` → "Din rolle har ikke adgang
til denne side." Tilføjet `editor-psk` til browse, import, audit,
register og settings routes.

**Berørte filer:** `frontend/js/app.js`

## [3.11.4 build 0140] — 2026-05-03 — fix(PSK): PSK-kolonner i browse-tabel + ingen PSK-rydning ved tabel-gem

**Bug 1 (manglende kolonner):** `psk_mode` og `psk_key` tilføjet til COLUMNS-arrayet
og renderRows i browse.js som read-only display-celler (PSK redigeres kun via
detail-modal). PSK Key vises med monospace-font og truncation.

**Bug 2 (PSK-data ryddes ved tabel-gem):** Ikke-PSK-editors' save-payload sender
ikke PSK-felter, men `CustomAttrs.PSK_Mode/PSK_Key` defaultede til `""` → ISE-update
ryddede eksisterende PSK-data. Fix: `PSK_Mode`/`PSK_Key` er nu `str | None = None`
i `CustomAttrs`; `model_dump(exclude_none=True)` i service ekskluderer dem fra
ISE-payloaden når de ikke er eksplicit sat.

**Berørte filer:** `frontend/js/views/browse.js`, `frontend/css/styles.css`,
`backend/app/schemas/endpoint.py`, `backend/app/services/endpoint_service.py`

## [3.11.3 build 0139] — 2026-05-03 — fix(PSK): editor-psk adgang til browse/edit + PSK-synlighed for admin

**Bug 1 (editor-psk 403):** `require_any` inkluderede ikke `editor-psk` →
editor-psk-brugere fik "Din rolle har ikke adgang til denne side" ved forsøg
på at åbne browse/edit. Rettet: `editor-psk` tilføjet til `require_any`.

**Bug 2 (PSK usynlig for admin):** `isPskEditor` i browse.js blev initialiseret
til `false` og først sat korrekt når den async `authMe()`-kald i `load()`
returnerede. Detail-modal åbnet før load er fuldstændig ville bruge den forkerte
værdi. Fix: `isPskEditor` initialiseres nu straks fra `auth.hasRole(...)` (JWT
i localStorage) ligesom `isAdmin` i settings.js — ingen async race condition.

**Berørte filer:** `backend/app/api/deps.py`, `frontend/js/views/browse.js`

## [3.11.2 build 0138] — 2026-05-03 — feat(PSK): PSK-felter tilføjet til opret-endpoint-siden

PSK Mode toggle og PSK Key-felt (med Vis/Skjul og Generer-knapper) er nu
synlige i register-viewet for brugere med admin- eller editor-psk-rolle.
PSK-felterne inkluderes i create-payload og nulstilles efter vellykket registrering.

**Berørte filer:** `frontend/js/views/register.js`

## [3.11.1 build 0137] — 2026-05-03 — fix(PSK): validate_psk_key returnerer list ikke tuple

`_validate_psk` i `endpoint_service.py` forsøgte at unpacke returværdien fra
`validate_psk_key` som `ok, msg = ...`, men funktionen returnerer en `list[str]`
(fejlliste). Tom liste → "not enough values to unpack (expected 2, got 0)" → 422
ved oprettelse af ethvert endpoint med PSK_Mode=false/tom. Rettet til
`errors = validate_psk_key(...)` + `if errors: raise ValueError(...)`.

## [3.11.0 build 0136] — 2026-05-03 — feat(PSK): MPSK/IPSK PSK-nøgle-management

Ny `editor-psk`-rolle + fuld PSK-livscyklus i portalen. PSK_Mode/PSK_Key gemmes i ISE som custom attributes. PSK_Key maskeres til `****` for alle roller undtagen admin og editor-psk. Nøgle-generator i detail-modal og Settings PSK-politik-tab. Validering mod politik ved create/update; sentinel-write-back (`****`) afvises.

**Backend:**
- `schemas/user.py`: tilføjet `editor-psk` til `Role` Literal og `ROLE_VALUES`
- `api/deps.py`: `require_psk_editor`, `require_edit_endpoint`, `require_create_endpoint` og `require_register_lookup` opdateret med `editor-psk`
- `schemas/endpoint.py`: `CustomAttrs` +`PSK_Mode`/`PSK_Key`; `EndpointDetail` +`psk_mode: bool`/`psk_key: str`
- `schemas/settings.py`: `PskPolicy`, `GeneratedPskKey`
- `core/config.py`: `psk_min_length`, `psk_require_uppercase`, `psk_require_numbers`, `psk_require_special`
- `core/custom_attr_store.py`: `PSK_MODE_ATTR`, `PSK_KEY_ATTR`, `PSK_ATTRS`, `HIDDEN_ATTRS`, `ALL_ATTRS`
- `services/settings_service.py`: `get_psk_policy()`, `update_psk_policy()`, `validate_psk_key()`, `generate_psk_key()`
- `services/endpoint_service.py`: `PSK_MASKED`, `_mask_psk()`, `_validate_psk()`; `get_endpoint`/`list_endpoint_details`/`list_all_endpoint_details` +`is_psk_editor`; interne audit-snapshots bruger `is_psk_editor=True`
- `api/settings.py`: separat `psk_router` med `require_psk_editor` dependency; PSK-endpoints: GET/PUT `/psk-policy`, POST `/psk-policy/generate`
- `api/endpoints.py`: `_is_psk_editor_for()`, `is_psk_editor` sendt til service; `update_endpoint` dependency → `require_edit_endpoint`; ValueError → 422

**Frontend:**
- `api.js`: `getPskPolicy()`, `updatePskPolicy()`, `generatePskKey()`
- `views/browse.js`: `isPskEditor`-flag; PSK Mode toggle + PSK Key felt med Vis/Skjul og Generer i detail-modal; PSK-felter medsendes i save-payload kun for psk-editors
- `views/settings.js`: PSK-politik-tab (synlig for admin + editor-psk), PSK-politik-form med test-generator; `editor-psk` tilføjet til opret- og rediger-rolle-dropdowns
- `css/styles.css`: `.psk-key-wrap`, `form .field.checkbox-field`, `.detail-grid label/div.hidden`

## [3.10.1 build 0135] — 2026-05-03 — fix(browse): tab-skift til Browse/Edit giver ikke længere alle-rød

Initiellt `load()` på view-mount brugte `force=false`. Race condition: SSE-snapshot ankommer under ISE API-kaldet med `sessions=[]` (tom backend-cache) → `activeSessionMacs = new Set([])` (tom Set er truthy) → `refreshActiveSessionMacs(false)` ser `pxgridLive && pxgridSessionMacs` og returnerer med den tomme Set → MnT polles aldrig → alle endpoints rød. Fix: view-mount kalder `load(true)` — poller altid MnT ved init, uanset pxGrid-snapshot-state.

**Berørte filer:**
- [frontend/js/views/browse.js](frontend/js/views/browse.js) — linje 1933: `await load()` → `await load(true)`

---

## [3.10.0 build 0134] — 2026-05-03 — fix(browse): Refresh poller nu MnT selv når pxGrid er aktiv

`refreshActiveSessionMacs(force)` returnerede altid tidligt med pxGrid-data når `pxgridLive && pxgridSessionMacs` — `force=true` fra Refresh-knappen blev aldrig evalueret fordi pxGrid-tjekket stod *før* force-logikken. pxGrids session-set er inkrementelt (bygget fra events) og kan indeholde stale MACs, fx. efter portal-reload. MnT's ActiveList er det autoritative snapshot. Fix: `force`-tjekket wrapper nu begge early-returns; ved `force=true` bypasses pxGrid-data og MnT polles altid. `pxgridSessionMacs` synkroniseres herefter med MnT-set som nyt fundament.

**Berørte filer:**
- [frontend/js/views/browse.js](frontend/js/views/browse.js) — `refreshActiveSessionMacs()`: force-guard wrapper pxGrid early-return + MnT→pxGrid sync

---

## [3.9.9 build 0133] — 2026-05-03 — ux(browse): MAC-celle helbaggrund grøn/rød for auth-status

Auth-status visning flyttes fra checkbox-outline (svær at se) til helbaggrund på MAC-adresse-cellen. Grøn (`#4ade80`) = aktiv RADIUS session, rød (`#f87171`) = ingen aktiv session. Link-tekst justeres til mørk grøn/rød for kontrast. `applyAuthStatusColors()` sætter klassen på `td.mac-cell` i stedet for checkbox-elementet.

**Berørte filer:**
- [frontend/css/styles.css](frontend/css/styles.css) — `td.mac-cell.auth-active/auth-failed` erstatter checkbox-outline regler
- [frontend/js/views/browse.js](frontend/js/views/browse.js) — `applyAuthStatusColors()`: class på `macCell` i stedet for `cb`

---

## [3.9.8 build 0132] — 2026-05-03 — fix(browse): Refresh buster cache + henter altid aktuel auth-status fra MnT

Refresh-knappen kaldte `load()` uden cache-bust → backend returnerede cached endpoint-data. `refreshActiveSessionMacs()` sprang MnT-poll over ved `!anyFilterActive()` → ingen grøn/rød auth-status uden aktivt filter (f.eks. efter portal-genstart). Fix: (A) `POST /cache/invalidate` åbnet for alle roller (`require_any`). (B) Refresh-knap kalder `invalidateCache()` + `load(true)`. (C) `force`-parameter på `load()` og `refreshActiveSessionMacs()` — tvinger MnT-poll ved eksplicit Refresh. Knap viser "Opdaterer…" under operationen.

**Berørte filer:**
- [frontend/js/views/browse.js](frontend/js/views/browse.js) — Refresh-handler, `load(force)`, `refreshActiveSessionMacs(force)`
- [backend/app/api/cache.py](backend/app/api/cache.py) — `/cache/invalidate`: `require_admin` → `require_any`

---

## [3.9.7 build 0131] — 2026-05-03 — fix(audit): aktør viser nu faktisk login-bruger i stedet for "system"

`get_current_user` i `deps.py` er en sync funktion. FastAPI kører sync dependencies via `run_in_executor` (threadpool), og `ContextVar.set()` i en thread modificerer kun threadens kontekst-kopi — ændringen propagerer ikke tilbage til den asyncio-task hvor `audit_store.record()` kører. Resultatet: `actor_ctx.get()` returnerer altid default `ActorContext(actor_username="system")`. **Fix**: `get_current_user` ændret fra `def` til `async def` så FastAPI awaiter den direkte i den aktuelle asyncio-task. `actor_ctx.set()` er nu synlig for alle efterfølgende `record()`-kald i samme request.

**Berørte filer:**
- [backend/app/api/deps.py](backend/app/api/deps.py) — `get_current_user`: `def` → `async def`

---

## [3.9.6 build 0130] — 2026-05-03 — fix(brugere): auto-tildel System adm-rolle ved oprettelse

Ny bruger fik automatisk en System adm-rolle oprettet i kataloget (3.8.0),
men `assigned_endpoint_roles` blev initialiseret til `[]`. Admin måtte manuelt
gå ind og sætte flueben på brugerens egen rolle i tabellen.

`create_user` sætter nu `assigned_endpoint_roles = [username]` umiddelbart
efter `ensure_user_role` lykkes. `effective_roles()` deduplicerer med
`dict.fromkeys` så nye brugere ikke får `["jan", "jan"]` i stedet for `["jan"]`.

Eksisterende brugere er upåvirkede — `effective_roles()` tilføjer stadig
`username` implicit, og deduplicering er harmløs for dem.

**Berørte filer:**
- [backend/app/services/user_service.py](backend/app/services/user_service.py)

---

## [3.9.5 build 0129] — 2026-05-03 — fix(pxGrid): WS ping/pong liveness + badge-debounce + disconnect-farve

Tre relaterede pxGrid-bugs fundet ved analyse af `logs/app.log`:

**Bug 1 — Worker oscillerer hvert 60s (ISE sender ingen STOMP heartbeats)**
ISE's pxGrid STOMP-broker på `ise2.ll.lan` sender aldrig heartbeat-frames selv
når portalen anmoder om det (`heart-beat: 0,30000`). `recv_timeout = 2×heartbeat_ms
= 60s` trigges konstantt. Fix: WebSocket RFC 6455 ping/pong (`ping_interval=20s,
ping_timeout=10s`) er nu primær liveness-mekanisme — uafhængigt af STOMP-laget.
`recv_timeout` sat til 120s som backstop. Forventes at eliminere de periodiske
reconnects når ISE blot er stille (ingen session-events).

**Bug 2 — Badge flicker ⚪↔🟢 hvert ~3s ved transient SSE-reconnect**
`EventSource.onerror` satte øjeblikkeligt `pxgridLive=false` → badge ⚪. Browser
auto-reconnect (~3s) satte `onopen` → pxgridLive=true → badge 🟢. Synlig flicker.
Fix: `onerror` debounced 5s — hvis `onopen` ankommer inden for 5s annulleres
timer og badge forbliver grøn. `stopPxGridStream()` rydder timeren.

**Bug 3 — Disconnected endpoint forbliver grøn i Browse**
To root causes: (A) `applyAuthStatusColors()` returnerede early når
`activeSessionMacs === null` (sker når `refreshFilters` kører uden aktivt filter).
Det betød at `remove`-events aldrig farvede rækken rød. Fix: funktion bruger nu
`pxgridSessionMacs` som fallback når pxGrid er live og `activeSessionMacs` er null.
(B) Disconnect-events der sker mens worker er offline (60s-reconnect-vindue)
misses: `cache.remove()` returnerer `existed=False` → ingen broadcast til frontend.
Fix: worker kalder `_reconcile_cache_with_mnt()` efter hver STOMP SUBSCRIBE —
fetcher MnT ActiveList og evict'er cache-entries der ikke længere er aktive.

**Berørte filer:**
- [backend/app/pxgrid/session_worker.py](backend/app/pxgrid/session_worker.py)
- [frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.9.4 build 0128] — 2026-05-01 — ux(Saved views): tilføj "🚫 Ryd alle filtre" reset-action

Brugeren havde ingen direkte måde at deaktivere et anvendt view på —
man kunne kun ændre filtre manuelt eller skifte til andet view. Tilføjet
en eksplicit reset-action øverst i Views-dropdown'en:

> 🚫 **Ryd alle filtre (ingen view)**

Klik nulstiller portalOnly, server-MAC-filter og alle kolonnefiltre,
rydder aktivt view, og refresher Browse til server-side pagination uden
filter. Kolonne-synlighed og page-size bevares (de er ikke filter-state
per se).

**Filer:** [frontend/js/views/browse.js](frontend/js/views/browse.js),
[frontend/css/styles.css](frontend/css/styles.css)

---

## [3.9.3 build 0127] — 2026-05-01 — ux(Saved views): vis aktivt view i toolbar + dropdown

Når man har anvendt et view eller lige har gemt et, ser man nu hvilket
det er:

- **Toolbar-knappen** viser navnet i fed: `📁 Mine printere ▾`
  (mod default `📁 Views ▾`). Knappen får også en blå "active"-baggrund.
- **Dropdown-menuen** viser ✓-prefix og blå highlight på det aktive view.

Aktivt view **ryddes automatisk** når brugeren ændrer en filter-state
(Kun portal toggle, server-MAC-filter, kolonnefilter, page-size, eller
kolonne-synlighed) — fordi nuværende state så ikke længere matcher det
gemte view. Toolbar-knappen falder tilbage til `📁 Views ▾`.

Implementeret med en let-vægt `activeViewId`-variabel + `clearActiveView()`-
helper kaldt fra alle filter-mutation-handlers. `applyFilterSnapshot`
og `views-apply`/`views-save`-handlers opdaterer den til det rigtige
view-id.

**Filer:** [frontend/js/views/browse.js](frontend/js/views/browse.js),
[frontend/css/styles.css](frontend/css/styles.css)

---

## [3.9.2 build 0126] — 2026-05-01 — ux(Saved views): tilbyd overskrivning ved duplikat-navn

Tidligere kunne man gemme to views med samme navn — backend tillader det,
men UX-mæssigt giver det forvirring (hvilken vil jeg aktivere?). Nu
tjekker frontend ved gem om der findes et view med samme navn (case-
insensitive), og hvis ja, prompter:

> Et view med navnet "X" findes allerede. Overskriv det med nuværende
> filtre?

Bekræft = PUT på det eksisterende view-id (samme navn + nye filtre).
Afvis = ingen action. Cleanere end at have parallelle "Mine printere",
"Mine printere (kopi)", "Mine printere v2".

**Filer:** [frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.9.1 build 0125] — 2026-05-01 — fix(Saved views): inkludér kolonne-synlighed + page-size

3.9.0's view-snapshot manglede kolonne-synlighed (Kolonner ▾) og
page-size — hvis bruger gemte et view med skjulte kolonner og senere
genaktiverede det, kom de skjulte kolonner tilbage. `snapshotFilters()`
fanger nu HELE Browse-state inkl. `colVis` og `pageSize`.
`applyFilterSnapshot()` anvender begge ved view-load (kun hvis tilstede,
så gamle views gemt før 3.9.1 fortsætter med at virke for de fields de
indeholder).

**Filer:** [frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.9.0 build 0124] — 2026-05-01 — feat: Saved filter views i Browse (per-bruger presets)

Browse-toolbaren har nu en **📁 Views ▾**-dropdown der gemmer nuværende
filterkombination som navngivet view pr. bruger. Brugbar når man har
faste flows ("Mine printere", "PLC-HalA aktive", "Disconnected i dag")
og ikke vil sætte filtre op manuelt hver gang.

**Hvad gemmes i et view:**
- "Kun portal"-toggle
- Server-side MAC-filter (field, op, value)
- Kolonnefiltre (alle aktive kolonner med deres værdier)

**Backend:**
- Nyt `api/me`-router med CRUD `GET/POST/PUT/DELETE /api/me/views`
- `User`-record udvidet med `saved_views: list[SavedView]` (gemt i
  `users.json`); max 20 views pr. bruger.
- Hver write audit-logges som resource `saved_view`.
- Schema: `SavedView`, `SavedViewCreate`, `SavedViewUpdate`,
  `SavedViewsResponse` (med `max_views`-grænse).

**Frontend:**
- Ny `views-wrap`/`views-menu`-dropdown i Filtre-gruppen i toolbar.
- Liste over gemte views + "💾 Gem nuværende filtre som view…"-action
  der prompter for navn og gemmer via `snapshotFilters()`.
- Hver view har en delete-knap (×) med confirm.
- `applyFilterSnapshot()` factored ud af `restoreFilters()` så samme
  apply-logic deles af localStorage-restore og view-aktivering — sikrer
  at views fuldt resetter alle filtre før de anvender det gemte sæt.
- Click-outside lukker menuen; nye views vises øjeblikkeligt efter
  oprettelse.

**Designvalg:**
- View-navne kan være duplikate (admin vælger selv); kun 20-cap er hård
  begrænsning.
- Endpoint-templates fra original 2.14.0-plan er udsat til separat release.

**Filer:** [backend/app/schemas/user.py](backend/app/schemas/user.py),
[backend/app/api/me.py](backend/app/api/me.py),
[backend/app/main.py](backend/app/main.py),
[frontend/js/api.js](frontend/js/api.js),
[frontend/js/views/browse.js](frontend/js/views/browse.js),
[frontend/css/styles.css](frontend/css/styles.css)

---

## [3.8.3 build 0123] — 2026-05-01 — ux(Settings): tab-navigation grupperer 9 cards i logiske sektioner

Settings-siden var blevet rodet med 9 cards stablet vertikalt — admin
skulle scrolle langt for at finde det rigtige felt. Indført tab-baseret
navigation der grupperer cards efter formål:

**Admin-tabs:**
- **Forbindelse** — Backend (Cisco ISE connection)
- **Performance** — Endpoint-cache
- **PxGrid** — PxGrid 2.0 (real-time session push)
- **ISE-config** — Anbefalet ISE purge-config
- **Adgang** — System adm + Brugere & System adm
- **Konto** — Skift password + CSV Export Template + Frontend preferences

**Non-admin-tabs:**
- **Konto** (kun)

Selected tab persisteres i `localStorage` (key: `ise_portal_settings_tab`),
så bruger lander samme sted ved page reload. Default = "Forbindelse" for
admin, "Konto" for andre. Hver card markeret med `data-tab`-attribut og
toggles via `display:none`/`""`. Underliggende init-funktioner kører
stadig ved page load (uændret), så form-state og data er klar når en tab
aktiveres.

**Filer:** [frontend/js/views/settings.js](frontend/js/views/settings.js),
[frontend/css/styles.css](frontend/css/styles.css)

---

## [3.8.2 build 0122] — 2026-05-01 — fix(Settings): refresh System adm-katalog efter user-create + skjul picker for admin

To follow-ups på 3.8.0 (auto-rolle pr. bruger):

1. **System adm-katalog opdateres efter user-create.** Backend auto-opretter
   en rolle med navn = username, men frontend's cache blev ikke refreshed
   → rollen var usynlig i Brugere-tabellens picker indtil page reload.
   `initRolesSection` returnerer nu sin `reload`-funktion via
   `state.reload`, og `createUser`-handleren kalder den efter success.

2. **Skjul System adm-picker for admin-brugere.** Admin har implicit alle
   roller og ser alle endpoints — det er forvirrende at vise et
   checkbox-katalog som om de skal vælge noget. Admin-rækker viser nu
   hinten *"Admin — alle System adm implicit"* i kolonnen. Når en bruger
   skifter system-rolle (fx editor → admin) genrenderes rækken så cellen
   automatisk toggler mellem picker og admin-hint.

**Filer:** [frontend/js/views/settings.js](frontend/js/views/settings.js)

---

## [3.8.1 build 0121] — 2026-04-30 — fix: registrar får 403 på "Mine endpoints"

Bruger med rollen `registrar` blev mødt med *"403: Kræver en af rollerne:
admin, editor, viewer"* når de klikkede "Mine endpoints" i register-
viewet. Årsag: `GET /api/endpoints/details/all` var beskyttet af
`require_any` (kun admin/editor/viewer). Service-laget filtrerer dog
allerede pr. effektive roller, så det er sikkert at give registrar
adgang — de ser kun egne endpoints (deres username + assigned System adm).

Fix: skift dependency til `require_register_lookup` (admin/editor/viewer/
registrar) på dette ene endpoint.

**Filer:** [backend/app/api/endpoints.py](backend/app/api/endpoints.py)

---

## [3.8.0 build 0120] — 2026-04-30 — feat: omdøb "Endpoint-roller" → "System adm" + auto-rolle pr. bruger

UI-terminologien for endpoint-tag-systemet skiftet fra "Endpoint-roller" /
"Roller" til **"System adm"** alle steder portalen viser eller refererer
til det. Ny funktion: hver bruger får automatisk en System adm-rolle i
kataloget med navn = username, så admin kan se og bruge brugeren som
scope-tag på endpoints uden manuelt at oprette rollen.

**Backend:**
- `role_catalog.ensure_user_role(username)` — idempotent helper der
  tilføjer en katalog-entry markeret med `auto_user_role: true`. Skipper
  ugyldige navne (skal matche `^[A-Za-z0-9_-]{1,64}$`).
- `role_catalog.backfill_user_roles(usernames)` — bulk-helper der køres
  ved startup for at oprette manglende user-roller efter opgradering.
- `user_service.create_user()` kalder nu `ensure_user_role` efter user-
  creation. Logger advarsel hvis username indeholder ugyldige tegn så
  user-flowet ikke fejler — admin kan manuelt oprette rolle bagefter.
- `main.py` lifespan kører backfill ved hver startup. Idempotent.

**Frontend rename (UI-text only, internal IDs/API-stier uændret):**
- Settings: "Endpoint-roller" header → "System adm". Hint-tekst opdateret
  til at forklare admin-konceptet (admin uden System adm = fuld synlighed,
  brugere får automatisk username-rolle).
- Settings: "Brugere & roller" → "Brugere & System adm". Tabellen viser
  "System adm" i kolonneoverskriften.
- Browse: kolonne "Roller" → "System adm". Detail-modal og bulk-edit
  felter ligeledes.
- Register: rolle-picker label "Roller" → "System adm". Hint-tekst
  opdateret. "Mine endpoints"-listen viser "System adm" i stedet for
  "Roller".
- Alerts/dialogs: "Rolle oprettet" → "System adm oprettet", etc.

**Bevarede internt:**
- ISE custom attribute hedder stadig `HypervisionRoles` (ingen ISE-side
  rename — det er en breaking change for bestående endpoints).
- API-paths `/api/endpoint-roles` uændret.
- Field-navne `assigned_endpoint_roles` i user-records uændret.

**Filer:** [backend/app/core/role_catalog.py](backend/app/core/role_catalog.py),
[backend/app/services/user_service.py](backend/app/services/user_service.py),
[backend/app/main.py](backend/app/main.py),
[frontend/js/views/settings.js](frontend/js/views/settings.js),
[frontend/js/views/browse.js](frontend/js/views/browse.js),
[frontend/js/views/register.js](frontend/js/views/register.js)

---

## [3.7.4 build 0119] — 2026-04-30 — ux(Browse): PxGrid-status flyttet til header + reorganiseret toolbar + FEATURES-oprydning

**Browse-toolbaren var blevet for lang** med 14+ knapper i én række.
Reorganiseret med visuelle dividers i 5 logiske grupper:

1. **Data-handlinger** — Refresh · Export CSV · Kolonner ▾
2. **Filtre** — Kun portal · server-filter (MAC search)
3. *(spacer)* — skubber resten til højre
4. **Gem-handlinger** — CoA reauth · Gem alle
5. **Bulk-actions** — selection-count · Rediger · Gem · Disconnect · Slet
6. **Visning** — page-size · count

PxGrid push/pull-status-badgen er flyttet **ud af toolbar'en** og op
ved siden af "Browse / Edit endpoints"-titlen i en ny `.page-header`.
Det giver:
- Mere plads i selve toolbar'en
- Status fungerer som en "ambient" indikator der altid er synlig på
  side-niveau, ikke gemt blandt knapper
- Logisk separation: status (information) vs. toolbar (handlinger)

Bulk-knapperne har også fået kortere labels ("Disconnect" og "Slet" i
stedet for "Disconnect valgte" / "Slet valgte") fordi gruppen allerede
viser selection-count som kontekst.

**FEATURES.md oprydning:**
- `[in-progress 3.0.0] PxGrid server-push af session/auth-status` →
  `[done 3.0.0 → 3.7.3]` — er reelt landet gennem 8 minor/patch-bumps.
- `[in-progress 3.0.0] PxGrid event-invalidering af endpoint-cache` →
  `[wontfix 3.0.0]` — empirisk verificeret at ISE 3.4/3.5 ikke
  publicerer endpoint-CRUD-events. Multi-topic worker bevaret som
  opt-in for profiler-events. 2.8.0 background-sync er B-løsning.

**Filer:** [frontend/js/views/browse.js](frontend/js/views/browse.js),
[frontend/css/styles.css](frontend/css/styles.css),
[FEATURES.md](FEATURES.md)

---

## [3.7.3 build 0118] — 2026-04-30 — fix(Browse): falsk PUSH-status når pxGrid er disabled

Browse-badge fortsatte med at vise "🟢 PUSH (pxGrid)" efter admin slog
PxGrid fra i Settings. Det var ikke kun visuelt forkert — `pxgridLive=true`
fik også frontend til at springe MnT-polden over, så auth-status-farver
aldrig blev opdateret.

**Fix:** indført eksplicit "pxgrid_disabled"-event over SSE-kanalen:
- SSE-endpoint sender det med det samme hvis `pxgrid_enabled=false` ved
  connect-tidspunkt.
- `session_worker.stop()` broadcaster det til alle aktive SSE-subscribers
  så frontend reagerer øjeblikkeligt når admin disabler under drift
  (worker stoppes som del af settings-save-flow).
- Frontend lytter på event'et: lukker EventSource permanent (ingen retry-
  storm mod disabled service), rydder pxGrid-state, og falder tilbage til
  MnT-poll. Badge viser nu korrekt "🟡 PULL (MnT-poll)" når pxGrid er fra.

**Filer:** [backend/app/api/pxgrid.py](backend/app/api/pxgrid.py),
[backend/app/pxgrid/session_worker.py](backend/app/pxgrid/session_worker.py),
[frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.7.2 build 0117] — 2026-04-29 — perf(Browse): inkrementel row-refresh efter save (ikke længere flud-reload)

Hver gang admin gemte ændringer i Browse — hvad enten via "Gem alle",
"Gem valgte", eller detail-modal'en — kaldte vi ``await load()`` der
genfetchede **hele** datasettet plus 6 hjælpekald (groups, custom-attrs,
DACLs, platform-mapping, roles, auth-me). Det er en "flud opdatering"
selv hvis kun ét enkelt endpoint blev gemt.

**Optimering:**
- Ny ``refreshRows(ids)`` i [browse.js](frontend/js/views/browse.js) der
  henter kun de specifikke endpoints via ``api.getEndpoint(id)`` parallelt,
  patcher ``allRows`` + ``allRowsCache`` in-memory, og opdaterer kun de
  affected ``<tr>`` i DOM in-place (bevarer scroll, focus, selection).
- De tre ``await load()``-kald efter save er erstattet med
  ``refreshRows(savedIds)``.

**Effekt:** Save af 1 endpoint går fra ~7 ISE-kald til 1. Save af 10
endpoints går fra ~7 ISE-kald (paginated list + groups + ...) til 10 GET-
detail-kald (parallelt). Bedre fordi vi kun rører det der faktisk ændrede
sig, og fordi user-state (scroll position, åbne dropdowns, checkbox-
selection) bevares — ingen UI-flicker.

**Bevarede full-reloads:**
- Initial mount af Browse-viewet
- Eksplicit "Refresh"-knap i toolbaren (intentionel full reload)
- Filter mode-skift (kræver fuld dataset)
- Bulk delete (slettede endpoints kan ikke re-fetches)
- pxGrid endpoint_changed-event (ekstern trigger — kunne optimeres senere
  hvis event-id matches en cached row)

**Filer:** [frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.7.1 build 0116] — 2026-04-29 — refactor(purge-protect): revert DRS-stempling, tilføj guide-card + dok

3.7.0's tilgang viste sig at være forkert: Cisco's docs siger eksplicit at
custom attributes IKKE kan bruges som purge-condition i ISE 3.4. Vores
DRS-stempling havde derfor ingen reel effekt. Bruger har opgraderet til
ISE 3.5 hvor `CUSTOMATTRIBUTE` som purge-condition ER understøttet — og
har manuelt oprettet en `Hypervision`-rule med
`CUSTOMATTRIBUTE HypervisionISEPortal EQUALS true`. Det dækker 100% af
portal-stemplede endpoints, så DRS-stemplingen er overflødig.

**Rollback:**
- Fjernet `DeviceRegistrationStatus`-stempling fra create/update.
- Fjernet `purge_protect_backfill()`-service-method og
  `POST /api/endpoints/purge-protect-backfill`-endpoint.
- Fjernet `PURGE_PROTECT_*`-konstanterne fra `custom_attr_store`.
- Fjernet `purgeProtectBackfill()` fra frontend api.js.

**Tilføjet:**
- Settings UI har nu et "Anbefalet ISE purge-config"-card med:
  - Step-by-step vejledning til at oprette `Never Purge`-rule manuelt
    (ISE 3.5+ med `CUSTOMATTRIBUTE` condition).
  - Kopiér-knapper til rule-name og attribut-navn.
  - Alternativ-opskrift for ISE 3.4 (Identity Group som condition).
  - Eksplicit note om at der ikke findes API til purge-rules.
- [ISE_API_REFERENCE.md](ISE_API_REFERENCE.md) udvidet med stort afsnit
  om pxGrid 2.0 empiriske erfaringer (bootstrap, WS-auth, heart-beat,
  topics-tabel, ServiceLookup-discovery) plus "Endpoint Purge — hvad
  virker og hvad gør ikke" inkl. version-matrix for custom-attribute-
  condition support.

**Filer:** [backend/app/core/custom_attr_store.py](backend/app/core/custom_attr_store.py),
[backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py),
[backend/app/api/endpoints.py](backend/app/api/endpoints.py),
[frontend/js/api.js](frontend/js/api.js),
[frontend/js/views/settings.js](frontend/js/views/settings.js),
[ISE_API_REFERENCE.md](ISE_API_REFERENCE.md)

---

## [3.7.0 build 0115] — 2026-04-29 — feat: purge-protection via DeviceRegistrationStatus="Registered"

ISE's default endpoint-purge-policy fjerner endpoints baseret på inaktivitet
— ødelæggende for portal-managed devices der måske ikke ses på nettet i lang
tid. ISE's purge-rules eksempterer dog endpoints hvor
`DeviceRegistrationStatus="Registered"`. Den indbyggede DRS er forbeholdt
BYOD-flowet, men purge-evalueringen matcher også **custom attributes med
samme navn** — så vi definerer den som CA og stempler "Registered"
automatisk på alle portal-endpoints.

**Backend:**
- `custom_attr_store.HIDDEN_ATTRS` udvidet med `DeviceRegistrationStatus` så
  ISE-definitionen auto-bootstrappes ved første endpoint-create/update via
  eksisterende `_ensure_ca_definitions()`-flow.
- `endpoint_service.create_endpoint()` + `update_endpoint()` stempler nu
  automatisk `DeviceRegistrationStatus=Registered` (sammen med eksisterende
  `HypervisionISEPortal=true`).
- Ny `purge_protect_backfill()` der paginerer gennem portal-endpoints
  (filter `CUSTOM.HypervisionISEPortal.EQ.true`), tjekker raw customAttributes
  for eksisterende DRS-værdi og opdaterer kun dem der mangler stemplet.
  Idempotent. Audit-logged som `backfill/endpoint/purge_protect`.
- Nyt admin-only endpoint `POST /api/endpoints/purge-protect-backfill` der
  returnerer `{scanned, already_ok, updated, failures}`.

**Frontend:**
- Ny "Purge-protection"-card i Settings med Backfill-knap, confirm-dialog,
  in-flight progress og resultat-rapport (success/warning ved fejl + expandable
  failure-list).

**Filer:** [backend/app/core/custom_attr_store.py](backend/app/core/custom_attr_store.py),
[backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py),
[backend/app/api/endpoints.py](backend/app/api/endpoints.py),
[frontend/js/api.js](frontend/js/api.js),
[frontend/js/views/settings.js](frontend/js/views/settings.js)

**Use:** Efter opgradering, gå til Settings → Purge-protection → klik
"Backfill DeviceRegistrationStatus..." én gang for at stemple alle
eksisterende portal-endpoints. Nye endpoints stemples automatisk fra nu.

---

## [3.6.3 build 0114] — 2026-04-29 — diag(PxGrid): vis ServiceLookup-properties for endpoint-topic

User rapporterer at endpoint-events udebliver selv om SUBSCRIBE accepteres
silently (begge topics i `subscribed_topics`, men `endpoint: 0`). Hypotese:
ServiceLookup returnerer en service-node uden `topic`-property, så vi
falder tilbage til en hardcoded default som ikke matcher den faktiske
broker-destination.

Tilføjet diagnostik:
- Worker fanger nu hele `properties`-dict fra ServiceLookup-svaret og
  prøver flere kendte property-navne (`topic`, `endpointTopic`,
  `wsPubsubTopic`) før fallback.
- Logger advarsel hvis ingen topic-property findes i responset, så
  problemet er synligt i `app.log`.
- Worker-status API returnerer nu `endpoint_lookup_service` +
  `endpoint_lookup_props` så Settings UI kan vise nøjagtigt hvad ISE
  svarede på ServiceLookup-kaldet — admin kan se direkte i UI'et om
  topic er tom, om properties bare er ufuldstændige, eller om vi har
  ramt forkert service-navn.

**Filer:** [backend/app/pxgrid/session_worker.py](backend/app/pxgrid/session_worker.py),
[backend/app/api/pxgrid.py](backend/app/api/pxgrid.py),
[backend/app/schemas/settings.py](backend/app/schemas/settings.py),
[frontend/js/views/settings.js](frontend/js/views/settings.js)

---

## [3.6.2 build 0113] — 2026-04-29 — ux(Browse): vis endpoint-event-count i status-badge

Fejlsøgning af "nye endpoints i ISE dukker ikke op": badge'en viste kun
session-data, så det var svært at se om endpoint-topic-subscription
faktisk modtog events. Badge viser nu altid `endpoint-events: N (sidste
Xs siden)` så admin kan se i Browse-viewet om SSE-eventene faktisk når
frem (uden at skifte til Settings).

**Filer:** [frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.6.1 build 0112] — 2026-04-29 — fix(PxGrid): ServiceLookup for endpoint-topic, ikke hardcoded default

Bruger rapporterede at nye endpoints oprettet i ISE-GUI ikke dukker op i
portalens Browse-view, selv med endpoint-topic enabled. Worker accepterede
SUBSCRIBE silently for et topic der ikke nødvendigvis eksisterer på alle
ISE-versioner.

Fix: worker gør nu ServiceLookup for et konfigurerbart service-navn
(`pxgrid_endpoint_service`, default `com.cisco.ise.endpoint`) når endpoint-
topic er enabled. Bruger den returnerede `topic`-property fra service-
node'en hvis tilstede, falder tilbage til den konfigurerede topic ellers.
ServiceLookup-fejl skrives til `last_error` i worker-status så det er
synligt i Settings UI.

Settings UI har nu separate felter:
- **Endpoint-service navn** (ServiceLookup target — prøv
  `com.cisco.ise.config.profiler` eller `com.cisco.ise.endpoint.asset`
  hvis default ikke virker på din ISE-version).
- **Endpoint-topic fallback** (kun brugt hvis ServiceLookup ikke
  returnerer topic-property).

Worker-status viser nu altid den faktisk subscribede topic (ikke bare
default-config) i `subscribed_topics`-listen.

**Filer:** [backend/app/core/config.py](backend/app/core/config.py),
[backend/app/pxgrid/session_worker.py](backend/app/pxgrid/session_worker.py),
[backend/app/schemas/settings.py](backend/app/schemas/settings.py),
[backend/app/services/settings_service.py](backend/app/services/settings_service.py),
[frontend/js/views/settings.js](frontend/js/views/settings.js)

---

## [3.6.0 build 0111] — 2026-04-29 — feat(PxGrid Phase 4): endpoint-topic + live cache-invalidering

Sidste leg af 3.0.0-roadmap'en: portalen reagerer nu live på endpoint-
ændringer foretaget direkte i ISE-GUI (uden om portalen). Worker'en
subscriber til to topics samtidigt på samme WebSocket, og endpoint-events
invaliderer 2.8.0 endpoint-cache + pushes som `endpoint_changed` til
Browse-viewet som så reloader.

**Backend:**
- `session_worker._one_session()` refactored til multi-SUBSCRIBE: én sub-id
  pr. topic (`sub-session`, `sub-endpoint`), MESSAGE-frames routes via
  `subscription`-header til separate handlere.
- Ny `_handle_endpoint_body()` — tolerant payload-parser, kalder
  `endpoint_cache.invalidate_detail(id)` (fallback til `invalidate_all()`
  hvis ISE-ID mangler), broadcaster `endpoint_changed`-event på samme
  SSE-bus som session-events.
- `WorkerStatus` har nu `subscribed_topics`, `session_events_total`,
  `endpoint_events_total` for separate counters i UI.

**Settings:**
- `pxgrid_endpoint_topic_enabled` (default OFF — opt-in fordi event-volume
  stiger) + `pxgrid_endpoint_topic` (default `/topic/com.cisco.ise.endpoint`).
- Worker restartes automatisk ved settings-save så ny subscription tager
  effekt uden backend-restart.

**Frontend:**
- `browse.js` lytter på `endpoint_changed`-events fra SSE-stream og kører
  debounced reload (500ms vindue) så bulk-ændringer i ISE ikke triggrer
  N reloads i træk. Skipper reload hvis bruger har dirty edits — lokale
  ændringer skal ikke wipes af cache-refresh.
- Settings worker-status panel viser nu topics-listen + separate
  session/endpoint event-tællere.

**Filer:** [backend/app/core/config.py](backend/app/core/config.py),
[backend/app/pxgrid/session_worker.py](backend/app/pxgrid/session_worker.py),
[backend/app/api/pxgrid.py](backend/app/api/pxgrid.py),
[backend/app/schemas/settings.py](backend/app/schemas/settings.py),
[backend/app/services/settings_service.py](backend/app/services/settings_service.py),
[frontend/js/views/settings.js](frontend/js/views/settings.js),
[frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.5.2 build 0110] — 2026-04-29 — fix(PxGrid): SSE-stream-route skygges af /sessions/{mac}

Browse-toolbar viste vedvarende "🟡 PULL (MnT-poll · 0 aktive)" selv når
worker var connected (Settings rapporterede 🟢 connected, 0 events). Bug
var ren route-ordering: `/sessions/stream` blev registreret EFTER
`/sessions/{mac}`, så FastAPI matchede stream-URL'en som `mac="stream"`,
returnerede 404 fra `cache.get("stream")`, EventSource fejlede silent og
`pxgridLive` forblev false → fallback til MnT.

Fix: flyttet stream-route op før den dynamiske `{mac}`-route. Tilføjet
eksplicit kommentar om kravet så regression er svær at lave igen.

**Filer:** [backend/app/api/pxgrid.py](backend/app/api/pxgrid.py)

---

## [3.5.1 build 0109] — 2026-04-29 — fix(Browse): live re-color uden refresh + push/pull-indikator

To problemer i Phase 3-leverancen rapporteret efter rollout:

1. **Auth-status opdateredes kun ved Refresh** — SSE-handlerne for `upsert/remove`
   tjekkede `anyFilterActive()` og sprang DOM-update over uden filter, så
   live events ikke ændrede grøn/rød farve på rækkerne. Fix: `activeSessionMacs`
   populeres nu altid fra `pxgridSessionMacs` når stream er live (det koster
   ingen ISE-kald), og `applyAuthStatusColors()` kaldes uafhængigt af filter.
2. **Ingen indikation af kilde** — admin kunne ikke se om farverne kom fra
   pxGrid push eller MnT pull. Ny status-badge i Browse-toolbar viser:
   - 🟢 PUSH (pxGrid · N aktive · sidste event Xs siden)
   - 🟡 PULL (MnT-poll · N aktive)
   - ⚪ Inaktiv (intet filter + pxGrid offline)

   Badge tælles op hvert 5s så "sidste event"-tid forbliver retvisende selv
   når der er stille på STOMP-kanalen.

**Filer:** [frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.5.0 build 0108] — 2026-04-29 — feat(PxGrid Phase 3): SSE-stream til frontend, Browse farver live

Phase 2b's worker fyldte cachen med real-time event-data, men frontend
brugte stadig MnT-poll for at farve auth-status. Phase 3 lukker loopet:
en SSE-stream pusher cache-deltas direkte til Browse-viewet, så grøn/rød
checkbox-farve følger ISE i realtid uden poll.

**Backend:**
- `session_cache.py` udvidet med pubsub-fan-out: hver SSE-subscriber får sin
  egen `asyncio.Queue` (cap 256, drop-oldest ved overflow så slow consumers
  ikke holder worker'en op). `upsert/remove/clear` broadcaster events.
- Nyt endpoint `GET /api/pxgrid/sessions/stream?token=<jwt>` (text/event-stream).
  EventSource kan ikke sætte Authorization-header, så JWT'en accepteres som
  query-param og valideres mod samme codepath som require_any. Sender
  `snapshot` ved connect, derefter `upsert`/`remove`/`clear` events,
  `keepalive` hvert 15s.

**Frontend:**
- `browse.js` åbner EventSource ved view-load, holder en lokal Set af
  aktive MAC'er live opdateret. Når mindst ét filter er aktivt og pxGrid-
  stream er live, springes MnT-polden over (kommer ind i `refreshActiveSessionMacs`).
- Graceful fallback: EventSource auto-reconnecter; når den er nede falder
  vi tilbage til MnT-poll. Når pxGrid er disabled returnerer endpoint'et
  401 og browse fortsætter med MnT som hidtil.
- Cleanup når Browse-view skiftes (MutationObserver + EventSource.close()).

**Designvalg:** SSE valgt over WebSocket fordi (a) one-way push er nok —
frontend skal kun læse, (b) browser auto-reconnect er gratis, (c) ingen
ekstra dependency på server-side. Token-i-query er en bevidst trade-off
for EventSource's manglende header-support; tokens er korte og pages igennem
samme CORS/HTTPS som resten af API'et.

**Filer:** [backend/app/pxgrid/session_cache.py](backend/app/pxgrid/session_cache.py),
[backend/app/api/pxgrid.py](backend/app/api/pxgrid.py),
[frontend/js/views/browse.js](frontend/js/views/browse.js)

---

## [3.4.0 build 0107] — 2026-04-28 — feat(PxGrid Phase 2b): persistent STOMP-worker + session-cache

Phase 2a's prober blev brugt som diagnose-værktøj og er bekræftet end-to-end
(STOMP OK, 0 events i 10s — broker accepterede subscribe). 2b bygger den
permanente kanal: en lifespan-task der subscriber til
`com.cisco.ise.session` *uendeligt*, parser MESSAGE-frames og holder en
in-memory `MAC → SessionInfo`-cache opdateret i real-time.

**Backend:**
- Ny `pxgrid/session_cache.py` — asyncio-lock-beskyttet dict + stats.
- Ny `pxgrid/session_worker.py` — auto-reconnect med eksponentiel backoff,
  PSN-failover via fresh ServiceLookup pr. cycle, fresh AccessSecret pr.
  reconnect (broker afviser genbrugte secrets), heart-beat-tab → reconnect.
- Worker startes/stoppes i FastAPI lifespan (`main.py`).
- Ny router `api/pxgrid.py`: `GET /pxgrid/sessions`, `GET /pxgrid/sessions/{mac}`,
  `GET /pxgrid/worker/status`, `POST /pxgrid/worker/restart`.
- `stomp.connect_frame()` accepterer nu `heartbeat_ms`-param.

**Settings (alle nye tunables):**
- `pxgrid_session_topic` (default `/topic/com.cisco.ise.session`)
- `pxgrid_stomp_heartbeat_ms` (default 30000)
- `pxgrid_stomp_reconnect_min_s` / `_max_s` (default 1 / 300 sek)
- `pxgrid_session_cache_max_age_s` (default 0 = aldrig udløb)
- `pxgrid_worker_enabled` (default true) — separat fra `pxgrid_enabled`
  så admin kan slå worker fra uden at miste REST control plane.

**Frontend:**
- Nyt fieldset under PxGrid-card med alle tunables + live worker-status
  (running/connected, peer-node, event-count, cache-size, reconnect-count,
  last error). Auto-refresh hvert 10s. "Restart worker"-knap.

**Designvalg:** worker restartes automatisk når settings gemmes så ændrede
heartbeat/topic/backoff tager effekt uden full backend-restart. Tunables
giver ops mulighed for at tune broker-timeouts under konkrete deployments
uden code-ændring (fx kortere heartbeat ved aggressive firewalls,
længere backoff ved flaky links).

**Filer:** [backend/app/core/config.py](backend/app/core/config.py),
[backend/app/pxgrid/session_cache.py](backend/app/pxgrid/session_cache.py),
[backend/app/pxgrid/session_worker.py](backend/app/pxgrid/session_worker.py),
[backend/app/pxgrid/stomp.py](backend/app/pxgrid/stomp.py),
[backend/app/api/pxgrid.py](backend/app/api/pxgrid.py),
[backend/app/api/settings.py](backend/app/api/settings.py),
[backend/app/schemas/settings.py](backend/app/schemas/settings.py),
[backend/app/services/settings_service.py](backend/app/services/settings_service.py),
[backend/app/main.py](backend/app/main.py),
[frontend/js/api.js](frontend/js/api.js),
[frontend/js/views/settings.js](frontend/js/views/settings.js)

---

## [3.3.3 build 0106] — 2026-04-27 — ux(PxGrid): flyt status-bar under action-knapper

Status-feltet (`#pxgrid-msg`) lå over selve formularen, så test-knapperne
blev skubbet langt ned. Flyttet til lige under action-rækken så
knapperne ligger i toppen af PxGrid-sektionen og status vises der hvor
brugeren har klikket.

**Filer:** [frontend/js/views/settings.js](frontend/js/views/settings.js)

---

## [3.3.2 build 0105] — 2026-04-28 — fix(PxGrid): tilføj HTTP Basic auth på WebSocket-upgrade

STOMP-prober fejlede ved `ws_connect`-trinet med `server rejected
WebSocket connection: HTTP 401`. pxGrid pubsub-broker kræver
HTTP Basic auth (`node_name:secret`) på selve WS-upgrade-
requesten — ikke kun inde i STOMP CONNECT-frame'en. mTLS alene
er ikke nok til broker-laget; ISE forventer to-lags auth.

`probe.run_session_probe()` bygger nu `Authorization: Basic
<b64(node:secret)>` og sender den via `additional_headers=`
til `websockets.connect()`.

Filer: [backend/app/pxgrid/probe.py](backend/app/pxgrid/probe.py).

---

## [3.3.1 build 0104] — 2026-04-27 — fix(PxGrid): kald /AccessSecret (ikke /AccessSecretCreate) — ISE 3.4 returnerer 404

STOMP-prober fejlede ved `access_secret`-trinet med 404 fra ISE.
pxGrid 2.0-spec'et + Cisco DevNet samples bruger **kortformen**
`/pxgrid/control/AccessSecret` her, modsat de tre andre control-
plane calls (`AccountCreate`, `AccountActivate`, `ServiceLookup`)
der har "Create"/"Activate"/"Lookup"-suffix. Naming-mønstret
bryder med de øvrige.

`client.access_secret_create()` kalder nu det rigtige path.
Fejlmeddelelser + docstrings opdateret. Ny gotcha #8 i
[ISE_API_REFERENCE.md](ISE_API_REFERENCE.md) så fælden ikke
gentages.

Filer: [backend/app/pxgrid/client.py](backend/app/pxgrid/client.py),
[backend/app/pxgrid/probe.py](backend/app/pxgrid/probe.py),
[ISE_API_REFERENCE.md](ISE_API_REFERENCE.md).

---

## [3.3.0 build 0103] — 2026-04-27 — feat(PxGrid): minimal STOMP-prober (Phase 2a)

Nu hvor REST-bootstrap (port 8910) virker end-to-end, er næste step
at verificere at WebSocket+STOMP-laget mod pubsub-noden også fungerer
*før* vi bygger persistent worker + session-cache + SSE-stream ovenpå.

Ny knap i Settings → PxGrid: "Test STOMP-subscription (10s)" der
walker:

  1. ServiceLookup("com.cisco.ise.pubsub") → wsUrl
  2. AccessSecretCreate(peer_node) → per-peer secret
  3. WebSocket connect (mTLS, samme cert som control-plane)
  4. STOMP CONNECT (login=node, passcode=secret, accept-version=1.2)
  5. SUBSCRIBE /topic/com.cisco.ise.session
  6. Læs frames i 10 sek, count MESSAGE-frames, gem ≤3 sample-bodies
  7. DISCONNECT, luk WS

Returnerer struktureret rapport med præcis hvilket trin der fejlede
(cert/lookup/connect/subscribe/timeout) + sample-payloads så fejl-
søgning er præcis. Read-only og selvterminerende.

Tom-resultat (0 events i 10s) er IKKE en fejl — bare lav RADIUS-
trafik i tidsvinduet. Probe rapporterer ok=True med count=0.

Nye filer:
- [backend/app/pxgrid/stomp.py](backend/app/pxgrid/stomp.py) —
  ~120 LOC tiny STOMP 1.2 frame-codec (ingen ekstern dep)
- [backend/app/pxgrid/probe.py](backend/app/pxgrid/probe.py) —
  `run_session_probe(duration_s)` walker hele kæden

Udvidelser:
- [backend/app/schemas/settings.py](backend/app/schemas/settings.py)
  +PxGridStompProbeResponse
- [backend/app/api/settings.py](backend/app/api/settings.py)
  +POST /api/settings/pxgrid/stomp-probe?duration=N (1-60s)
- [backend/app/services/settings_service.py](backend/app/services/settings_service.py)
  +pxgrid_stomp_probe wrapper
- [backend/pyproject.toml](backend/pyproject.toml) +websockets>=12.0
  (transitiv via uvicorn[standard], gjort eksplicit)
- [frontend/js/api.js](frontend/js/api.js) +runPxGridStompProbe
- [frontend/js/views/settings.js](frontend/js/views/settings.js)
  +knap+inline-resultat med expandable sample-payloads

Næste skridt: Phase 2b (persistent STOMP-worker + session-cache) og
Phase 2c (SSE-stream til frontend, erstatter MnT-poll).

---

## [3.2.3 build 0102] — 2026-04-27 — fix(PxGrid): tilføj ekstra SAN-felt så CSR kan inkludere host-FQDN

Build 0101 tilføjede `SAN:dNSName=<node_name>` (minimum for ISE
3.4). For fuld pxGrid 2.0 / RFC 6125 compliance bør SAN også
indeholde portalens host-FQDN — visse ISE-deployments med
strict cert-validation afviser klient-certs uden det.

Nyt setting-felt `pxgrid_cert_extra_sans` (komma-separeret
liste af DNS-navne) inkluderes nu som ekstra `SAN:dNSName` i
CSR'en udover `pxgrid_node_name`. Listen dedupes og tomme
entries filtreres væk. UI-felt under node-navnet i Settings
→ PxGrid med hint om at tilføje host-FQDN.

Påvirker kun nye CSR'er — eksisterende cert skal genskabes via
Nulstil registrering → Trin 1 hvis admin vil have FQDN ind.

Filer: [backend/app/core/config.py](backend/app/core/config.py),
[backend/app/schemas/settings.py](backend/app/schemas/settings.py),
[backend/app/services/settings_service.py](backend/app/services/settings_service.py),
[backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py),
[backend/app/api/settings.py](backend/app/api/settings.py),
[frontend/js/views/settings.js](frontend/js/views/settings.js).

---

## [3.2.2 build 0101] — 2026-04-27 — fix(PxGrid): tilføj SubjectAlternativeName til genereret CSR

`cert_manager.generate_csr()` lavede CSR'en uden SAN-extension —
kun `subject_name = CN=<node>`. pxGrid 2.0 / RFC 6125 kræver
`SubjectAlternativeName:dNSName` matchende nodeName, og ISE 3.4
afviser cert som "ikke matcher node" når SAN mangler (selv om
CN er korrekt). Det forklarer "Password mismatch"-loggen på
hypervision-portal hvor Web Clients-tabben i øvrigt var tom:
kontoen blev afvist *før* registrering nåede at gennemføres.

CSR'en tilføjer nu `x509.SubjectAlternativeName([DNSName(node)])`
som non-critical extension. Eksisterende installationer skal
køre Nulstil registrering → Trin 1 (ny CSR) → re-signering hos
CA → Trin 3 (upload nyt cert), da SAN bages ind ved CA-signering.

Filer: [backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py).

---

## [3.2.1 build 0100] — 2026-04-27 — fix(PxGrid): konkrete fejlmeddelelser ved manglende cert-materiale

`load_bundle()` returnerede den generiske `pxgrid_cert_path and
pxgrid_key_path must both be set` uanset hvilken af de to der
manglede, og fortalte ikke admin hvad de skulle gøre. Det er
mest synligt efter "Nulstil registrering" hvis admin springer
Trin 1 (Generér CSR) over og hopper direkte til Trin 3.

Fejlmeddelelsen lister nu hvert manglende felt eksplicit
("klient-cert", "private key") og peger på det korrekte trin
i CSR-flowet:

- Manglende key → "kør Trin 1: Generér CSR for at oprette en ny"
- Manglende cert → "upload det signerede cert igen via Trin 3"
- Manglende CA → "upload CA-bundle igen via Trin 4"
- Path peger på fil der ikke findes → samme henvisning til trin

Filer:
- [backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py)

---

## [3.2.0 build 0099] — 2026-04-27 — feat(PxGrid): "Nulstil registrering"-knap i Settings

Admin-knap nederst i pxGrid-kortet der nulstiller portal-side
registrerings-state, så CSR-flowet kan køres forfra uden at man
selv skal slette filer på serveren. Bruges typisk efter:

- **Server-skift** (klient-entry på gamle ISE matcher ikke længere)
- **Forkert cert uploadet** (CSR i stedet for signed, mismatched key)
- **Expired keys** eller andre fejl-tilstande hvor "start rent" er
  hurtigere end at debugge

**Sletter** under `backend/pxgrid/<node>.{cert,key,ca,csr}.pem` plus
rydder cert/key/CA-paths og gemt `pxgrid_password` fra settings.

**Beholder** config-niveau felter (enabled, node_name, psn_fqdn,
cert_mode) så admin ikke skal indtaste dem igen før CSR-genereringen
køres på ny.

Operationen er **idempotent** og **kun portal-side** — admin skal
selv slette klient-entry'en i ISE → pxGrid Services → All Clients
hvis 100% rent flow ønskes. Det fremgår af både confirm-dialog,
UI-hint og API-docstring.

Audit: ny event `reset/backend_settings/pxgrid` (admin-only) der
logger before/after + listen af slettede filer.

Filer:
- [backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py) — ny `delete_artifacts(node_name)`
- [backend/app/services/settings_service.py](backend/app/services/settings_service.py) — ny `pxgrid_reset()`
- [backend/app/api/settings.py](backend/app/api/settings.py) — `POST /api/settings/pxgrid/reset`
- [backend/app/schemas/settings.py](backend/app/schemas/settings.py) — `PxGridResetResponse`
- [frontend/js/api.js](frontend/js/api.js) — `resetPxGridRegistration()`
- [frontend/js/views/settings.js](frontend/js/views/settings.js) — rød knap + confirm-dialog

---

## [3.1.6 build 0098] — 2026-04-27 — fix(PxGrid): gør Trin 5 idempotent når ISE returnerer 503 for kendt klient

ISE 3.4's pxGrid svarer 503 (i stedet for idempotent success) på
gentagne `/AccountCreate` for samme `nodeName`. Hvis admin allerede
har en gemt `pxgrid_password` betyder det bare at en tidligere
AccountCreate er lykkedes — kontoen findes på ISE-siden, bare i
en eller anden state (PENDING/ENABLED).

Trin 5 i UI'et fejlede unødvendigt selvom flowet faktisk var
gennemført. Fix:

- `pxgrid_account_create()` detekterer "503 + gemt password" og
  kalder `AccountActivate` for at rapportere den faktiske state.
- ENABLED → success med besked om at admin kan gå videre til Test.
- PENDING → success med besked om at klienten afventer approval i
  ISE → pxGrid Services → All Clients.
- Activate fejler også → original 503 propageres med kontekst.

Filer:
- [backend/app/services/settings_service.py](backend/app/services/settings_service.py)

---

## [3.1.5 build 0097] — 2026-04-27 — fix(PxGrid): brugbare fejlmeddelelser ved 503 + 401/403 på control-plane

ISE pxGrid svarede `503` med tom body på `/AccountCreate` efter
PEM-fixen i build 0096. Vores client reportede bare
`PxGrid /AccountCreate returned 503: ` hvilket var ubrugeligt for
admin.

`_post` i `client.py` håndterer nu de to typiske ikke-OK responses
specifikt:

- **503** fra port 8910 → dansk besked der lister de tre konkrete
  tjekpunkter i ISE-UI (Deployment-persona, pxGrid Services → All
  Clients running, Settings → auto-approval) + note om at multi-PSN
  setups skal sætte `pxgrid_psn_fqdn` eksplicit (ellers falder vi
  tilbage på `ise_base_url` som måske ikke er en pxGrid-node).
- **401/403** → peger på MS CA-trust og CSR-CN vs `pxgrid_node_name`
  som de typiske rod-årsager.

Filer:
- [backend/app/pxgrid/client.py](backend/app/pxgrid/client.py)

---

## [3.1.4 build 0096] — 2026-04-26 — fix(PxGrid): validér uploadede cert/key/CA-filer (CSR-as-cert + p7b + DER)

AccountCreate fejlede med `[SSL] PEM lib (_ssl.c:4143)` fordi admin
havde uploadet CSR-filen som "signeret cert" — den naive validation
`b"-----BEGIN" not in raw` slap CSR'en igennem (den har jo
`-----BEGIN CERTIFICATE REQUEST-----`), filen blev gemt som
`*.cert.pem`, og OpenSSL fejlede først ved TLS-handshake hvor
fejlmeddelelsen er ubrugelig.

**Fix** i `cert_manager.normalize_uploaded_bytes` (kaldes nu fra
`save_uploaded_pem`):

- **CSR uploadet som cert** → afvis med dansk besked der peger admin
  på den faktiske CA-roundtrip.
- **PKCS#7 (.p7b) chain** (typisk MS certsrv "Download certificate
  chain") → udtræk certs og re-emit som concatenated X.509 PEM,
  understøttes nu både til kind=cert (tager leaf) og kind=ca (hele chain).
- **DER (.cer / .crt binary)** → forsøg DER X.509 og DER PKCS#7,
  re-emit som PEM.
- **UTF-8 BOM** strippes (Notepad/Excel-eksporter tilføjer ofte
  `\ufeff` i starten).
- **Private key** valideres med `load_pem_private_key` /
  `load_der_private_key`; password-beskyttede keys/PFX peger admin
  hen på "Importér PKCS#12"-knappen.

Endpoint `POST /pxgrid/cert` returnerer nu 400 med konkret dansk
besked ved hver af disse fejl-typer i stedet for at lade filen lande
på disk og fejle ved næste handshake.

Filer:
- [backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py)
- [backend/app/api/settings.py](backend/app/api/settings.py)

---

## [3.1.3 build 0095] — 2026-04-26 — fix(PxGrid): renummerér CSR-flow til 5 trin + per-felt upload-status

To UX-issues opdaget under brug af CSR-flowet:

1. **Trin 2 var usynlig**: nummereringen sprang fra Trin 1 → Trin 3 →
   Trin 3b → Trin 4 fordi "indsend CSR til CA" kun lå som hjælpetekst
   øverst og ikke som dedikeret felt. Admin opfattede det som om der
   manglede et trin.
2. **Ingen lokal feedback efter upload**: `<input type=file>` resettes
   til "no file chosen" by design (så samme fil kan vælges igen efter
   fejl), men eneste bekræftelse var en success-banner øverst i kortet
   + en path-opdatering langt nede. Admin var ikke sikker på om upload
   faktisk virkede.

**Frontend** ([frontend/js/views/settings.js](frontend/js/views/settings.js)):

- CSR-blokken renummereret til **5 trin** med dedikeret felt for hvert:
  - Trin 1: Generér + download CSR
  - Trin 2: Indsend CSR til CA + hent signeret cert/CA-chain (instruktion
    med både ISE-internal-CA og MS-certsrv-flow inline, inkl. p7b→PEM-
    konvertering)
  - Trin 3: Upload signeret klient-cert
  - Trin 4: Upload CA-bundle
  - Trin 5: Opret pxGrid-konto
- Hver fil-upload-felt har fået en `.upload-status` span lige under
  input'et: "Uploader filnavn..." → "✓ Uploadet: filnavn" (grøn) eller
  "✗ Fejl: ..." (rød). Gælder både CSR-blokken (trin 3 + 4) og upload-
  mode-blokken (cert, key, ca). Direkte visuel bekræftelse uden at
  scanne resten af formularen.

Backend uændret. PFX-import-flowet har allerede eksplicit knap +
success-banner med paths så enhancement udeladt der.

Filer: [frontend/js/views/settings.js](frontend/js/views/settings.js),
[BUGS.md](BUGS.md).

---

## [3.1.2 build 0094] — 2026-04-26 — fix(PxGrid): skjul upload-blok i CSR-mode + flyt CA-upload ind i CSR-flowet

Opfølgning på 3.1.1 — efter at have introduceret nummererede trin i
CSR-blokken, var det stadig forvirrende at upload-blokken (med
overskriften "Upload-mode:" + tre separate PEM-felter + PFX-import)
forblev synlig ved siden af. To konkrete problemer:

1. **Footgun**: "Privat key (PEM)"-feltet i upload-blokken ville
   overskrive den private key portalen lige havde genereret som del
   af CSR'en — cert/key-paret matchede dermed ikke længere efter en
   sådan upload. Ingen advarsel.
2. **Forvirrende mental model**: admin så to parallelle "veje" som om
   begge skulle gennemføres for at lukke flowet, selvom de er
   gensidigt udelukkende.

**Frontend** ([frontend/js/views/settings.js](frontend/js/views/settings.js)):
`applyMode("csr")` skjuler nu hele upload-blokken (i stedet for kun at
toggle CSR-blokken). CA-bundle-uploaden — som CSR-flowet stadig har
brug for fordi ISE internal CA / MS certsrv kun udsteder klient-
certifikatet, ikke chain'en til at verificere ISE-server-cert ved
mTLS-handshake — er flyttet ind i CSR-blokken som **Trin 3b — Upload
CA-bundle (PEM)**. Brugte samme multi-kind file-handler-loop, så
backend-endpoint'et er uændret (`POST /pxgrid/cert kind=ca`).

Resultatet er ét sammenhængende CSR-flow med 4 + 1 trin (Generér →
Indsend → Upload signeret cert → Upload CA → Opret konto), uden
synlige felter der ikke giver mening i den valgte mode. Switch til
upload-mode dropdown viser stadig hele upload-blokken (uændret).

Filer: [frontend/js/views/settings.js](frontend/js/views/settings.js),
[BUGS.md](BUGS.md).

---

## [3.1.1 build 0093] — 2026-04-26 — fix(PxGrid): tydeliggør CSR-flow med nummererede trin + inline cert-upload

UX-fix på CSR-flowet: efter download af CSR fra portalen var det ikke
klart hvordan det signerede cert skulle uploades tilbage. Hjælpe-
teksten henviste til "Klient-certifikat (PEM)"-feltet i upload-blokken
*ovenover*, men feltet lå visuelt adskilt fra CSR-blokken og blev
overset.

**Frontend** ([frontend/js/views/settings.js](frontend/js/views/settings.js)):
CSR-blokken er omstruktureret til 4 nummererede trin med dedikerede
felter inde i selve blokken:
- **Trin 1**: Generér CSR + keypair (auto-download) + manuel
  "Download CSR igen"-knap
- **Trin 2**: (instruktion) indsend CSR til ISE internal CA / MS certsrv
- **Trin 3**: Upload signeret cert (PEM/CER) — nyt fil-input *inde i
  CSR-blokken* der bruger samme `POST /pxgrid/cert kind=cert`-endpoint
  som upload-blokkens cert-felt. Admin behøver ikke længere hoppe ud
  af CSR-blokken for at lukke flowet.
- **Trin 4**: Opret pxGrid-konto → afventer admin-approval i ISE

Backend er uændret — endpoint'et `POST /pxgrid/cert kind=cert` håndterer
allerede signerede certs uden at skelne mellem CSR-flow og frit
upload-flow. Det er kun UI-strukturen der er ændret.

Filer: [frontend/js/views/settings.js](frontend/js/views/settings.js),
[BUGS.md](BUGS.md).

---

## [3.1.0 build 0092] — 2026-04-26 — feat(PxGrid): PKCS#12-import (.pfx fra MS certsrv eller generic CA)

Tredje vej til at få cert-materialet på portalen, ud over (a) tre
separate PEM-uploads og (b) CSR-flow mod ISE internal CA. Primær
motivation: lader admin bruge **MS Active Directory Certificate
Services** (`https://<adcs>/certsrv`) som CA — én af de mest udbredte
interne PKI'er — uden at portalen selv skal kunne tale NTLM/Kerberos
mod ADCS web enrollment.

**Workflow** for admin:
1. Browse til `https://<adcs>/certsrv` med Windows-bruger.
2. Submit CSR (enten den portalen genererede via /pxgrid/csr, eller en
   ny direkte i certsrv-UI'et via "Create and submit a request to this
   CA").
3. Når cert'et er udstedt: "Install Certificate" → eksportér via
   IE/Edge cert-manager → "Yes, export the private key" + "Include
   all certificates in path if possible" → vælg password → gem .pfx.
4. Settings → PxGrid → ny PKCS#12-sektion → vælg fil + password →
   "Importér PKCS#12".

**Backend** ([backend/app/api/settings.py](backend/app/api/settings.py),
[backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py)):
nyt endpoint `POST /api/settings/pxgrid/pfx` (multipart: `file` +
`password` Form-field). To nye helpers i `cert_manager`:
- `extract_pkcs12(pfx_bytes, password)` bruger
  `cryptography.hazmat.primitives.serialization.pkcs12.load_key_and_certificates()`
  og returnerer `(cert_pem, key_pem, ca_pem|None)`. CA-chain bygges
  ved at koncatenere PEMs af alle `additional_certificates` fra
  bundlet (typisk sub-CA + root). Bad password / korrupt PFX bliver
  til `PxGridCertError` med dansk besked → 400.
- `save_pkcs12_bundle()` skriver de tre PEMs til samme naming-scheme
  som `save_uploaded_pem` (`<safe_node>.{cert,key,ca}.pem`) og
  chmod'er key til 600 hvor POSIX understøtter det.

Endpointet opdaterer alle tre `pxgrid_*_path`-settings i ét hug; hvis
PFX'en ikke havde CA-chain bevares den eksisterende
`pxgrid_ca_bundle_path` så admin kan uploade CA separat bagefter.

**Frontend** ([frontend/js/api.js](frontend/js/api.js),
[frontend/js/views/settings.js](frontend/js/views/settings.js)):
ny `api.uploadPxGridPfx(file, password)` med FormData. UI får ny
sektion under upload-blokken med fil + password + "Importér PKCS#12"-
knap. Eksplicit knap (ikke auto-submit på fil-change som de tre PEM-
felter), fordi password skal indtastes først. Success-meddelelsen
viser hvilke paths der blev sat og noterer hvis CA-chain manglede.

Bump-begrundelse: MINOR (3.1.0) — additivt feature, ingen breaking
changes. Eksisterende upload- og CSR-flows er uændrede; PFX-import er
en parallel vej der bruger samme on-disk-shape.

Filer: [backend/app/api/settings.py](backend/app/api/settings.py),
[backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py),
[frontend/js/api.js](frontend/js/api.js),
[frontend/js/views/settings.js](frontend/js/views/settings.js),
[FEATURES.md](FEATURES.md).

---

## [3.0.2 build 0091] — 2026-04-26 — feat(PxGrid): download CSR-fil direkte fra Settings UI

Tidligere lå CSR-filen kun på serverens disk under
`backend/pxgrid/<node>.csr.pem` efter `POST /pxgrid/csr` — admin måtte
SSH/RDP ind for at hente filen og indsende til ISE internal CA.

**Backend** ([backend/app/api/settings.py](backend/app/api/settings.py),
[backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py)):
nyt endpoint `GET /api/settings/pxgrid/csr/download` returnerer
`FileResponse` med `application/x-pem-file`-MIME og
`Content-Disposition: attachment; filename=<safe_node>.csr.pem`. Ny
helper `cert_manager.csr_path_for(node_name)` udleder CSR-pathen ud
fra node-navnet (samme `_safe_node_name`-sanitering som
`persist_csr_artifacts` bruger), så endpoint'et ikke skal tracke paths
separat. 400 hvis `pxgrid_node_name` ikke er sat, 404 hvis CSR ikke er
genereret endnu.

**Frontend** ([frontend/js/api.js](frontend/js/api.js),
[frontend/js/views/settings.js](frontend/js/views/settings.js)):
ny `api.downloadPxGridCsr()` helper laver auth'et fetch + blob +
`URL.createObjectURL` + `<a download>`-trigger så download'et virker
med Bearer-token (kan ikke bruge plain `<a href>`). UI'et har fået
"Download CSR-fil"-knap i CSR-blokken til standalone-download, og
auto-trigger efter "Generér CSR" så filen lander i Downloads uden
ekstra klik. Auto-trigger bruger silent-error-mode så success-beskeden
inkluderer enten "downloadet som X" eller fallback til manuel knap.

Filer: [backend/app/api/settings.py](backend/app/api/settings.py),
[backend/app/pxgrid/cert_manager.py](backend/app/pxgrid/cert_manager.py),
[frontend/js/api.js](frontend/js/api.js),
[frontend/js/views/settings.js](frontend/js/views/settings.js),
[FEATURES.md](FEATURES.md).

---

## [3.0.1 build 0090] — 2026-04-26 — fix(PxGrid): /csr og /account 400 efter UI-mode-skift uden Gem

Bug-fix på Phase 1 (3.0.0 build 0089) opdaget ved første rigtige test:
admin skifter cert-mode dropdown'en fra "upload" til "csr" og klikker
"Generér CSR" — backend svarer `400` fordi den gatekeeper på
*persisted* `cert_mode`, men dropdown-ændringen ligger kun i DOM indtil
formularen submittes.

**Backend** ([backend/app/api/settings.py](backend/app/api/settings.py),
[backend/app/services/settings_service.py](backend/app/services/settings_service.py)):
fjernet `cert_mode == "csr"`-gaten fra både `/pxgrid/csr` og
`pxgrid_account_create()`. Begge operationer er ikke-destruktive (CSR
genererer nye filer under `backend/pxgrid/`, AccountCreate returnerer
PENDING uden at ændre noget hvis brugeren ikke er approved). Nu
valideres kun at `pxgrid_node_name` er sat — admin kan dermed køre CSR
i upload-mode for at skifte over senere, eller pre-stage en
account-registrering før mode flippes.

**Frontend** ([frontend/js/views/settings.js](frontend/js/views/settings.js)):
ny `autoSaveBeforeAction()` helper kaldes før CSR- og account-knapperne
fyrer deres backend-kald. Bygger samme payload som submit-handleren men
nuller password-feltet (tomt = bevar) så et eksisterende ISE-secret ikke
wipes hvis brugeren ikke har skrevet noget i feltet. Defense-in-depth:
selvom backend nu accepterer alle modes, sikrer auto-save at persisted
state matcher UI'et før følge-kald (test forbindelse osv.).

Filer: [backend/app/api/settings.py](backend/app/api/settings.py),
[backend/app/services/settings_service.py](backend/app/services/settings_service.py),
[frontend/js/views/settings.js](frontend/js/views/settings.js).

---

## [3.0.0 build 0089] — 2026-04-26 — feat(PxGrid): Phase 1 — REST control plane + cert-håndtering (upload + CSR)

**MAJOR-bump (3.0.0)** — første eksterne push-integration. Phase 1
lægger fundamentet for både PxGrid-features fra roadmap'en (server-push
af session/auth-status + event-invalidering af endpoint-cache):
REST control plane, mTLS cert-håndtering i to modes, og Settings UI.

Phase 2 (STOMP-subscription til `com.cisco.ise.session`), Phase 3 (SSE
push til frontend), og Phase 4 (`com.cisco.ise.endpoint`-invalidering)
følger i 3.0.x build-serien — denne commit isolerer infrastruktur-laget
så det kan testes mod en rigtig ISE-PSN før vi bygger STOMP ovenpå.

**Hvad er bygget:**

- **Nyt modul `backend/app/pxgrid/`** med:
  - [exceptions.py](backend/app/pxgrid/exceptions.py): typed errors
    (`PxGridConfigError`, `PxGridCertError`, `PxGridAuthError`,
    `PxGridAccountPendingError`, `PxGridServiceNotFoundError`) så
    api-laget kan mappe til præcise dansksprogede HTTP-fejl uden at
    lække httpx-internals.
  - [cert_manager.py](backend/app/pxgrid/cert_manager.py): løser
    cert-paths relativt til `backend/`, validerer at cert+key+CA
    eksisterer (uden at parse PEM — OpenSSL gør det bedre ved
    handshake), og leverer `CertBundle.httpx_cert()` /
    `httpx_verify()` helpers. Plus `generate_csr()` (RSA-2048 +
    PKCS8-key + SHA256-CSR via `cryptography`-biblioteket) og
    `persist_csr_artifacts()` der skriver `<node>.key.pem` (chmod 600
    på POSIX) + `<node>.csr.pem` til `backend/pxgrid/` for CSR-mode.
    `save_uploaded_pem()` håndterer upload-mode på tilsvarende måde.
  - [client.py](backend/app/pxgrid/client.py): async REST-klient mod
    `https://<psn>:8910/pxgrid/control/*` med httpx + mTLS. Implementerer
    de fire bootstrap-calls — `account_create`, `account_activate`,
    `service_lookup` (returnerer `ServiceNode`-dataclass med `ws_url` for
    Phase 2 STOMP), `access_secret_create`. PSN FQDN afledes auto fra
    `ise_base_url` hvis `pxgrid_psn_fqdn` er tom. `connectivity_test()`
    walker cert-load → TLS handshake → ServiceLookup og rapporterer
    *hvilket trin* der fejlede så Settings UI kan vise præcis fejl.

- **Config + schemas + service-lag:**
  - [config.py](backend/app/core/config.py): 7 nye `pxgrid_*` felter
    (enabled, node_name, psn_fqdn, cert_mode∈{upload,csr}, cert/key/ca
    paths, password). Default `pxgrid_enabled=False` → graceful no-op
    fallback til MnT-poll.
  - [schemas/settings.py](backend/app/schemas/settings.py): nye DTOs
    `PxGridSettingsResponse/Update`, `PxGridStatusResponse`,
    `PxGridTestResponse` (med `step`-felt så UI viser hvor det fejlede),
    `PxGridAccountCreateResponse`. Password er write-only —
    response-DTO'en eksponerer kun `pxgrid_password_set: bool`.
  - [services/settings_service.py](backend/app/services/settings_service.py):
    `get/update_pxgrid_settings`, `test_pxgrid_connection`,
    `get_pxgrid_status`, `pxgrid_account_create`. Update-fluen audit-logges
    som `backend_settings/pxgrid` resource, så cert-mode-skift og enabled-
    flip kan rulles tilbage gennem eksisterende audit-view.

- **API:**
  - [api/settings.py](backend/app/api/settings.py): syv nye routes under
    `/api/settings/pxgrid*` — `GET/PUT settings`, `GET status`,
    `POST test`, `POST account` (CSR-mode bootstrap),
    `POST cert` (multipart-upload med `kind∈{cert,key,ca}` →
    persist + auto-update sti i settings), `POST csr` (generér + persist).
    Alle bag `require_admin`.

- **Frontend Settings UI:**
  - [views/settings.js](frontend/js/views/settings.js): nyt PxGrid-card
    efter Endpoint-cache-card, med toggle, node-navn, PSN FQDN,
    cert-mode-dropdown (vis/skjul CSR-blok dynamisk), cert-status-badge
    (ok/missing/error fra backend), tre file-inputs til upload-mode,
    "Generér CSR" + "Opret pxGrid-konto" knapper til CSR-mode, sti-felter
    (auto-udfyldes efter upload), write-only password-felt, "Gem" + "Test
    forbindelse"-knapper. Test-output viser hvilket trin der fejlede +
    fundne services.
  - [api.js](frontend/js/api.js): syv nye API-helpers, inkl. en
    multipart-upload-helper der bypasser den vanlige JSON `request()`
    da FormData ikke skal sættes som `application/json`.

- **Dependencies:**
  - [pyproject.toml](backend/pyproject.toml): tilføjet `cryptography>=42`
    (CSR-generering) og `python-multipart>=0.0.9` (FastAPI multipart-form
    til cert-upload).

- **Sikkerhed:**
  - [.gitignore](.gitignore): `backend/pxgrid/` ignored så cert/key
    aldrig commit-glemmes.
  - Key-filer skrives med `chmod 600` på POSIX; password er write-only i
    UI og audit logger kun `pxgrid_password_changed: bool`, ikke selve
    secretten.

**Test-stien for admin (efter denne commit):**

1. Settings → PxGrid → vælg cert-mode.
2. **Upload-mode:** upload de tre PEM-filer (cert, key, CA bundle).
   ISE-admin har på forhånd udstedt klient-certet og oprettet pxGrid-
   client-objektet med matching CN.
3. **CSR-mode:** klik "Generér CSR" → indsend `backend/pxgrid/<node>.csr.pem`
   til ISE internal CA → download signeret cert → upload som
   "Klient-certifikat" → klik "Opret pxGrid-konto" → admin approver i ISE
   → test forbindelse til status flipper til ENABLED.
4. Klik "Test forbindelse" — output viser hvilket trin (cert_load,
   tls_handshake, service_lookup) der fejlede + fundne services.

**Hvad der IKKE er bygget endnu (3.0.x):**

- STOMP/WebSocket-klient til `com.cisco.ise.session` (Phase 2).
- SSE-endpoint `/api/events/sessions` + `browse.js` `EventSource` (Phase 3).
- `com.cisco.ise.endpoint`-event-invalidering af cache (Phase 4).
- Background reconnect + PSN-failover loop.

Filer:
- [version.json](version.json): 2.12.3 b0088 → 3.0.0 b0089
- 7 nye filer: `backend/app/pxgrid/{__init__,exceptions,cert_manager,client}.py`
  + udvidelser i `core/config.py`, `schemas/settings.py`,
  `services/settings_service.py`, `api/settings.py`
- Frontend: `views/settings.js`, `api.js`
- `pyproject.toml`, `.gitignore`, `FEATURES.md` (entries → in-progress),
  `CHANGELOG.md` (denne entry).

---

## [2.12.3 build 0088] — 2026-04-26 — fix: Audit-actions på samme linje + Enter-trigger på søg

To små UX-fix i Audit-viewet:

1. **Knapperne "Vis" og "Rollback" stod på hver sin linje** i actions-cellen
   fordi kolonnen var 9rem bred og standard-button-padding fyldte mere end
   det. Cellen viste samtidig stort whitespace til højre. Løsning: kolonnen
   udvidet til 11rem, ny `.audit-actions-cell` med `white-space: nowrap` +
   `text-align: right`, og kompakte button-styles (mindre padding/font) så
   begge knapper holder sig på én linje uanset om Rollback faktisk vises.

2. **Søgefeltet reagerede kun på `input`-event med 350ms debounce** — hvis
   browseren af en eller anden grund holdt en cached version af tidligere
   `audit.js` (uden b0087-search-koden), fremstod det som om søgningen ikke
   filtrerede. Tilføjet eksplicit `change`- og `Enter`-trigger så `load()`
   kaldes med det samme når brugeren forlader feltet eller trykker Enter
   (uden debounce). Hjælper også når brugeren copy-paster en streng ind.

Verificeret backend: `audit_store.query(search='admin')` filtrerer korrekt
(3 af 49 events i nuværende DB).

PATCH bump (2.12.2 → 2.12.3) — bugfix/UX, ikke ny funktionalitet.

Filer:
- [version.json](version.json): 2.12.2 b0087 → 2.12.3 b0088
- [frontend/js/views/audit.js](frontend/js/views/audit.js): `audit-actions-col`
  klasse på actions-`<th>`, `audit-actions-cell` på `<td>`; ekstra
  `change`/`keydown` handlers på `#audit-search` så Enter og blur fyrer
  `load()` straks.
- [frontend/css/styles.css](frontend/css/styles.css): nye regler for
  `.audit-actions-col` (11rem), `.audit-actions-cell` (nowrap + højrejusteret)
  og kompakt button-styling i actions-cellen.
- [BUGS.md](BUGS.md): fixed-entry for begge.
- [CHANGELOG.md](CHANGELOG.md): denne entry.

---

## [2.12.2 build 0087] — 2026-04-26 — feat: Audit søg på alle felter

Audit-viewet havde to separate filterfelter (Aktør + Ressource-ID),
som hver kun matchede ét felt og krævede præcis værdi. Det gjorde
det svært at finde et event hvis man kun huskede en MAC, en IP, et
navn fra en JSON-payload eller en delvis tidsstempel.

Erstattet med ét samlet **Søg**-felt der laver case-insensitive
substring-match på tværs af alle relevante kolonner i ét hug:
`actor_username`, `action`, `resource_type`, `resource_id`,
`source_ip`, `ts` og hele før/efter JSON-blobs (`before_json` +
`after_json`). NULL-felter beskyttes med `IFNULL(..., '')` så
`resource_id`-mangel ikke bryder forespørgslen.

Implementeret i ét lag på SQL-niveau (`LIKE %pattern%` med
`LOWER()`), så pagination/total-tælling fortsat virker korrekt.
Backend-API tilføjer ny `search`-query-parameter; frontend sender
den via det generiske params-loop i `api.listAuditEvents()` —
ingen ændring nødvendig dér.

PATCH bump (2.12.1 → 2.12.2) — UX-forbedring af eksisterende
2.9.0-feature, ikke ny RBAC-funktionalitet.

Filer:
- [version.json](version.json): 2.12.1 b0086 → 2.12.2 b0087
- [backend/app/core/audit_store.py](backend/app/core/audit_store.py):
  `_query_sync()` + `query()` accepterer ny `search`-param der
  bygger en bredsøgnings-OR-klausul over 8 kolonner.
- [backend/app/api/audit.py](backend/app/api/audit.py): `list_events`
  videregiver `search` Query-param til store-laget.
- [frontend/js/views/audit.js](frontend/js/views/audit.js): erstattet
  `audit-actor` + `audit-rid` inputs med ét unified `audit-search`
  felt. Debounce (350ms) og refresh-binding bevaret.

---

## [2.12.1 build 0086] — 2026-04-25 — fix: roleCatalog.map crash i Browse/Edit + Register

`api.listEndpointRoles()` returnerer `{roles: [...]}` (et
`EndpointRoleListResponse`), ikke en array direkte.
[settings.js](frontend/js/views/settings.js) behandlede det
korrekt med `data.roles`, men Phase 6b/6c kode i
[browse.js](frontend/js/views/browse.js) og
[register.js](frontend/js/views/register.js) brugte responsen
direkte som array — derfor crashede `roleCatalog.map(...)`
ved første render af Browse/Edit (og chip-pickeren i
Register).

Fix: begge views udtrækker nu `rolesResp.roles` med
`Array.isArray`-guard og fallback til `[]`. `.catch()`
returnerer `{roles: []}` så samme objektform bruges også
ved fejl.

PATCH bump (2.12.0 → 2.12.1) — bug-fix uden funktionel
ændring.

Filer:
- [version.json](version.json): 2.12.0 b0085 → 2.12.1 b0086
- [frontend/js/views/browse.js](frontend/js/views/browse.js):
  `roleCatalog = (roles && Array.isArray(roles.roles)) ? roles.roles : []`
- [frontend/js/views/register.js](frontend/js/views/register.js):
  samme rettelse via `rolesResp` mellemvariabel.
- [BUGS.md](BUGS.md): bug-entry tilføjet under Fixed.

---

## [2.12.0 build 0085] — 2026-04-25 — feat(M7): Audit-logging af endpoint-rolle CRUD + 2.12.0 done

Phase 7 af 7 — sidste fase i endpoint-level RBAC. Hermed er
[FEATURES.md](FEATURES.md)-feature 2.12.0 markeret som `done`.

**Audit-logging**:
- `POST /api/endpoint-roles` (opret rolle) logger nu et
  `created`/`endpoint_role`-event med name + description +
  created_by i `after`-feltet.
- `DELETE /api/endpoint-roles/{name}` logger et
  `deleted`/`endpoint_role`-event med samme felter i `before`.
- Role-assignment (`PUT /api/users/{id}/endpoint-roles`)
  havde allerede audit fra Phase 3 (`roles_assigned`/`user`).
- Endpoint create/update bruger den eksisterende endpoint-
  audit der nu også fanger `HypervisionRoles`-CA-ændringer
  via custom_attributes-diff'en.

**Status efter 2.12.0**:
- ISE CA `HypervisionRoles` bootstrappes automatisk.
- Admin definerer rolle-katalog (Settings).
- Admin tildeler N roller pr. bruger (Settings).
- Read-path filtrerer endpoints på effektive roller for
  non-admin (assigned + [username]).
- Write-path auto-tagger med username hvis ingen roller
  vælges eksplicit (registrar/viewer-flow).
- Browse/Edit har editerbar "Roller"-kolonne (admin/editor).
- Register har rolle-picker (admin/editor) + "Mine
  endpoints"-knap (alle).
- Alt CRUD af roller og assignments er auditeret.

Filer:
- [version.json](version.json): 0084 → 0085
- [backend/app/api/endpoint_roles.py](backend/app/api/endpoint_roles.py):
  audit_store-import + record-kald i create_role og
  delete_role.
- [FEATURES.md](FEATURES.md): 2.12.0 markeret som `done`.

---

## [2.12.0 build 0084] — 2026-04-25 — feat(M6c): Register-view rolle-picker + Mine endpoints

Phase 6c af 7 i endpoint-level RBAC.

**Rolle-picker i Register**:
- Ny sektion "Roller" mellem CA-felterne og Beskrivelse, vises
  KUN for admin/editor (rolleCatalog hentes ved load).
- Chip-multi-select baseret på `.role-chip`-classen fra
  Phase 6a/6b — én chip pr. rolle i kataloget med beskrivelse
  som tooltip.
- Hint-tekst forklarer at uden eksplicit valg auto-tagges
  endpointet med brugerens username (Phase 5-logik).
- Submit bygger nu `HypervisionRoles` CSV i custom_attributes
  hvis chips er markeret. Viewer/registrar har ingen UI →
  backend auto-tagger med username.

**Mine endpoints**:
- Ny knap nederst på register-siden: "Mine endpoints" toggler
  en mobil-venlig kortliste med endpoints brugeren har adgang
  til (backend filterer allerede via Phase 4 read-path).
- Hver kort viser MAC, Identity Group, Beskrivelse (hvis sat)
  og Roller — alt read-only.
- Lazy-load: første klik fetcher via `listAllEndpointDetails`,
  senere klik åbner cachen.
- Knap-label opdateres med antal: "Mine endpoints (12)".

Filer:
- [version.json](version.json): 0083 → 0084
- [frontend/js/views/register.js](frontend/js/views/register.js):
  +`esc()`-helper, +load af roleCatalog/me, +chip-render +
  HypervisionRoles i submit-payload, +"Mine endpoints"-toggle
  med renderMineList.
- [frontend/css/styles.css](frontend/css/styles.css):
  `.register-roles-section`, `.register-mine-*` (knap, kort,
  rækker, empty-state, error) + dark-theme varianter.

Næste fase: Phase 7 — audit-logging af alle role CRUD og
assignments, polish + slut-commit.

---

## [2.12.0 build 0083] — 2026-04-25 — feat(M6b): Browse/Edit Roller-kolonne med inline multi-select

Phase 6b af 7 i endpoint-level RBAC.

Ny "Roller"-kolonne i Browse/Edit-tabellen og detail-modal med
inline multi-select via rolle-chips:

**Tabel-kolonne**:
- Ny kolonne "Roller" sidst i `COLUMNS`-arrayet — auto-håndteret
  af eksisterende kolonne-visibility-menu og col-filter-rækken.
- Renderes med checkbox-chips: katalog-roller er toggleable for
  admin/editor (markerer rækken dirty ved klik), disabled for
  viewer/registrar.
- Eksterne roller (fx username auto-tags fra registrar) vises som
  read-only `.role-chip-extern`-chips i lila for at skille dem
  fra katalog-roller — bevares automatisk ved save.

**Detail-modal**:
- Nyt felt "Roller" med samme chip-pattern.
- `dataset.original` gemmer endpointets oprindelige roller-array
  så eksterne roller (uden for katalog) bevares ved save.

**Bulk-edit-modal**:
- Ny "Roller"-checkbox med chips-wrapper (`.be-roles-wrap`).
- Ny `.disabled-overlay`-klasse (pointer-events: none + opacity)
  bruges for div-felter da `disabled` ikke virker på div'en.
- Apply replacer kun katalog-roller på de valgte rækker;
  eksterne roller bevares pr. række.

**Save-payload**:
- `buildSavePayload` og detail-modalens save inkluderer nu
  `HypervisionRoles` CSV i custom_attributes — sammensat af
  eksterne roller (bevaret) + checked katalog-chips.

Frontend-ændringer:
- [frontend/js/views/browse.js](frontend/js/views/browse.js):
  ~80 nye linjer (rolesChipsHtml-helper, load() henter katalog +
  authMe, renderRows-celle, buildSavePayload, detail-modal,
  bulk-edit, disabled-overlay-toggle).
- [frontend/css/styles.css](frontend/css/styles.css):
  `.role-chip-extern`, `.roles-cell .role-chips`,
  `.disabled-overlay`, `.be-roles-wrap` + dark-theme varianter.

Næste fase: Phase 6c — Register-view: rolle multi-select (skjult
for registrar) + "Mine endpoints"-knap nederst på register-siden.

---

## [2.12.0 build 0082] — 2026-04-25 — feat(M6a): Settings UI — rolle-katalog + per-bruger tildeling

Phase 6a af 7 i endpoint-level RBAC.

To nye admin-sektioner i Settings:

**Endpoint-roller** (nyt card):
- Tabel viser alle roller fra kataloget (navn, beskrivelse,
  oprettet af, oprettet, slet-knap).
- Opret-form med pattern-validering (`[A-Za-z0-9_-]{1,64}`)
  matchende backend-NAME_RE.
- Sletning advarer om at brugeres tildelinger fjernes (men
  endpoint-tags ændres ikke automatisk — admin må selv rydde op).

**Brugere & roller** (eksisterende card udvidet):
- Ny kolonne "Endpoint-roller" med rolle-chips (multi-select
  via checkbox-chips, én chip pr. rolle i kataloget).
- Klik på chip → øjeblikkelig PUT mod `/api/users/{id}/endpoint-roles`.
- Når rolle-kataloget ændrer sig (opret/slet) genrender bruger-
  cellerne automatisk via shared state-callback.

Frontend-ændringer:
- [frontend/js/api.js](frontend/js/api.js): nye metoder
  `listEndpointRoles`, `createEndpointRole`, `deleteEndpointRole`,
  `setUserEndpointRoles`, `authMe`.
- [frontend/js/views/settings.js](frontend/js/views/settings.js):
  ny `initRolesSection` returnerer `state{roles, onChange}` så
  `initUsersSection` kan reagere på katalog-ændringer.
- [frontend/css/styles.css](frontend/css/styles.css): `.role-chips`
  + `.role-chip` styling med `:has(input:checked)` til selected-
  state, dark-theme variant.

Næste fase: Phase 6b — Browse/Edit Roller-kolonne med inline
multi-select edit.

---

## [2.12.0 build 0081] — 2026-04-25 — feat(M5): write-path auto-tag for non-admin

Phase 5 af 7 i endpoint-level RBAC.

Når en non-admin opretter eller opdaterer et endpoint og
`HypervisionRoles` er tom i requesten, auto-tagges endpointet med
brugerens username. Det sikrer at non-admin (især registrar) kan
se sine egne nye endpoints via read-path-filteret (Phase 4) uden
at skulle vælge roller manuelt.

Adfærd:
- Admin: ingen auto-tag, write-path uændret.
- Editor/viewer/registrar: hvis `HypervisionRoles` er tom →
  sættes til `username`. Eksplicit valgte roller respekteres
  uændret (admin/editor kan vælge yderligere fra kataloget i UI).
- Bulk-import: auto-tag anvendes på hvert item, både ved create
  og ved overwrite (409-fallback).

Service-ændringer ([backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py)):
- Ny `_apply_auto_tag(ca, auto_tag_username)` helper — mutates
  CA dict in-place hvis username er sat og roles er tom.
- `create_endpoint`, `update_endpoint`, `bulk_create`,
  `_overwrite_existing` accepterer nu `auto_tag_username:
  str | None` (default `None` = ingen auto-tag).

API-ændringer ([backend/app/api/endpoints.py](backend/app/api/endpoints.py)):
- Ny `_autotag_for(user)` returnerer `None` for admin og
  `user.username` ellers.
- `POST /api/endpoints`, `POST /api/endpoints/bulk`,
  `PUT /api/endpoints/{id}` modtager nu `User` via Depends og
  videregiver auto-tag-username til service-laget. Permission-
  guards (`require_create_endpoint` / `require_editor`) flyttet
  fra `dependencies=[]` til function-arg.

Næste fase: Phase 6 — frontend UI for rolle-katalog (Settings),
per-bruger assignments (Settings), Browse/Edit Roller-kolonne, og
Register "Mine endpoints"-knap.

---

## [2.12.0 build 0080] — 2026-04-25 — feat(M4): read-path filter på endpoints for non-admin

Phase 4 af 7 i endpoint-level RBAC.

Non-admin brugere ser nu kun endpoints hvor `HypervisionRoles`-CA
overlapper med deres effektive roller (assigned + username). Admin
ser stadig alt.

Schema-ændringer ([backend/app/schemas/endpoint.py](backend/app/schemas/endpoint.py)):
- `EndpointDetail.roles: list[str]` (default `[]`) — parsed fra
  `HypervisionRoles`-CA. Frontend bruger feltet til Browse/Edit
  Roller-kolonnen.
- `CustomAttrs.HypervisionRoles: str = ""` — comma-separated CSV
  for write-path. Sat eksplicit af admin/editor; auto-tag for
  non-admin håndteres i Phase 5.

Service-ændringer ([backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py)):
- `_fetch_endpoint_detail` udfylder nu `roles` ved at parse
  `HypervisionRoles`-CA via ny `_parse_roles_csv` helper (strip,
  drop tomme stykker, bevar stavning).
- Nye helpers: `_endpoint_visible(detail, effective_roles)` —
  case-insensitiv overlap-check; et endpoint uden roller er
  usynligt for non-admin (least-privilege default).
- `list_endpoints`, `list_endpoint_details`, `list_all_endpoint_details`,
  `get_endpoint` accepterer nu `effective_roles: list[str] | None`:
  - `None` (default) = admin-mode = ingen filter
  - non-empty list = filtrér post-fetch på CA-overlap
- `get_endpoint` rejser `IseApiError(404)` ved out-of-scope så
  API-laget kan returnere 404 (ikke 403) — scope-grænsen leakes
  ikke til klienten.
- `list_endpoints` (summary) for non-admin går nu via detail-fetch
  for at have CA tilgængelig; admin-pathen er uændret (hurtig).

API-ændringer ([backend/app/api/endpoints.py](backend/app/api/endpoints.py)):
- Ny `_scope_for(user)` helper returnerer `None` for admin og
  `effective_roles` ellers.
- `GET /api/endpoints`, `/details`, `/details/all`, `/{id}` modtager
  nu `User` via Depends og videregiver scope. Permission-guards
  (`require_any`) er flyttet fra `dependencies=[]` til function-arg
  så user-objektet er tilgængeligt.
- `GET /api/endpoints/{id}` mapper service-404 til HTTP 404 med
  "Endpoint ikke fundet" — uskelnelig fra reelt manglende endpoint
  så scope-grænsen er undselig.

Bemærk: write-path (`create_endpoint`, `update_endpoint`,
`coa_*`) bevarer admin-snapshots og påvirkes ikke af denne fase.
Auto-tag for non-admin på create/update kommer i Phase 5.

Næste fase: Phase 5 — write-path auto-tag så non-admin's egne
oprettelser bliver synlige for dem selv (sætter username-tag hvis
ingen roller eksplicit valgt).

---

## [2.12.0 build 0079] — 2026-04-25 — feat(M3): user assigned_endpoint_roles + assignment API

Phase 3 af 7 i endpoint-level RBAC.

Brugere kan nu få tildelt N roller fra det admin-styrede katalog
(2.12.0/0078). Effektive roller = tildelte + brugerens implicit
username — så hver bruger er garanteret mindst én rolle og altid kan
se sine egne endpoints.

Schema-ændringer ([backend/app/schemas/user.py](backend/app/schemas/user.py)):
- `User.assigned_endpoint_roles: list[str]` (default `[]`) — tildelte
  rolle-navne fra kataloget.
- Ny `UserMe(User)` med `effective_roles: list[str]` — returneres af
  `GET /api/auth/me`. Frontend bruger dette felt til at filtrere
  endpoint-visning.
- Ny `UserEndpointRoles` body-skema (`{ "roles": [...] }`) til PUT.

Service-ændringer ([backend/app/services/user_service.py](backend/app/services/user_service.py)):
- `_to_public` migrerer ved load: gamle users.json-records uden
  feltet får automatisk `[]` og fungerer uændret indtil admin
  tildeler roller.
- Ny `effective_roles(user)` returnerer `assigned + [username]`.
- Ny `get_user_me(id)` til `/me`-endpointet.
- Ny `set_endpoint_roles(user_id, roles, actor_username)`:
  - validerer at hver rolle findes i kataloget (case-insensitivt
    opslag, kanonisk stavning bevares fra kataloget).
  - dedupliker case-insensitivt.
  - audit-event `roles_assigned` med before/after.

API-ændringer:
- [backend/app/api/users.py](backend/app/api/users.py): nyt
  `PUT /api/users/{user_id}/endpoint-roles` (admin only) →
  returnerer opdateret User.
- [backend/app/api/auth.py](backend/app/api/auth.py): `GET /me`
  returnerer nu `UserMe` med `effective_roles`.
- [backend/app/api/deps.py](backend/app/api/deps.py):
  `get_current_user` udfylder `assigned_endpoint_roles` på `User`,
  så downstream-handlers kan bruge feltet uden ekstra DB-opslag.

Næste fase: Phase 4 — read-path filter på endpoint list/get så
ikke-admin kun ser endpoints tagged med en effektiv rolle.

---

## [2.12.0 build 0078] — 2026-04-25 — feat(M2): rolle-katalog backend + CRUD-API

Phase 2 af 7 i endpoint-level RBAC.

Admin-kontrolleret katalog af endpoint-rolle-navne der bruges som
tags på endpoints. Lagring i `backend/endpoint_roles.json` (gitignored,
samme mønster som users.json + custom_attr_values.json).

Nye filer:
- [backend/app/core/role_catalog.py](backend/app/core/role_catalog.py)
  — JSON-fil-backed CRUD med `is_valid_name`-validering (kun
  `[A-Za-z0-9_-]{1,64}` — komma/space er ikke tilladt da komma er
  separator i CA-værdien). Helpers: `load_roles`, `save_roles`,
  `find_by_name`, `add_role`, `delete_role`, `role_names`.
- [backend/app/schemas/endpoint_role.py](backend/app/schemas/endpoint_role.py)
  — Pydantic `EndpointRole`, `EndpointRoleCreate`,
  `EndpointRoleListResponse`.
- [backend/app/api/endpoint_roles.py](backend/app/api/endpoint_roles.py)
  — REST-router under `/api/endpoint-roles`:
  - `GET /` — alle authenticated brugere (read), så frontend-pickere
    kan vise listen.
  - `POST /` — admin only, opretter med 201.
  - `DELETE /{name}` — admin only, 204 ved succes, 404 hvis ukendt.

Registreret i [backend/app/main.py](backend/app/main.py).
[.gitignore](.gitignore) udvidet med `backend/endpoint_roles.json`.

Næste fase (build 0079): user-schema får `assigned_endpoint_roles` +
PUT-endpoint til admin-tildeling.

---

## [2.12.0 build 0077] — 2026-04-25 — feat(M1): bootstrap HypervisionRoles ISE custom attribute

MINOR-bump (versionen tages i brug). Phase 1 af 7 i 2.12.0
(endpoint-level RBAC).

Ny ISE custom attribute `HypervisionRoles` registreres som hidden
attribute i [backend/app/core/custom_attr_store.py](backend/app/core/custom_attr_store.py)
og sættes automatisk i ISE ved næste `_ensure_ca_definitions()`-kald
(samme bootstrap-mekanik som `HypervisionISEPortal` har brugt siden
build 0011). CAs er en string der kommer til at indeholde en
comma-separated liste af rolle-navne i senere faser.

Ændringer:
- `HIDDEN_ATTR = "HypervisionISEPortal"` (uændret, dokumenteret som
  portal-tag).
- Ny konstant `ROLES_ATTR = "HypervisionRoles"`.
- Ny liste `HIDDEN_ATTRS = [HIDDEN_ATTR, ROLES_ATTR]`.
- `ALL_ATTRS = MANAGED_ATTRS + HIDDEN_ATTRS` (var
  `MANAGED_ATTRS + [HIDDEN_ATTR]`).

Eksisterende kode der importerer `HIDDEN_ATTR` (auto-tag-stien i
[backend/app/services/endpoint_service.py](backend/app/services/endpoint_service.py))
er uændret. Næste lifespan-startup af backend opretter `HypervisionRoles`
i ISE; eksisterende endpoints får ingen ændring til deres CA-værdier.

---

## [2.10.4 build 0076] — 2026-04-25 — docs: planlæg endpoint-level RBAC til 2.12.0

Ren dokumentations-commit. Ingen kode-ændring. Føjer
[FEATURES.md](FEATURES.md) entry for det nye endpoint-level RBAC-system
(per-bruger endpoint-roller) og skubber de eksisterende planlagte
features for at gøre plads til 2.12.0:

- 2.12.0 (var Webhooks) → 2.13.0
- 2.13.0 (var Saved Views) → 2.14.0
- **NY 2.12.0**: Endpoint-level RBAC

Plan i 7 faser: ISE CA-bootstrap, rolle-katalog, user-tildeling,
read-filter, write-binding, frontend (Settings/Browse/Register/Mine
endpoints), audit. Designvalg lukket med brugeren: editor/viewer
uden tildelte roller ser kun deres eget username-tag; eksisterende
utaggede endpoints bliver usynlige for non-admin (admin får
inline-edit-kolonne i Browse/Edit); registrar ser både eget tag og
assigned roles + får en "Mine endpoints"-knap nederst på
registreringssiden.

Implementering starter i build 0077.

---

## [2.10.4 build 0075] — 2026-04-25 — refactor: drop "Opret endpoint" — én samlet registreringsside

PATCH-bump. Konsolidering af to næsten-identiske create-flows til én.
Den gamle "Opret endpoint"-side ([frontend/js/views/create.js](frontend/js/views/create.js))
gjorde præcis det samme som det nye registreringsmodul fra 2.10.0
([frontend/js/views/register.js](frontend/js/views/register.js)) — to flows er
forvirrende, så den gamle side er fjernet helt.

Ændringer:

- Fjernet: [frontend/js/views/create.js](frontend/js/views/create.js)
  (slettet) — den fyldte ~270 linjer som duplikerede MAC-input,
  group-dropdown, custom-attribute-pickers og OUI-lookup.
- [frontend/js/app.js](frontend/js/app.js): `renderCreate`-import +
  `create`-route fjernet. Eneste create-rute er nu `/#register`.
- [frontend/index.html](frontend/index.html): den gamle
  `<a href="#/create">Opret endpoint</a>` sidebar-link er fjernet,
  og `Mobil-registrering` linket er omdøbt til "Opret endpoint" og
  flyttet øverst i menuen — det er nu det primære navn for create-flowet
  for alle roller.
- [frontend/js/views/register.js](frontend/js/views/register.js):
  tilføjet `AuthzVlan` og `AuthzACL` dropdowns så admin/editor har
  feature-paritet med den fjernede create-side. AuthzACL-værdier
  hentes fra ISE DACL-listen via `api.listDacls()` (samme kilde som
  før). Registrar-rollen kan ignorere felterne — de er valgfrie.

Brugere der bookmarkede `/#create` lander nu på deres default-rolle-rute
(browse for admin/editor, register for registrar). Ingen backend-API'er
er ændret.

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
