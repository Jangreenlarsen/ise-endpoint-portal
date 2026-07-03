# Bugs

Alle bugs registreres her så snart de opdages. Opdateres når de fikses.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte filer, løsning (hvis fixed).

**Detaljerede post-mortems**: Komplekse/tilbagevendende bugs har en selvstændig
`BUGREPORT-*.md`-fil i projektroden med fuld analyse, log-fingeraftryk, hvorfor tidligere
fixes fejlede, og regressions-vagt. Den linkes fra bug-entryen nedenfor. **Læs den før du
fejlfinder et lignende symptom** — flere ISE-timeout/CB-problemer har været samme grundårsag.

Kendte post-mortems:
- [BUGREPORT-ise-endpointgroup-storm.md](BUGREPORT-ise-endpointgroup-storm.md) — ISE `/ers/config/endpointgroup` ReadTimeout-storm + CB-cykling (grundårsag: N+1 gruppe-fetch i drip-loop). Fixed 6.21.0721.

## [FIXED 6.21.0721] 2026-07-03 — Drip-loop N+1 gruppe-storm → konstant `/endpointgroup` ReadTimeout + CB-cykling

- **Symptom:** Loggen domineres af `GET /ers/config/endpointgroup` `ReadTimeout` (10.000+ issues på `app.ise.client`), CB åbner 10-13×/dag, fresh% ustabil. Kørte hele dagen, ikke som spike.
- **Root cause (endelig — grundårsagen bag 6.14–6.21's symptom-fixes):** `_drip_loop()` genopretter `EndpointService` på hver iteration ([cache_prewarm.py:289](backend/app/services/cache_prewarm.py#L289)), så det **per-instans** `_group_cache` altid er tomt. `_fetch_endpoint_detail` → `_resolve_group_name` falder derfor igennem til `self.groups.list_all()` — et **N+1-kald** (1 list + `GET /endpointgroup/{id}` for HVER gruppe) — på ~hver drip-refresh (~1/5s). Det gav titusindvis af group-kald/time, langt over ISE ERS' ~5-10 req/s → ReadTimeout → 2 retries (mere last) → CB åbner → lukker → storm i ring. **Diskriminator:** 37% (1050/2800) af timeouts var på friske forbindelser (`idle_before=0s`) → udelukker stale-connection som årsag.
- **Hvorfor tidligere fixes ikke virkede:** 6.18.0711/6.21.0720 (keepalive) behandlede forbindelses-alder; 6.15.0702 (drip back-off) og 6.14.0699 (list-view N+1) ramte nabo-symptomer men overså drip-loopens group-storm.
- **Løsning (v6.21.0721):** Delt gruppe-navne-cache på modul-niveau (`_shared_group_names`, TTL = `cache_ttl_seconds`, coalesced via én lås) deles på tværs af alle `EndpointService`-instanser. `_resolve_group_name` → ny `_get_group_names()`: refresher højst 1×/300s, coalescer concurrent kaldere til ét `list_all()`, serverer stale + back-off 30s ved ISE-fejl. Korte navne bevaret (uændret UI). `create_group` invaliderer cachen; `_full_scan` pre-warmer den via `force=True`. Group-kald falder ~1000×.
- **Berørte filer:** `backend/app/services/endpoint_service.py`, `backend/app/services/cache_prewarm.py`
- **Detaljeret analyse:** [BUGREPORT-ise-endpointgroup-storm.md](BUGREPORT-ise-endpointgroup-storm.md)

## [FIXED 6.21.0720] 2026-07-02 — Stale connections ved korte idle-pauser → CB låser, fresh% → 0%

- **Symptom:** Efter en "Opdater fra ISE"-scan faldt fresh endpoint % gradvist fra 100% til 0% og blev der. Log viste `ReadTimeout` på `GET /ers/config/endpointgroup` med `[idle_before=18s]` — efterfulgt af CB-åbning og ingen recovery.
- **Root cause:** ISE ERS (Tomcat) lukker idle TCP-forbindelser efter ~12-15s — ikke ~25-30 min som den tidligere kommentar antog. Drip-loopets søvn i normal mode er `max(0.5, 1800/100) = 18s`. I de 18s lukker ISE forbindelserne. httpx forsøger at genbruge dem (keepalive_expiry=30s >> 18s idle) og får ReadTimeout. CB åbner efter 5 failures. CB's recovery-probe (60s) bruger samme stale connections → probe fejler → CB reset til OPEN. Endless loop.
- **Løsning (v6.21.0720):** Reduceret `keepalive_expiry_s` default fra 30s til 10s. httpx lukker nu idle forbindelser efter 10s — FØR ISE lukker dem ved ~12-15s. Drips 18s søvn og CB's 60s probe resulterer altid i en frisk TCP-forbindelse.
- **Berørte filer:** `backend/app/ise/client.py`

## [FIXED 6.21.0718] 2026-07-02 — 4 bugs opdaget via v6.20.0717 condensed-eksport + reload-analyse

- **Bug A** `circuit_breaker.open_count` for høj: drip-loglinjen `"drip: circuit breaker OPEN — pauser…"` matchede `_CB_OPEN`-regex og tæltes som en CB-tilstandsændring. Root cause: regex `r"circuit.?breaker[:\s]+OPEN"` er for bred. Fix: ekskludér linjer der starter med `"drip:"` i CB-event-detektion.
- **Bug B** `circuit_breaker.open_count` tæller dobbelt pr. CB-åbning: ved samtidige ISE-fejl kalder flere concurrent requests `record_failure()` og rammer threshold+1, +2 etc. — alle logger `"circuit breaker: OPEN after N failures"`, som alle matches af regex. Fix: log kun "OPEN after N failures" ved første CLOSED→OPEN transition (skip hvis allerede OPEN).
- **Bug C** `drip: fetch fejlede id=<uuid>: Cannot send a request, as the client has been closed`: httpx-klienten lukkes under restart/settings-ændring mens drip stadig har en inflight asyncio.gather. RuntimeError er korrekt fanget men logges på WARNING → vises som problem i analyse. Fix: downgrade til DEBUG for RuntimeError med "closed".
- **Bug D** Browse-reload latens 15-20s: `refreshActiveSessionMacs(force=true)` kaldes SYNKRONT efter `Promise.all()` i `load()`, dvs. ISE MnT-kald blokerer rendering. Cachen er varm og endpoint-data er klar på <100ms, men tabellen viser ikke noget før MnT-kaldet svarer. Fix: kør `refreshActiveSessionMacs` i baggrunden — render tabel øjeblikkeligt, opdater auth-farver når MnT svarer.
- **Løsning (v6.21.0718):** Alle 4 bugs fixet — se CHANGELOG.
- **Berørte filer:** `backend/app/api/logs.py`, `backend/app/ise/circuit_breaker.py`, `backend/app/services/cache_prewarm.py`, `frontend/js/views/browse-table.js`

## [FIXED 6.20.0717] 2026-07-02 — Log-analyse: 5 bugs opdaget via condensed-eksport

- **Bug A** `time_range.first > time_range.last`: `_all_log_files()` returnerede nyeste-fil-først grundet fejlagtig `.reverse()` → `first_ts`/`last_ts` var byttet om.
- **Bug B** `notable_entries` viste de ældste 300 entries i stedet for nyeste: samme forkerte fil-rækkefølge, `[-300:]` gav oldest file's tail.
- **Bug C** `ise_requests.outcomes` manglede 2xx: succesfulde ISE-kald loggedes aldrig med statuskode → regex matchede ingenting. Fix: tilføj `logger.info("ISE %s %s -> %d")` i `client.py`.
- **Bug D** `UnboundLocalError: cannot access local variable 'loaded'` i `session_cache.load_from_disk`: `loaded` aldrig initialiseret til 0 inden loop.
- **Bug E** `drip_refresh: 0/0`: drip-success loggedes på DEBUG-niveau (usynligt) og skip loggedes slet ikke. Fix: periodisk INFO-statuslog i drip-loop + ny regex.
- **Bug F** `ancendpoint 400: The filter field 'macAddress' is not supported`: ISE ERS `/ancendpoint` understøtter ikke `macAddress` som filter-parameter. Fix: paginér client-side i stedet.
- **Løsning (v6.20.0717):** Alle 6 bugs fixet — se CHANGELOG.
- **Berørte filer:** `backend/app/api/logs.py`, `backend/app/ise/client.py`, `backend/app/pxgrid/session_cache.py`, `backend/app/services/cache_prewarm.py`, `backend/app/ise/anc.py`

## [FIXED 6.18.0711] 2026-07-02 — Stale idle-forbindelser → circuit breaker låser ved portal-inaktivitet

- **Symptom:** Når ingen brugere er logget ind på portalen i >30 min (f.eks. om natten), fejler alle ISE-kald med `ISE API 0: transport error: ` (tom fejlbesked) og circuit breakeren åbner. Half-open proben genbruger samme stale forbindelser og fejler → CB forbliver OPEN.
- **Root cause:** `httpx.AsyncClient` har ingen `keepalive_expiry` konfigureret. ISE (ERS/Tomcat) lukker idle TCP-forbindelser efter ~25-30 min. httpx ved det ikke og forsøger at genbruge lukkede forbindelser ved næste request. Tom fejlbesked skyldes at `str(httpx.RemoteProtocolError)` kan være tom — type + idle-tid loggedes ikke.
- **Løsning (v6.18.0711):** Sat `keepalive_expiry=30.0` (konfigurerbar via `ise_keepalive_expiry_s`) på `httpx.Limits` — portalen lukker idle-forbindelser inden ISE gør det. Udvidet logning: idle-tid pr. request, exception-type ved transport-fejl, advarsel ved lange idle-pauser.
- **Berørte filer:** `backend/app/ise/client.py`

## [OPEN → MONITORED 6.16.0706] 2026-07-01 — ISE REST API-bruger bliver disabled

- **Symptom:** Portalen mister ISE-forbindelsen periodisk — alle ISE-kald returnerer 401. ISE-admin kan se at API-brugerkontoen er disabled.
- **Root cause:** ISE's "Account Disable Policy" deaktiverer konti efter N dages inaktivitet — ISE tæller sandsynligvis kun GUI-logins som "aktivitet", ikke API Basic Auth-kald. Dermed ses API-brugeren som "inaktiv" selv om portalen kalder ISE hundredvis af gange dagligt.
- **Status:** Monitorering implementeret (v6.16.0706). Portal viser nu rød alarm i Dashboard ved 3+ consecutive 401s med præcise trin til genaktivering. Langsigtet løsning er at slå Account Disable Policy fra for API-brugeren i ISE GUI.
- **Berørte filer (monitoring):** `backend/app/ise/client.py`, `backend/app/core/alert_store.py`, `backend/app/api/dashboard.py`, `frontend/js/views/dashboard.js`, `frontend/js/i18n.js`

## [FIXED 6.15.0702] 2026-06-17 — Cache drip-loop låser på fejlende endpoint + for langsom sprint

- **Symptom:** Efter noget tid indeholder cachen kun gammel data (stale entries med forældet ISE-info) — selv om portalen er i drift og cache-health-dot viser aktivitet. Data opdateres kun når bruger trykker "Refresh from ISE".
- **Root cause 1 (primær — drip-loop fastlåst):** `_drip_loop()` vælger altid `get_oldest_id()` (entry med ældst `fetched_at`). Hvis `_fetch_endpoint_detail()` fejler for dette endpoint, fanges exception'en, men `fetched_at` opdateres **aldrig** → næste iteration returnerer præcis samme endpoint → permanent loop over ét endpoint, alle andre refreshes aldrig. Alle 99 øvrige entries forbliver stale indtil `_full_scan()` kører om 30 min (skip_threshold=1800s).
- **Root cause 2 (sekundær — sprint for langsom):** Sprint-formlen `(interval/4)/stale_count` giver `drip_sleep=4.5s` for 100 endpoints. Inkl. ISE fetch (~1s) = 5.5s/endpoint → fuld runde = 550s >> TTL=300s. Drip-loopen kan aldrig holde alle entries friske — der vil altid være store dele af cachen stale.
- **Fix 1:** I exception-handler: sæt `entry.fetched_at = time.time() - ttl + 60` (back-off 60s). Drip-loopen vælger nu et andet endpoint næste iteration. Log-niveau hævet fra DEBUG til WARNING.
- **Fix 2:** Sprint-formel ændret til `ttl / total / 2`: giver `drip_sleep=1.5s` for 100 endpoints, cycle ≈ 250s < TTL=300s → alle entries holdes friske.
- **Berørt fil:** `backend/app/services/cache_prewarm.py`

## [FIXED 6.14.0700] 2026-06-17 — Browse reload tager ~30 sek efter 30 min fravær

- **Symptom:** "Reload"-knap i Browse/Edit tager ca. 30 sekunder efter 30 minutters fravær. Normalt bør reload være <200ms da data serveres fra cache.
- **Root cause:** `load()` i `browse-table.js` kalder `Promise.all()` med 9 parallelle API-kald — herunder `api.listDacls()`. `DaclService.list_summaries()` havde **ingen cache** og ramte ISE ERS/Open API direkte ved hvert kald. Med `cache_ttl_seconds=300s` er entries stale efter 5 min, og ISE kan være langsom (idle connection re-establish + SSL handshake + rate limiting) — typisk 5-30s. `Promise.all()` venter på det langsomste kald inden browse-tabellen renderes.
- **Fix:** SWR-cache i `dacl_service.py`: første kald fetcher fra ISE og cacher 5 min (fresh), herefter serveres fra cache med SWR-baggrunds-refresh op til 150 min. Cache invalideres ved create/update/delete. Concurrent fetches coalesces via inflight asyncio.Task.
- **Berørte filer:** `backend/app/services/dacl_service.py`

## [FIXED 6.14.0699] 2026-06-17 — Browse reload langsom + "operation timed out" fejl

- **Symptom:** Efter at cachen er populeret er reload hurtigt. Så snart ét endpoint gemmes (eller entries bliver stale efter TTL), er næste reload langsom igen. Hyppige "The operation timed out" fejl i Browse/Edit.
- **Root cause:** `_list_all_from_cache()` og `_list_from_roles_index()` kaldte `asyncio.gather()` med `get_endpoint()` for hvert cachet endpoint (N=500+). For stale entries (age > TTL = 5 min) spawner `get_detail()` én ISE-baggrundstask per entry via `_get_or_create_inflight`. Resultatet: op til N simultane ISE-requests fra list-view alene, på toppen af pre-warm-drip. ISE overbelastes → timeout-fejl. Ét save → ét invalideret entry → resten af entries er stadig stale → næste reload spawner N-1 ISE-tasks igen.
- **Fix:** `_list_all_from_cache` og `_list_from_roles_index` bruger nu `cache.snapshot_all_details()` / `cache.snapshot_details_for_roles()` — ren synkron O(N) dict-read, ingen asyncio.gather, ingen ISE-kald, ingen baggrundstasks. Pre-warm drip-loop håndterer gradvis refresh. Ny helper `_build_detail_page()` anvender PSK-masking og stale-flag.
- **Berørte filer:** `backend/app/core/endpoint_cache.py`, `backend/app/services/endpoint_service.py`

## [FIXED 6.14.0697] 2026-06-17 — Browse viser tom liste efter portal-genstart (disk cache ikke vist øjeblikkeligt)

- **Symptom:** Browse/Edit viser ingen endpoints i op til 15-30 sekunder efter portal-genstart (eller lang tids fravær). Derefter dukker alle endpoints op på én gang.
- **Root cause:** `endpoint_cache.get_detail()`: disk-loaded entries (loaded fra disk ved opstart) gennemgår SWR-tjekket `_stale_servable()` som returnerer `age <= ttl * 30`. Hvis disk-cachen er gemt natten før er entries 8+ timer gamle → `age > ttl * 30` (2,5 timer med default ttl=300s) → ikke SWR-kandidater → falder igennem til **synkron ISE-fetch**. `_list_all_from_cache` awaiter alle N fetches med concurrency=8 → 500 endpoints * 300ms / 8 = 18+ sekunder inden Browse svarer.
- **Fix:** Disk-loaded entries har et dedikeret branch i `get_detail()` der altid serverer disk-værdien øjeblikkeligt (stale, `cache_stale=True`) og starter en background-refresh — uanset alder. Pre-warm-workeren opdaterer alle disk-entries i baggrunden alligevel.
- **Berørte filer:** `backend/app/core/endpoint_cache.py`

## [FIXED 6.14.0696] 2026-06-17 — ISE låser REST API-kontoen ved gentagne auth-fejl

- **Symptom:** ISE deaktiverer REST API-brugerkontoen — portal viser 401 Auth-fejl i diagnostics. Efter lang tids fravær vises Browse tom i op til 1-2 minutter (cache pre-warm kørende).
- **Root cause:** I `client.py` kaldes `self._cb.record_success()` for **alle** HTTP-responses — inkl. 401. Det betyder at repeated 401-fejl aldrig åbner circuit breakeren, og pre-warmen fortsætter med at sende ISE-requests med fejlagtige credentials. ISE's "Disable account after N consecutive failed logins" policy (typisk 3-5) aktiveres og låser kontoen. Circuit breakeren er fuldstændig blind for auth-fejl.
- **Fix:** 401-responses kalder nu `record_failure()` i stedet for `record_success()`. En separat tæller (`_consecutive_401s`) spoer på hinanden følgende auth-fejl. 1. fejl: WARNING i log. 2.+ fejl: ERROR med instruktion om at tjekke ISE kontolås. Succesfulde requests (og andre 4xx/5xx) nulstiller tælleren. Efter `failure_threshold` (default 5) på hinanden følgende 401er åbner circuit breakeren og blokerer yderligere ISE-kald i `recovery_timeout` sekunder — ISE kontoen kan dermed ikke nå lockout-grænsen.
- **Berørte filer:** `backend/app/ise/client.py`

## [FIXED 6.14.0695] 2026-06-15 — VLAN (og andre CA-felter) opdateres ikke i tabellen efter save

- **Symptom:** Efter at have gemt et endpoint i Endpoint Details syntes VLAN-værdien (og andre custom attributes) at forblive på den gamle værdi i Browse-tabellen.
- **Root cause:** `api.getEndpoint()` returnerer nu `{ data, totalMs, fromCache, cacheAge }` (ændret til `requestTimed` i v6.14.0689). Men `refreshRows()` i `browse-table.js` behandlede returværdien direkte som et `EndpointDetail`-objekt. `r.id` var `undefined` → rækker i `state.allRows` blev aldrig opdateret → tabel viste gamle værdier.
- **Fix:** `api.getEndpoint(id).then((r) => r?.data ?? r)` — udpakker `.data` fra wrapper-objektet, med fallback for backward-compat.
- **Berørte filer:** `frontend/js/views/browse-table.js`

## [FIXED 6.14.0694] 2026-06-15 — Send CoA on expiry gemmes ikke i Settings

- **Symptom:** "Send CoA on expiry" og CoA-type-valget i Guest Registration-indstillingerne blev ikke gemt — checkbox forblev altid `false` og indstillingen virkede ikke ved guest-udløb.
- **Root cause:** `settings_service.py` — `get_backend_settings()` inkluderede ikke `selfregister_expiry_coa_enabled`/`selfregister_expiry_coa_type` i `BackendSettingsResponse`. `update_backend_settings()` inkluderede dem heller ikke i `overrides.update()`-dict'en. Felterne eksisterede i schema og config men var aldrig koblet til læse/skrive-flowet.
- **Fix:** Begge felter tilføjet til `get_backend_settings()` og `update_backend_settings()`.
- **Berørte filer:** `backend/app/services/settings_service.py`

## [FIXED 6.14.0693] 2026-06-15 — Guest selvregistrering satte ikke endpoint-gruppen ved gen-registrering

- **Symptom:** En guest der registrerede sig (første gang) blev placeret korrekt i den konfigurerede endpoint identity group. Men hvis samme MAC registrerede sig igen (gen-registrering), forblev gruppen uændret — gæsten kunne ende i en anden gruppe end den der er valgt i indstillingerne.
- **Root cause:** I upsert-logikken i `selfregister.py`: ved `update` (eksisterende endpoint) manglede `group_id` i `EndpointUpdate`. `None` → `endpoints.update()` spring `groupId` i ISE over (korrekt adfærd for admin-edit, forkert for selfregister).
- **Fix:** `group_id=s.selfregister_group_id or None` tilføjet til `EndpointUpdate` i update-stien i `selfregister.py`.
- **Berørte filer:** `backend/app/api/selfregister.py`

## [FIXED 6.13.0685] 2026-06-14 — Aktiv/Inaktiv-knapper mangler i Endpoint Details

- **Symptom:** I Endpoint Details modal var der ingen tydelig/synlig måde at sætte aktiv/inaktiv-status. Knapperne "Sæt Aktiv"/"Sæt Inaktiv" var gemt i bunden af modalens footer og kun vist konditionelt — svære at finde.
- **Root cause:** `HypervisionActive`-feltet var ikke en del af det redigerbare formular-grid — kun eksponeret via skjulte action-knapper i modal-actions-baren.
- **Fix:** `HypervisionActive` tilføjet som synlig `<select>`-dropdown direkte i formular-griddet (efter Description, før Type). Dropdownen er altid synlig og gemmes via det normale Gem-flow. Derudover paralleliseret `getEndpoint`+`listCustomAttributes`+`listDacls` i `openDetail` for hurtigere indlæsning.
- **Berørte filer:** `frontend/js/views/browse.js`, `frontend/js/views/browse-detail.js`, `frontend/js/i18n.js`

## [FIXED 6.8.0669] 2026-06-14 — Portal kan crashe efter OTA-opdatering (ingen pre-flight tjek)

- **Symptom:** Portal crasher (crash-loop) efter OTA git pull hvis ny kode har importfejl eller manglende afhængighed. Kræved desuden manuel klik på "Genstart server".
- **Root cause:** `git_pull()` kørte ikke verificering af ny kode inden genstart — `os._exit(0)` med defekt kode → systemd genstarter → crash → loop.
- **Fix:** `_preflight_check()` kører `python -c "from app.main import app"` som subprocess. Hvis tjek fejler → ingen genstart (fejl vises i UI). Hvis tjek OK → auto-genstart om 3s. Frontend poller `/api/health` og viser "Server oppe igen" med genindlæs-link.
- **Berørte filer:** `backend/app/services/update_service.py`, `frontend/js/views/settings/section-update.js`

## [FIXED 6.7.0666] 2026-06-14 — Portal crasher ved opstart på frisk OVA-install (manglende h2-pakke)

- **Symptom:** Portalen crashede ved opstart med `ImportError` fordi `httpx.AsyncClient(http2=True)` kræver h2-pakken, som ikke er installeret på friske OVA-installs.
- **Root cause:** `IseClient.__init__` initialiserede klienten med `http2=use_http2` uden at håndtere manglende h2-dependency.
- **Fix:** `ImportError` fanges og portalen falder automatisk tilbage til HTTP/1.1 med en log-advarsel. OTA-pull (v6.7.0665+) installerer h2 automatisk — næste genstart aktiverer HTTP/2.
- **Berørt fil:** `backend/app/ise/client.py`

## [FIXED 6.7.0664] 2026-06-14 — Release notes i portalen viser forkert sektion + brudt bullet-formatering

- **Symptom:** Portalen viste `## [6.7] — ... — Feature: frys pxGrid live-opdatering` (build 0658) som aktuel release note i stedet for den nyeste sektion (`## [6.7.0663]`). Bullet-punkter med linjeskift-continuation (`  baggrunden...`) renderede som separate afsnit.
- **Root cause 1:** `_extract_release_sections_since` fik `VERSION` = "6.7" som `current_version`. `_parse_semver("6.7")` = `(6, 7, 0)` → fandt eksakt match på `## [6.7]`-sektionen i stedet for `## [6.7.ZZZZ]`.
- **Root cause 2:** `RELEASE_NOTES.md` brugte `## [6.7]` og `## [6.6]` som headers (gammelt format uden build-nummer).
- **Root cause 3:** Multi-linje bullet-punkter med 2-space continuation-indent splitter i separate `<p>`-elementer af rendererens linje-for-linje parser.
- **Fix:** `check_github_version` sender nu `FULL` ("6.7.0664") som `current_version` og `"{version}.{build}"` som `latest_version` til `_extract_release_sections_since`. RELEASE_NOTES.md: `## [6.7]` → `## [6.7.0658]`, `## [6.6]` → `## [6.6.0658]`. Alle multi-linje bullet-punkter gjort til single-line.
- **Berørte filer:** `backend/app/services/update_service.py`, `RELEASE_NOTES.md`

## [FIXED 6.7.0662] 2026-06-14 — Browse: bruger-redigerede inputfelter (description m.fl.) nulstilles ved pxGrid-opdatering

- **Symptom:** Hvis en pxGrid live-event (upsert/remove/endpoint_changed) trigger `applyFilter()` → `renderRows()` mens en bruger er i gang med at redigere felter i en "dirty" række (description, group, type, osv.), erstattes `tbody.innerHTML` komplet — og brugerens urelaterede ændringer slettes. Rækken er stadig markeret dirty, men indeholder nu de originale værdier. Gemmer brugeren derefter, sendes de originale (ikke de redigerede) værdier til ISE. Dataset-attributter (`beStaticGroup`, `bePskKey`, `beActiveStatus`) gik tilsvarende tabt.
- **Root cause:** `renderRows()` i `browse-table.js` bruger `tbody.innerHTML = rows.map(...).join("")` som erstatter hele DOM inkl. alle input-elementers `.value`. Der var ingen beskyttelse af dirty-rækkernes nuværende bruger-redigerede indhold.
- **Fix:** `renderRows()` tager nu et snapshot af alle dirty-rækkernes inputværdier og dataset-attributter FØR `innerHTML`-replace, og gendanner dem umiddelbart efter rebuild.
- **Berørt fil:** `frontend/js/views/browse-table.js`

## [FIXED 6.7.0660] 2026-06-14 — Backend startup crash: nmap.py importerer ikke-eksisterende app.core.users

- **Symptom:** Backend crasher ved startup med `ModuleNotFoundError: No module named 'app.core.users'`.
- **Root cause:** `nmap.py` brugte `from app.core.users import User` — modulet hedder `app.schemas.user`.
- **Fix:** Ændret import til `from app.schemas.user import User`.
- **Berørt fil:** `backend/app/api/nmap.py`

## [FIXED 6.7.0659] 2026-06-14 — OTA update-check: ny version med samme build registreres ikke som opdatering

- **Symptom:** Portalen siger "ingen opdatering" selvom `6.7 build 0658` er nyere end `6.5.0 build 0658` (og lignende). `_parse_semver("6.7")` returnerer `(0,0,0)` fordi regex kræver 3 dele. `update_available` sammenligner KUN build-numre — med det nye versionsformat kan MINOR stige uden at build ændres (features tæller ikke som build-bump), så `658 > 658 = False` selv om MINOR er højere.
- **Root cause:** (1) `_parse_semver` regex: `r"(\d+)\.(\d+)\.(\d+)"` kræver 3 dele — fejler på nyt `X.Y`-format. (2) `update_available = int(latest_build) > int(current_build)` ignorerer MAJOR og MINOR helt.
- **Fix:** Ny `_parse_version_build(version, build)` sammenligner fuldt `(major, minor, build_int)`-tuple. Håndterer både gammelt `X.Y.Z`-format og nyt `X.Y`-format. `_parse_semver` opdateret til at matche `X.Y` som fallback (returnerer `(X, Y, 0)`). `_split_release_sections` accepterer nu både `X.Y` og `X.Y.Z` i section-headers.
- **Berørt fil:** `backend/app/services/update_service.py`

## [FIXED 6.3.2 b0644] 2026-06-08 — Register-siden sætter ikke "Registered by"

- **Symptom:** Endpoints registreret via Register-siden (register.js) har tomt "Registered by"-felt.
- **Root cause:** `register.js`'s `attrLabels`-objekt indeholder kun Type, Owner, Lokation, AuthzVlan, AuthzACL, PlatformType — ikke `RegistretBy`. Submit-handleren bygger `ca`-dict udelukkende herfra, så `RegistretBy` aldrig sættes.
- **Fix:** Auto-sæt `ca.RegistretBy = me.username` ved submit (brugeren er allerede hentet via `api.authMe()`).
- **Berørt fil:** `frontend/js/views/register.js`

## [FIXED 6.3.1 b0643] 2026-06-08 — ISE authz-profil: manglende cisco-av-pair url-redirect-acl attribut

- **Symptom:** Portal viser kun ét `cisco-av-pair` (url-redirect) for CWA-profiler — `url-redirect-acl` mangler i profilvisningen.
- **Root cause:** `_parse_profile_detail()` parsede kun `advancedAttributes`. ISE gemmer web-redirect ACL i et separat `webRedirection`-objekt (`webRedirection.acl`) når profilen er konfigureret via ISE GUI's Web Redirection-sektion — ikke som `advancedAttributes`-entry.
- **Fix:** Parser nu også `webRedirection`-feltet: ekstraherer `WebRedirectionType`, `portalName`, `acl` og evt. `staticIPHostNameFQDN`. Undgår dubletter med `advancedAttributes`-data. Debug-logging af raw ISE profile-data tilføjet.
- **Berørt fil:** `backend/app/services/authz_profile_service.py`

## [FIXED 6.2.6 b0641] 2026-06-08 — ISE 400 "Condition property is required" ved gem af Default authz-regel

- **Symptom:** `Error: 502: ISE API 400: Condition property is required` ved gem af Default-regelens profiler.
- **Root cause:** b0639-fix udelod `condition`-feltet fra PUT-payload når det var null — ISE kræver feltet til stede.
- **Fix:** Sender `"condition": null` eksplicit i JSON-payload i stedet for at udelade feltet.
- **Berørt fil:** `backend/app/ise/policy.py`

## [FIXED 6.2.4 b0639] 2026-06-08 — ISE 400 ved gem/flyt/slet af Default authz-regel

- **Symptom:** `Error: 502: ISE API 400: Failed to handle API request - Network Access Authorization Rule : Default rule cannot be modified` ved save/drag/delete på Default-reglen.
- **Root cause:** ISE afviser PUT med condition-feltet på Default-reglen og alle DELETE-kald. Profil-ændringer er derimod tilladt.
- **Fix:** Editoren åbner for Default-reglen men conditions-sektionen erstattes af info-besked. `condition: null` sendes i PUT (udelades fra ISE-payload). Delete blokeres. Drag-drop blokeres med fejlbesked.
- **Berørte filer:** `backend/app/api/policy.py`, `backend/app/ise/policy.py`, `backend/app/services/policy_service.py`, `backend/app/schemas/policy.py`, `frontend/js/views/policy.js`

## [FIXED 6.0.3 b0624] 2026-06-06 — Simulering: EndPoints.GuestRegistration og RegistretBy altid skipped

- **Symptom:** Policy-simulering evaluerede aldrig `EndPoints.GuestRegistration equals true/false` eller `EndPoints.RegistretBy equals …` — betingelserne blev markeret som "skipped/unevaluable" uanset endpoint-værdier.
- **Root cause 1:** `_ENDPOINT_ATTR_MAP` i `policy_service.py` manglede entries for `"GuestRegistration"` og `"RegistretBy"` → `_get_ep_value()` returnerede `None` → condition skipped.
- **Root cause 2:** `_fetch_ep_from_ise()` (live-endpoint simulation) returnererede ikke `guest_registration`/`registret_by` i ep-dict, så custom_attributes-fallback hjalp heller ikke.
- **Fix:** Tilføjet `"GuestRegistration": "guest_registration"` og `"RegistretBy": "registret_by"` til `_ENDPOINT_ATTR_MAP`, samt tilsvarende felter i `_fetch_ep_from_ise` return-dict.
- **Berørt fil:** `backend/app/services/policy_service.py`

## [FIXED 5.20.3 b0596] 2026-06-02 — Auth-status kolonne altid rød

- **Symptom:** Auth-status søjle (og MAC-celle farve) viste rød (auth-failed) på alle endpoints — selv aktive sessioner.
- **Root cause 1:** `applyAuthStatusColors()` i `browse-table.js` brugte `macCell.textContent` til MAC-opslag. Cellen indeholder ekstra badge-tegn (⚰ ⊘ ✓ 📌 ⏱) → `normalizeMac()` returnerede `"AA:BB:CC:DD:EE:FF⚰"` som aldrig matchede sessionsættet → altid `auth-failed`.
- **Root cause 2:** pxGrid `clear`-event kaldte `.clear()` på Sets, der forblev truthy (tom Set er ikke `null`) → `if (!macs) return`-guard virkede ikke → alt rød.
- **Fix:** Brug `tr.dataset.mac` (ren MAC sat ved row-render). Sæt `state.*SessionMacs = null` i `clear`-handler i stedet for `.clear()`.
- **Filer:** `frontend/js/views/browse-table.js`, `frontend/js/views/browse.js`

## [FIXED 5.19.4 b0582] 2026-05-31 — Audit: Rollback af Decommissioned nulstiller ikke HypervisionStatus

- **Symptom:** Rollback af `decommissioned`-event slettede ikke `status: "Decommissioned"` — endpoint forblev dekommissioneret i ISE efter rollback.
- **Root cause 1:** `_endpoint_update_from_snapshot()` i `audit.py` byggede `CustomAttrs` uden `HypervisionStatus` — feltet droppedes stille.
- **Root cause 2:** `update_endpoint()` bruger `model_dump(exclude_none=True)` — `None`-værdier filtreres fra og ISE-feltet renses aldrig. Tom streng `""` overlever filteret.
- **Fix:** Send `HypervisionStatus=snap.get("status") or ""` i `_endpoint_update_from_snapshot()` — tom streng er ikke `None` og ISE modtager eksplicit clearing af CA-feltet.
- **Berørt fil:** `backend/app/api/audit.py`

## [FIXED 5.19.3 b0581] 2026-05-31 — Browse: pxGrid SSE-stream startede aldrig efter cookie-migrering

- **Symptom:** Browse-view viste "⚪ inactive (no filter + pxGrid offline)" selv om pxGrid-worker var forbundet med 27 sessioner.
- **Root cause:** `startPxGridStream()` i `browse.js` læste token fra `localStorage.getItem("hv_ise_token")`. Efter cookie-migreringen i v5.19.0 gemmes token ikke længere i localStorage → `token` var tom string → `if (!token) return` afbrød funktionen før EventSource-oprettelsen.
- **Fix (frontend):** Token-check fjernet; EventSource bruger nu `{ withCredentials: true }` som sender httpOnly cookie automatisk for same-origin og cross-origin (file://).
- **Fix (backend):** `sessions/stream`-endpointet læser `hv_token`-cookie FØRST, `?token=` query-param som fallback; token_gen-tjek tilføjet i tråd med `get_current_user()`.
- **Berørte filer:** `frontend/js/views/browse.js`, `backend/app/api/pxgrid.py`

## [FIXED 5.19.2 b0580] 2026-05-31 — Sikkerhed: Token-revokation og log-sanitering manglede

**Sårbarhed 1 (HØJ): Ingen token-revokation**
- Tokens var gyldige i op til 1 time efter logout, passwordskift eller rolleændring — en stjålet Bearer-token kunne genbruges hele TTL-perioden.
- **Fix:** `token_gen`-counter tilføjet per bruger i `users.json`. Alle tokens inkluderer nu `gen`-claim. `get_current_user()` afviser tokens med forældet `gen`. Logout, passwordskift og rolleændring (inkl. admin-ændring) incrementerer counteren og invaliderer alle eksisterende tokens for brugeren.
- **Berørte filer:** `backend/app/core/user_store.py`, `backend/app/core/auth.py`, `backend/app/api/deps.py`, `backend/app/api/auth.py`, `backend/app/services/user_service.py`

**Sårbarhed 2 (LAV): Ingen log-sanitering (defense-in-depth)**
- Logformatter var uden redaktion — fremtidige programmeringsfejl kunne lække credentials til logfiler.
- **Fix:** `_SensitiveDataFilter` tilføjet — matcher `password`, `secret`, `token`, `psk`, `api_key` o.l. i key=value- og JSON-format og erstatter værdien med `***`.
- **Berørt fil:** `backend/app/core/logging.py`

## [FIXED 5.19.1 b0579] 2026-05-30 — Audit: Rollback af decommissioned-handling fejlede med 400

- **Symptom:** "Rollback failed: 400: Rollback understøttes ikke for action=decommissioned" i Audit-visningen.
- **Root cause:** `_rollback_endpoint_action()` i `audit.py` håndterede kun `created`, `updated` og `deleted` — `decommissioned` landede i den generiske 400-fejl.
- **Fix:** `decommissioned`-gren tilføjet: genopret endpoint fra `before`-snapshot via `_endpoint_update_from_snapshot` + `update_endpoint` — identisk flow som `updated`-rollback.
- **Berørt fil:** `backend/app/api/audit.py`

## [FIXED 5.19.0 b0578] 2026-05-30 — Sikkerhedsanalyse: 3 kritiske/høje sårbarheder

**Sårbarhed 1 (KRITISK): `/metrics`-endpoint var uauthentificeret**
- Alle brugere — herunder uautentificerede — kunne hente Prometheus-metrics med cache-størrelse, circuit breaker-state og request-counts.
- **Fix:** `Depends(require_any)` tilføjet til `GET /metrics`.
- **Berørt fil:** `backend/app/api/metrics_api.py`

**Sårbarhed 2 (HØJ): Backup-eksport indeholdt plaintext credentials**
- `GET /config/backup` inkluderede `ise_password`, `pxgrid_password` og `tacacs_secret` fra `config.json`/`auth_config.json` i ren tekst. Backup-fil var sensitiv som et password-dokument.
- **Fix:** Sensitive felter erstattes af sentinel `"__REDACTED__"` i eksporten. `credentials_redacted: true` markeres i metadata. Restore springer `__REDACTED__`-felter over og bevarer serverens eksisterende credentials.
- **Berørt fil:** `backend/app/api/config_backup.py`

**Sårbarhed 3 (HØJ): JWT-token gemt i localStorage — sårbar over for XSS**
- Token lå i localStorage og kunne stjæles af XSS-scripts (f.eks. via kompromitteret 3.-parts library).
- **Fix:** Backend sætter nu `httpOnly; SameSite=Strict`-cookie ved login/refresh. Cookie er utilgængelig fra JavaScript. Backend-auth læser fra cookie først, falder tilbage på Bearer-header for API-klienter. Frontend gemmer ikke længere token — kun `expires_at` og `auth_type` (ikke-sensitive metadata) i localStorage til lokal udløbskontrol.
- **Berørte filer:** `backend/app/core/auth.py`, `backend/app/api/auth.py`, `backend/app/api/deps.py`, `backend/app/schemas/user.py`, `backend/app/services/user_service.py`, `frontend/js/auth.js`, `frontend/js/api.js`, `frontend/js/app.js`, `frontend/js/views/login.js`, `frontend/js/views/settings/section-backup.js`, `frontend/js/views/audit.js`

## [FIXED 5.18.1 b0577] 2026-05-30 — Code-review: 8 fejl fundet og rettet (Decomm-chip + profil-details)
- **Bug 1 (høj):** `encodeFilterToUrl` testede `!state.hideDecommissioned` i stedet for `state.decommOnly` — Decomm-chip-tilstand blev aldrig skrevet til delt URL. Fix: `if (state.decommOnly)`.
- **Bug 2 (høj):** `decodeFilterFromUrl` satte ikke `state.decommOnly = true` ved `decomm=1` — shared URL viste alle endpoints i stedet for kun dekommissionerede. Fix: `state.decommOnly = true` (fjernet forkert `hideDecommissioned = false`).
- **Bug 3 (medium):** `updateClearBtn` inkluderede ikke `state.decommOnly` — "Ryd filtre"-knap viste sig ikke når Decomm var eneste aktive filter. Fix: `|| state.decommOnly` tilføjet.
- **Bug 4 (medium):** `snapshotFilters`/`applyFilterSnapshot` gemte ikke `decommOnly` — chip-tilstand tabt ved page-reload. Fix: `decommOnly` tilføjet til snapshot-objekt og gendannes i `applyFilterSnapshot`.
- **Bug 5 (medium):** `loadAndRenderProfileDetails` i `policy.js` skrev til detached DOM-node ved navigation under API-kald. Fix: `if (!document.contains(container)) return` efter `await`.
- **Bug 6 (lav):** Decomm-filterlogik duplikeret i `browse-table.js` server-sti (dead code — filter-mode håndterer det). Fix: fjernet duplikeret gren, beholder kun `hideDecommissioned`-logikken.
- **Bug 7 (lav):** VLAN `tagID: 0` undertrykt af falsy-check i `_parse_profile_detail`. Fix: `is not None`-guard i stedet for sandhedstest.
- **Bug 8 (lav):** `get_by_name` slugte alle exceptions uden logging — ISE 401/500 uadskillelig fra "ikke fundet". Fix: `logger.warning` tilføjet.
- **Berørte filer:** `frontend/js/views/browse-filter.js`, `frontend/js/views/browse-table.js`, `frontend/js/views/policy.js`, `backend/app/services/authz_profile_service.py`, `backend/app/ise/authz_profiles.py`.

## [FIXED 5.17.2 b0568] 2026-05-29 — Import: XSS + runtime crash — escapeHtml udefineret
- **Symptom:** Import-preview og import-resultat crashede med `ReferenceError: escapeHtml is not defined`; rå brugerinput fra CSV-filer (MAC, beskrivelse, custom attributes) indsattes uescapet i innerHTML.
- **Root cause:** `escapeHtml()` brugt 12 steder i `import.js` men aldrig defineret eller importeret — det korrekte kald var `esc()` som allerede var importeret fra `browse-utils.js`.
- **Fix:** Alle 12 `escapeHtml(` → `esc(` (replace_all).
- **Berørte filer:** `frontend/js/views/import.js`.

## [FIXED 5.17.1 b0567] 2026-05-29 — Browse: "Vis dekommissionerede"-filter havde ingen effekt
- **Symptom:** Toggling af decommission-filter ændrede intet i tabellen — begge tilstande viste de samme rækker.
- **Root cause:** `needsFilterMode()` brugte `!state.hideDecommissioned` (inverteret), så filter-tilstand aldrig indtrådtes for denne betingelse alene, og `applyFiltersToRows()` kørte ikke i paginated-tilstand.
- **Fix:** Fjernet `!state.hideDecommissioned` fra `needsFilterMode()`; `applyFilter()` i `browse-table.js` filtrerer nu dekommissionerede rækker i begge rendering-stier.
- **Berørte filer:** `frontend/js/views/browse-filter.js`, `frontend/js/views/browse-table.js`.

## [FIXED 5.17.1 b0567] 2026-05-29 — Browse: "Del filter"-knap kopierede ikke URL til udklipsholder
- **Symptom:** Knappen reagerede ikke på HTTP-origins — ingen kopi, ingen fejlbesked.
- **Root cause:** `navigator.clipboard` er `undefined` på ikke-HTTPS origins; `.writeText()` kastede en synkron TypeError inden `.catch()` nåede at registrere sig.
- **Fix:** Erstattet med try/catch + optional chaining (`navigator.clipboard?.writeText`); fallback til `prompt(url)` ved manglende clipboard-API.
- **Berørte filer:** `frontend/js/views/browse-filter.js`.

## [FIXED 5.13.1 b0562] 2026-05-29 — UI: Hvid tekst på "Ryd markeringer"-knap i Livscyklus
- **Symptom:** `.lc-clear-marks`-knappen viste amber farve (`#92400e` / `#fcd34d`) på teksten i stedet for standard hvid, i modsætning til alle andre knapper i portalen.
- **Fix:** Fjernet `color`-override fra `.lc-clear-marks` og dark-tema-varianten. Knappen bruger nu standard hvid tekst.
- **Berørte filer:** `frontend/css/styles.css`.

## [FIXED 5.12.9 b0560] 2026-05-28 — UI: Inaktiv-chip var redundant med auth-status-kolonnen
- **Symptom:** "Inaktiv"-filterfunktionen i MAC-kolonnen duplikerede den information der allerede vises i auth-status-kolonnen, og skabte forvirring.
- **Fix:** Inaktiv-chip og al tilhørende tilstandsstyring (`state.macInactive`, `updateInactiveChip`, `macInactive`-filterblok, `:disabled` CSS) fjernet.
- **Berørte filer:** `frontend/js/views/browse.js`, `frontend/js/views/browse-filter.js`, `frontend/css/styles.css`.

## [FIXED 5.12.8 b0559] 2026-05-28 — UI: Markerings-fjernelse fejlede ved gem — grundlæggende reimplementering
- **Symptom:** Tre rodårsager: (1) inline/bulk save fjernede ALDRIG markering — save-handlere kaldte kun `refreshRows`. (2) `<tr>` manglede `data-mac`-attribut så MAC-opslag var skrøbeligt. (3) unmark-kode spredt over detail-modal, refreshRows og inline-save med overlap og race conditions.
- **Fix:** `<tr data-mac="...">` tilføjet i `renderRows`. Centraliseret `unmarkSaved(id)` i browse-table.js. `saveAllBtn` og `bulkSaveBtn` kalder `unmarkSaved` for hver vellykket gemt endpoint. browse-detail.js kalder `cb.unmarkSaved(savedId)`.
- **Berørte filer:** `frontend/js/views/browse-table.js`, `frontend/js/views/browse-detail.js`.

## [FIXED 5.12.7 b0558] 2026-05-28 — UI: 📌-pin fjernedes ikke direkte fra DOM ved gem
- **Symptom:** Gem-handleren delegerede pin-fjernelse til `refreshRows` via localStorage-opdatering — en asynkron kæde med for mange led der brød.
- **Fix:** Straks efter `saveMarkedMacs` fjernes pinnen direkte fra `<tr data-id="..."> .marked-pin` i DOM synkront inden `closeDetail()`.
- **Berørte filer:** `frontend/js/views/browse-detail.js`.

## [FIXED 5.12.6 b0557] 2026-05-28 — UI: Markering fjernedes ikke korrekt efter gem — forkert MAC-opslag
- **Symptom:** MAC-adressen til markerings-fjernelsen læstes fra `#d-mac` DOM-elementets `textContent` ved gem-tidspunktet. Browser-timing kunne give tom eller forkert formateret værdi.
- **Fix:** MAC gemmes i `state.detailCurrentMac = normalizeMac(d.mac)` når detail åbner (data netop hentet fra API). `closeDetail()` nulstiller `state.detailCurrentMac`.
- **Berørte filer:** `frontend/js/views/browse-detail.js`.

## [FIXED 5.12.4 b0555] 2026-05-28 — UI: 📌-badge forsvandt ikke fra rækken efter gem
- **Symptom:** `refreshRows` opdaterede MAC-cellen delvist (kun `.mac-link`-indholdet) men fjernede ikke `.marked-pin`-badgen udenfor linket.
- **Fix:** `refreshRows` genindlæser nu marked-sæt fra localStorage og fjerner/tilføjer `.marked-pin` korrekt for den opdaterede række.
- **Berørte filer:** `frontend/js/views/browse-table.js`.

## [FIXED 5.12.3 b0554] 2026-05-28 — UI: MAC-chips opdaterede ikke tabellen automatisk
- **Symptom:** MAC-filter-chips (Privat / Inaktiv / Markeret) kaldte `applyFilter()` direkte, men det virkede kun hvis filter-tilstand allerede var aktiv. Tabellen opdaterede sig ikke ved første chip-klik.
- **Fix:** Chip-handleren kalder nu `onFilterChange()` som korrekt starter filter-tilstand ved behov.
- **Berørte filer:** `frontend/js/views/browse.js`.

## [FIXED 5.12.1 b0552] 2026-05-28 — UX: Markeret-filter lå i toolbar — passet dårligt med MAC-chips
- **Symptom:** "📌 Markerede"-toolbar-knappen var inkonsistent med "Privat"/"Inaktiv"-chips der sidder direkte under MAC-kolonnen i filterpanelet.
- **Fix:** Toolbar-knappen er fjernet. I stedet er "📌 Markeret"-chip tilføjet direkte under MAC-kolonnen på linje med Privat/Inaktiv.
- **Berørte filer:** `frontend/js/views/browse.js`, `frontend/css/styles.css`.

## [FIXED 5.8.2-P4 b0526] 2026-05-24 — SEC: Cache-invalidate tilgængeligt for alle brugere (DoS)
- **Symptom:** `/api/cache/invalidate` brugte `require_any` — enhver autentiseret bruger (viewer, registrant) kunne tømme endpoint-cachen.
- **Risiko:** Gentagen cache-invalidering tvinger backend til at kalde ISE for hvert request → latens-spike og potentiel ISE-overbelastning (DoS mod eget ISE).
- **Fix:** Endpoint kræver nu `require_admin`. `require_any`-import fjernet fra `cache.py`.

## [FIXED 5.8.2-P4 b0526] 2026-05-24 — SEC: trends.py — _mac_from_json() brugte json uden import (NameError)
- **Symptom:** Ubrugt funktion `_mac_from_json()` i `trends.py` kaldte `json.loads()` men `json` var ikke importeret i filen.
- **Risiko:** Kald til funktionen ville give `NameError: name 'json' is not defined` → 500-fejl.
- **Fix:** Funktionen er fjernet (dead-code — aldrig kaldt).

## [FIXED 5.8.2-P4 b0526] 2026-05-24 — SEC: audit list-endpoint manglede max_length på filterparametre
- **Symptom:** `GET /api/audit` — `actor`, `resource_type`, `resource_id`, `from_ts`, `to_ts` havde ingen `max_length`-begrænsning. Export-endpoint var korrekt fra Patch 3.
- **Risiko:** Ekstremt lange filterværdier kunne forårsage overhead i SQLite-query-parsing.
- **Fix:** `max_length` tilføjet konsistent på alle fem parametre (200/100/200/50/50 tegn).

## [FIXED 5.7.13 b0513] 2026-05-23 — XSS: user.role ukrypteret i innerHTML (app.js)
- **Symptom:** `user.role` fra JWT-payload indsættes direkte i `innerHTML` uden HTML-escaping.
- **Risiko:** Hvis en angriber kan påvirke rolle-værdien (kompromitteret token), kan vilkårligt HTML/JS injiceres.
- **Fix:** `esc(user.role)` bruges nu i `app.js:171`. `esc()` importeres fra `browse-utils.js`.

## [FIXED 5.7.13 b0513] 2026-05-23 — CSP: script-src tillod unsafe-inline scripts (main.py)
- **Symptom:** `Content-Security-Policy` indeholdt `script-src 'self' 'unsafe-inline'`.
- **Risiko:** En XSS-sårbarhed kunne udnyttes til at køre vilkårlige scripts da CSP ikke blokerede inline scripts.
- **Fix:** `'unsafe-inline'` fjernet fra `script-src`. Alle scripts er `type="module" src="..."` (externe).

## [FIXED 5.7.13 b0513] 2026-05-23 — Account lockout gemtes kun i memory — tabt ved genstart
- **Symptom:** Backend-genstart nulstillede aktive account lockouts.
- **Risiko:** En angriber kunne omgå lockout ved at provokere en genstart (f.eks. systemfejl eller deployment).
- **Fix:** Ny `lockout_store.py` gemmer failures og lockout-state i SQLite (`audit.db`). Overlever genstarter.

## [FIXED 5.7.13 b0513] 2026-05-23 — Ingen input-validering på search-parametre i API
- **Symptom:** `search`-parameter i `/api/endpoints` og `/api/audit` havde ingen længdebegrænsning.
- **Risiko:** Ekstremt lange søgestrenge kunne forårsage DoS (CPU/memory) i FTS5-søgningen.
- **Fix:** `max_length=500` på alle søge-parametre; `page`/`size` valideret med `ge`/`le`.

## [FIXED 5.7.13 b0513] 2026-05-23 — Windows: config.json fik ikke filadgangsbegrænsning
- **Symptom:** `settings_store.py` satte kun Unix `chmod 0o600`; Windows-blokken var tom.
- **Risiko:** `config.json` (indeholder ISE-credentials) var læsbar for alle brugere på systemet.
- **Fix:** `icacls` bruges nu til at fjerne nedarvet adgang og give kun aktuel bruger fuld kontrol.

## [FIXED 5.7.11 b0511] 2026-05-23 — 502 ved "Show 500" — ISE ERS max 100/side
- **Symptom:** Valg af 500 i "Show"-dropdown gav `502: ISE returnerede en uventet fejl (HTTP 400)`.
- **Årsag:** Admin-stien i `list_endpoint_details` sendte `size=500` direkte til ISE ERS API der kun accepterer max 100 per side.
- **Fix:** Når cache er varm, bruger admin-stien nu `_list_all_from_cache()` der paginerer i Python uden ISE-kald. Kold-cache-fallback caps `size` til 100.

## [FIXED 5.7.10.2 b0510] 2026-05-23 — /endpoints/stats returnerede 0 — Pydantic-objekt har ikke .get()
- **Symptom:** LAA-badge viste intet.
- **Årsag:** `cached_entry.value` er `EndpointDetail` (Pydantic) — `ep.get("mac")` kaster `AttributeError`. Frontend slugte fejlen stille → `state.laaTotal = null`.
- **Fix:** `isinstance(ep, dict)` afgør om `.get()` eller `getattr()` bruges.

## [FIXED 5.7.10.1 b0509] 2026-05-23 — /endpoints/stats fejlede — EndpointCache har ingen .values()
- **Symptom:** LAA-badge forsvandt.
- **Årsag:** `get_cache().values()` — `EndpointCache` er ikke et dict og har ingen `.values()`-metode → `AttributeError`.
- **Fix:** Rettes til `cache._details.values()` (intern `dict[str, CachedEntry]`).

## [FIXED 5.7.8.1 b0506] 2026-05-23 — Browser cacher JS/CSS — nye features indlæses ikke uden hard refresh
- **Symptom:** Nye frontend-ændringer (f.eks. LAA MAC-fremhævning) vises ikke i browseren selv efter genstart af backend.
- **Årsag:** FastAPI `StaticFiles` sender ingen `Cache-Control` headers → browseren cacher `.js` og `.css` på ubestemt tid.
- **Fix:** `SecurityHeadersMiddleware` i `main.py` sætter nu `Cache-Control: no-store` på alle `.js`- og `.css`-svar.

## [FIXED 5.7.7.5 b0504] 2026-05-23 — TACACS login brudt efter shadow-user introduceret (is_admin_user fejlklassificering)
- **Symptom:** TACACS-brugere med admin-rolle (f.eks. "adm") fik `login_failed bad_credentials` — ISE modtog aldrig TACACS-auth-forespørgslen.
- **Årsag:** Shadow-record (`username="adm"`, `role="admin"`, `user_type="tacacs_shadow"`) matchede `find_by_username`. Gammel check `user_type != "operator"` klassificerede shadow som lokal admin → `is_admin_user=True` → TACACS springes over → lokal auth fejler med `password_hash=""`.
- **Fix:** `is_admin_user` kræver nu `user_type == "user"`. `profile_record` lookup filtrerer shadow fra. Lokal auth-blok dækker nu også `tacacs_shadow`.

## [FIXED 5.7.7.4 b0503] 2026-05-23 — Users-liste giver 500 når TACACS shadow-users er i users.json
- **Symptom:** Admin → Users-modul kastede "Internal Server Error 500" efter v5.7.7.3 introducerede `tacacs_shadow`-records.
- **Årsag:** `UserType = Literal["user", "operator"]` — `"tacacs_shadow"` ikke med → Pydantic ValidationError ved `_to_public()`.
- **Fix:** `user.py`: tilføjet `"tacacs_shadow"` til `UserType`. `user_service.py`: `list_users()` filtrerer shadow-records fra.

## [FIXED 5.7.7.3 b0502] 2026-05-23 — TACACS-brugere fik HTTP 404 ved gem af præferencer/views
- **Symptom:** TACACS-brugere fik 404-fejl når de forsøgte at gemme præferencer eller gemte views, fordi `users.json` ikke havde en post for dem.
- **Årsag:** TACACS-login oprettede et syntetisk `User`-objekt med `id=f"tacacs:{username}"` men gemte det aldrig til `users.json`. Alle præference- og view-endpoints slår brugeren op via `find_by_id()` → returnerede `None` → 404.
- **Fix:** `user_service.py` `login()` upsert'er nu et shadow-record med `user_type="tacacs_shadow"` i `users.json` ved hvert vellykket TACACS-login. Rolle, endpoint-roller og skabeloner synkroniseres fra operatørprofilen ved hvert login.

## [FIXED] 2026-05-21 — selektion af endpoints nulstilles ved automatisk portal-opdatering
- **Symptom:** Valgte endpoints (checkbokse) blev fravalgt efter kort tid, selv uden bruger-interaktion.
- **Årsag:** pxGrid `endpoint_changed`-events trigerede `scheduleEndpointReload()` → `cb.load()` → `renderRows()` som sætter `tbody.innerHTML` og dermed erstatter alle DOM-elementer inkl. checkbokse. Selektion var ikke gemt nogen steder og gik tabt.
- **Fix:** `renderRows()` i `browse-table.js` fanger nu alle valgte IDs i `prevSelected` inden innerHTML-erstatning og sætter `checked` på de matchende rækker i den nye render. Fungerer for alle re-render-triggers (pxGrid auto-refresh, manuel refresh). Løst i v5.6.26.

## [FIXED] 2026-05-21 — batch-simulate: `PolicyMatchResult has no attribute 'matched_rule'`
- **Symptom:** Alle endpoints returnerede fejl ved batch-simulering.
- **Årsag:** `batch_simulate` i `policy.py` brugte `result.matched_rule` og `result.matched_profile` — de korrekte feltnavne er `matched_rule_name` og `profiles` (liste).
- **Fix:** `backend/app/api/policy.py` — rettet til `result.matched_rule_name` og `", ".join(result.profiles)`. `matched`-check opdateret tilsvarende. Løst i v5.6.25.

---

## [FIXED 5.7.4.5 b0495] 2026-05-23 — first_seen: slettet endpoint i ISE (aldrig tilbage) bevarede stale DB-post
- **Symptom:** Hvis et endpoint slettes direkte i ISE og aldrig genopdages, forbliver MAC-adressen i `first_seen.db` permanent. Hukommelsesleak.
- **Fix:** `_full_scan()` i `cache_prewarm.py` henter MAC fra cache inden invalidering og kalder `first_seen_store.delete(mac)` for hvert endpoint der forsvinder fra ISE-listen.

## [FIXED 5.7.4.4 b0494] 2026-05-23 — first_seen: endpoint slettet i ISE og genskabt beholdt gammelt tidsstempel
- **Symptom:** Endpoint slettet direkte i ISE og re-oprettet arvede det originale "første gang set" tidsstempel fra før sletningen.
- **Fix:** `first_seen_store.record()` sammenligner nu `endpoint_id` — ISE tildeler nyt ID ved genskabelse. Ændret ID trigger `UPDATE` og nyt tidsstempel.

## [FIXED 5.7.4.3 b0493] 2026-05-23 — first_seen: endpoint slettet via portal beholdt post i DB
- **Symptom:** Sletning af endpoint via portalen fjernede ikke MAC fra `first_seen.db`. Ved genopdagelse fik endpointet det gamle tidsstempel.
- **Fix:** `delete_endpoint()` kalder `first_seen_store.delete(mac)` efter ISE-sletningen.

## [FIXED 5.7.4.2 b0492] 2026-05-23 — first_seen kolonne manglede `<td>` i renderRows — alle efterfølgende kolonner rykkede én position
- **Symptom:** `first_seen`-kolonnen var tom i datarækker; NAS, ISE Session m.fl. vistes én kolonne forskudt.
- **Årsag:** `cells`-objektet i `renderRows()` manglede `first_seen`-nøgle → `cells[c.key] || ""` returnerede tom streng i stedet for et `<td>`-element.
- **Fix:** `first_seen`-entry tilføjet i `cells`-objektet i `browse-table.js`.

## Åbne

- `[fixed 5.6.19 b0467] 2026-05-21 — Save endpoint meget langsom (2× ISE-kald i serie på hot path)` — `update_endpoint` lavede tre ISE-kald i rækkefølge: GET (before-audit, cache-hit → hurtig), PUT (selve opdateringen), GET (after-audit → blokerede HTTP-svaret med et ekstra ISE-kald). Frontend ventede på alle tre før siden responderede. Fix: after-GET + audit-record køres nu som `asyncio.create_task` i baggrunden. HTTP-svaret returneres straks efter PUT+cache-invalidation. Besparelse: ~1 ISE GET-tid (typisk 300-600ms) per save. **Berørt fil:** `backend/app/services/endpoint_service.py`.

- `[fixed 5.6.18 b0466] 2026-05-21 — Dashboard alert "Mange stale cache-entries" er permanent falsk alarm` — Alert-logikken brugte `stale_pct` (entries med age > TTL=60s). Med en 30-min drip-cyklus og SWR-design har ~98% af entries altid age > 60s — det er tilsigtet. Alertet fyrede således permanent efter første fulde drip-rotation, uanset om cache faktisk var sund. Root cause: forkert sammenligningsmetric. Fix: alertet bruger nu `very_stale_pct` (entries med age > TTL × STALE_MAX_FACTOR = 1800s = SWR-vinduesgrænse). Disse entries KAN ikke serves fra cache overhovedet — et højt tal her indikerer at drip ikke følger med. Threshold sænket til 10%. **Berørte filer:** `backend/app/core/alert_store.py`, `backend/app/core/endpoint_cache.py`.

- `[fixed 5.6.17 b0465] 2026-05-21 — Dashboard cache-stat "Disk stale" viser altid 0 i drift` — `disk_stale_entries` tæller kun disk-indlæste entries der *endnu ikke* er refreshet af prewarm. I steady state er denne altid 0 (prewarm har erstattet alle disk-entries med live ISE-data) — dvs. metric'en er aldrig synlig for brugeren. Dashboard viste heller ikke `disk_loaded` (antal indlæst fra disk ved opstart) som er den reelt nyttige metric. Fix: (1) dashboard-API eksponerer `disk_loaded_at_startup` fra prewarm-status; (2) Dashboard frontend viser dette som "Indlæst fra disk ved opstart" og forklarer `disk_stale` med en note om at det er transient. **Berørte filer:** `backend/app/api/dashboard.py`, `frontend/js/views/dashboard.js`.

- `[fixed 5.6.12 build 0459] 2026-05-20 — Operator-profil med admin-rolle kan aldrig logge ind ved TACACS+` — `is_admin_user` tjekkede kun `role == "admin"`, ikke `user_type`. Operator-profiler oprettet med rolle=admin (for at give TACACS-brugere admin-adgang) fik `is_admin_user=True`, som sprang TACACS-stien over og tvang dem til lokal auth — men de har en random password_hash (oprettet i TACACS-mode) og kan aldrig logge ind lokalt. Fix: `is_admin_user` kræver nu også `user_type != "operator"` — ægte lokale admins bypasser stadig TACACS; operator-admins bruger TACACS-stien korrekt. **Berørt fil:** `backend/app/services/user_service.py`.

- `[fixed 5.6.10 build 0457] 2026-05-20 — 6 resterende telemetri-problemer fra to-faset analyse` — Fix af alle lavere-prioritets problemer identificeret i rapportanalysen: (P2) `_reconcile_from_pxgrid` opdaterer nu VLAN/dacl/sgt for eksisterende entries ved reconnect hvis felterne er ændret (fangede VLAN-ændringer i STOMP offline-vindue). (P3+P5) Deduplicering af `_enrich_single_from_mnt` tasks per MAC via `_enrich_in_flight`-sæt med try/finally cleanup — forhindrer parallelle MnT-tasks for samme endpoint. (P4) `load_from_disk` springer sessions over ældre end `pxgrid_session_disk_max_age_s` (default 4 timer) — forhindrer meget stale VLAN-data i startvinduet. (P6) `mnt_stale_reconcile_max_batch` konfigurerbar (default hævet 50→100). (P7) `fetch_session_by_mac` foretrækker nu AuthStatus VLAN (fra RADIUS Accept AV-pair) over Session/MACAddress VLAN — Session/MACAddress kan have stale data ved ISE session-overlap. **Berørte filer:** `backend/app/pxgrid/session_worker.py`, `backend/app/pxgrid/session_cache.py`, `backend/app/main.py`, `backend/app/ise/mnt_sessions.py`.

- `[fixed 5.6.9 build 0456] 2026-05-20 — _enrich_sessions_from_mnt overskrev korrekt pxGrid VLAN med stale MnT-data (5-minutters-cyklus)` — Samme fejlklasse som fix i v5.6.8 (`_enrich_single_from_mnt`), men i den periodiske 5-minutters-enrich-funktion. `_enrich_sessions_from_mnt` brugte `data.get("vlan") or current.vlan` (MnT-prioritet). Hvis en VLAN-ændring sker inden for 5 minutter af næste cyklus-kørsel, returnerer MnT stadig det gamle VLAN og overskriver det korrekte pxGrid-VLAN i cachen. Identificeret via to-faset telemetri-analyse (rapport: `reports/telemetri-analyse-2026-05-20.md`). Fix: `current.vlan or data.get("vlan")` — pxGrid bevares, MnT fylder kun ved tomt felt. **Berørt fil:** `backend/app/pxgrid/session_worker.py`.

- `[fixed 5.6.8 build 0455] 2026-05-20 — Session VLAN ét step bagud ved VLAN-ændring via CoA` — `_enrich_single_from_mnt` kører straks efter STOMP-event (fordi identity_group="" på første session). MnT er ikke opdateret endnu og returnerer det GAMLE VLAN. Koden brugte `data.get("vlan") or current.vlan` (MnT forrang) → overskrev det korrekte pxGrid-VLAN med det stale MnT-VLAN. Symptom: VLAN i session altid ét trin bagud (10 når 32 var sat, 32 når 210 var sat). CoA-sync virkede fordi identity_group='Unknown' (ikke-tom) forhindrede MnT-kald ved efterfølgende events. Fix: `current.vlan or data.get("vlan")` i `_enrich_single_from_mnt` — pxGrid STOMP bevares, MnT fylder kun ved tomt felt. **Berørt fil:** `backend/app/pxgrid/session_worker.py`.

- `[fixed 5.6.7 build 0454] 2026-05-20 — MnT AuthStatus parsedes med ældste session-data i stedet for nyeste` — `fetch_session_by_mac` brugte `_parse_all_xml_fields()` på AuthStatus-svaret som indeholder FLERE `authStatusElements` (nyeste-først). `_parse_all_xml_fields` overdriver med sidst-fundne værdi per tag = den ÆLDSTE records data vinder. Fx VLAN 210 fra en gammel session overskriver VLAN 64 fra den aktuelle session. Fix: ny `_parse_auth_status_elements()` parser hvert element individuelt; `fetch_session_by_mac` itererer elementer i rækkefølge og bruger FØRSTE (nyeste) fund per felt. **Berørt fil:** `backend/app/ise/mnt_sessions.py`.

- `[fixed 5.6.6 build 0453] 2026-05-20 — tunnelPrivateGroupId "(tag=0) 32" parsedes ikke + getSessions ignorerede VLAN fra frisk payload` — Roden til forkert VLAN i session-cache: (1) `_build_session_info` gemte `"(tag=0) 32"` som vlan-string i stedet for at normalisere til `"32"`. (2) getSessions bulk-loading brugte `existing.vlan` (stale fra gammel STOMP-event) og ignorerede `info.vlan` fra frisk ISE-payload på trods af at tunnelPrivateGroupId er med i getSessions-svaret. (3) reconcile_stale_sessions brugte forkert prioritet (existing forrang over MnT) fra v5.6.4-fix der nu reverted for vlan/policy-felter. Fix: `_parse_vlan()` normaliserer `"(tag=0) N"` → `"N"`; getSessions bruger nu `info.vlan or existing.vlan`; reconcile bruger MnT-vlan som primær (RADIUS accounting er mere pålidelig end STOMP-events). **Berørte filer:** `backend/app/pxgrid/session_worker.py`.

- `[fixed 5.6.5 build 0451] 2026-05-20 — STOMP-event arver stale VLAN fra gammel session + MnT real-time enrich overskriver korrekt VLAN` — To bugs: (1) ved ny session (nyt audit_session_id) arvede STOMP-handleren vlan/dacl/sgt fra den gamle session — det forældede VLAN fulgte med ind i ny session. (2) `_enrich_single_from_mnt` brugte MnT-vlan selv om current.vlan var tomt fordi det var ryddet. Fix: (1) `_handle_message_body` detekterer nyt audit_session_id og rydder session-specifikke felter; trigger MnT-berigelse ved tomt vlan. (2) log-output udvides til at inkludere vlan-ændringer. (3) ISE Session-tab i detail-modal viser cache-data + admin Probe MnT-knap til sammenligning. **Berørte filer:** `backend/app/pxgrid/session_worker.py`, `frontend/js/views/browse.js`, `frontend/js/views/browse-detail.js`, `frontend/js/api.js`.

- `[fixed 5.6.4 build 0450] 2026-05-20 — reconcile_stale_sessions overskriver pxGrid VLAN-data med forældet MnT-data` — For endpoints med eksisterende pxGrid real-time session (korrekt VLAN 10) kørte `reconcile_stale_sessions` og erstattede VLAN med det MnT returnerede (VLAN 210 fra en ældre session). Årsag: `_process()` brugte `mnt_data or existing.field` — MnT-prioritet — i stedet for `existing.field or mnt_data` — pxGrid-prioritet. Fix: vendt prioritet for alle felter i `if existing:` grenen: existing (pxGrid) foretrækkes, MnT fylder kun tomme felter. **Berørt fil:** `backend/app/pxgrid/session_worker.py`.

- `[fixed 5.6.2 build 0448] 2026-05-20 — Fritekst-søgning giver 500 Internal Server Error` — `_full_text_filter()` refererede `d.profile` som ikke eksisterer på `EndpointDetail` (`d.profiler_name` er det korrekte felt). Årsag: `AttributeError` der ikke var fanget. Fix: `d.profile` → `d.profiler_name`. **Berørt fil:** `backend/app/services/endpoint_service.py`.

- `[fixed 5.6.2 build 0448] 2026-05-20 — ISE session auth-status opdateres ikke hvis pxGrid push-event droppes` — pxGrid STOMP-forbindelsen kan miste events (WSS timeout, PSN failover, netværksfejl). Endpoints der aldrig modtager et push-event har ingen session-cache entry og ses aldrig som authenticated i Browse. Fix: ny baggrunds-worker `reconcile_stale_sessions` kører hvert 10. min, finder stale endpoint-cache entries, henter session-data fra MnT og opretter/opdaterer session-cache entries. **Berørte filer:** `backend/app/pxgrid/session_worker.py`, `backend/app/main.py`.

- `[fixed 5.6.1 build 0446] 2026-05-20 — Fritekst-søgning (q) virker ikke i Browse` — `enterFilterMode()` returnerede tidligt hvis `state.filterMode` allerede var `true`, selv om `allRowsCache` var ryddet fordi `q` ændrede sig. Ny `q`-søgning hentede aldrig data med det nye søgekriterie. Fix: fjernet `state.filterMode`-check fra early-return guard — funktionen tjekker nu kun `state.loadingAll`. **Berørt fil:** `frontend/js/views/browse-filter.js`.

- `[fixed 5.6.1 build 0446] 2026-05-20 — Dashboard viser 0 sessioner (pxGrid)` — `dashboard.py` læste `sess_stats.get("total", 0)` men `SessionCache.stats()` returnerer nøglen `"size"`, ikke `"total"`. Session-tæller viste altid 0. Fix: `"total"` → `"size"`. **Berørt fil:** `backend/app/api/dashboard.py`.

- `[fixed 5.6.1 build 0446] 2026-05-20 — Stale-cache-alert fyrer straks ved genstart` — `_check_stale_pct()` supprimerer alertet under drip-første-rotation (`drip_refreshed_total < total_endpoints`), men ikke før første scan er kørt (`total_endpoints == 0`). Umiddelbart efter genstart er alle disk-entries stale og `total_endpoints = 0` — betingelsen `total > 0` er false og alertet fyrer. Fix: supprimerer også når `total_endpoints == 0`. **Berørt fil:** `backend/app/core/alert_store.py`.

- `[fixed 5.6.1 build 0446] 2026-05-20 — Historik-tab viser altid "Klik på fanen for at indlæse historik."` — `_lazyLoadHistorik()` hentede `state.detailCurrentId` der kan være null i edge-cases (timing). Fix: tilføjet DOM-fallback: `state.detailCurrentId || container.querySelector("#d-id")?.textContent?.trim()`. **Berørt fil:** `frontend/js/views/browse-detail.js`.

- `[fixed 5.6.1 build 0446] 2026-05-20 — ISE session auth-data opdaterer ikke med MnT-data` — MnT-berigelse kører hvert 5. min i backend og tilføjer `ISEPolicySetName`, VLAN-info osv. til session-cachen. Frontend `pxgridSessionData` opdaterede kun via SSE-events, aldrig via MnT-berigelse. Fix: `setInterval` i browse.js gen-henter `GET /pxgrid/sessions` hvert 5. min og merger beriget data ind i `state.pxgridSessionData`. **Berørt fil:** `frontend/js/views/browse.js`.

- `[fixed 5.5.7 build 0438] 2026-05-19 — Audit-API tilgængeligt for alle brugere (sikkerhedsbrist)` — `GET /api/audit` og `GET /api/audit/{id}` brugte `require_any` — alle loggede brugere (viewer, registrant) kunne søge og læse hele audit-historikken inkl. admin-operationer. Fix: skiftet til `require_admin` på begge endpoints. **Berørt fil:** `backend/app/api/audit.py`.

- `[fixed 5.5.7 build 0438] 2026-05-19 — Logout og circuit-breaker events ikke i audit-log` — Logout-events manglede helt i audit-DB. ISE circuit-breaker OPEN/CLOSED-transitions loggede kun til app.log. Fix: logout auditeres med aktør og auth-type; circuit-breaker OPEN og recovered-to-CLOSED auditeres med fejldetaljer. **Berørte filer:** `backend/app/api/auth.py`, `backend/app/ise/client.py`.

- `[fixed 5.5.5 build 0436] 2026-05-19 — Frontend hænger — kræver Ctrl+Shift+R` — MutationObserver-cleanup i browse.js kørte aldrig ved view-skift fordi `#view-container` aldrig forlader DOM (kun `innerHTML = ""`). Resulterede i akkumulerede zombied EventSource-forbindelser og `setInterval`-timers per browse-besøg. Sekundært: pxGrid reconnect-loop startede nye SSE-forbindelser efter navigation. Tertiært: `fetch()` uden timeout blokerede UI ved langsomme ISE-kald. Fix: (1) cleanup lifecycle i `app.js` — `renderView()` kalder returneret cleanup-funktion før view-skift; (2) `renderBrowse()` returnerer eksplicit cleanup der stopper EventSource, clearer interval og fjerner resize-listener; (3) `viewActive`-guard på pxGrid reconnect-timeout; (4) 30s `AbortSignal.timeout` på alle API-kald. **Berørte filer:** `frontend/js/app.js`, `frontend/js/views/browse.js`, `frontend/js/api.js`.

- `[fixed 5.5.5] 2026-05-19 — Cache "for gammel" efter 10 min — browse re-fetcher alle endpoints fra ISE` — `STALE_MAX_FACTOR = 10` × `cache_ttl_seconds = 60s` = 600s "too stale"-grænse. Pre-warm kører hvert 1800s. I vinduet 600s–1800s er cachen ikke servérbar → hvert browse-kald henter alle endpoints synkront fra ISE. Fix: `STALE_MAX_FACTOR` hævet til `30` (30×60=1800s matcher pre-warm-interval). **Berørt fil:** `backend/app/core/endpoint_cache.py`.

---

- `[fixed 5.5.2 build 0424] 2026-05-18 — Simulator viser kun én RADIUS-parameter selv om politikken bruger flere` — RADIUS-parametersektionen i endpoint-detail / simulatoren vises kun *efter* simulation og kun med de attributter politikken rapporterer som `radius_attrs_needed`. Der er ingen mulighed for proaktivt at tilføje flere RADIUS-parametre eller fjerne/redigere dem — UI'et genstarter parametre ved hvert kald. Fix: ny dynamisk add/remove RADIUS-sektion der altid er synlig; bruger kan tilføje/fjerne vilkårlige RADIUS-nøgle/værdi-par; manglende `radius_attrs_needed` merges ind automatisk efter simulation uden at nulstille eksisterende værdier. **Berørte filer:** `frontend/js/views/browse-detail.js`, `frontend/css/styles.css`.

---

## Fixed

- `[fixed 5.5.1 build 0422] 2026-05-18 — NAS-scan skjulte device-typer der normaliserede til kendte platforme (f.eks. "Airespace-WLC" → "airos")` — Scan normaliserede ISE NDG-paths til kanoniske typer og grupperede dem under `raw = "airos"`. Enheder som "Airespace-WLC" var usynlige for brugere der ikke allerede havde en "airos"-mapping-række. Fix: scanneren normaliserer ikke længere — alle unikke NDG-paths præsenteres rå. Brugeren mapper selv "Airespace-WLC" → "airos". Normalisering (`normalize()`) er bevaret i MnT session-sync men fjernet fra scan-presentationslaget. **Berørte filer:** `backend/app/api/custom_attributes.py`, `backend/app/core/platform_types.py`.

- `[fixed 5.5.1 build 0421] 2026-05-18 — "Use dev branch"-checkbox gemte ikke github_branch — Update-check viste altid main` — Frontend sendte `github_branch: "dev"` i PUT `/api/settings/backend`, men `BackendSettingsUpdate`-schema kendte ikke feltet → Pydantic droppede det stille. `update_backend_settings()` inkluderede det aldrig i `overrides`-dict → `config.json` fik aldrig `github_branch` → `_github_branch()` returnerede altid `"main"` → GitHub-check hentede altid fra `main`. Fix: `github_branch` tilføjet til `BackendSettingsUpdate`, `BackendSettingsResponse`, `get_backend_settings()` og `update_backend_settings()`. **Berørte filer:** `backend/app/schemas/settings.py`, `backend/app/services/settings_service.py`.

- `[fixed 5.5.1 build 0420] 2026-05-18 — NAS-scan viste fortsat en manglende NAS-type; "All Device Types" forurener unmatched` — (1) Device der fejler under detail-fetch i `_load_all()` forsvandt lydløst fordi undtagelse kun loggedes som DEBUG og intet fallback-entry blev tilføjet til `_all_devices`. Fix: bevar name fra liste (step 1), log som WARNING og indsæt `DeviceInfo(name)` fallback. (2) Devices med NDG "All Device Types" (ingen specifik type, `path=""`) dukkede op som unmatched i mapping-editoren. Fix: `elif path:` i `get_nas_devices_by_platform` sikrer at devices uden NDG-path udelukkes fra unmatched. **Berørte filer:** `backend/app/ise/network_devices.py`, `backend/app/api/custom_attributes.py`.

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
