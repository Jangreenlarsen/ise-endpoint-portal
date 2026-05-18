# Bugs

Alle bugs registreres her så snart de opdages. Opdateres når de fikses.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte filer, løsning (hvis fixed).
**Status**: `open` · `investigating` · `fixed`

---

## Åbne

*(ingen åbne bugs)*

---

## Fixed

- `[fixed 5.5.0 build 0417] 2026-05-18 — NAS-scan viste kun 3 af 4 NAS-typer fra ISE` — `network_devices._load_all()` byggede kun `_by_ip`-dict (keyet på IP-adresse). `get_nas_devices_by_platform` itererede kun `_by_ip`, så NAS-devices der (a) ikke har nogen IP-adresse konfigureret i ISE, eller (b) er tildelt NDG "Device Type#All Device Types" (standard/tom type → `device_type=""`, `path=""`), var fuldstændigt usynlige — talt aldrig med som hverken matched eller unmatched. Fix: `_load_all()` populerer nu også `_all_devices: list[DeviceInfo]` (én entry per device, uanset IP). `get_nas_devices_by_platform` itererer `_all_devices` i stedet for `_by_ip` (fjerner `seen_ip`-hacket). Devices med ukendt/tom type vises under unmatched med navn-label (fx "Router-01 (ukendt type)"). **Berørte filer:** `backend/app/ise/network_devices.py`, `backend/app/api/custom_attributes.py`.

- `[fixed 5.4.6 build 0382] 2026-05-17 — Simulate match baserede sig på formularværdier i stedet for live ISE-data` — `collectEndpointAttrs()` hentede endpoint-attributter fra HTML-formularfelterne (stale form values) — group_name var kortnavnet eller forældet pga. stale `state.groups`-cache, custom attributes var hvad brugeren sidst gemte i formularen, ikke hvad ISE faktisk har. Backend `match_endpoint` brugte disse formularværdier direkte. Fix: frontend sender nu kun `{endpoint_id: state.detailCurrentId}`, og backend henter ALLE attributter live fra ISE ERS (`IseEndpointRepository.get()`) inkl. fuldt hierarkisk group_name (via `IseEndpointGroupRepository.list_all()`). Simulationen er nu 100% baseret på hvad ISE ser. **Berørte filer:** `frontend/js/views/browse-detail.js`, `backend/app/services/policy_service.py`.

- `[fixed 5.4.5 build 0381] 2026-05-17 — Simulate match: OR-blok dobbelttælte evaluable conditions + IdentityGroup fejlede med kortnavne` — OR-regler (sub-rules) tæller conditions fra ALLE grene → PSK_Mode tælt 2× for 2 sub-rules → kunstigt høj score. Fix: scorer kun fra bedste sub-rule + global_conds. Desuden: `_eval_identity_group` fejlede hvis `group_name` var et kortnavnet ("ADM-Apple-iPhone") pga. stale backend-cache. Fix: suffix-fallback → matcher hvis `rule_val` ender med `":<ep_val>"`. **Berørte filer:** `backend/app/services/policy_service.py`.

- `[fixed 5.4.5 build 0380] 2026-05-17 — Simulate match valgte forkert regel ved partial matches — laveste rank vandt uanset specificitet` — Stop-ved-første-match valgte regel 2 "SSID 802 PSK Mode" (rank 2, 1 evaluable betingelse + 2 Radius-skipped) frem for den korrekte regel med 5 evaluable betingelser der alle matchede (Owner, Type, Lokation, PlatformType, IdentityGroup + 1 Radius-skipped). Fix: ny match-strategi med tre kategorier: (a) no-condition catch-all (Default) → sidst, (b) alle conditions evaluable og passer → definitivt match, returner straks (ISE-semantik), (c) partial match → vælg den med FLEST evaluable betingelser der passer; uafgjort brydes af laveste rank. **Berørte filer:** `backend/app/services/policy_service.py`.

- `[fixed 5.4.5 build 0379] 2026-05-17 — Simulate match matchede altid Default-reglen efter build 0378` — To-pass strategien fra 0378 sprang alle partial matches (ConditionReference) over og ledte efter "definitivt match". Default-reglen (ingen betingelse) er altid definitivt → alt landede på Default/DenyAccess. Reverteret til stop-ved-første-match; ConditionReference = benefit-of-doubt True + partial_match=True. **Berørte filer:** `backend/app/services/policy_service.py`.

- `[fixed 5.4.5 build 0378] 2026-05-17 — Simulate match stoppede ved første ConditionReference-regel og returnerede forkert regel` — `match_endpoint` stoppede ved første `matched=True` — også partial matches (ConditionReference behandlet som True). Regel 1 med `ConditionReference(Wireless_MAB) AND IdentityGroup(X)` rapporteres som "muligt match" selvom ISE ville fejle regel 1 (Wireless_MAB=False ved runtime) og matche regel 5. Fix: to-pass strategi — fortsæt forbi partial matches, returner første **definitive** match (alle betingelser evaluable og True); falder kun tilbage til første partial match hvis ingen definitiv match findes. **Berørte filer:** `backend/app/services/policy_service.py`.

- `[fixed 5.4.5 build 0378] 2026-05-17 — Regelsortering i list_authorization_rules sorterede på forkert niveau` — `r.get("rank", 0)` søgte rank på wrapper-niveau (`{"rule":{...}, "profile":[...]}`), men rank sidder inde i `r["rule"]`. Alle regler fik sort-key `0` → sortering var no-op. ISE returnerer typisk regler i rank-rækkefølge alligevel, men afhænger af ISE-version. Fix: `(r.get("rule") or r).get("rank", 0)`. **Berørte filer:** `backend/app/ise/policy.py`.

- `[fixed 5.4.5 build 0377] 2026-05-17 — Simulate match matchede ikke regler mod parent-grupper — ISE's hierarkiske equals ikke implementeret` — ISE's `IdentityGroup.Name equals "Endpoint Identity Groups:Profiled"` matcher hierarkisk alle endpoints i Profiled OG alle undergrupper. Simulatoren brugte simpel string-equal, så et endpoint i `"Endpoint Identity Groups:Profiled:ADM-Apple-iPhone"` matchede ALDRIG en regel skrevet mod `"Endpoint Identity Groups:Profiled"`. Fix: ny `_eval_identity_group()` i backend bruger prefix-tjek (`ep.startswith(rule + ":")`) for `equals`/`notEquals` — identisk med ISEs hierarkiske semantik. **Berørte filer:** `backend/app/services/policy_service.py`.

- `[fixed 5.4.4 build 0375] 2026-05-17 — Simulate match returnerede forkert (ingen match) fordi group_name var kortnavnet` — `collectEndpointAttrs()` læste `.selectedOptions[0].text` fra `#d-group` (kortnavnet `"ADM-Apple-iPhone"`) som `group_name`-feltet. Backend `_get_ep_value` for `IdentityGroup.Name` sammenlignede det med ISE-regelens fulde condition-value `"Endpoint Identity Groups:Profiled:ADM-Apple-iPhone"` — `equals` fejlede altid → simulator kunne aldrig matche en IdentityGroup-baseret regel. Fix: opslag i `state.groups` via gruppe-ID giver den fulde hierarkiske sti, identisk med ISE-regelens format. **Berørte filer:** `frontend/js/views/browse-detail.js` linje 320.

- `[fixed 5.4.4 build 0374] 2026-05-17 — Identity Group-condition i RADIUS-wizard fik forkert sti (manglede mellemled)` — Wizard-koden læste display-teksten (`.text`) fra `#d-group` select-elementet i stedet for den fulde gruppe-sti. Kortnavnet `"ADM-Apple-iPhone"` blev brugt som condition-startværdi, og `normalizeIdentityGroupValue` tilføjede kun root-prefix → `"Endpoint Identity Groups:ADM-Apple-iPhone"` (mangler `Profiled`-niveau). Fix: lookup gruppe-navn fra `state.groups` via den valgte gruppe-ID (`g.id`) så den fulde hierarkiske sti `"Endpoint Identity Groups:Profiled:ADM-Apple-iPhone"` bruges som condition-startværdi. **Berørte filer:** `frontend/js/views/browse-detail.js` linje 405.

- `[fixed 5.4.4 build 0373] 2026-05-17 — Identity Group-dropdown viste alt fladt — ingen hierarki` — ISE ERS `/ers/config/endpointgroup` list-respons returnerer kun korte navne (`"Profiled"`, `"ADM-Apple-iPhone"`) uden parent-information. Frontend-koden prefixede alle med `"Endpoint Identity Groups:"` og placerede dem i ét fladt niveau. Fix: backend henter nu hvert gruppe individuelt i parallel (sem=8) for at hente `parentId` fra ERS GET-response, bygger derefter rekursiv fuld sti via parent-kæden (`ADM-Apple-iPhone` → `Endpoint Identity Groups:Profiled:ADM-Apple-iPhone`). Frontend optgroup-logik var korrekt — problemet var manglende path-data fra backend. **Berørte filer:** `backend/app/ise/endpoints.py`, `backend/app/services/endpoint_service.py`.

- `[fixed 5.4.4 build 0372] 2026-05-17 — Identity Group-dropdown viste fuld ISE-sti som display-tekst og ingen hierarkisk gruppering` — Alle steder der viser endpoint-grupper (browse-tabel, detail-modal, policy condition-builder, registrer-formular, skabeloner) viste hele `"Endpoint Identity Groups:Profiled:ADM-Apple-iPhone"` som display-tekst uden visuel grupperingsstruktur. Fix: ny `groupHierarchyOptionsHtml()` i `browse-utils.js` bygger hierarkiske optgroups: root-optgroup med direkte børn, sub-optgroups (fx `↳ Profiled`) med under-grupper. Fuld sti bruges som `value`, kort navn som display. **Berørte filer:** `browse-utils.js`, `browse-table.js`, `policy-condition-builder.js`, `register.js`, `settings/section-templates.js`.

- `[fixed 5.4.3 build 0371] 2026-05-17 — Detail modal fanepanel tomt efter konvertering til tabs` — `.detail-tab-panels` kollapsede til 0 højde fordi `.detail-modal` brugte `max-height` i stedet for `height` — `flex: 1 1 0` kræver en defineret højde på flex-forælderen. Fix: `height: 92vh` på `.modal.detail-modal`. **Berørte filer:** `frontend/css/styles.css`.

- `[fixed 5.4.2 build 0366] 2026-05-17 — IdentityGroup condition-dropdown viste "--- select ---" ved re-edit` — `listGroups()` returnerede korte navne (`"Profiled"`) men gemte condition-værdier var fulde stier (`"Endpoint Identity Groups:Profiled"`). `known.includes(val)` fandt aldrig match → dropdown valgte aldrig den korrekte option ved re-åbning af en allerede oprettet condition. Fix: `caValues["__IdentityGroup_Name__"]` i `policy.js` prefixer nu alle gruppe-navne med `"Endpoint Identity Groups:"` inden sammenligning. **Berørte filer:** `frontend/js/views/policy.js`.

- `[fixed 5.3.34 build 0350] 2026-05-16 — Simulate match viser ✓ selv om RADIUS-betingelser ikke er evalueret` — Simulator behandlede alle unevaluable RADIUS-attributter som "True" (benefit of doubt), så en regel med `RADIUS.X AND RADIUS.Y AND EndPoints.PSK_Mode` matchede bare ved PSK_Mode=true uanset RADIUS-tilstanden. Fix: `PolicyMatchResult.partial_match=True` når nogen betingelse er skippet; frontend viser ⚠ gult kort "Muligt match" i stedet for grønt ✓. **Berørte filer:** `policy.py`, `policy_service.py`, `browse-detail.js`, `i18n.js`, `styles.css`.

- `[fixed 5.3.34 build 0350] 2026-05-16 — authzACL dropdown i detail-editor ikke opdateret med aktuelle ISE DACLs` — `openDetail()` refreshede custom attributter (Type, Owner m.fl.) men ikke DACL-listen — den var kun hentet ved page load. Fix: `openDetail()` kalder nu `api.listDacls()` parallelt med `api.listCustomAttributes()` og opdaterer `state.caValues.AuthzACL`. **Berørte filer:** `browse-detail.js`.

- `[fixed 5.3.33 build 0349] 2026-05-16 — Session-kolonne viser stadig kun authz_profiles (og af og til heller ikke det)` — **Root cause (bekræftet via curl):** ISE 3.4 MnT AuthStatus XML indeholder IKKE `ISEPolicySetName` eller `AuthorizationPolicyMatchedRule` for dette deployment — policy-navne "MAC ByPass" og "SSID 802-Greens TLF" er ISE-interne og ikke tilgængelige via REST API. Hvad der ER til stede: `authentication_method` (mab), `selected_azn_profiles` (komma-sep. string), `identity_group`. Desuden: `authz_profiles` var tomme fordi MnT back-fill ikke blev gjort. Fix: (1) `fetch_session_by_mac` udtrækker nu `auth_method`, `identity_group`, `authz_profiles_mnt` (fra selected_azn_profiles), VLAN fra response AV-pair. (2) `_enrich_single_from_mnt`/`_enrich_sessions_from_mnt` back-filler `authz_profiles` fra MnT hvis pxGrid leverede tomt. (3) `iseSessionCellHtml` viser `auth_method` (grønt badge) + `identity_group` + profiler uanset om authz_rule_name er sat. **Berørte filer:** `mnt_sessions.py`, `session_cache.py`, `session_worker.py`, `settings.py`, `pxgrid.py`, `browse-table.js`, `i18n.js`, `styles.css`.

- `[fixed 5.3.31 build 0347] 2026-05-16 — MnT-beriget data slettes ved næste STOMP-event` — `_handle_message_body` kaldte `cache.upsert(info)` med en frisk `SessionInfo` der har tomme MnT-felter — slettede policy_set_name/authz_rule_name/dacl/vlan/sgt ved enhver efterfølgende session-event. `_reconcile_from_pxgrid` havde samme problem. Fix: eksisterende cache-entry slås op og MnT-felter bevares ved merge inden upsert. **Berørte filer:** `backend/app/pxgrid/session_worker.py`.

- `[fixed 5.3.31 build 0347] 2026-05-16 — Enrichment kørte kun ved pxGrid-reconnect, ikke ved startup` — Sessioner fra disk-cache (load_from_disk) fik aldrig MnT-berigelse medmindre pxGrid genoprettede forbindelsen. Fix: periodisk enrichment-task kører ved startup (45s delay) og derefter hvert 5. min via `_mnt_enrich_loop` i `main.py`. **Berørte filer:** `backend/app/main.py`.

- `[fixed 5.3.30 build 0346] 2026-05-16 — Session-kolonne viser ikke Auth/Authz politik-navne` — `fetch_session_by_mac` kaldte kun MnT Session/MACAddress som ikke indeholder ISEPolicySetName/AuthorizationPolicyMatchedRule. Disse felter sidder i MnT **AuthStatus/MACAddress** — men probe brugte forkert URL (manglede påkrævede `/{seconds}/{records}/{framed}` path-params og fik 404). Fix: `fetch_session_by_mac` kalder nu BEGGE endpoints; AuthStatus-URL udvidet til `/3600/25/All`; `_enrich_sessions_from_mnt` populerer `policy_set_name` + `authz_rule_name` fra MnT. **Berørte filer:** `backend/app/ise/mnt_sessions.py`, `backend/app/pxgrid/session_worker.py`.

- `[fixed 5.3.30 build 0346] 2026-05-16 — ISE Profil-kolonne redundant med eksisterende Profil-kolonne` — Ny `ise_profile`-kolonne (b0345) viste `endpoint_policy` fra MnT — dublerede den eksisterende "Profil"-kolonne (vendor/profileName fra ERS). Fjernet kolonne inkl. CSS, i18n, template. **Berørte filer:** `frontend/js/views/browse-utils.js`, `frontend/js/views/browse-table.js`, `frontend/js/i18n.js`, `frontend/css/styles.css`.

- `[fixed 5.3.23 build 0331] 2026-05-15 — Platform-kolonne: ⚡-badge synker til bunden ved høj række; kan ikke sortere` — Bug 1: `display:flex` direkte på `<td>` er ugyldigt i table-layout og giver uforudsigelig vertikal alignment — indholdet faldt til bunden når en anden celle udvidede rækken. Fix: flex fjernet fra td, indhold wrappet i `<div class="platform-auto-wrap">` (flex-container). Bug 2: Sortering på platform_type brugte `r.platform_type` (ISE-gemt værdi), men auto-afledte rækker viser `nas_device_type` fra pxGrid-sessionen. Fix: sort-logikken i `browse-filter.js` special-caser `platform_type` og kigger i `state.pxgridSessionData`. **Berørte filer:** `frontend/css/styles.css`, `frontend/js/views/browse-table.js`, `frontend/js/views/browse-filter.js`.

- `[fixed 5.3.22 build 0327] 2026-05-15 — Profil-kolonne viser intet selvom ISE har profil-info` — `/ers/config/profilerprofile` (bulk list) fejlede gentagne gange med transport errors (timeout/forbindelsesfejl), så `profiler._cache` forblev tom og `resolve_name_sync()` returnerede altid "". Fix: ny `resolve_name_lazy()` i `profiler.py` henter én enkelt profil direkte via `/ers/config/profilerprofile/{uuid}`. **Berørte filer:** `backend/app/ise/profiler.py`, `backend/app/services/endpoint_service.py`.

- `[fixed 5.3.19 build 0323] 2026-05-15 — Platform type forsvinder efter portal-genstart` — Disk-loadede sessions med `nas_device_type` mistede platform type ved reconnect. Bug 1: `_reconcile_from_pxgrid` byggede `info_with_mac` uden at kopiere `nas_name`/`nas_device_type`. Bug 2: `_reconcile_from_mnt` seedede sessions uden NAS device-opslag. **Berørte filer:** `backend/app/pxgrid/session_worker.py`.

- `[fixed 5.3.11 build 0310] 2026-05-14 — Platform ⚡-badge ødelægger 2-kolonne layout i detail-modal` — `detailPtEl.after(badge)` indsatte badge-span som selvstændig CSS grid-item i `.detail-grid { grid-template-columns: 160px 1fr }`. Fix: `<select id="d-platformtype">` wrappet i `<div class="platform-field-wrap">`. **Berørte filer:** `frontend/js/views/browse.js`, `frontend/js/views/browse-detail.js`, `frontend/css/styles.css`.

- `[fixed 5.3.9 build 0308] 2026-05-14 — Platform-dropdown låses ikke for endpoints med eksisterende platform_type i ISE` — `!r.platform_type`-betingelsen forhindrede auto-lock: hvis endpoint allerede havde en gemt `platform_type` i ISE, blev `nasPt` altid tom og dropdown forblev editerbar trods aktiv pxGrid NAS-session. Fix: betingelsen fjernet helt — NAS session vinder altid over gemt ISE-værdi. **Berørte filer:** `frontend/js/views/browse-table.js`, `frontend/js/views/browse-detail.js`.

- `[fixed 5.3.2 build 0288] 2026-05-14 — TACACS+-brugere fik 401 på pxGrid SSE-stream — PULL-badge permanent` — SSE-endpointet `/api/pxgrid/sessions/stream` lavede manuel token-validering der manglede TACACS+-håndteringen. Fix: tilføjet `if payload.get("auth_type") == "tacacs"` check i SSE-auth. **Berørt fil:** `backend/app/api/pxgrid.py`.

- `[fixed 5.3.1 build 0286] 2026-05-14 — pxGrid session-cache starter altid på 0 — ISE replayer ikke eksisterende sessioner ved subscribe` — ISE pxGrid sender kun events for fremtidige state-ændringer. Fix: `_reconcile_cache_with_mnt()` udvides med "seed"-fase: MnT-sessioner der mangler i cachen upsert'es med `state=STARTED`. **Berørte filer:** `backend/app/pxgrid/session_worker.py`, `frontend/js/views/browse.js`.

- `[fixed 5.3.0 build 0284] 2026-05-14 — Browse badge viser PULL selvom pxGrid-worker er OK` — Når pxGrid-settings gemmes, broadcaster `worker.stop()` `pxgrid_disabled` → frontend lukker EventSource permanent og genåbner den aldrig. Fix: `pxgrid_disabled`-handleren parser `reason`-feltet; er det `worker_stopped` schedules en `setTimeout(..., 5000)` der kalder `startPxGridStream()` igen. **Berørt fil:** `frontend/js/views/browse.js`.

- `[fixed 5.2.1 build 0275] 2026-05-14 — Portal staler intermittent — pxGrid starter aldrig pga. Windows-sti i cert-path` — Settings indeholder en Windows-absolut sti (`C:\Projekter\...\pxgrid\hypervision-portal.cert.pem`) der på Linux joines til en sti der aldrig eksisterer. Fix: `_resolve()` detekterer Windows drive-letter-mønster og bruger kun filnavnet resolved mod `BACKEND_ROOT/pxgrid/`. **Berørte filer:** `backend/app/pxgrid/cert_manager.py`.

- `[fixed 5.2.1 build 0272] 2026-05-14 — "Opret manglende profiler" fejler 500 på Endpoint_VLAN — EndPoints ikke ODBC dictionary` — ISE returnerer `500: EndPoints is not a valid ODBC dictionary`. Fix: `vlan`-feltet fjernet; erstattet med `advancedAttributes` med tre RADIUS Tunnel-attributter. **Berørte filer:** `backend/app/services/authz_profile_service.py`.

- `[fixed 5.2.1 build 0271] 2026-05-14 — "Opret manglende profiler" fejler 500 på Endpoint_PSK-KEY — forkert dictionary` — ISE returnerer `500: Unable to find dictionary attribute for [Cisco-AV-Pair:Cisco-AV-Pair]`. Det korrekte RADIUS-dictionary er `Cisco` med attributten `cisco-av-pair` (lowercase). **Berørte filer:** `backend/app/services/authz_profile_service.py`.

- `[fixed 5.2.1 build 0270] 2026-05-14 — "Opret manglende profiler" fejler 400 på Endpoint_PSK-KEY` — ISE ERS feltnavnet for højre side af advancedAttributes er `rightHandSideAttribueValue` (ISE's eget typo-mønster: "Attribue" = "Attribute" uden 't'), men koden sendte `rightHandSideAttribValue`. Fix: omdøbt til `rightHandSideAttribueValue`. **Berørte filer:** `backend/app/services/authz_profile_service.py`.

- `[fixed 5.2.0 build 0265] 2026-05-14 — Politikker-siden viser dansk tekst selvom locale er sat til engelsk` — `nav.policy` nøglen manglede fra i18n.js, og hele `policy.js` / `policy-condition-builder.js` brugte hardkodede danske strings fremfor `t()`. **Berørte filer:** `frontend/js/i18n.js`, `frontend/js/views/policy.js`, `frontend/js/views/policy-condition-builder.js`, `frontend/index.html`.

- `[fixed 5.0.1 build 0248] 2026-05-13 — Deployment-opdatering fejler med PermissionError på read-only filer` — `apply_package` markerede hele opdateringen som fejlet når dokumentationsfiler ikke var skrivbare for portal-processen på Linux. Fix: `PermissionError` fanges nu separat og tilføjes `skipped`-listen — opdateringen fortsætter. **Filer:** `backend/app/services/update_service.py`.

- `[fixed 5.0.1] 2026-05-13 — Policy regel-oprettelse fejler med 400 hvis navn indeholder kolon` — ISE Open API kræver regelnavne matcher `^[\w\-\.\(\)\ ]+$` — kolon (fra MAC-adresse i standardnavn) er ikke tilladt. Fix: erstat `:` med `-` i standardnavn, pre-validér navn mod regex i backend, parse begge fejlformater (ERS + Open API) i client.py. **Berørte filer**: `browse-detail.js`, `backend/app/api/policy.py`, `backend/app/ise/client.py`.

- `[fixed 3.30.0 build 0213] 2026-05-08 — Browse Views: "Ryd alle filtre" nulstillede ikke filtre` — `views-clear`-handleren kaldte `applyFilterSnapshot()` med et objekt der refererede `filterFieldSel` og `filterOpSel` (fjernet i b0210) → ReferenceError → intet blev nulstillet. Fix: fjernet ugyldig reference; tilføjet `sortCol`/`sortDir` reset + `updateSortHeaders()` i `applyFilterSnapshot()`. **Filer:** `frontend/js/views/browse-filter.js`.

- `[fixed 3.29.3 build 0204] 2026-05-08 — Browse: nye custom attributter vises ikke i dropdowns hvis filter er aktivt` — `state.caValues` populeres kun i `load()`. Med aktivt filter bruges `refreshRows()` i stedet, og `state.caValues` forbliver forældet. Fix: Hent `api.listCustomAttributes()` sekventielt efter `api.getEndpoint()` i `openDetail`. **Filer:** `frontend/js/views/browse-detail.js`.

- `[fixed 3.25.4 build 0192] 2026-05-08 — Access token udløber ikke fra brugerens perspektiv ved backend-genstart` — `boot()` i `app.js` bruger cached localStorage-bruger uden validering hvis `authStatus()`-kaldet fejler. Ingen client-side exp-tjek. **Filer:** `frontend/js/auth.js`, `frontend/js/app.js`, `backend/app/core/auth.py`.

- `[fixed 3.25.3 build 0186] 2026-05-07 — Ny skabelon vises ikke i bruger-skabelontildeling uden manuel reload` — `initUsersSection` hentede `allTemplates` én gang ved sektion-init. Fix: `allTemplates`-fetch flyttet ind i `reload()`. **Filer:** `frontend/js/views/settings.js`.

- `[fixed 3.25.2 build 0185] 2026-05-07 — Genstart-knap forsvandt fra Settings → Opdatering efter global .hidden-fix` — Knappen lå inde i `<div id="update-result" class="hidden">` og var kun synlig fordi `.hidden` ikke havde nogen CSS-regel. Fix: restart-knappen er flyttet til en permanent-synlig sektion. **Filer:** `frontend/js/views/settings.js`.

- `[fixed 3.24.1 build 0179] 2026-05-07 — .hidden CSS-klasse ikke defineret globalt — tpl-form-wrap altid synlig` — `settings.js` skabelon-formular brugte `class="hidden"` men der fandtes ingen global `.hidden { display: none; }` regel. Fix: tilføjet `.hidden { display: none !important; }` øverst i `styles.css`. **Filer:** `frontend/css/styles.css`.

- `[fixed 3.16.0 build 0170] 2026-05-07 — Non-admin Browse henter ALLE endpoints ved role-filter (skaleringsblokker ved 10K)` — ISE ERS understøtter ikke filter på custom attributes, så `HypervisionRoles`-scoping krævede at portalen hentede alle endpoint-detaljer. Fix: in-memory roles-indeks i `EndpointCache` der mappes `lowercase_rolle → {endpoint_id}`. **Filer:** `backend/app/core/endpoint_cache.py`, `backend/app/services/endpoint_service.py`.

- `[fixed 3.16.0 build 0170] 2026-05-07 — save_to_disk blokerer asyncio event loop ved stort endpoint-antal` — `cache.save_to_disk()` kører `json.dumps` + `path.write_text()` synkront på event loop. Fix: `save_to_disk_async()` der kører i `run_in_executor`. **Filer:** `backend/app/core/endpoint_cache.py`, `backend/app/services/cache_prewarm.py`.

- `[fixed 3.16.0 build 0170] 2026-05-07 — IseEndpointGroupRepository.list_all() henter kun side 1 — fejler ved >100 ISE-grupper` — `list_all()` kalder ISE med `{"size": 100}` uden paginering. Fix: paginér `list_all()` identisk med `IseEndpointRepository.list_all()`. **Filer:** `backend/app/ise/endpoints.py`.

- `[fixed 3.16.0 build 0170] 2026-05-07 — disk_stale_count() er O(N) scan — blokerer ved mange cache-entries` — `disk_stale_count()` itererer over hele `_details`-dict for at tælle entries med `from_disk=True`. Fix: vedligehold `_disk_stale_count: int` counter inkrementelt. **Filer:** `backend/app/core/endpoint_cache.py`.

- `[fixed 3.15.5] 2026-05-07 — 502/teknisk fejlbesked vist for admin i edit-modal ved ISE-fejl` — Alle ISE-fejl viste rå intern tekst. Fix: ny `_ise_http_error()` helper oversætter alle `IseApiError` til passende HTTP-statuskoder med dansk brugerbesked. **Filer:** `backend/app/api/endpoints.py`, `frontend/js/views/browse.js`.

- `[fixed 3.15.4] 2026-05-07 — Portal/Logs viser gammel log fra 2026-05-05 (forkert log-sti i API)` — `logs.py` resolverede relativ log-sti med `Path.cwd()` (projektrod) → læste fra `projekt-root/logs/app.log`. Men `logging.py` skriver til `backend/logs/app.log`. Fix: `logs.py` bruger nu `Path(__file__).resolve().parents[2]`. **Filer:** `backend/app/api/logs.py`.

- `[fixed 3.15.4] 2026-05-07 — 502 i edit-modal ved kortvarig ISE-fejl` — `force_fresh=True` rammer ISE direkte; ISE transport-fejl giver 502 til brugeren. Fix: `get_detail()` fanger ISE-fejl og returnerer cached entry (markeret ⏱ stale) hvis en findes. **Filer:** `backend/app/core/endpoint_cache.py`.

- `[fixed 3.15.3] 2026-05-07 — "Task exception was never retrieved" + gruppenavn N-dobbelt ISE-kald` — (1) Fire-and-forget tasks blev aldrig awaited → asyncio loggede ERROR. (2) `get_groups()` miss-path manglede coalescing → N samtidige kald ramte alle ISE selvstændigt. **Filer:** `backend/app/core/endpoint_cache.py`, `backend/app/services/endpoint_service.py`.

- `[fixed 3.15.2] 2026-05-05 — Race condition: edit-modal langsom + dobbelt ISE-kald` — `openDetail()` kaldte `prioritizeEndpoint` og `getEndpoint` simultant → to uafhængige ISE-kald. Fix: unified `_get_or_create_inflight()` koalescerer alle samtidige fetches for samme endpoint. **Filer:** `backend/app/core/endpoint_cache.py`, `backend/app/api/endpoints.py`, `frontend/js/views/browse.js`.

- `[fixed 3.13.7] 2026-05-04 — pxGrid worker reconnecte ikke efter idle timeout: backoff reset-logik fejler` — `connected_ok` sættes kun True når `_one_session()` returnerer via graceful shutdown; ethvert exception efterlader `connected_ok=False` → backoff nulstilles aldrig. Fix: backoff-reset baseres på `last_connect_at > iter_start`. **Filer:** `backend/app/pxgrid/session_worker.py`.

- `[fixed 3.13.6] 2026-05-04 — pxGrid worker disconnecter hvert 120s under idle: "Ingen frames i 120s"` — ISE pxGrid broker sender ingen STOMP-frames under idle-perioder der kan overstige 120s. Fix: `recv_timeout` læses fra ny config-setting `pxgrid_stomp_recv_timeout_s` (default 600s). **Filer:** `backend/app/pxgrid/session_worker.py`, `backend/app/core/config.py`.

- `[fixed 3.12.0] 2026-05-03 — editor-psk kan ikke redigere tildelte System adm-roller` — `canEditRoles` og `canPickRoles` ekskluderede `editor-psk`-rollen. **Berørte filer:** `frontend/js/views/browse.js`, `frontend/js/views/register.js`.

- `[fixed 3.12.4] 2026-05-03 — Rediger valgte endpoints mangler Tilknytning, PSK Mode og PSK Key` — Bulk-edit modal manglede felter som detail-modal har. **Berørte filer:** `frontend/js/views/browse.js`.

- `[fixed 3.12.5] 2026-05-03 — Bulk-edit modal ændrer størrelse ved Vis/PSK Key-aktivering` — `.modal` havde kun `width: 420px` men PSK Key-sektionen kræver 560px. Bulk-edit modal-div manglede `detail-modal` klassen. **Berørte filer:** `frontend/js/views/browse.js`.

- `[fixed 3.10.1] 2026-05-03 — Tab-skift til Browse/Edit: alle endpoints rød til manuel Refresh` — SSE-snapshot-event kan ankomme under load med `sessions=[]` og sætter `activeSessionMacs = new Set([])` (tom Set er truthy!) — MnT polles aldrig. Fix: det initielle `load()` på view-mount ændret til `load(true)`. **Filer:** `frontend/js/views/browse.js`.

- `[fixed 3.10.0] 2026-05-03 — Refresh poller ikke MnT når pxGrid er aktiv — alle devices forbliver grønne` — `refreshActiveSessionMacs(force)` havde pxGrid early-return FØR `force`-tjekket. Fix: `force`-tjekket wrapper nu begge early-returns. **Filer:** `frontend/js/views/browse.js`.

- `[fixed 3.9.8] 2026-05-03 — Refresh i Browse/Edit henter ikke aktuel ISE-status: cache bruges + auth-farver mangler uden filter` — Refresh-knappen kaldte `load()` direkte uden cache-bust, og `refreshActiveSessionMacs()` sprang MnT-poll over når `!anyFilterActive()`. Fix: Refresh-knap kalder `invalidateCache()` + `load(true)`. **Filer:** `frontend/js/views/browse.js`, `backend/app/api/cache.py`.

- `[fixed 3.9.7] 2026-05-03 — Audit-log aktør viser altid "system" i stedet for den indloggede bruger` — `get_current_user` var en sync `def`-funktion — FastAPI kørte den via threadpool og `ContextVar.set()` propagerede ikke til asyncio-task. Fix: ændret til `async def`. **Filer:** `backend/app/api/deps.py`.

- `[fixed 3.9.6] 2026-05-03 — Ny bruger tildeles ikke automatisk sin egen System adm-rolle ved oprettelse` — `create_user` initialiserede `assigned_endpoint_roles = []`. Fix: sætter nu `assigned_endpoint_roles = [username]`. **Filer:** `backend/app/services/user_service.py`.

- `[fixed 3.9.5] 2026-05-03 — pxGrid worker oscillerer: ISE sender ingen STOMP-heartbeats → worker timeout hvert 60s` — ISE's pxGrid STOMP-broker sender ingen heartbeat-frames. Fix: brug WebSocket RFC 6455 ping/pong (`ping_interval=20s, ping_timeout=10s`) som primær liveness; `recv_timeout` sættes til 120s som backstop. **Filer:** `backend/app/pxgrid/session_worker.py`.

- `[fixed 3.9.5] 2026-05-03 — SSE badge-flicker ⚪↔🟢 hvert ~3s ved transient SSE-reconnect` — `EventSource.onerror` sætter øjeblikkeligt `pxgridLive=false`. Fix: debounce `onerror` med 5s grace period. **Filer:** `frontend/js/views/browse.js`.

- `[fixed 3.9.5] 2026-05-03 — Disconnected endpoint forbliver grøn (auth-active) i Browse/edit når pxGrid kører` — (A) `applyAuthStatusColors()` har early-return når `activeSessionMacs === null`. (B) Disconnect-events misses under worker genopbygningsvindue. Fix: (A) fallback til `pxgridSessionMacs`; (B) worker reconcilerer mod MnT ActiveList efter hver reconnect. **Filer:** `backend/app/pxgrid/session_worker.py`, `frontend/js/views/browse.js`.

- `[fixed 3.9.1] 2026-05-01 — Saved views gendanner ikke kolonne-synlighed eller page-size` — `snapshotFilters()` fangede kun aktive filtre, ikke kolonne-synlighed eller page-size. Fix: `snapshotFilters()` inkluderer nu `colVis` + `pageSize`. **Filer:** `frontend/js/views/browse.js`.

- `[fixed 3.8.2] 2026-05-01 — System adm-katalog opdateres ikke i UI efter ny bruger oprettes` — Frontend's lokale rolle-katalog blev ikke refreshed ved bruger-creation. Fix: `createUser`-handler kalder `reload()` efter success. **Filer:** `frontend/js/views/settings.js`.

- `[fixed 3.8.1] 2026-04-30 — Registrar får 403 på "Mine endpoints" i register-viewet` — `GET /api/endpoints/details/all` brugte `require_any` (admin/editor/viewer) — registrar udelukket. Fix: skift til `require_register_lookup`. **Filer:** `backend/app/api/endpoints.py`.

- `[fixed 3.7.3] 2026-04-30 — Browse-badge viser fortsat "PUSH (pxGrid)" når pxGrid er disabled, auth-status opdateres aldrig` — SSE-forbindelsen stod åben uanset worker-state. Fix: SSE-endpoint sender `pxgrid_disabled`-event hvis disabled; frontend lukker EventSource og falder tilbage til MnT-poll. **Filer:** `backend/app/api/pxgrid.py`, `backend/app/pxgrid/session_worker.py`, `frontend/js/views/browse.js`.

- `[fixed 3.6.1] 2026-04-29 — Phase 4: nye endpoints i ISE dukker ikke op i portal selv om endpoint-topic er aktiv` — Worker SUBSCRIBE'ede til hardcoded default-topic `/topic/com.cisco.ise.endpoint`. Fix: worker laver nu ServiceLookup på et konfigurerbart service-navn og bruger den returnerede `topic`-property. **Filer:** `backend/app/core/config.py`, `backend/app/pxgrid/session_worker.py`, `backend/app/schemas/settings.py`, `backend/app/services/settings_service.py`, `frontend/js/views/settings.js`.

- `[fixed 3.5.2] 2026-04-29 — SSE-stream returnerer 404, frontend falder tilbage til MnT-pull` — Route `/sessions/stream` blev registreret EFTER `/sessions/{mac}` → FastAPI matchede stream-URL'en som `mac="stream"` → 404. Fix: stream-route flyttet op FØR den dynamiske `{mac}`-route. **Filer:** `backend/app/api/pxgrid.py`.

- `[fixed 3.5.1] 2026-04-29 — Browse: auth-status farver opdateres ikke live, kun ved Refresh` — SSE-event handlers for `upsert/remove` opdaterede kun `activeSessionMacs` hvis et filter var aktivt. Fix: `activeSessionMacs` populeres altid fra cache og `applyAuthStatusColors()` kaldes på hver event. **Filer:** `frontend/js/views/browse.js`.

- `[fixed] 2026-04-28 — PxGrid: WebSocket-upgrade afvist med HTTP 401 fordi Basic-auth-header mangler på selve handshaken` — mTLS alene er ikke nok til broker-laget; ISE forventer to-lags auth. Fix: `probe.run_session_probe()` bygger nu `Authorization: Basic <b64(node:secret)>` og sender den via `additional_headers=`. **Filer:** `backend/app/pxgrid/probe.py`.

- `[fixed] 2026-04-27 — PxGrid: AccessSecret-endpoint kaldt med forkert path "/AccessSecretCreate" → ISE 3.4 returnerer 404` — pxGrid 2.0-spec'et bruger kortformen `/pxgrid/control/AccessSecret`. Fix: `client.access_secret_create()` kalder nu `/AccessSecret`. **Filer:** `backend/app/pxgrid/client.py`, `backend/app/pxgrid/probe.py`, `ISE_API_REFERENCE.md`.

- `[fixed] 2026-04-27 — PxGrid: CSR har kun nodeName som SAN — host-FQDN bør med` — pxGrid 2.0 best practice + RFC 6125 anbefaler at SAN også indeholder portalens host-FQDN. Fix: nyt setting-felt `pxgrid_cert_extra_sans` der inkluderes som ekstra SAN i CSR'en. **Filer:** `backend/app/core/config.py`, `backend/app/schemas/settings.py`, `backend/app/services/settings_service.py`, `backend/app/pxgrid/cert_manager.py`, `backend/app/api/settings.py`, `frontend/js/views/settings.js`.

- `[fixed] 2026-04-27 — PxGrid: portal-genereret CSR mangler SubjectAlternativeName så ISE afviser klient-cert` — ISE 3.4 kræver `SubjectAlternativeName:dNSName` matchende nodeName. Fix: `generate_csr()` tilføjer nu `x509.SubjectAlternativeName([x509.DNSName(common_name)])`. **Filer:** `backend/app/pxgrid/cert_manager.py`.

- `[fixed] 2026-04-27 — PxGrid: "must both be set"-fejlmeddelelse er for kryptisk når et cert-felt mangler` — Fix: `cert_manager.load_bundle` lister nu eksplicit hvilke felter der mangler og peger på det korrekte trin i CSR-flowet. **Filer:** `backend/app/pxgrid/cert_manager.py`.

- `[fixed] 2026-04-27 — PxGrid: Trin 5 fejler med 503 selvom kontoen allerede er oprettet og password er gemt` — ISE 3.4's pxGrid afviser at re-registrere et eksisterende nodeName. Fix: `pxgrid_account_create()` detekterer "503 + gemt password" og falder tilbage på `AccountActivate`. **Filer:** `backend/app/services/settings_service.py`.

- `[fixed] 2026-04-27 — PxGrid: AccountCreate "returned 503:" uden brugbar fejlmeddelelse` — Fix: `_post` i `client.py` håndterer nu 503 specifikt med en dansk fejlmeddelelse der lister konkrete tjekpunkter i ISE-UI. **Filer:** `backend/app/pxgrid/client.py`.

- `[fixed] 2026-04-26 — PxGrid: AccountCreate fejler med "[SSL] PEM lib (_ssl.c:4143)" pga. CSR uploadet som signeret cert` — `POST /pxgrid/cert kind=cert` validerede kun `b"-----BEGIN" in raw`, hvilket en CSR også opfylder. Fix: ny `cert_manager.normalize_uploaded_bytes(kind, raw)` parser indholdet via `cryptography` per kind — afviser CSR med eksplicit dansk besked. **Filer:** `backend/app/pxgrid/cert_manager.py`, `backend/app/api/settings.py`.

- `[fixed] 2026-04-26 — PxGrid: upload-blokken vises i CSR-mode med misvisende headline + footgun-key-felt` — Fix: `applyMode("csr")` skjuler nu hele upload-blokken; CA-bundle-uploaden er flyttet ind i CSR-blokken. **Filer:** `frontend/js/views/settings.js`.

- `[fixed] 2026-04-26 — PxGrid: ingen tydelig sti til upload af signeret cert efter CSR-download` — Fix: CSR-blokken er omstruktureret til 5 nummererede trin med dedikeret upload-felt for det signerede cert inde i CSR-blokken. **Filer:** `frontend/js/views/settings.js`.

- `[fixed] 2026-04-26 — PxGrid: POST /api/settings/pxgrid/csr returnerer 400 efter mode-skift i UI` — Backend gatekeeper'ede på `pxgrid_cert_mode == "csr"` (persisted state), men dropdown-værdien levede kun i DOM indtil formularen submittes. Fix: backend validerer nu kun `pxgrid_node_name`; frontend auto-gemmer formularen før CSR- og account-knapperne. **Filer:** `backend/app/api/settings.py`, `backend/app/services/settings_service.py`, `frontend/js/views/settings.js`.

- `[fixed] 2026-04-26 — Audit: "Vis"/"Rollback" på hver sin linje + søgefelt fremstod som om det ikke filtrerede` — Actions-cellen for smal; `#audit-search` reagerede kun på `input`-event med 350ms debounce. Fix: kolonnen udvidet, `white-space: nowrap`, tilføjet `change`/`keydown`/Enter-handlers. **Filer:** `frontend/js/views/audit.js`, `frontend/css/styles.css`.

- `[fixed] 2026-04-25 — Browse/Edit: "roleCatalog.map is not a function" på første load` — Backend returnerer `{"roles": [...]}` men `browse.js` og `register.js` behandlede hele response-objektet som en array. Fix: udtrækker nu `rolesResp.roles` med `Array.isArray`-guard. **Filer:** `frontend/js/views/browse.js`, `frontend/js/views/register.js`.

- `[fixed] 2026-04-25 — Browse/Edit: kolonner forskudt én plads til venstre fordi Vendor-kolonnen mangler i body` — "Vendor" tilføjet til `COLUMNS`-arrayet men `renderRows` emitterede ingen `<td>` for vendor. Fix: tilføjet `<td class="vendor-cell-td">`. **Filer:** `frontend/js/views/browse-table.js`.

- `[fixed] 2026-04-25 — Rollback rydder custom attributes i stedet for at restore dem` — `_endpoint_update_from_snapshot` læste `snap.get("custom_attributes")` men before-snapshot'et flader dem ud til top-level felter. Fix: rekonstruerer nu `CustomAttrs` fra de fladede snapshot-felter. **Filer:** `backend/app/api/audit.py`.

- `[fixed] 2026-04-24 — Browse/Edit kan ikke rydde custom attributes (værdien forbliver, vises som "bypass")` — `IseEndpointRepository.update` filtrerede empty-string-værdier væk før PUT-payloaden, men ISE merger `customAttributes`-blokken på PUT. Fix: sender nu hele `custom_attributes`-dict'et uden at strippe empty strings. **Filer:** `backend/app/ise/endpoints.py`, `backend/app/ise/openapi_endpoints.py`.

- `[fixed] 2026-04-21 — Slettet attribut-værdi kommer tilbage efter sync fra ISE` — `set_custom_attributes` droppede den fjernede nøgle fra payloaden — ISE beholdt bare den gamle værdi. Fix: `remove_value` sætter eksplicit `new_attrs[attr_name] = ""` i stedet for at droppe nøglen. **Filer:** `backend/app/ise/endpoints.py`, `backend/app/services/custom_attribute_service.py`, `ISE_API_REFERENCE.md`.

- `[fixed] 2026-04-21 — Tilknytning (StaticGroupAssignment) ændrer sig ved CSV export + re-import` — `toIseCsv` afledte static fra om gruppen var sat; `parseIseFormat` læste slet ikke feltet; `CreateEndpointRequest` manglede felt. Fix: komplet roundtrip-fix i `csv.js`, `import.js`, `endpoint.py` og `endpoint_service.py`. **Filer:** `frontend/js/csv.js`, `frontend/js/views/import.js`, `backend/app/schemas/endpoint.py`, `backend/app/services/endpoint_service.py`.

- `[fixed] 2026-04-21 — CSV Export Template: import opdaterer ikke templaten, reset virker ikke` — Excel-eksporterede CSV-filer starter med UTF-8 BOM; `parseTemplateHeader` fik BOM-prefix og fandt ikke kolonnenavne. Fix: `parseTemplateHeader` stripper nu BOM. **Filer:** `frontend/js/csv.js`, `frontend/js/views/settings.js`.

- `[fixed] 2026-04-19 — Browser-reload tvinger nyt login selvom token er gyldigt` — `/auth/status` lå i `UNAUTH_PATHS` så Authorization-headeren ikke blev sendt. Fix: fjernet `/auth/status` fra `UNAUTH_PATHS`. **Filer:** `frontend/js/api.js`.

- `[fixed] 2026-04-19 — CoA reauth fejler med HTTP 401 (HTML login-side)` — ISE-brugeren har kun rollen `ERS Admin` — MnT REST API'et kræver `MnT Admin` eller `Super Admin`. Fix: `coa.py` fanger 401/403 og giver eksplicit dansk besked om rolle-kravet. **Filer:** `backend/app/ise/coa.py`, `frontend/js/views/settings.js`, `ISE_API_REFERENCE.md`.

- `[fixed] 2026-04-18 — Export CSV uden selektion eksporterer kun aktuel side` — Uden selektion og filter eksporterede "Export CSV" kun endpoints på aktuel pagination-side. Fix: henter nu alle endpoints via `listAllEndpointDetails()` ved eksport uden selektion. **Filer:** `frontend/js/views/browse.js`.

- `[fixed] 2026-04-18 — ERS filter-felter 'name'/'description' returnerer 400` — ISE 3.4 svarer `400 The filter field 'name' is not supported`. Fix: server-side filter-dropdown begrænset til `mac`. **Filer:** `frontend/js/views/browse.js`, `ISE_API_REFERENCE.md`.

- `[fixed] 2026-04-18 — POST /api/custom-attributes/sync returnerer 500 (TypeError)` — `sync_from_ise()` kaldte `list_page()` som om den returnerede en liste, men metoden returnerer tuplen `(resources, total)`. Fix: unpack tuple. **Filer:** `backend/app/services/custom_attribute_service.py`.

- `[fixed] 2026-04-17 — Filter søger kun i aktuel side, ikke alle endpoints` — Alle kolonnefiltre filtrerede kun i den aktuelle sides data. Fix: ny backend-route `GET /endpoints/details/all`; frontend skifter til filter-mode. **Filer:** `backend/app/api/endpoints.py`, `frontend/js/views/browse.js`.

- `[fixed] 2026-04-17 — Browse/Edit ignorerer "Default page size" preference` — Browse/Edit view brugte altid hardkodet `100`. Fix: `browse.js` læser nu `pageSize` fra localStorage via `getPageSize()`. **Filer:** `frontend/js/views/browse.js`.

- `[fixed] 2026-04-17 — Tema-valg slår ikke igennem` — Valg af tema gemt i localStorage men aldrig anvendt på DOM. Fix: tilføjet `applyTheme()`/`initTheme()` i `settings.js`, kaldt ved app-start. **Filer:** `frontend/js/views/settings.js`, `frontend/css/styles.css`.

- `[fixed] 2026-04-17 — Save i Browse/Edit sætter altid staticGroupAssignment=true` — group_id altid sendt i payload selv uden gruppe-ændring. Fix: frontend sender kun `group_id` når gruppen faktisk blev ændret. **Filer:** `frontend/js/views/browse-detail.js`.

- `[fixed] 2026-04-17 — Browse/Edit refresh nulstiller filter` — `load()` kaldte `renderRows(allRows)` direkte. Fix: `load()` kalder nu `applyFilter()` så filter og portal-toggle bevares. **Filer:** `frontend/js/views/browse.js`.

- `[fixed] 2026-04-16 — Custom attributes sættes ikke på endpoints` — (1) `ensure_definitions` kaldt kun ved sync. (2) ERS stien `/ers/config/endpointcustomattribute` returnerer 404. Fix: skiftet til ISE Open API (`/api/v1/endpoint-custom-attribute`). **Filer:** `backend/app/services/custom_attribute_service.py`.

- `[fixed] 2026-04-16 — "Location" konflikter med ISE built-in profiler attribut` — ISE returnerer 500 ved forsøg på at oprette custom attribute "Location". Fix: omdøbt til `Lokation` i hele systemet. **Filer:** alle lag.
