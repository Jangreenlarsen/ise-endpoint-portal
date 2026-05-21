# HyperVision ISE Portal — Release Notes

Release notes viser hvad der er nyt i hver version. Opdateres ved hver main-release.

---

## [5.6.18] — 2026-05-21 — Bug fix release

### Dashboard: falsk "Mange stale cache-entries"-advarsel fjernet

**Advarslen om stale cache-entries vises ikke længere i normal drift.** Den forkerte alert skyldtes at logikken sammenlignede cache-alder mod TTL (60 sekunder). Med en 30-minutters drip-refresh-cyklus og stale-while-revalidate-design har ~98% af endpoints altid en alder over 60 sekunder — det er tilsigtet og ufarligt. Alertet fandt aldrig ro og var en permanent falsk alarm.

Alertet trigges nu kun hvis entries er **ældre end det maksimale SWR-vindue** (30 minutter) — altså entries der slet ikke kan serves fra cachen. Det indikerer at drip-refresh ikke følger med belastningen, og er en reel advarsel.

---

## [5.6.17] — 2026-05-21 — Bug fix release

### Dashboard: cache disk-statistik viser nu meningsfulde data

**Dashboard viser nu "Indlæst fra disk ved opstart" i stedet for den ubrugelige "Disk stale"-metric.** `disk_stale` tæller kun disk-indlæste entries der *endnu ikke* er refreshet af prewarm — en transient tilstand der forsvinder inden for få minutter efter opstart. I drift er den altid 0, hvilket gav det fejlagtige indtryk at disk-persistens ikke virkede.

Nu vises i stedet:
- **Indlæst fra disk ved opstart**: Antal endpoints der blev genoprettet fra `endpoints.json` ved seneste opstart (fx 1.843). Et tal over 0 bekræfter at disk-persistens fungerer.
- **Disk stale (nu)**: Forklarende tekst — "0 ✓ (alle entries er live ISE-data)" i normal drift, eller antal med note om prewarm-refresh i startup-vinduet.

---

## [5.6.15] — 2026-05-20 — Forbedring

### Simulate: Auto-mode tester alle policy sets fra rank 0

**Simulate starter nu automatisk fra rank 0 af alle policy sets.** Tidligere skulle du manuelt vælge det rigtige policy set i dropdown'en — hvis RADIUS-parametrene ændrede hvilket policy set der ville matche, fik du et forkert svar. Nu er der en "Auto — test alle policy sets (fra rank 0)"-option som er default. Simulatoren gennemgår alle sets i rækkefølge og stopper ved det første match — præcis som ISE gør det ved en rigtig RADIUS-request.

**Indlæsning af en RADIUS-template skifter automatisk til Auto-mode.** Så du ikke utilsigtet tester mod et forkert policy set.

**Resultatet viser nu hvilket policy set der matchede** — praktisk i miljøer med mange sets.

---

## [5.6.14] — 2026-05-20 — Ny funktion + bug fix

### RADIUS-parametre kan gemmes som navngivne templates

**Du kan nu gemme et sæt RADIUS-parametre som en template og genindlæse det i fremtidige simulate-test.** I simulate-fanen finder du en ny template-bar under RADIUS-sektionen. Eksempel: gem `Called-Station-ID: voldby17:hus` og `NAS-Port-Type: 8` som "Wireless SSID voldby17" og indlæs det med ét klik næste gang. Du kan gemme så mange templates du ønsker, sorteret alfabetisk. Templates gemmes lokalt i browseren og er tilgængelige på tværs af alle endpoint-tests.

### Fix: GitHub update-check viste altid gammel version

**"Check for update"-knappen returnerer nu altid den rigtige seneste version fra GitHub.** Knappen hentede version.json via GitHub's CDN som ignorerer Cache-Control-headers fra klienter — resultatet var at portalen could vise en forældet version som "nyeste" selv sekunder efter et push. Rettet ved at tilføje et unikt timestamp som query-parameter der tvinger CDN'en til at hente frisk indhold.

---

## [5.6.13] — 2026-05-20 — Forbedring

### Policy match: AND/OR-betingelser vises som i ISE's policy-editor

**Simulate match-resultatet viser nu politikkens betingelsestræ med farvekodede AND/OR-blokke** — samme stil som ISE's policy-editor. Tidligere var alle betingelser listet fladt uden struktur.

- **Blå AND-blok**: globale betingelser der alle skal opfyldes
- **Grøn OR-blok**: alternative grene — kun én skal matche
- Kombinerede politikker (AND + OR) vises indlejret korrekt
- Hvert betingelse viser `Ordbog.Attribut`-notation med farvedifferentieret tekst
- Matchede OR-grene fremhæves med grøn kant, fejlede med rød kant

---

## [5.6.12] — 2026-05-20 — Bug fix release

### TACACS+: operatørprofil med admin-rolle kunne ikke logge ind

**Brugere med en operatørprofil der har admin-rollen kan nu logge ind korrekt via TACACS+.** Tidligere fik disse brugere altid 401 — portalen fejlfortolkede dem som lokale admins og sprang TACACS-autentiseringen over, hvorefter den lokale adgangskodekontrol fejlede fordi operatørprofiler ikke har en lokal adgangskode. Rettet ved at skelne korrekt mellem lokale admins og TACACS-operatørprofiler med admin-rolle.

---

## [5.6.11] — 2026-05-20 — Ny funktion

### Systemlog vises direkte i Dashboard (kun admin)

**Administratorer kan nu se backend-loggen direkte i Dashboard** uden at skulle ssh'e ind på serveren. Systemlog-sektionen viser de seneste log-linjer med farvekodet niveau-badge (DEBUG, INFO, WARNING, ERROR, CRITICAL). Funktioner:

- **Niveau-filter**: WARNING og derover, ERROR og derover, alt, osv. — filtrering er korrekt inklusiv ("WARNING+" inkluderer WARNING, ERROR og CRITICAL)
- **Antal linjer**: vælg 50, 100 eller 200 linjer
- **Fritekst-søgning**: filtrer direkte i log-output
- **Auto-refresh**: opdateres hvert 30 sekunder med resten af dashboard
- Sektionen er usynlig for ikke-admin-brugere

---

## [5.6.10] — 2026-05-20 — Bug fix release

### 6 telemetri-fejl rettet (analyse-opfølgning)

Opfølgning på to-faset telemetri-analyse der kortlagde alle datakilder og fejlmønstre i session-cachen.

**VLAN-prioritet i periodisk MnT-berigelse**: Den 5-minutters MnT-opdatering kunne overskrive korrekte pxGrid-VLAN-data med forældede MnT-data — samme fejlmønster som i v5.6.9 men i en anden funktion. Rettet.

**Deduplicering af samtidige MnT-kald**: Hvis flere pxGrid-events ankom til samme endpoint tæt på hinanden, startede portalen parallelle MnT-kald for samme MAC — dette kunne føre til race conditions. MnT-kald dedupliceres nu per MAC.

**Forældet session-cache ved opstart**: Sessions der var meget gamle (over 4 timer) blev ved opstart genindlæst fra disk og betragtet som aktive. Disse hoppes nu over.

**Begrænset MnT-reconcile ved opstart**: Reconcile-workeren kunne ved opstart forsøge at berige hundredvis af endpoints på én gang. Batchen er nu begrænset til 100 per kørsel.

**VLAN-kilde i MnT-parser**: MnT returnerer VLAN to steder — portalen bruger nu AuthStatus AV-pair som primær kilde (tættere på hvad ISE faktisk assignede) frem for Session/MACAddress-feltet.

---

## [5.6.9] — 2026-05-20 — Bug fix release

### ISE Session: periodisk MnT-berigelse overskrev korrekt VLAN

**Den periodiske session-berigelse (hvert 5. minut) overskriver ikke længere korrekte VLAN-data.** Portalen henter session-data fra både pxGrid (real-time) og MnT (periodisk). MnT-berigelsen prioriterede fejlagtigt MnT-VLANet frem for det allerede kendte pxGrid-VLAN — selv om pxGrid-data altid er nyere og mere præcis. Rettet: eksisterende VLAN fra cachen bevares, og MnT bruges kun til at fylde felter der er tomme.

---

## [5.6.8] — 2026-05-20 — Bug fix release

### ISE Session VLAN: altid ét trin bagud ved VLAN-ændring

**Session-kolonnen viser nu korrekt VLAN med det samme efter en VLAN-ændring.** Tidligere viste portalen altid det *forrige* VLAN — fx VLAN 10 efter at have sat 32, og 32 efter at have sat 210. Årsag: MnT-berigelsen kørte straks efter pxGrid-eventet (mens MnT stadig havde det gamle VLAN) og overskrev det korrekte pxGrid-VLAN med det forældede MnT-VLAN. Symptom på at problemet var indkapslet: at sende en CoA *uden* at ændre VLAN "syncede" portalen, fordi efterfølgende events ikke triggede MnT-kaldet igen. Fix: `_enrich_single_from_mnt` bevarer nu pxGrid STOMP-VLANet og bruger kun MnT til at fylde tomme felter.

---

## [5.6.7] — 2026-05-20 — Bug fix release

### ISE Session VLAN: MnT returnerede data fra gammel session

**VLAN fra MnT henter nu altid den nyeste sessions data.** ISE MnT AuthStatus-API returnerer flere autentiseringsposter per MAC (sorteret nyeste-først). Portalen parsede fejlagtigt alle poster samlet og endte med den ældste records VLAN-data — fx VLAN 210 fra en session fra i forgårs, mens den aktuelle session (samme audit_session_id som pxGrid) gav VLAN 64. Fix: portalen itererer nu posterne i rækkefølge og bruger det første (nyeste) fund per felt.

---

## [5.6.6] — 2026-05-20 — Bug fix release

### ISE Session VLAN: forkert værdi på visse endpoints

**VLAN i ISE Session Auth-kolonnen viser nu korrekt VLAN for alle endpoints.** Et subset af endpoints viste forkert VLAN (fx 10 i stedet for 32). Root cause: ISE sender VLAN i pxGrid som `tunnelPrivateGroupId: "(tag=0) 32"` — portalen parsede ikke præfikset korrekt og gemte hele strengen. Derudover brugte getSessions-opdateringen stale VLAN fra den gamle cache i stedet for den friske pxGrid-payload. Begge fejl rettet: `_parse_vlan()` normaliserer ISE-formatet til rent tal; getSessions bruger nu VLAN direkte fra ISE-svaret.

---

## [5.6.5] — 2026-05-20 — Bug fix release

### ISE Session: stale VLAN ryddes ved re-autentisering + ny debug-tab

**VLAN i ISE Session Auth-kolonnen er nu korrekt ved re-autentisering.** Når et endpoint skiftede VLAN (re-auth til ny policy), blev det gamle VLAN-nummer arvet fra den forrige session og viste forkert data — fx VLAN 210 mens endpoint faktisk var på VLAN 10. Årsag: STOMP-event-handleren arvede `vlan`/`dacl`/`cts_security_group` fra cachen uden at tjekke om det var en ny session (nyt audit_session_id). Fix: ved nyt audit_session_id ryddes session-specifikke felter, og MnT-berigelse trigges straks for at hente friske data.

**Ny "ISE Session"-fane i endpoint-detaljer.** Viser alle felter fra session-cachen (hvad frontend aktuelt ser). Admin-knap "Probe MnT" kalder ISE MnT direkte og sammenligner cache vs. live MnT — VLAN-mismatch fremhæves i orange.

---

## [5.6.4] — 2026-05-20 — Bug fix release

### ISE session auth: MnT-reconcile overskriver ikke korrekt VLAN-data

**Reconcile-workeren kan ikke længere overskrive pxGrid real-time session data med forældet MnT-data.** Endpoints med en aktiv pxGrid-session (fx VLAN 10) kunne fejlagtigt vise VLAN fra en ældre MnT-session (fx VLAN 210) fordi reconcile-workeren prioriterede MnT-data over eksisterende pxGrid-data. Workeren bruger nu korrekt prioritet: eksisterende pxGrid-felter bevares altid — MnT fylder kun felter der er tomme.

---

## [5.6.3] — 2026-05-20 — Forbedring

### Endpoint historik: sigende handlingstekst

**Historik-fanen i endpoint-detaljer viser nu præcis hvad der ændrede sig.** Tidligere stod der blot "updated" for alle ændringer. Nu vises de konkrete felter og nye værdier — fx `VLAN:10`, `Gruppe:Unknown` eller `Owner:adm, Type:PC`. Maks 32 tegn på én linje; hvis mange felter ændres vises de vigtigste kommasepareret og teksten trunkeres med "…".

---

## [5.6.2] — 2026-05-20 — Bug fix release

### 2 fejl rettet

**Fritekst-søgning fejlede med 500 Internal Server Error.** Søgning i fritekstfeltet i Browse udløste en intern Python-fejl (`AttributeError: 'EndpointDetail' object has no attribute 'profile'`). Rettet: det korrekte felt `profiler_name` bruges nu.

**ISE session auth-status opdaterer ikke endpoints der har misset pxGrid push-events.** Hvis et pxGrid STOMP push-event droppede (WSS timeout, PSN failover, netværksfejl) forblev endpointets auth-status aldrig opdateret i Browse-kolonnen. Ny baggrunds-worker `reconcile_stale_sessions` kører hvert 10. minut: den finder endpoints der er stale i cachen, henter friske session-data fra MnT, og opretter eller opdaterer session-cache entries — selv for endpoints der aldrig har modtaget et push-event.

---

## [5.6.1] — 2026-05-20 — Bug fix release

### 5 fejl rettet fra v5.6.0

**Fritekst-søgning (q) i Browse virker nu korrekt.** Søgefeltet i Browse-filterlinjen hentede ikke nye resultater når søgeteksten blev ændret mens filtertilstand allerede var aktiv. Resultatet var at portalen blev ved med at vise det første søgeresultat uanset hvad man søgte på efterfølgende. Rettet.

**Endpoint historik-tab indlæser nu korrekt.** Fanen "Historik" i endpoint detail-modalen viste altid "Klik på fanen for at indlæse historik." og hentede aldrig audit-events. Årsag var en timing-race hvor fanen læste et tomt ID. Rettet med DOM-fallback.

**ISE session auth-data viser nu MnT-beriget information.** Policy-sæt-navn, autorisationsregel og VLAN fra MnT-berigelse (kører hvert 5. min i baggrunden) vises nu korrekt i Browse. Tidligere lå MnT-data kun i backend-cachen uden at nå frontend. Rettet: frontend gen-henter session-data fra backend hvert 5. minut.

**Dashboard viser nu korrekt antal aktive pxGrid-sessioner.** Session-tælleren viste altid 0 pga. en forkert dict-nøgle. Rettet.

**Stale cache-advarsel vises ikke længere straks ved genstart.** Advarslen "Mange stale cache-entries" fyrede tidligere øjeblikkeligt efter genstart (alle disk-entries er per definition stale) og forblev aktiv i lang tid. Advarslen undertrykkes nu til drip-refresh har gennemført sin første fulde rotation — typisk 30 minutter.

---

## [5.5.9] — 2026-05-19 — Patch 1

### Endpoint-cache: kontinuerlig baggrundsopdatering

**Alle endpoints opdateres nu automatisk i baggrunden** — uden at brugeren skal åbne Browse-siden. Tidligere blev cache kun opdateret ved bruger-interaktion (browse, edit) eller ved den periodiske fulde scan hvert 30. minut. Det betød at endpoints der ikke var besøgt i et stykke tid, altid udløste en synkron ISE-forespørgsel ved næste åbning.

Den nye drip-refresh-mekanisme fungerer som et kontinuerligt baggrundstjek: portalen finder løbende det endpoint der har den ældste cachepost og opdaterer det fra ISE. Opdateringerne spredes jævnt over hele 30-minutters-intervallet (fx ~1,8s pr. endpoint ved 1000 endpoints) — ingen burst-belastning på ISE og ingen "kold cache" ved skift til Browse.

---

## [5.5.8] — 2026-05-19 — Patch 1

### Detail-modal: loading-besked rykker ikke længere layout

**Informationsbeskeder i endpoint detail-modal skubber ikke længere indholdet.** Tidligere sad loading/gem/fejl-beskeden i flex-flowet, så tab-baren og alle detaljer rykkede op og ned når beskeden dukkede op eller forsvandt. Beskeden er nu `position: absolute` og overlayer indholdet øverst — tab-baren forbliver stationær.

---

## [5.5.7] — 2026-05-19 — Patch 1

### Sikkerhed og audit-dækning

**Audit-log er nu kun tilgængeligt for admins.** Tidligere kunne alle loggede brugere (viewer, registrant m.fl.) søge og læse hele audit-historikken inkl. admin-operationer og settings-ændringer. Rettet: `GET /api/audit` kræver nu admin-rolle.

**Logout registreres nu i audit-loggen.** Hvert logout med et gyldigt token opretter en `logout`-record med brugernavn og auth-type (lokal/TACACS+).

**ISE connection-fejl registreres nu i audit-loggen.** Når ISE-circuit-breakeren tripper til OPEN (efter gentagne forbindelsesfejl) oprettes en `ise_circuit_open`-record med fejldetaljer. Når ISE er tilgængeligt igen oprettes en `ise_circuit_closed`-record.

---

## [5.5.6] — 2026-05-19 — Patch 1

### Stabilitet og ydeevne

**Frontend hænger ikke længere ved navigation.** Browseren krævede tidligere Ctrl+Shift+R efter at have navigeret væk fra Browse-siden. Årsagen var at EventSource (pxGrid SSE-stream) og badge-timeren aldrig blev lukket korrekt ved view-skift — de akkumulerede som zombied forbindelser for hvert Browse-besøg. Alle views cleaner nu op via en lifecycle-funktion der køres automatisk ved navigation.

**API-kald har nu 30 sekunders timeout.** Langsomme ISE-kald kan ikke længere blokere UI'en ubestemt — de afbrydes og giver en fejlbesked i stedet.

**Endpoint-cache holder nu i 30 minutter.** En fejl i cache-konfigurationen betød at cachen blev "for gammel" allerede efter 10 minutter og alle endpoints blev re-hentet fra ISE synkront — det lignede en manuel refresh. Cachen matcher nu korrekt pre-warm-intervallet på 30 minutter.

---

## [5.5.5] — 2026-05-19 — Security Patch 1

### Sikkerhedsforbedringer

**PSK-nøglegenerator** bruger nu kryptografisk sikker tilfældighedsgenerator (`secrets`-modulet) i stedet for Mersenne Twister (`random`). Genererede PSK-nøgler er ikke længere forudsigelige.

**ISE TLS-verifikation** er nu slået **til som standard** på nye installationer. Portalen validerer ISE-serverens certifikat ved al kommunikation. Eksisterende installationer med selvsigneret ISE-certifikat skal sætte `ise_ca_bundle` i Settings → ISE Connection.

**Audit-log** dækker nu alle kritiske update-operationer: GitHub git pull, ZIP-pakke apply og server-genstart registreres i audit-loggen med aktør og resultat.

**Første admin-oprettelse** logges nu i audit-DB, så bootstrap-aktiviteten er sporbar.

**TACACS+ auto-admin bootstrap** registreres nu i audit-DB (`tacacs_auto_admin_bootstrap`) når en TACACS+-bruger automatisk tildeles admin-rollen fordi ingen operatørprofiler er konfigureret.

**ZIP-pakke beskyttelse:** Uploadede opdateringspakker tjekkes nu for ukomprimeret størrelse (max 500 MB) for at forhindre ZIP-bomb-angreb.

**Operatørprofiler** sættes nu til `chmod 0o600` på Unix-systemer ved skrivning — konsistent med øvrige konfigurationsfiler.

---

## [5.5.4] — 2026-05-19

### TACACS+ Auto-Admin Bootstrap

**Automatisk admin-adgang** tildeles den første TACACS+-bruger der logger ind, hvis ingen operatørprofiler er konfigureret i portalen. Dette muliggør første login uden manuel filoprettelse — TACACS+-serveren er autorisationskilde. Når én operatørprofil er oprettet, kræver alle efterfølgende TACACS+-brugere en matchende profil.

### Rettelser

**TACACS+ login** fejlede med HTTP 500 i bootstrap-tilstanden fordi kode forsøgte at kalde `.get()` på `None`. Rettet.

---

## [5.5.3] — 2026-05-19

### PxGrid-opsætning — forbedret vejledning og workflow

**Cert-mode dropdown** er nu visuelt tydelig med en chevron-pil på alle form-dropdowns i portalen.

**Extra SAN-felt** er opdateret med tydelig tekst: portalens FQDN *skal* inkluderes her for at TLS-validering virker korrekt. pxGrid 2.0 / RFC 6125 validerer server-certifikatet mod det hostnavn klienten forbinder til — hvis portalens FQDN afviger fra node-name, fejler forbindelsen.

**Trin 5 — Opret pxGrid-konto** kører nu automatisk en test-forbindelse efter registrering, hvis ISE returnerer kontoen i `INIT`-tilstand. Det første autentificerede forbindelsesforsøg fra klienten er nødvendigt for at ISE kan flytte kontoen til `PENDING`, hvorefter ISE-admin kan approve den under Administration → pxGrid Services → Clients.

**Phase 2b (STOMP-worker)** er nu slået **fra som standard**. Workeren skal eksplicit aktiveres af admin efter vellykket pxGrid-opsætning og admin-approval.

**Test-forbindelsesstatus** vises nu direkte under trin 5-knappen — ingen scroll nødvendig for at se resultatet.

---

## [5.5.2] — 2026-05-18

### Endpoint-simulator — RADIUS-attributter

**Dynamisk RADIUS-parameter UI:** Simulatoren viser nu en permanent tilføj/fjern-grænseflade til RADIUS-attributter. Tilføj så mange attributter du har brug for med ✕-fjern, og autocomplete foreslår 10 almindelige RADIUS-attributnavne (`Called-Station-ID`, `NAS-IP-Address`, `Service-Type` m.fl.).

**Duplikat-nøgle advarsel:** Forsøg på at simulere med to attributter af samme nøgle (fx to `Called-Station-ID`-rækker) blokeres med en tydelig advarsel. En RADIUS-pakke har én enkelt værdi per attribut — ønsker du at matche flere substrings skal de kombineres i én samlet værdi.

---

## [5.5.1] — 2026-05-18

### Rettelser

**NAS-scan** viser nu alle device-typer fra ISE NDG direkte og rå — ingen intern normalisering i præsentationslaget. Enheder med specielle typer (fx `Airespace-WLC`, `Airspace-WLC`) er nu synlige og præsenteres som forslag i mapping-editoren. Devices uden IP-adresse og devices der fejler under detail-hentning vises nu også.

**GitHub-opdatering — branch-valg** gemmes nu korrekt. `github_branch`-feltet manglede i Pydantic-schemas og service-laget, så "Brug dev-branch"-checkbox ændrede intet. Opdateringscheck henter nu fra den korrekte branch.

**Git pull** bruger nu `FETCH_HEAD` i stedet for `origin/{branch}` som reference. Løser fejl på servere med ikke-standard remote-tracking opsætning (typisk Debian-servere der kun følger `main`).

---

## [5.5.0] — 2026-05-17 — Første release

### Endpoint Browse & Redigering

Hoved-arbejdsflade for endpoint-administration. Viser alle ISE-endpoints i en søgbar, filtré rbar og sorterbar tabel med live opdatering.

- **Filtrering** per kolonne med regex-søgning, dropdown-filter og datointerval
- **Auth-status kolonne** — sortérbar kolonne med grøn/rød indikator der viser om et endpoint har aktiv RADIUS-session, med filter (Alle / Auth / Ikke auth)
- **Inline redigering** via detail-modal med tre faner: *Endpoint* (gruppe, custom attributes, ANC), *RADIUS* (policy-simulering), *Profil & IDs* (ISE-profileringsdata og profilerprofile)
- **Bulk-operationer** — markér flere endpoints og skift gruppe eller attributter i ét hug
- **Kolonne-synlighed** — slå kolonner til/fra og gem valget
- **Saved views** — gem filterkombinationer til genbrug

### ISE pxGrid — Real-time session data

Portal kan forbindes til ISE pxGrid (port 8910) via mTLS for at modtage RADIUS-session events i realtid i stedet for periodisk MnT-polling.

- **Phase 1:** Certifikat-opsætning — upload tre PEM-filer eller generer CSR direkte i portalen (5-trins flow med ISE Internal CA eller MS certsrv)
- **Phase 2b:** Persistent STOMP-worker der abonnerer på session-events og opdaterer Browse-tabellen live via Server-Sent Events
- **ISE Session-kolonne** viser auth-metode, authz-profiler og identity group direkte i tabellen

### Politik-administration

Vis og redigér ISE endpoint authorization policy sets og regler direkte fra portalen.

- **Grafisk regelvisning** med rank-badges, betingelses-chips og sammenklappelig regeliste
- **Inline redigering** med rekursiv AND/OR gruppe-editor der bevarer ISE's betingelses-nesting fuldt ud
- **Simuler policy-match** for et specifikt endpoint — se hvilken regel og authz-profil ISE ville matche, inkl. RADIUS-condition evaluering med valgfrie RADIUS-parametre

### NAS Platform Management

Kortlæg ISE network device-typer til platform-kategorier (Aruba, Cisco WLC, UniFi m.fl.).

- **NAS-scan** henter alle network devices fra ISE og viser typer rå fra NDG — grupperede (allerede mappet) og ikke-mappede (vises som forslag)
- **Mapping-editor** til at tilknytte ISE device-type-paths til platform-labels der bruges i custom attributes og profiler

### TACACS+ Autentisering

Portal-brugere kan autentiseres via ekstern TACACS+-server.

- Rolle (`portal-role`) og operatørprofil (`portal-operator-profile`) sættes via TACACS+-attributter
- Fallback til lokal autentisering ved TACACS+-nedbrud (konfigurerbart)
- **Operatørprofil-katalog** — definer standard-rolle og endpoint-roller per profil

### Endpoint Registrering & Import

- **Registrér** nye endpoints enkeltvis med gruppe, custom attributes og valgfri skabelon
- **Importer** endpoints fra CSV med fleksibel kolonne-mapping til ISE-attributter

### Endpoint Attributter & DACL'er

- Administrér custom attribut-definitioner direkte fra portalen (tilføj, redigér, slet)
- Vis og administrér ISE DACL'er (Downloadable ACL'er) med indhold

### Autentisering & Sikkerhed

- Lokal brugeradministration med roller (admin, bruger) og password-styrke-validering
- Token-baseret autentisering (1 time TTL) med silent refresh hvert minut
- Rate limiting og bruger-lockout ved gentagne fejl-login (5 fejl → 15 min lockout)
- Security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- Login-audit log (success og failed events)
- AGPL v3 open source

### Portal-administration

- **Tema:** Light, Dark, Midnight — gemmes per bruger
- **Lokalisering:** Dansk og Engelsk per bruger (skifter øjeblikkeligt uden reload)
- **GitHub-opdatering:** Tjek og hent seneste version direkte fra portalen via git pull — vælg mellem `main` (stabil) og `dev` (udviklingsversion)
- **OVA-distribution:** Installer direkte som VMware/ESXi-image med interaktiv first-boot wizard (hostname, IP, gateway, DNS, root-password, auto-install)
- **Install-script:** `curl -fsSL .../install.sh | bash` på fresh Debian/Ubuntu

---
