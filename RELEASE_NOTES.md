# HyperVision ISE Portal — Release Notes

Release notes viser hvad der er nyt i hver version. Opdateres ved hver main-release.

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
