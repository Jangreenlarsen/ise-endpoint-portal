# HyperVision ISE Portal — Release Notes

Release notes viser hvad der er nyt i hver version. Opdateres ved hver main-release.

---

## [6.10.0677] — 2026-06-14 — Funktionsgennemgang: to-faset portal-audit

> **Build:** 0677

Ny sektion under **Indstillinger → System Opdatering: Funktionsgennemgang** giver en struktureret to-faset gennemgang af alle portal-funktioner.

**Fase 1 — Statisk (< 1 sekund, ingen netværk):**
- ISE URL, brugernavn og adgangskode konfigureret
- GitHub OTA-branch og .git-mappe tilgængelig
- Databaser: audit.db, lockout.db, cache/first_seen.db, cache/guest_expiry.db, metrics_history.db
- Log-mappe (backend/logs/app.log)
- pxGrid-certifikater (hvis pxGrid aktiveret)
- Custom attributes JSON-store

**Fase 2 — Live ISE-test (5-15 sekunder):**
- ERS: kan vi liste endpoints? (total count)
- ERS: kan vi hente endpoint-grupper?
- ERS: er custom attributes defineret i ISE — inkl. HypervisionISEPortal?
- MnT: kan vi query aktive sessioner? (kræver MnT Admin-rolle)
- OpenAPI: er `/api/v1/endpoint/count` tilgængeligt?
- nmap: localhost ping-scan som funktionstest
- GitHub: kan vi nå GitHub og hente seneste version?
- Cache: er endpoint-cache opvarmet?
- pxGrid: live forbindelsesstatus (hvis aktiveret)

Resultater vises med ✅/⚠️/❌ pr. tjek med detaljerede metadata. Fase 2-knappen aktiveres først efter Fase 1 er kørt.

## [6.9.0675] — 2026-06-14 — System sundhed på dashboard

> **Build:** 0675

Dashboardet viser nu et **System sundhed**-kort i højre kolonne — opdateres automatisk hvert 30 sekund.

Kortet viser status for 7 hurtige tjek: HTTP/2, nmap, disk plads, ISE konfiguration, endpoint cache, circuit breaker og pxGrid. Den farvede topkant signalerer det samlede niveau: grøn (alt OK), orange (advarsler) eller rød (fejl).

Admin-brugere har et "Fuld diagnostik →"-link til den detaljerede visning i Indstillinger.

## [6.8.0669] — 2026-06-14 — OTA-opdatering: pre-flight tjek + auto-genstart

> **Build:** 0669

**Forhindrer crash-loop efter OTA-opdatering.**

Tidligere: pull → pip install → bruger klikker manuelt "Genstart server" → server crasher hvis ny kode har fejl → crash-loop.

Nu: pull → pip install → **pre-flight tjek** → auto-genstart (hvis tjek OK) / ingen genstart (hvis tjek fejler).

**Pre-flight tjek:** Kører `python -c "from app.main import app"` som subprocess med det aktive venv. Verificerer at den nye kode på disk kan importeres uden syntax- eller import-fejl.

**Auto-genstart:** Hvis pull + pip + pre-flight alle lykkes genstarter serveren automatisk efter 3 sekunder — ingen manuel knap nødvendig. Browseren poller og viser "Server er oppe igen ✅ — Genindlæs siden".

**Sikkerhed:** Hvis pre-flight fejler (f.eks. ny modul mangler eller syntax-fejl) sker der ingen genstart. Fejlen vises tydeligt i UI'et så problemet kan løses før genstart.

## [6.8.0668] — 2026-06-14 — Systemdiagnostik

> **Build:** 0668

Ny funktion i Indstillinger → Performance: **Systemdiagnostik**. Klik "Kør diagnostik" og få et komplet sundhedstjek af alle afhængigheder og tjenester på ét sekund.

**12 tjek køres parallelt:**

- Python version (kræver 3.11+) og virtuel miljø (venv)
- Alle 12 påkrævede Python-pakker (fastapi, uvicorn, httpx, pydantic, cryptography m.fl.)
- HTTP/2 h2-pakke installeret og aktiv
- nmap tilgængelig i PATH (bruges til nmap-scanning)
- Disk plads med advarsler under 2 GB fri
- ISE konfiguration (URL, brugernavn, adgangskode konfigureret)
- ISE ERS-forbindelsestest med latens (live GET mod ISE med 10 s timeout)
- Endpoint cache (antal endpoints i memory-cache)
- Circuit breaker state (closed/half-open/open)
- pxGrid worker (connected/running/stopped)
- Git branch og seneste commit

Resultater vises som tabel med ✅ OK / ⚠️ Advarsel / ❌ Fejl og et samlet status-banner øverst.

## [6.7.0667] — 2026-06-14 — h2 installeres automatisk i baggrunden ved opstart

> **Build:** 0667

Portalen installerer nu selv `h2`-pakken i baggrunden hvis den mangler ved opstart.

**Komplet flow fra gammel OVA uden manuel SSH:**

1. OTA Pull — ny kode hentes (portalen kører stadig med gammel kode i hukommelsen)
2. Genstart — ny kode starter, h2 mangler → HTTP/1.1 (graceful), baggrunds-install starter
3. Vent ~10 sekunder til loggen viser `h2 installeret OK`
4. Genstart igen (`pkill -f uvicorn`) — HTTP/2 aktiv

**Fra ny OVA med latest kode:**

1. Portal starter → h2 mangler → baggrunds-install starter automatisk
2. Genstart efter ~10 sekunder → HTTP/2 aktiv

Loggen viser installationsforløbet:
```
h2-pakken mangler — installerer httpx[http2] i baggrunden. HTTP/2 aktiveres ved næste genstart.
h2 installeret OK — genstart portalen (pkill -f uvicorn) for at aktivere HTTP/2.
```

---

## [6.7.0666] — 2026-06-14 — Fix: HTTP/2 falder tilbage til HTTP/1.1 ved manglende h2-pakke

> **Build:** 0666

På friske OVA-installs er `h2`-pakken ikke installeret. Tidligere crashede
portalen ved opstart fordi `httpx.AsyncClient(http2=True)` kastede `ImportError`.

Portalen starter nu korrekt og kører HTTP/1.1 hvis h2 mangler. Loggen viser:

```
h2-pakken mangler — HTTP/2 deaktiveret, kører HTTP/1.1. Installer ved OTA-opdatering.
```

**Opdateringsflow fra frisk OVA:**

1. Portal starter med HTTP/1.1 (ingen crash)
2. Settings → GitHub → Pull — koden opdateres og `pip install -e .` kører automatisk (h2 installeres)
3. Restart — portalen genstarter med HTTP/2 aktiv

Ingen manuel SSH eller bootstrap-script nødvendigt.

---

## [6.7.0665] — 2026-06-14 — OTA: pip install køres automatisk ved git pull

> **Build:** 0665

Efter en vellykket OTA-opdatering (Settings → GitHub → Pull) kører portalen
nu automatisk `pip install -e .` som et ekstra trin. Nye Python-afhængigheder
fra `pyproject.toml` installeres uden manuel SSH-adgang.

Output fra pip vises direkte i pull-resultatet i UI'et. Hvis pip fejler
(f.eks. netværksproblem), vises en advarsel — men opdateringen markeres
stadig som gennemført og portalen kan genstarte. Pip-fejl kræver i så fald
manuel kørsel: `pip install -e .` i `backend/`-mappen på serveren.

---

## [6.7.0664] — 2026-06-14 — Fix: release notes viste forkert sektion i portalen

> **Build:** 0664

Portalen viste `[6.7] — Feature: frys pxGrid...` (build 0658) som aktuel
release note i stedet for den nyeste sektion. Årsag: `VERSION` = "6.7" blev
sendt til `_extract_release_sections_since` og matchede `## [6.7]`-headeren
i RELEASE_NOTES.md fremfor `## [6.7.0663]`.

Nu sendes `FULL` ("6.7.0664") og den tilsvarende `latest_full` fra GitHub,
så release notes matcher præcist på det kombinerede version+build-nummer.

Multi-linje bullet-punkter i ældre sektioner er desuden rettet til single-line
så de ikke splittes i separate afsnit af markdownrendereren.

---

## [6.7.0663] — 2026-06-14 — Forbedret kommunikationshastighed portal ↔ ISE 3.5

> **Build:** 0663

5 optimeringer der reducerer latens og hæver throughput ved ISE-integration over internet:

**HTTP/2 + gzip**
Portalen kommunikerer nu med ISE via HTTP/2 (multiplexing af mange requests over én
TCP-forbindelse) og anmoder om gzip-komprimering af alle svar. Store endpoint-lister
(10.000+ endpoints) er 5-10× mindre over netværket. Kan deaktiveres med
`ISE_HTTP2=false` i `.env` hvis ISE ikke understøtter HTTP/2.

**Open API parallel paginering**
Open API-endpoint-listen hentede sider sekventielt — nu parallelt med Semaphore(8)
ligesom ERS-klienten. Sparer 2-3 sekunder ved 10.000+ endpoints.

**MnT Session + AuthStatus parallelt**
`fetch_session_by_mac()` lavede 2 MnT-kald i rækkefølge — nu køres de simultant.
Sparer én fuld RTT pr. MAC (typisk 60-100 ms over internet).

**Semaphore- og connection-pool-tuning**
Endpoint detail-fetch: 5→8 parallelle kald. Bulk-operationer: 3→5. pxGrid
session-worker: 3→5. Connection pool default: 10→15 forbindelser.

---

## [6.7.0662] — 2026-06-14 — Fix: bruger-edits bevares ved pxGrid live-opdatering

> **Build:** 0662

Redigerede felter i Browse/Edit (description, group, type, owner m.fl.) gik tabt
når en pxGrid live-event triggede en re-render mens en bruger var i gang med at
redigere en endpoint. Rækken forblev "dirty" men indeholdt de originale ISE-værdier
— og et efterfølgende gem ville sende de forkerte værdier til ISE.

`renderRows()` snapshotter nu alle dirty-rækkernes inputværdier og dataset-attributter
(`beStaticGroup`, `bePskKey`, `beActiveStatus`) FØR `tbody.innerHTML`-rebuild og
gendanner dem umiddelbart efter.

---

## [6.7.0661] — 2026-06-14 — Fix: nmap markeret eksperimentel + OS-scan fjernet

> **Build:** 0661

nmap-scanning er nu tydeligt markeret som **eksperimentel** med et amber badge.
En forklaringstekst under overskriften gør det klart at scanningen køres fra
**portalserveren** — ikke fra ISE — og at resultatet afspejler netværksadgang
set fra serverens placering.

"OS + service"-presetten (`nmap -O`) er fjernet da OS-fingerprinting kræver
root-rettigheder som portal-processen (`hypervision`) ikke har.

---

## [6.7.0660] — 2026-06-14 — Fix: backend startup crash (nmap-modul)

> **Build:** 0660

`nmap.py` importerede `from app.core.users import User` — modulet eksisterer
ikke. Backend crashede ved startup. Rettet til `from app.schemas.user import User`.

---

## [6.7.0659] — 2026-06-14 — Fix: OTA update-check + ny versionsregel

> **Build:** 0659

**OTA fix:** Portalens update-check sammenlignede kun build-numre. Med det
nye versionsformat kan MINOR stige uden build-bump (feature commits), så
`6.7.0658` vs `6.5.0658` fejlagtigt returnerede "ingen opdatering" selvom
MINOR er højere. Nu sammenlignes fuld `(major, minor, build)`-tuple.

**Ny versionsregel:** `build` (ZZZZ) incrementeres nu ved **alle** kodeændringer
— features OG bugfixes. Commit-format: `vX.Y.ZZZZ: feat/fix: beskrivelse`.

---

## [6.7.0658] — 2026-06-14 — Feature: frys pxGrid live-opdatering i Browse

> **Build:** 0658

I miljøer med tusindvis af endpoints der autentificerer og frakobler sig konstant, kan Browse-viewet blive meget aktivt og gøre det svært at fokusere.

Ny **"⏸ Frys live"**-knap i Browse-headeren (ved siden af pxGrid-badgen):

- **Klik én gang** → tabellen fryses. pxGrid-events akkumuleres stadig i baggrunden (data er frisk), men UI opdateres ikke.
- **Knappen viser antal ventende ændringer**, f.eks. `▶ Genoptag live (47)`.
- **Klik igen** → alle ventende ændringer anvises på én gang og viewet er hurtigt à jour.
- Fryse-tilstanden nulstilles automatisk hvis pxGrid-streamen genstarter.

---

## [6.6.0658] — 2026-06-14 — Feature: nmap-scanning direkte fra portalen

> **Build:** 0658

Netværksadministratorer kan nu trigge en nmap-scan mod et endpoints IP-adresse direkte fra portalen. IP'en hentes automatisk fra pxGrid-sessionens `framed_ip`.

**Konfigurerbare presets:**

- **Ping** — `nmap -sn -T4 <ip>` — er enheden oppe?
- **Top-1000 porte** — `nmap -T4 --top-ports 1000 <ip>`
- **Service discovery** — `nmap -sV -T4 <ip>` — services og versioner
- **Brugerdefineret** — fri flag-input

**Tilgængeligt fra:**

- **Endpoint details → Session-tab** — nmap-sektion vises automatisk når endpointet har en aktiv RADIUS-session med framed_ip.
- **Browse-tabel action-bar** — nmap-knap aktiveres når præcis ét endpoint med aktiv session og IP er valgt.

Farlige flag blokeres serverside (`-iL`, `--script`, `-oN`, `-oX` osv.). Timeout: 120 sekunder. nmap skal være installeret på backend-serveren.

---

## [6.5.0] — 2026-06-14 — Feature: PSK policy tekst + key generator fix

> **Build:** 0658

**Tekst:** MPSK- og IPSK-labels under Settings → PSK policy er opdateret
med tydelig beskrivelse: MPSK gemmer nøglen uændret i ISE; IPSK ændrer
nøglen automatisk ved at tilføje `psk=`-prefix inden ISE-gemning.

**Bug:** Test PSK key generator ignorerede ikke-gemte form-ændringer — den
kaldte backend uden parametre og backend brugte de gemte (gamle) settings.
Rettet: test-knappen sender nu de aktuelle form-værdier med POST-kaldet,
så generatoren afspejler min. nøglelængde, krav om store bogstaver, tal
og specialtegn præcis som formen viser dem.

---

## [6.4.9] — 2026-06-14 — Fix: global søgning på pxGrid session-felter og authz-profiler

> **Build:** 0657

Søgning på "Endpoint_VLAN:10" returnerede ingen resultater selvom alle
endpoints med aktiv session bruger dette authz-profil. Årsag: display-
strengen "Endpoint_VLAN:10" er sammensat af `authz_profiles[]` + VLAN-
nummer fra `vlan`-feltet. Søgningen kender ikke til den sammensætning.
Rettet: global søgning rekonstruerer nu de samme profil:vlan-strenge
som UI'en viser, og inkluderer alle pxGrid session-felter: user_name,
policy, authz-profiler, NAS-info, DACL, VLAN, SGT, auth-metode osv.

---

## [6.4.8] — 2026-06-14 — Fix: søgning på ISE Session Auth kolonne (autentificeret/inaktiv)

> **Build:** 0656

`auth_status`-kolonnen havde `field: () => ""` så hverken kolonnefilter
eller global søgning kunne matche noget. Rettet: `field()` returnerer nu
"autentificeret" (aktiv RADIUS-session) eller "inaktiv" baseret på
`_sessionData`. Globalt søgefelt inkluderer nu auth-status, så man kan
søge fx "autentificeret" og se alle endpoints med aktiv session.

---

## [6.4.7] — 2026-06-14 — Fix: fri tekst søgning finder nu endpoints på Klient IP

> **Build:** 0655

Søgning i det globale søgefelt (fri tekst) kunne ikke finde endpoints
via Klient IP (framed_ip). Årsag: søgningen gik til backend der kun
kender ISE-attributter — framed_ip er pxGrid session-data som backend
ikke søger i. Løst ved at flytte fullTextQ-filtrering til klient-siden
så den inkluderer `framed_ip` fra live pxGrid-sessioner. Bivirkning:
gentagne tekst-søgninger er nu øjeblikkelige da allRowsCache genbruges.

---

## [6.4.6] — 2026-06-14 — Fix: browse-tabel opdateres korrekt efter gem i Endpoint details

> **Build:** 0654

Når man gemte ændringer i Endpoint details-modalen opdaterede tabellen
ikke alle felter — bl.a. `active_status`-badge (⊘/✓) og `decomm`-badge (⚰)
i MAC-cellen forblev uændrede. Erstattet manuel celle-for-celle DOM-opdatering
med `applyFilter()` der re-renderer hele tabellen fra det friske ISE-svar.

---

## [6.4.1] — 2026-06-13 — Fix: RADIUS simulator evaluerer HypervisionActive korrekt

> **Build:** 0651

Betingelser i RADIUS-simulatoren der refererede `EndPoints.HypervisionActive`
(fx `= "Aktiv"`) viste altid `?` (ukendt/skipped) i stedet for at evaluere
mod endpointets faktiske CA-værdi. Årsag: attributten manglede i
`_ENDPOINT_ATTR_MAP`, og `_fetch_ep_from_ise()` hentede ikke
`active_status` fra ISE ERS. Rettet — `HypervisionActive`, `HypervisionStatus`,
`HypervisionISEPortal` og `HypervisionRoles` evalueres nu korrekt i simulatoren.

---

## [6.4.0] — 2026-06-13 — Fix: framed_ip gennemgribende rettelse

> **Build:** 0650

Fire relaterede fejl med Klient IP / `framed_ip` rettet på én gang:

1. **API-schema** (`PxGridSessionInfoResponse`) manglede `framed_ip`-felt →
   `/api/pxgrid/sessions/{mac}` returnerede aldrig IP-adressen til frontend
2. **SSE broadcast** sendte ikke `framed_ip` → live upsert-events nulstillede
   Klient IP i browse-tabellen ved re-auth
3. **Bulk API** (`list_sessions`) videresendte ikke `framed_ip` fra cache
4. **Session debug tab** (detail modal): IP ikke vist, tidsstempel var rå Unix-float,
   og felterne user_name, nas_device_type, cts_security_group, use_case manglede

---

## [6.4.0] — 2026-06-13 — Fix: søgning i "Klient IP"-kolonne virker nu

> **Build:** 0649

Kolonne-filter og sortering på "Klient IP" matchede aldrig noget selvom
IP-adresser var synlige i kolonnen. Årsagen var at `field: () => ""`-funktionen
altid returnerede tom streng, og filtrering sker via `field(row)`.

Rettet ved at tilføje en modul-niveau session-data reference i browse-utils.js
som browse.js opdaterer ved alle pxGrid-events. field-funktionen slår nu
MAC'en op og returnerer den faktiske IP-adresse.

---

## [6.4.0] — 2026-06-13 — Fix: Klient IP-kolonne viser nu IP-adresse korrekt

> **Build:** 0648

"Klient IP"-kolonnen viste ingen data selvom session-cachen indeholder
`framedIpAddress` fra pxGrid. To fejl rettet:

1. `fetch_session_by_mac()` (MnT) udpakkede ikke `Framed-IP-Address` fra XML.
2. `_enrich_single_from_mnt()` og `reconcile_stale_sessions()` nulstillede
   `framed_ip` ved at bygge ny `SessionInfo` uden at overføre feltet.

Nu bevares pxGrid-IP-adressen ved MnT-berigelse, og MnT-IP bruges som
fallback hvis pxGrid ikke leverede en.

---

## [6.4.0] — 2026-06-13 — Ny kolonne: Klient IP fra session-data

> **Build:** 0647

Ny togglebar kolonne **"Klient IP"** i Browse-visningen. Viser den IP-adresse
ISE/RADIUS har tildelt klienten (framedIpAddress) fra pxGrid- eller MnT-sessionsdata.
Opdateres i realtid ved pxGrid-events. Vises i monospace/blå så den adskiller sig
fra tekst-kolonner.

---

## [6.3.3] — 2026-06-08 — Fix: ISE session auth-kolonne viser context for alle profiler

> **Build:** 0645

Profilsuffix i "ISE session auth"-kolonnen viste kun DACL-navn / VLAN / ACL for
portals egne standardprofiler (Endpoint_VLAN, Endpoint_DACL, osv.) via
navne-regex. Enhver anden ISE-profil viste kun profilnavnet.

Nu: hvis en profil ikke matcher et standardmønster men sessionen har en DACL
vises den som `ProfilNavn:DaclNavn` — samme format som standardprofilerne.

---

## [6.3.2] — 2026-06-08 — Fix: Register-siden sætter nu "Registered by"

> **Build:** 0644

Endpoints registreret via Register-siden (ISE Register) havde tomt "Registered
by"-felt. `RegistretBy` var ikke inkluderet i formens custom-attribute-byggeri.
Løsning: indlogget brugers username auto-sættes som `RegistretBy` ved submit.

---

## [6.3.1] — 2026-06-08 — Fix: ISE authz-profil viser nu alle cisco-av-pair attributter

> **Build:** 0643

Profiler med web-redirect (CWA) viste kun `url-redirect` men manglede
`url-redirect-acl`. Årsag: ISE gemmer ACL-feltet i et separat `webRedirection`-objekt
(ikke i `advancedAttributes`) når profilen er konfigureret via ISE GUI's Web
Redirection-sektion. Portalen parser nu begge felter korrekt.

---

## [6.3.0] — 2026-06-08 — Konfigurerbar tekst på selvregistreringssiden

> **Build:** 0642

To nye tekstfelter i **Settings → Guest Registration (self-registration)**:
- **Tekst under registrering** — intro-tekst vist over formularen
- **Tekst efter registrering** — tekst vist når gæsten er registreret

Begge felter er textarea og gemmes i konfigurationen. Selvregistreringssiden
henter teksten dynamisk fra API'en — ingen genstart nødvendig.

---

## [6.2.6] — 2026-06-08 — Fix: Default authz-regel gem virker nu

> **Build:** 0641

ISE kræver at `condition`-feltet er til stede i PUT-payload — selv for
Default-reglen. Forrige fix udelod feltet når det var null, hvilket gav
"Condition property is required". Nu sendes `"condition": null` eksplicit.

---

## [6.2.5] — 2026-06-08 — Fix: Konsistens i Guest Registration settings

> **Build:** 0640

Tre mangler i Settings → Guest Registration (self-registration):
- **Endpoint-gruppe**: ny dropdown vælger hvilken ISE-gruppe selvregistrerede gæster placeres i
- **Check-interval**: nyt felt konfigurerer baggrunds-workerens tjek-frekvens (sekunder, 0=deaktiveret)
- **Klokkeslæt**: `<input type="time">` erstattet med 24-timers select-par (samme fix som b0637)

---

## [6.2.4] — 2026-06-08 — Fix: Default authz-regel tillader profil-edit

> **Build:** 0639

Default-reglen i ISE kan nu redigeres for autoriseringsprofiler. Conditions-
sektionen er låst med en forklarende besked. Delete er stadig blokeret.
Forudgående b0638-fix var for aggressiv og blokerede hele editoren.

---

## [6.2.3] — 2026-06-08 — Fix: ISE Default authz-regel kan ikke redigeres

> **Build:** 0638

Default-reglen i ISE policy sets er read-only. Alle forsøg på at gemme,
flytte (drag) eller slette den er nu blokeret i frontend og backend med en
klar fejlbesked i stedet for en kryptisk 502-fejl fra ISE.

---

## [6.2.2] — 2026-06-07 — Fix: 24-timers ur til Guest Expiry date/time-picker

> **Build:** 0637

Guest Expiry date-pickeren i Endpoint details edit-modal bruger nu to
dropdown-lister (00–23 for timer, 00–59 for minutter) i stedet for
`<input type="time">`. Sikrer altid 24-timers format uanset OS-locale.

---

## [6.1.1] — 2026-06-07 — Fix: Sync-knap viser attribut-definitionsstatus

> **Build:** 0627

Efter "Importér custom attributter fra ISE" vises nu to linjer:
- `Scannet N endpoints. X nye værdier importeret.`
- `Attribut-definitioner i ISE: Y/Z ✓` — eller rød tekst med navne på manglende attributter der skal oprettes manuelt i ISE.

---

## [6.1.0] — 2026-06-07 — Feat: Gæsteadgang udløb

> **Build:** 0626

**Automatisk udløb af gæsteadgang**
Under Settings → Portal Config → Advanced → Gæste-registrering er der nu en ny sektion:

- **Aktivér udløb** — checkbox der slår funktionen til/fra
- **Udløbstype:**
  - *Tidsperiode* — N dage efter registrering (f.eks. 30 dage)
  - *Bestemt dato* — én fælles udløbsdato for alle gæster der registrerer sig
- **Klokkeslæt** — tidspunkt for udløb (f.eks. 23:59)

Ved selvregistrering sættes to nye custom attributes på endpoint:
- `GuestExperyDate` — udløbsdatotid i format `YYYY-MM-DD:HH:MM`
- `GuestAccessExpire` — `false` (sættes til `true` af ISE-politik eller ekstern checker)

Begge attributter er tilgængelige i ISE Policies condition-builder (`EndPoints.GuestAccessExpire equals true`).

> **ISE-opsætning:** Opret `GuestExperyDate` (String) og `GuestAccessExpire` (String) som custom endpoint attributes i ISE, og brug `GuestAccessExpire equals true` i en authz-regel til at nægte adgang.

---

## [6.0.4] — 2026-06-06 — Fix: GuestRegistration + RegistretBy skipped i policy-simulering

> **Build:** 0625

**Policy-simulering evaluerede aldrig GuestRegistration/RegistretBy**
`EndPoints.GuestRegistration equals true/false` og `EndPoints.RegistretBy equals …` blev altid markeret som *skipped* i simuleringsresultatet — uanset endpoint-værdier. Root cause: `_ENDPOINT_ATTR_MAP` i backend manglede entries for begge attributter, og `_fetch_ep_from_ise()` sendte heller ikke felterne med. Nu evalueres betingelserne korrekt i både manuel og live-endpoint simulation.

---

## [6.0.3] — 2026-06-06 — Release: GuestRegistration, authz-profile auto-scan, CWA fixes

> **Build:** 0623

**GuestRegistration attribut fuldt integreret**
Vises og kan redigeres i Browse inline-edit, endpoint detail-panel, bulk-edit dialog og ISE Policies conditions (dropdown `true`/`false`). `RegistretBy` tilføjet til policy conditions.

**Auto-scan af ISE authz-profiler**
Første gang man klikker på "Tilføj profil"-dropdown i policy-editoren scannes alle ISE authorization profiles automatisk — ingen manuel knap nødvendig.

**CWA session-lookup — ActiveList fallback**
ISE 3.4 returnerer HTTP 500 på `Session/IPAddress/{ip}` (kendt bug). Portal falder nu automatisk tilbage til at scanne `ActiveList` og filtrere på `framed_ip`.

**KNOWN_PROFILES import-fix**
Manglende import forårsagede "KNOWN_PROFILES is not defined" fejl i policy-editor.

---

## [6.0.1] — 2026-06-06 — Fix: selfregister MAC-lookup via pxGrid session-cache

> **Build:** 0617

Registreringssiden fandt ikke MAC fordi MnT `Session/IPAddress` API'et fejlede.

**Root cause:** `GET /api/selfregister/session` brugte kun ISE MnT API som kilde.
MnT kræver MnT Admin-rollen og kan have latency — 5 forsøg × 2s = 10s ventetid.

**Fix:** Sessionsopslag prøver nu **pxGrid session-cache** (in-memory) **først**.
Portalen har allerede disse sessions fra pxGrid STOMP. `SessionInfo` er udvidet
med `framed_ip` populeret fra `framedIpAddress`/`ipAddresses[0]` i pxGrid-payload.

Prioritet: **pxGrid cache (øjeblikkelig) → MnT API fallback (3 forsøg)**

---

## [6.0.0] — 2026-06-06 — Release: Komplet CWA MAC-registrering

> **Build:** 0615

### CWA-flow (Central Web Authentication)

Wireless controller (AireOS 8.10) redirect flow er nu fuldt implementeret:

```
Klient → SSID → WLC → ISE MAB
  ↓ MAC ukendt
ISE → url-redirect AV-pair → WLC
  ↓ WLC intercepter HTTP
Portal /selfregister (ingen MAC i URL)
  ↓ portal finder klientens IP
ISE MnT /Session/IPAddress/{ip} → MAC + session-data
  ↓ bruger udfylder navn + accept
ISE ERS upsert endpoint (opret ELLER opdater)
  ↓
ISE MnT CoA Reauth → WLC re-autentificerer
  ↓
Klient får netværksadgang
```

### Hvad er nyt

**MnT IP-session-lookup med retry**
Portalen slår selv MAC op via `GET /admin/API/mnt/Session/IPAddress/{ip}`.
Tre automatiske forsøg med 2 sekunders mellemrum (RADIUS-session kan være forsinket).

**Polling-UI på registreringssiden**
Siden viser "Finder din enhed..." med animeret spinner og forsøgs-tæller.
Hvis session ikke findes inden timeout: retry-knap vises.

**Upsert-logik**
Tjekker automatisk om MAC allerede eksisterer i ISE:
- Ny MAC → opretter endpoint (POST)
- Eksisterende MAC → opdaterer attributter (PUT)

**Automatisk CoA Reauth**
Trigges med det samme efter registrering via ISE MnT — klienten
re-autentificeres af WLC uden manuel disconnect.

### ISE Authorization Profile opsætning

```
cisco-av-pair = url-redirect=https://hypervision.ll.lan:8000/selfregister
cisco-av-pair = url-redirect-acl=REDIRECT_ACL
```

Konfigurer Settings → Portal Config → Advanced → Gæste-registrering:
- VLAN og DACL til gæsteendpoints
- IPSK-toggle (valgfrit nøgle-felt på siden)
- Accepttekst og redirect URL

---

## [5.30.1] — 2026-06-04 — Release: Gæste-selvregistrering

> **Build:** 0614

### Selvregistreringsside til wireless controller redirect

Wireless controller kan nu redirecte uregistrerede klienter til:
`https://portal.example.com/selfregister?mac=AA:BB:CC:DD:EE:FF`

**Siden spørger om:**
- MAC-adresse (pre-udfyldt, read-only — sat af WLC)
- Navn på registranten
- Valgfri IPSK-nøgle (hvis aktiveret i settings)
- Accept af vilkår

**Hvad der sker ved registrering:**
- Endpoint oprettes i ISE med `GuestRegistration=true`, `RegistretBy=navn`, `HypervisionActive=Aktiv`
- VLAN og DACL assignes som custom-attributter (konfigurerbart)
- IPSK-nøgle gemmes som `PSK_Key` CA (hvis aktiveret)
- CoA Reauth sendes automatisk til NAS — klienten re-autentificeres straks

### Settings → Portal Config → Advanced → "Gæste-registrering"

Ny konfigurationssektion med:
- Aktivér/deaktivér toggle
- VLAN-dropdown (fra eksisterende ISE-værdier)
- DACL-dropdown (direkte fra ISE)
- IPSK-toggle
- Redirect URL efter registrering
- Accepttekst (vilkår)

### Nye endpoint custom attributes

| Attribut | Beskrivelse |
|----------|-------------|
| `RegistretBy` | Navn på registranten (selvregistrering eller manuel) |
| `GuestRegistration` | `"true"` på selvregistrerede endpoints |

---

## [5.22.3] — 2026-06-04 — Release: Cache-engine forbedringer + HypervisionRegisteredAt fixes

> **Build:** 0610

**Cache-engine (3 forbedringer)**
- Auto-restart: workeren genstarter automatisk ved crash (60s delay) — cachen kan aldrig forblive permanent kold
- Standard TTL hævet 60s → 300s: reducerer unødvendige stale-badges under normal drift
- Adaptiv drip-sleep: sprint-mode når >25% af entries er stale (fx efter server-genstart) — fuld cache-opvarmning på ~7 min i stedet for 30 min

**HypervisionRegisteredAt — to fixes**
- `first_seen_store` bruger nu `HypervisionRegisteredAt` fra ISE som seed-timestamp ved ny SQLite-record — korrekt registreringsdato bevares selv efter DB-nulstilling
- `update_endpoint()` stamper nu `HypervisionRegisteredAt` ved første portal-touch af pre-existing ISE-endpoints (oprettet udenfor portalen). Bedste tilgængelige timestamp: ISE createTime → audit-tid → first_seen_store → now

---

## [5.22.2] — 2026-06-03 — Release: Bulk-edit konsolideret, toolbar uniformt, bugfixes

> **Build:** 0607

### Hvad er nyt siden 5.21.0

**Bulk-edit modal samler alle handlinger**
"Edit selected endpoints" indeholder nu også Apply template, Delete, Decommission og Reactivate — de fire toolbar-knapper er fjernet og erstattet af en "Handlinger"-sektion i bunden af modalen.

**Uniform toolbar**
Alle toolbar-knapper i Browse er nu samme størrelse (`small`). Logisk gruppering: Data · Filtre · Gem/Undo · Selektion · Visning.

**first_seen bruger HypervisionRegisteredAt**
Hvis SQLite first_seen-databasen nulstilles, genbruges `HypervisionRegisteredAt`-attributten fra ISE som registreringstidspunkt — korrekt dato bevares efter geninstallation.

**Bugfixes**
- Rollback af `template_applied` audit-events fejlede 400 (manglede before-snapshot og case i rollback-handler)
- `bulkDelBtn is not defined` JavaScript-fejl ved åbning af Browse
- `HypervisionActive` status tilgængelig i bulk-edit
- Sæt Aktiv-knap vises nu korrekt for endpoints uden sat status

---

## [5.21.0] — 2026-06-02 — Release: Konfigurerbar decommission, policy-editor forbedringer, bugfixes

> **Build:** 0598

### Hvad er nyt

**Konfigurerbar decommission (AuthzVlan/ACL)**
Standard VLAN og DACL ved dekommissionering kan nu sættes under *Settings → Portal Config → Advanced*. Begge felter er dropdowns populeret fra eksisterende ISE-data — VLAN fra endpoint custom-attributter, DACL direkte fra ISE.

**Policy condition-editor: flyt rundt på conditions**
Conditions og nested grupper i policy-editoren kan nu omarrangeres med drag-and-drop via ⠿-håndtaget. Elementet markeres med blå baggrund under flytning; en blå streg viser præcis drop-position.

**Policy condition-editor: nye attributter**
`HypervisionActive` (Aktiv/Inaktiv), `HypervisionStatus` (Decommissioned) og `PSK_Mode` (true/false) er tilføjet som dropdowns i condition-builderens EndPoints-dictionary.

**Auth-status farver — bugfix**
Auth-status kolonnen viste altid rød fordi MAC-opslag brugte `textContent` der inkluderede badge-tegn. Rettet til `data-mac` attributten.

**System quality-check — 6 bugfixes**
- Gem-knap på decommission-standarder genindlæste siden (manglende `preventDefault`)
- pxGrid clear-event nulstillede ikke `pxgridLive`
- remove-event manglede MAC-guard
- textContent-fallback i auth-farver fjernet
- Duplikeret caValues-injection i policy-editor konsolideret
- Race condition: gem-knap er nu disabled indtil dropdowns er loadet

---

## [5.20.2] — 2026-06-02 — Feature: Drag-and-drop reordering i policy condition-editor

> **Build:** 0592

Conditions og grupper i policy-editoren kan nu flyttes rundt med drag-and-drop.

**Sådan bruges det:**
- Hvert condition-element og hver nested gruppe har et `⠿`-håndtag yderst til venstre
- Klik og hold på håndtaget og træk elementet til den ønskede position
- En blå streg viser præcis hvor elementet landes — over eller under naboen
- Det draggede element vises halvgennemsigtigt mens det flyttes
- Cross-group flytning understøttes — træk en condition fra én gruppe til en anden
- En gruppe kan ikke droppes inde i sig selv

Select/input-felter i rækken forstyrres ikke — drag starter kun fra `⠿`.

---

## [5.20.1] — 2026-05-31 — Fix: HypervisionActive/Status i policy-editor

> **Build:** 0590

`HypervisionActive` og `HypervisionStatus` er nu tilgængelige som betingelse i ISE Policy-editoren under **EndPoints**-dictionaryet:

- **`HypervisionActive`** — vælg `Aktiv` eller `Inaktiv` fra dropdown
- **`HypervisionStatus`** — vælg `Decommissioned` fra dropdown

Brug dem til at lave policy-regler der kun matcher aktive endpoints, udelukker dekommissionerede, osv.

---

## [5.20.0] — 2026-05-31 — Feature: Konfigurerbar decommission AuthzVlan/ACL

> **Build:** 0589

I stedet for hardkodede værdier (VLAN 999 / DACL `deny_all_ipv4_traffic`) kan admin nu sætte de standarder der bruges når et endpoint dekommissioneres.

**Settings → Portal Config → Advanced → "Standard dekommissioneringsværdier":**
- **AuthzVlan** — dropdown med VLAN-ID'er allerede i systemet (fra endpoint custom-attributter)
- **AuthzACL** — dropdown med DACL-navne direkte fra ISE

Den gemte værdi er altid pre-valgt — også hvis den ikke længere findes i listens data. Ændringer træder i kraft øjeblikkeligt ved næste dekommissionering.

---

## [5.19.9] — 2026-05-31 — Feature: Single toggle-chip + auto-sæt HypervisionActive

> **Build:** 0587

**Toggle-chip:** De to separate "Aktiv"/"Inaktiv"-chips er erstattet af én chip under MAC-kolonnen der cycler ved klik: ingen filter → **Aktiv** (grøn) → **Inaktiv** (amber) → ingen. Chip-teksten skifter med tilstanden.

**Auto-sæt ved save:** Når et portal-managed endpoint gemmes og `HypervisionActive` ikke er sat i forvejen, sættes den automatisk til `Aktiv`. Endpoints der allerede har `Aktiv` eller `Inaktiv` berøres ikke.

---

## [5.19.8] — 2026-05-31 — Feature: Aktiv/Inaktiv filter-chips + DeComm rename

> **Build:** 0586

To nye filter-chips under MAC-kolonnen i Browse: **Aktiv** (grøn når aktiv) og **Inaktiv** (amber når aktiv) — filtrerer på `HypervisionActive`-attributten. Begge chips kan kombineres med de eksisterende filter-chips og gemmes/gendannes i saved views og delte URL-links.

Alle steder "Decommissioned" eller "Decomm" vises som badge/chip-tekst er omdøbt til **"DeComm"** for konsistens.

---

## [5.19.7] — 2026-05-31 — Feature: Sæt Aktiv/Inaktiv direkte fra edit-modal

> **Build:** 0585

To nye knapper i edit-modal på linje med Dekommissionér/Genaktivér: **"Sæt Aktiv"** (grøn) og **"Sæt Inaktiv"** (amber). Kun den relevante knap vises — se logik nedenfor. Kald til `POST /endpoints/{id}/active-status` opdaterer kun `HypervisionActive` — alle andre CA-felter bevares.

### Endpoint-livscyklus: CA-adfærd

Følgende tabel viser hvilke ISE custom attributes der sættes ved hver handling i portalen. `uændret` betyder at attributten ikke indgår i kaldet og bevares som den er i ISE.

| Handling | `HypervisionStatus` | `HypervisionActive` | `AuthzVlan` | `AuthzACL` |
|---|---|---|---|---|
| **Gem (portal save)** | uændret | `Aktiv` ¹ | uændret | uændret |
| **Dekommissionér** | `Decommissioned` | `Inaktiv` | `999` | `deny_all_ipv4_traffic` |
| **Genaktivér** | *(cleared)* | `Aktiv` | uændret | uændret |
| **Sæt Aktiv** *(knap)* | uændret | `Aktiv` | uændret | uændret |
| **Sæt Inaktiv** *(knap)* | uændret | `Inaktiv` | uændret | uændret |

¹ *Kun hvis `HypervisionActive` ikke allerede er sat til `Aktiv` eller `Inaktiv`. Eksisterendeværdi bevares.*

**Forklaring:**

- **Gem (portal save):** Når et portal-managed endpoint gemmes via edit-modal, sættes `HypervisionActive="Aktiv"` automatisk første gang — så alle eksisterende endpoints får status sat ved næste redigering. Endpoints med en eksisterende `Aktiv` eller `Inaktiv` status berøres ikke.

- **Dekommissionér** er en samlet netværksnægtelse: `HypervisionStatus=Decommissioned` og `HypervisionActive=Inaktiv` sættes, og RADIUS-attributterne `AuthzVlan=999` og `AuthzACL=deny_all_ipv4_traffic` sikrer at endpointet øjeblikkeligt placeres i et isoleret VLAN og nægtes al IPv4-trafik — uden at kræve ændringer i ISE policy.

- **Genaktivér** ophæver dekommissioneringen: `HypervisionStatus` ryddes og `HypervisionActive` sættes til `Aktiv`. `AuthzVlan`/`AuthzACL` berøres bevidst ikke — admin styrer selv om RADIUS-restriktionerne skal fjernes manuelt via edit-modal.

- **Sæt Aktiv / Sæt Inaktiv** er manuelle statusknapper til løbende vedligehold uafhængigt af dekommissionsflowet. Kun `HypervisionActive` opdateres; alle andre CA-felter bevares uændret.

### Knap-synlighed i edit-modal (editor-rolle kræves)

| Endpointets tilstand | Synlige knapper |
|---|---|
| Aktivt endpoint (`HypervisionActive` = `Aktiv` eller tom) | Dekommissionér · Sæt Inaktiv |
| Inaktivt endpoint (`HypervisionActive` = `Inaktiv`) | Dekommissionér · Sæt Aktiv |
| Dekommissioneret (`HypervisionStatus` = `Decommissioned`) | Genaktivér |

### Filter-chip i Browse (MAC-kolonne)

Én chip cycler ved klik gennem tre tilstande:

| Chip-tilstand | Farve | Effekt |
|---|---|---|
| *(ingen)* | grå | Viser alle endpoints (dekomm skjules stadig medmindre DeComm-chip er aktiv) |
| **Aktiv** | grøn | Viser kun endpoints med `HypervisionActive=Aktiv` |
| **Inaktiv** | amber | Viser kun endpoints med `HypervisionActive=Inaktiv` |

---

## [5.19.6] — 2026-05-31 — Feature: AuthzVlan/ACL ved dekommissionering + HypervisionActive-status

> **Build:** 0584

**Dekommissionering sætter nu automatisk** `AuthzVlan=999` og `AuthzACL=deny_all_ipv4_traffic` — endpointet nægtes netværksadgang straks uden manuel ISE-policy.

**Ny `HypervisionActive`-attribut** (CA) viser `Aktiv` / `Inaktiv` på alle endpoints. Badge vises i MAC-cellen (⊘ = Inaktiv, ✓ = Aktiv) og i detail-modal. Audit-rollback gendanner også `active_status` korrekt.

---

## [5.19.5] — 2026-05-31 — Feature: Genaktivér dekommissionerede endpoints

> **Build:** 0583

Nye `POST /endpoints/{id}/undecommission` og `POST /endpoints/bulk-undecommission` API-endpoints rydder `HypervisionStatus` i ISE og markerer endpointet aktivt igen. I Browse-view vises en amber "Genaktivér"-knap i detail-modal (kun når endpointet er dekommissioneret) og en bulk-knap i toolbar. Knapperne er mutex med de røde Decommission-knapper.

---

## [5.19.4] — 2026-05-31 — Bugfix: Audit rollback nulstillede ikke HypervisionStatus

> **Build:** 0582

Rollback af et `decommissioned`-event efterlod endpointet med `status: "Decommissioned"` i ISE — CA-feltet `HypervisionStatus` blev aldrig clearet. Årsag: `_endpoint_update_from_snapshot()` inkluderede ikke `HypervisionStatus` i `CustomAttrs`-bygningen. Fix: sender nu `HypervisionStatus=""` (tom streng, ikke `None`) eksplicit — ISE modtager et clearing af feltet.

---

## [5.19.3] — 2026-05-31 — Bugfix: pxGrid SSE-stream offline efter cookie-migrering

> **Build:** 0581

Browse-view viste "⚪ inactive (pxGrid offline)" selv om worker var forbundet. Årsag: `startPxGridStream()` tjekkede `localStorage` for token — som ikke længere gemmes der efter v5.19.0. EventSource bruger nu `withCredentials: true` og sender cookie automatisk.

---

## [5.19.2] — 2026-05-31 — Sikkerhed: Token-revokation + log-sanitering

> **Build:** 0580

**Token-revokation (token_gen):** Tokens var gyldige hele TTL-perioden (1 time) selv efter logout, passwordskift eller rolleændring. Nu incrementeres en `token_gen`-counter i `users.json` ved disse events — alle eksisterende tokens for brugeren invalideres øjeblikkeligt. TACACS+-tokens er upåvirkede (ingen lokal brugerpost).

**Log-sanitering:** Ny `_SensitiveDataFilter` på root-loggeren redakterer automatisk kendte sensitive felter (`password`, `secret`, `token`, `psk`, `api_key` o.l.) i alle log-beskeder og erstatter værdien med `***`.

---

## [5.19.1] — 2026-05-30 — Bugfix: Audit rollback af dekommissionerede endpoints

> **Build:** 0579

Rollback af en `decommissioned`-handling i Audit-log fejlede med 400. Fixen gendanner endpointets fulde tilstand fra `before`-snapshot — identisk med rollback af en almindelig redigering.

---

## [5.19.0] — 2026-05-30 — Sikkerhedshærdning: 3 kritiske/høje sårbarheder lukket

> **Build:** 0578

Baseret på en komplet sikkerhedsanalyse af portalen er tre høj-prioritets sårbarheder rettet:

- **[KRITISK → FIXED] `/metrics` var uauthentificeret** — Prometheus-endpointet eksponerede interne driftsmetrikker til enhver. Kræver nu gyldig session.
- **[HØJ → FIXED] Backup indeholdt plaintext credentials** — `ise_password`, `pxgrid_password` og `tacacs_secret` var inkluderet i backup-filen. Felterne redigeres nu ud med `__REDACTED__`-sentinel; genopret credentials manuelt i Settings efter restore.
- **[HØJ → FIXED] JWT-token i localStorage — XSS-sårbar** — Token gemmes nu udelukkende i en `httpOnly; SameSite=Strict`-cookie (sat af backend). JavaScript — herunder eventuelle XSS-scripts — kan ikke tilgå tokenet. Frontend gemmer kun ikke-sensitiv metadata (udløbstidspunkt + auth-type) i localStorage. Bearer-header understøttes fortsat som fallback til API-klienter.

---

## [5.18.1] — 2026-05-30 — Bugfix: 8 fejl fra code-review

> **Build:** 0577

Automatisk code-review fandt og rettede 8 bugs:

- **[Høj]** Decomm-chip URL-deling virkte aldrig — `encodeFilterToUrl` testede forkert state-felt.
- **[Høj]** Shared URL med `decomm=1` viste alle endpoints — `decodeFilterFromUrl` satte ikke `decommOnly`.
- **[Medium]** "Ryd filtre"-knap viste sig ikke ved Decomm-chip alene — `updateClearBtn` manglede `decommOnly`.
- **[Medium]** Decomm-chip-tilstand tabt ved page-reload — `snapshotFilters` gemte ikke `decommOnly`.
- **[Medium]** Race condition i policy profil-details: skrivning til detached DOM ved hurtig navigation.
- **[Lav]** Duplikeret Decomm-filterlogik i `browse-table.js` (dead code) fjernet.
- **[Lav]** VLAN tag 0 undertrykt af falsy-check — rettet med `is not None`-guard.
- **[Lav]** ISE-fejl i `get_by_name` slugt uden logging — `logger.warning` tilføjet.

---

## [5.18.0] — 2026-05-30 — Authz Profile Details i Policy-panel

> **Build:** 0576

I ISE Policies-visningens højre panel vises nu hvad de tilvalgte authz-profiler består af:

- **Detail-view**: Under profiles-sektionen vises et kompakt kort pr. tilknyttet profil med access-type (ACCEPT/REJECT-badge), profil-type, DACL-navn, VLAN og advanced RADIUS-attributter (f.eks. `Radius:Tunnel-Type = 1:13`).
- **Editor-view**: Tilsvarende sektion nedenfor profile-tagvælgeren — opdateres automatisk når profiler tilføjes/fjernes.
- **Ny backend endpoint** `GET /authz-profiles/{name}` returnerer parsed profil-detaljer fra ISE ERS.
- Tilgængelig for alle autentiserede roller (ikke kun admin).

---

## [5.17.5] — 2026-05-29 — Decommission chip + kvalitetsfixes

> **Build:** 0573

Samler ændringer fra 5.17.3–5.17.4:

- **Decommission chip**: "Decomm"-chip placeret ved siden af "Privat" og "Markeret" i MAC-kolonnen — erstatter den separate toolbar-knap. Chip aktiv = vis dekommissionerede endpoints.
- **Visuel indikator**: Dekommissionerede rækker er dimmede (55% opacity) med strikethrough på MAC-linket og ⚰-ikon i MAC-cellen.
- **Detail-modal badge**: Rød pill med korrekt light/dark mode-support.
- **Chip refresh-fix**: Tabellen opdateres nu korrekt ved chip-klik i paginated tilstand.
- **Kvalitetsfix**: `escapeHtml` → `esc` i import.js (XSS/crash).

---

## [5.17.3] — 2026-05-29 — Bugfix: dekommissioneret badge manglede visuel indikator

> **Build:** 0569

Dekommissionerede endpoints havde ingen synlig markering i tabellen, og badge i detail-modalen brugte inline styles der brød dark mode.

- Tabellens rækker er nu dimmede (opacity 55%) med strikethrough på MAC-linket
- ⚰-ikon i MAC-cellen med tooltip
- Badge i detail-modalen bruger korrekte CSS-klasser med light + dark mode-varianter

---

## [5.17.2] — 2026-05-29 — Bugfix: XSS/crash i CSV-import

> **Build:** 0568

`escapeHtml()` var brugt 12 steder i import-viewet men aldrig defineret — rette funktion var `esc()` (allerede importeret). Konsekvensen var en `ReferenceError` der crashede preview og import-resultat, og rå brugerinput fra CSV blev indsat uescapet i innerHTML. Rettet ved at erstatte alle kald.

---

## [5.17.1] — 2026-05-29 — Bugfix: decommission-filter og clipboard

> **Build:** 0567

To fejl i v5.17.0 rettet.

**Decommission-filter** virkede ikke: "Vis dekommissionerede"-knappen ændrede intet i tabellen — begge tilstande viste det samme. Fejlen var en inverteret betingelse i `needsFilterMode()` kombineret med at filtreringen kun kørte ét sted. Rettet ved at anvende dekommissionsfiltering konsekvent i begge rendering-stier.

**Del filter / clipboard** fejlede på HTTP-origins: `navigator.clipboard` er `undefined` uden HTTPS, og det kastede en synkron TypeError. Rettet med try/catch og optional chaining; fallback viser URL'en i et `prompt()`-dialog.

---

## [5.17.0] — 2026-05-29 — Metrics-historik, bulk template-apply, decommission-flow og URL filter-deling

> **Build:** 0566

Fire planlagte features implementeret fuldt ud.

**Metrics-historik (Feature 4)**
ISE-portalens Metrics-view viser nu SVG linjediagrammer over de seneste 24 timers data. Prometheus-metrikker scrapes automatisk hvert minut og gemmes i `backend/metrics_history.db` (SQLite) — ingen ekstern Prometheus/Grafana nødvendig.
Viste serier: cache-entries, stale %, ISE requests total, circuit breaker state.

**Bulk template-apply (Feature 5)**
I Browse kan du nu vælge N endpoints, klikke **Anvend skabelon** og anvende en eksisterende skabelon på alle valgte på én gang. Alle felter i skabelonen (gruppe, beskrivelse, custom attributes) overskrives parallelt og auditeres.

**Endpoint decommission-flow (Feature 6)**
Endpoints kan nu "soft-deletes" via **Dekommissionér**-knappen i detail-modalen eller med bulk-dekommissionering af flere valgte. Sætter `HypervisionStatus=Decommissioned` som ISE custom attribute. Browse-visningen skjuler dekommissionerede endpoints som standard; "Vis dekommissionerede"-knappen slår synlighed til. Kan fortryde ved at redigere endpoint manuelt.

**Filter-deling via URL (Feature 7)**
Knappen **Del filter** i Browse kopierer et komplet URL (inkl. hash-parametre for alle aktive filtre) til udklipsholderen. Åbning af linket i en ny fane eller deling med en kollega gendanner præcis samme filter-tilstand. Understøtter: portal-filter, dekommissionerings-filter, fritekst, kolonne-filtre, auth-status, first-seen datointerval.

## [5.16.0] — 2026-05-29 — i18n runde 3: audit, metrics, import, settings backup

> **Build:** 0565

Fjerde og afsluttende runde af i18n-konvertering. Alle brugersyn­lige strenge i de resterende views er nu lokaliserede.

**Ændringer:**

- **audit.js**: meta-tæller ("N af X events"), drawer-titel og export-fejlbesked bruger nu `t()`
- **metrics.js**: "Cache vedligehold"-kortet (drip-interval, rotationstid, refreshed, skipped, ældste entry, gennemsnitlig alder, stale entries) og ISE PSN-noder-overskrift er lokaliserede
- **import.js**: hint-afsnittet (formater, kolonner, auto-detect) og preview-feedback ("Detekteret format", rækker/gyldige/ugyldige) samt resultat-sektionsoverskrifter (Succeeded/Overwritten/Skipped/Failed) bruger nu `t()`
- **section-backup.js**: backup og restore-flow er fuldt lokaliseret inkl. confirm-dialog, knap-tilstande og fejlbeskeder. Fil importerer nu `t()` fra i18n.js.
- **i18n.js**: ~45 nye nøgler i DA og EN for audit, metrics, import og settings backup/restore
- **Dokumentation**: FEATURES.md opdateret med entries for v5.13.0–v5.15.0 (i18n-features). BUGS.md opdateret med entries for v5.12.1–v5.13.1 (bug fixes). .gitignore udvidet med runtime-artefakter (cache/, logs/, temp/, backend/templates.json, backend/=*, IP-mapper)

## [5.15.0] — 2026-05-29 — i18n runde 2: browse-modulerne fuldt lokaliseret

> **Build:** 0564

Alle synlige strenge i browse-modulerne er nu lokaliserede. ~110 nye oversættelsesnøgler (da + en) dækker:

- **Browse tabel**: LAA-tooltip (privat MAC), markeret-pin titel, fortryd-dialog, gem-fremdrift
- **Browse filter**: filter-loading beskeder, views-menu (alle knapper og bekræftelsesdialoguer)
- **Browse bulk**: CoA Disconnect/Reauth beskeder, PSK-fejl, RADIUS-placeholder-tekst, simulerings-UI (match/ingen match/delvis, resume, badges)
- **Browse overlay**: ny-gruppe-dialog, batch-simulerings-overlay (header, policy-label, RADIUS-sektion, templates)
- **Browse detail**: ANC karantæne/fjern flow, historik-tab (headers, beskeder), session-tab (cache/MnT titler, fejlbeskeder), statisk profil Ja/Nej
- **Browse.js**: toolbar-tooltips, filter-chip tekster, tab-knapper (Historik → History, ISE Session)

## [5.14.0] — 2026-05-29 — Fuld i18n-oversættelse af lifecycle, dashboard, trends, audit og metrics

> **Build:** 0563

Alle synlige strenge i de centrale views oversættes nu korrekt når bruger-sprog er sat til engelsk. Views som tidligere viste dansk uanset sprogindstilling er nu fuldt lokaliserede.

**Berørte views:**
- **Lifecycle**: titel, beskrivelse, kolonne-headers, knapper, fejlmeddelelser, CSV-header, tidsenheder (t→h)
- **Dashboard**: KPI-labels, trend-chart-titler og serie-navne, systemstatus, audit-hændelser, systemlog
- **Trend Analyse**: titel, periode-vælger, statistik-kort, diagram-titler og hints
- **Audit**: export-knap og eksporterings-tekst
- **Metrics**: capacity-badges (følger med / grænse / bagud)
- **Settings/Cache**: capacity-badges og tidssuffix "siden"

**i18n.js**: ~100 nye nøgler (`lc.*`, `dash.*`, `trend.*`, `audit.btn_export`, `metrics.capacity_*`, `settings.cache_capacity_*`, `settings.ago`) i begge sprogblokke.

---

## [5.13.1] — 2026-05-29 — Hvid tekst på "Ryd markeringer"-knap

> **Build:** 0562

"Ryd markeringer"-knappen i Livscyklus viser nu hvid tekst som alle andre knapper i portalen. Den tilpassede mørk-amber `color`-override er fjernet.

---

## [5.13.0] — 2026-05-29 — Fuld lokaliseringsunderstøttelse for alle menupunkter

> **Build:** 0561

Alle sidebar-menupunkter og labels oversættes nu korrekt når bruger-sprog er sat til engelsk. Tidligere stod "Livscyklus", "Trend Analyse", "Rolle:", "Log ud" og "Præferencer" altid på dansk.

**Ændringer:**
- Tilføjet `nav.lifecycle`, `nav.trends`, `sidebar.role`, `sidebar.logout` til i18n-oversættelserne for både dansk og engelsk
- `data-i18n`-attributter tilføjet til "Rolle:", "Log ud" og "Præferencer" i HTML
- `updateNavLabels()` opdaterer nu `<html lang>` dynamisk ved sprogskcift
- `<html lang>` ændret fra hardkodet `da` til `en` (matcher default-fallback)

---

## [5.12.9] — 2026-05-28 — Fjernet Inaktiv-chip fra MAC-kolonne

> **Build:** 0560

"Inaktiv"-filteret er fjernet fra MAC-kolonnen — session-status vises allerede i Auth-Status-kolonnen. MAC-kolonnen har nu to chips: **Privat** og **📌 Markeret**.

---

## [5.12.8] — 2026-05-28 — Fix: Markering fjernes nu korrekt ved alle gem-operationer

> **Build:** 0559

📌-markeringen fjernes nu pålideligt fra både Browse og Livscyklus ved gem — uanset om det sker via detail-modal, "Gem alle" eller bulk-gem.

**Hvad var galt:** Inline- og bulk-gem fjernede aldrig markeringer fra localStorage (kun detail-modal havde kode til det, og den var skrøbelig). Desuden manglede `<tr>`-elementerne en `data-mac`-attribut, så MAC-opslag var usikkert.

**Løsning:** Centraliseret `unmarkSaved(id)`-funktion der altid virker: læser MAC fra `<tr data-mac="...">`, opdaterer localStorage og fjerner 📌-badge synkront.

---

## [5.12.7] — 2026-05-28 — Fix: 📌-markering fjernes direkte fra tabellen ved gem

> **Build:** 0558

📌-badgen fjernes nu synkront og direkte fra tabelrækken i det øjeblik gem lykkes — uden at vente på en asynkron `refreshRows`-kæde. Det giver øjeblikkelig og pålidelig feedback.

---

## [5.12.6] — 2026-05-28 — Fix: 📌-markering fjernes nu korrekt efter gem

> **Build:** 0557

📌-markeringen forsvinder nu pålideligt fra MAC-cellen i Browse-tabellen efter et endpoint er gemt i redigeringsmodalen. Fejlen skyldtes at MAC-adressen blev aflæst fra DOM-elementet på gem-tidspunktet, hvor den i visse situationer var tom. MAC gemmes nu direkte i state når modalen åbner.

---

## [5.12.5] — 2026-05-28 — Inaktiv-chip deaktiveres når pxGrid ikke har sessionsdata

> **Build:** 0556

**Inaktiv**-chippen er nu grå og ikke-klikbar når pxGrid ikke er forbundet eller endnu ikke har leveret sessionsdata. Et forklarende tooltip vises. Hvis pxGrid-forbindelsen falder mens chippen er aktiv, deaktiveres filteret automatisk og tabellen opdateres. Chippen genaktiveres automatisk når sessionsdata er tilgængeligt igen.

---

## [5.12.4] — 2026-05-28 — Fix: 📌-markering forsvinder nu fra rækken efter gem

> **Build:** 0555

Efter et endpoint gemmes i Browse/Edit forsvinder 📌-badgen nu korrekt fra MAC-cellen i tabellen — uden at siden skal genindlæses.

---

## [5.12.3] — 2026-05-28 — Fix: MAC-chips opdaterer nu tabellen automatisk

> **Build:** 0554

Klik på **Privat**, **Inaktiv** eller **📌 Markeret** under MAC-kolonnen opdaterer nu straks tabellen — også når intet filter var aktivt i forvejen. Browseren indlæser automatisk alle endpoints og filtrerer dem efter den valgte chip.

---

## [5.12.2] — 2026-05-28 — Gem i Browse fjerner automatisk markering

> **Build:** 0553

Når et markeret endpoint gemmes i Browse/Edit-modalen, fjernes 📌-markeringen automatisk. Hvis der ikke er flere markerede endpoints, slukkes "📌 Markeret"-chippen også automatisk, så tabellen ikke viser tomme resultater.

---

## [5.12.1] — 2026-05-28 — Fix: Markeret-filter flyttet til MAC-chip

> **Build:** 0552

"Vis kun markerede"-knappen er fjernet fra den øverste toolbar. I stedet er der nu tre chips under MAC-kolonnen i filterpanelet: **Privat**, **Inaktiv** og **📌 Markeret** — alle fungerer ens og kan kombineres frit.

---

## [5.12.0] — 2026-05-28 — Livscyklus-markering og MAC-filter-chips i Browse

> **Build:** 0551

### Livscyklus → Browse markerings-workflow

Livscyklus-visningen (Monitoring → Livscyklus) viser endpoints der ikke har haft portal-aktivitet i det valgte tidsrum. Det er nu muligt at:

1. **Afkrydse individuelle endpoints** — eller bruge "Vælg alle"-checkboksen i kolonneheaderen.
2. Klikke **"📌 Marker valgte (N) →"** — MAC-adresserne gemmes i browseren og Browse åbnes automatisk.
3. I Browse aktiveres **"Vis kun markerede"**-filtret automatisk — kun de markerede endpoints vises.
4. Redigér dem én for én via ↗-linket eller klik direkte på rækken.

Allerede-markerede endpoints viser et 📌-ikon i Livscyklus og i Browse-tabellens MAC-celle, så det er tydeligt hvad der er i kø. Knappen "Ryd markeringer" nulstiller listen.

### MAC-filter-chips i Browse (MAC-kolonne)

Under søgefeltet i MAC-kolonnen er der tilføjet to toggle-chips:

- **Privat** — viser kun Private/LAA MAC-adresser (Locally Administered Address, bit 1 sat i første octet). Nyttigt til at identificere iOS/Android-enheder med tilfældig MAC.
- **Inaktiv** — viser kun endpoints der **ikke** ses i den aktive pxGrid-session (ikke tilkoblet netværket lige nu).

Begge chips virker i kombination med øvrige filtre (tekst-søgning, gruppe-filter osv.).

---

## [5.11.6] — 2026-05-27 — Fix: Kolonne-flip og selektion-tab ved periodisk baggrunds-opdatering

> **Build:** 0550

Hvert 5. minut berigte ISE pxGrid-data med MnT-oplysninger (policy-navn, regel-navn m.m.), hvilket udløste en fuld tabel-genindlæsning. Det gav to synlige fejl:

1. **Kolonner flippede** frem og tilbage i 1-2 sekunder — tabellen viste en "indlæser"-besked og kolonne-bredder nulstillede sig mens ny data blev hentet.
2. **Selektion gik tabt** — valgte rækker (til bulkredigering) blev fravalgt ved genindlæsningen, så man var tvunget til at redigere én ad gangen.

Begge fejl er nu løst: baggrunds-opdateringer sker stille uden at vise indlæser-tekst eller rydde rækker. Eksisterende rækker forbliver synlige og selekterede mens ny data hentes i baggrunden, og erstattes derefter atomisk.

---

## [5.11.5] — 2026-05-25 — Fix: Kolonne-synlighed og gemte views virker nu for TACACS-brugere

> **Build:** 0549

TACACS+-brugere kan nu gemme deres Browse-præferencer (kolonne-synlighed, rækkefølge, bredde) og gemte views server-side — præcis som lokale brugere.

Første gang en TACACS-bruger gemmer en præference oprettes automatisk en shadow-record på serveren. Herefter fungerer incognito-sessioner og nye browsere korrekt: præferencerne hentes fra serveren ved login.

---

## [5.11.4] — 2026-05-25 — Fix: Kolonne-synlighed virker nu korrekt i incognito og på nye enheder

> **Build:** 0548

Kolonne-synlighed hentes nu korrekt fra backend i incognito-sessioner og nye browsere/enheder.

**Problemet:** En gammel fejl betød at backend-sidan gemte en "alle kolonner synlige"-tilstand. Når du åbnede Browse næste gang, overskrev portalen din lokale præference med denne forkerte backend-tilstand.

**Løsningen:** Backend-præferencer skrives nu kun til din lokale browser-cache, hvis den er tom (incognito, ny enhed, første login). Har du allerede en lokal præference, bevares den — og den uploades automatisk til backend, så fremtidige incognito-sessioner henter den korrekte tilstand.

**Kort sagt:** Sæt dine kolonne-præferencer i din normale browser, og de vil automatisk være aktive næste gang du åbner en ny incognito-session eller logger ind på en ny enhed.

---

## [5.11.3] — 2026-05-25 — Fix: Kolonne-synlighed nulstilles ikke længere ved navigation

> **Build:** 0547

Rodårsagen til at kolonne-synlighed nulstillede ved hvert Browse-besøg er nu fjernet. Problemet lå i `restoreFilters()`: filtergenoprettelse inkluderede den sidst gemte kolonne-synlighed fra filter-snapshotten (BROWSE_FILTERS_KEY), som overskrev brugernes kolonne-præference (COLVIS_KEY) ved hvert sidebesøg.

Rettelse: `restoreFilters()` springer nu kolonne-synlighed over — kolonne-tilstanden læses udelukkende fra COLVIS_KEY og backend-præferencer. Gemte views aktiverer stadig kolonne-synlighed korrekt, da de bruger eksplicit aktivering.

---

## [5.11.2] — 2026-05-25 — Fix: Kolonne-synlighed persisterer nu korrekt + gemt-bekræftelse

> **Build:** 0546

Kolonne-synlighed persisterer nu på tværs af navigationer: ved hvert besøg på Browse-siden uploades den aktuelle kolonne-tilstand til din brugerprofil, så den er korrekt næste gang du vender tilbage.

Derudover: når du ændrer en kolonnes synlighed, vises nu et grønt **✓** i "Kolonner"-knappen i 1,8 sekunder som bekræftelse på at ændringen er gemt.

---

## [5.11.1] — 2026-05-25 — Fix: Kolonne-synlighed synkroniseres nu korrekt til backend

> **Build:** 0545

Kolonne-synlighed (hvilke kolonner der vises i Browse) blev ikke gemt i backend, selv om funktionen var implementeret. Årsagen: synkronisering skete kun ved aktiv ændring — men brugere der havde sat synlighed FØR backend-sync-funktionen blev tilføjet, fik aldrig uploadet den eksisterende præference.

Rettet: ved første sideload kontrolleres om backend mangler kolonnepræferencer, og i så fald uploades localStorage-tilstanden automatisk én gang. Herefter synkroniseres ændringer som normalt.

---

## [5.11.0] — 2026-05-25 — Kolonnebredder og alle Browse-præferencer gemmes i backend

> **Build:** 0544

Kolonnebredder (resize) synkroniseres nu til din brugerprofil på serveren — ligesom kolonne-rækkefølge og synlighed allerede gør. Alle tre Browse-præferencer gendannes automatisk på tværs af enheder og browsere ved næste login.

**TACACS+-brugere:** Som tidligere gemmes præferencer stille i browserens localStorage.

---

## [5.10.4] — 2026-05-25 — Skalerbare kolonner virker nu

> **Build:** 0539

Resize-handle i kolonne-headers var usynlig og uklikbar pga. en CSS-fejl (`overflow: hidden` på `<th>` clippede den absolut-positionerede handle). Rettet — du kan nu trække i højre kant af en kolonneheader for at justere bredden.

---

## [5.10.2] — 2026-05-25 — Git pull: klar fejlbesked ved ejerskabsproblem

> **Build:** 0537

Hvis `.git`-mappen ejes af en anden bruger end portal-processen, vises nu en præcis `chown`-kommando med det rigtige brugernavn i stedet for de misvisende `find/chmod`-kommandoer.

---

## [5.10.1] — 2026-05-25 — Git pull fejler aldrig mere på filrettigheder

> **Build:** 0536

"Git-objektmappen har forkerte filrettigheder"-fejlen er løst permanent. Portalen fikser nu automatisk `.git/objects`-rettigheder (755/644) og sætter `core.sharedRepository` i git-config **inden** hvert git fetch — ingen manuelle chmod-kommandoer på serveren nogensinde igen.

---

## [5.10.0] — 2026-05-25 — Identity Group: fuld sti + skalerbare kolonner

> **Build:** 0535

### Fuld hierarkisk sti i gruppe-dropdowns

Alle gruppe-dropdowns (Browse inline, detail-modal, bulk-edit, overgruppe-valg) viser nu den **fulde sti** med " / " separator:

```
Profiled
Profiled / ADM-Apple-iPhone
Profiled / ADM-Apple-iPhone / SubGroup
Unknown
Unknown / SomeChild
```

I detail-modal vises desuden den valgte gruppes sti som stakkede linjer under dropdown-feltet (lille skrift, indrykket pr. niveau) — så man altid kan se hvad der er valgt uden at åbne dropdown.

### Individuel kolonne-skalering i Browse

Kolonner i Browse-tabellen kan nu skaleres individuelt ved at trække i den **grå resize-handle** i højre kant af kolonne-headeren. Bredder gemmes automatisk i browseren og genoprettes ved næste besøg.

---

## [5.9.4] — 2026-05-25 — Release notes vises altid i update-check

> **Build:** 0534

Update-checken viser nu altid release notes — også når portalen kører en debug-build (f.eks. 5.9.3.1) der ikke har sin egen sektion i RELEASE_NOTES.md. Fallback-logikken finder nu den seneste tilgængelige sektion hvis et eksakt match mangler.

---

## [5.9.3] — 2026-05-25 — Hurtigere update-check

> **Build:** 0532

GitHub-forespørgslerne ved update-check (`version.json` + `RELEASE_NOTES.md`) hentes nu **parallelt** i stedet for sekventielt. Checket er typisk 40–60 % hurtigere.

---

## [5.9.2] — 2026-05-25 — Opret endpoint gruppe: vælg overgruppe

> **Build:** 0530

"Ny gruppe"-modalen har nu en **Overgruppe**-dropdown der viser alle eksisterende endpoint identity groups (sorteret alfabetisk med fuld hierarkisk sti). Vælger man ingen overgruppe oprettes gruppen i roden. Valget sendes som `parentId` til ISE via ERS API.

---

## [5.9.1] — 2026-05-25 — Policy-view: "Authz Policies" label

> **Build:** 0529

- Sidebar-overskriften er omdøbt fra "Politikker"/"Policies" til **"Authz Policies"**
- Midter-kolonnens overskrift viser nu **"Authz : [policy-sæt navn]"** i stedet for bare sæt-navnet

---

## [5.9.0] — 2026-05-25 — Opret endpoint gruppe + Policy drag-and-drop

> **Build:** 0528

To nye features der giver admins og editorer mere direkte kontrol over ISE-konfiguration uden at forlade portalen.

### Ny endpoint identity group fra Browse (admin)

En "+ Ny gruppe"-knap vises nu i Browse-toolbar for admin-brugere. Klik åbner en modal hvor du angiver navn og beskrivelse. Gruppen oprettes direkte i ISE via ERS API, og gruppe-cachen opdateres automatisk — den nye gruppe er tilgængelig i dropdowns med det samme.

### Policy-regel rank-ændring via drag-and-drop (editor/admin)

I Policy-viewet kan editorer og admins nu trække og slippe regler for at ændre deres indbyrdes rækkefølge. Drag-and-drop sætter den valgte regels rank til destinationreglens rank — ISE renummererer de øvrige regler automatisk. Visuel feedback: den trukne regel bliver transparent, mulig destination fremhæves med amber-ramme.

---

## [5.8.3] — 2026-05-24 — Flytbare Browse-kolonner med backend-persistens

> **Build:** 0527

Kolonne-rækkefølge og synlighed i Browse-tabellen gemmes nu i din brugerprofil på serveren — ikke blot i browseren. Opsætningen gendannes automatisk når du logger ind fra en anden enhed eller browser.

**Sådan virker det:**
- **Flyt kolonner** ved at trække dem i tabelhoveden (drag-and-drop)
- **Slå kolonner til/fra** via "Kolonner"-knappen i toolbar
- Begge ændringer gemmes øjeblikkeligt i din brugerprofil via `PUT /api/me/prefs`
- Ved næste login hentes præferencerne fra backend og genoprettes automatisk — inden tabellen renderes

**TACACS+-brugere:** Backend-gem understøttes ikke (403 Forbidden) — opsætningen gemmes stille i browserens localStorage som hidtil.

---

## [5.8.2-P4] — 2026-05-24 — Security Patch 4

> **Build:** 0526 — Sikkerhedsrettelser fra ny uafhængig kodeanalyse

### 3 sikkerhedsfund rettet

| # | Sværhedsgrad | Komponent | Fund | Fix |
|---|---|---|---|---|
| 1 | **Høj** | `cache.py` | `/api/cache/invalidate` tilgængeligt for alle autentiserede brugere — viewer/registrant kunne tømme ISE-endpoint-cachen og provokere DoS mod ISE-API | Endpoint kræver nu `require_admin` |
| 2 | **Middel** | `trends.py` | Dead-code funktion `_mac_from_json()` kaldte `json.loads()` uden at `json` var importeret — ville give `NameError: name 'json' is not defined` ved kald | Funktion fjernet |
| 3 | **Middel** | `audit.py` | `GET /api/audit` — filterparametre `actor`, `resource_type`, `resource_id`, `from_ts`, `to_ts` manglede `max_length` (export-endpoint var korrekt fra Patch 3) | `max_length` tilføjet på alle fem parametre |

---

## [5.8.2] — 2026-05-24 — Livscyklus tid-telemetri + klik til Browse/Edit

> **Build:** 0524

Livscyklus-tabellen viser nu **"Første gang set"** (dato + alder) for hvert endpoint, og klik på en række navigerer direkte til Browse / Edit med MAC pre-fyldt i søgefeltet.

---

## [5.8.1] — 2026-05-24 — Dashboard redesign

> **Build:** 0523

Dashboard redesignet med KPI-kort (total endpoints, LAA%, inaktive, hit rate, CB-status), 30-dages mini sparkline-chart for endpoint-bevægelse og Livscyklus-summary direkte på forsiden. Audit-events vises med farvekodet action-badge.

---

## [5.8.0] — 2026-05-24 — Trend Analyse · Security Patch 3 · Stabilitets-fix

> **Builds:** 0514 · 0515 · 0516 · 0517 · 0518 · 0519 · 0520 · 0521 · 0522 — release til `main` 2026-05-24

### Overblik

v5.8.0 er en feature + sikkerhed + stabilitets-release med tre hoveddele:

| Del | Indhold |
|-----|---------|
| **Trend Analyse** | Nyt overvågningsview — endpoint bevægelser og private MACs over tid |
| **Security Patch 3** | 7 sikkerheds-hardening-fixes fra dyb kodeanalyse |
| **Stabilitets-fix** | Kritisk fix der forhindrer portal-crash ved startup |

---

### Trend Analyse (build 0514)

Nyt **Trend Analyse**-view i sidebaren under *Overvågning* — tilgængeligt for alle roller undtagen registrant.

**Endpoint bevægelsesdiagram**
Dagligt linjediagram der viser tilgang (grøn), fragang (rød) og netto ændring (blå) over den valgte periode.

**Private MAC-diagram (LAA)**
Dagligt linjediagram med tilgang og fragang af Locally Administered Addresses — hjælper med at spore omfanget af MAC-randomisering i netværket.

**Stat-kort**
Snapshot øverst på siden: totalt antal endpoints, antal private MACs, LAA-procent og periode-summer (til/fra).

**Periode-vælger:** 7 dage · 30 dage · 90 dage · 1 år

Data hentes fra `first_seen_store` (populeres af ISE-prewarm-scanner hvert 30. minut) — afspejler **alle** endpoints i ISE, ikke kun portal-oprettede. Ingen eksterne chart-afhængigheder — alt er ren SVG.

---

### Security Patch 3 (build 0515)

Dyb sikkerhedsanalyse af kodebasen afslørde 7 fund der er rettet i dette patch.

| # | Kategori | Komponent | Fix |
|---|----------|-----------|-----|
| 1 | XSS | Frontend `app.js` | `user.role` escaped med `esc()` ved `innerHTML`-indsætning — forhindrer role-name XSS |
| 2 | CSP hardening | Backend `main.py` | `script-src 'unsafe-inline'` fjernet — inline script-execution blokeres af browser |
| 3 | Opstartsadvarsler | Backend `main.py` | `SECURITY WARNING` i log ved `ISE_VERIFY_TLS=false` og ved dev-CORS-origins i produktion |
| 4 | Windows ACL | `settings_store.py` | `icacls` begrænser `config.json` til aktuel Windows-bruger (svarende til Unix `chmod 600`) |
| 5 | Persistent lockout | Ny `lockout_store.py` | Account lockout gemmes nu i SQLite — overlever backend-genstart og serverops |
| 6 | Input-validering | `endpoints.py` | `search` max 500 tegn; `page` og `size` valideret med `ge`/`le`-grænser |
| 7 | Input-validering | `audit.py` | `search`, `actor`, `resource_type`, `resource_id` begrænset med `max_length` |

---

### Stabilitets-fix: lockout_store startup-crash (build 0516)

**Baggrund:** Security Patch 3 introducerede `lockout_store.py` (persistent lockout i SQLite). En race condition under deployment betød at serveren kørte en version af `main.py` der importerede `lockout_store`, men uden at `lockout_store.py` endnu var hentet — dette crashede portalen i en restart-løkke.

**Rodårsager rettet i b0516:**

- `init_lockout_db()` var ikke i `try-except` — enhver DB-fejl ved startup crashede hele FastAPI-appen
- `lockout_store` brugte samme `audit.db` som audit-systemet — write-lock-konflikt ved samtidige startup-operationer
- `sqlite3.connect()` uden timeout — concurrent logins kunne give `"database is locked"`-fejl

**Designændringer:**

- `lockout_store.py` bruger nu dedikeret `lockout.db` (adskilt fra `audit.db`)
- Alle DB-funktioner er `try-except`-wrapped med sikre standard-returværdier
- `_available`-flag: hvis DB-initialisering fejler, degrader portalen stille til in-memory lockout (ingen crash)
- `conn.close()` garanteret i `finally`-blok på alle connections
- `timeout=10` på alle `sqlite3.connect()`-kald
- `init_lockout_db()` i `main.py` wrapped i `try-except` med `warning`-log — portalen starter altid uanset lockout DB-fejl

---

### Opgradering

Normal procedure — pull + genstart:

```bash
cd /opt/hypervision
git pull origin main
systemctl restart hypervision
journalctl -u hypervision -f -o short-precise
```

Vellykket opstart viser:
```
INFO  HyperVision ISE Portal v5.8.0 build 0516 starting
INFO  lockout_store: initialiseret (/.../lockout.db)
INFO  Application startup complete.
```

Nye filer der oprettes automatisk: `backend/lockout.db`

---

### Komplet feature-oversigt — hvad portalen kan pr. v5.8.0

Denne release markerer en moden portal. Her er en samlet oversigt over alt hvad der er bygget siden v5.5.0.

#### Endpoint Browse og redigering
- Søgbar, filtrerbar og sorterbar tabel med alle ISE-endpoints og live pxGrid-opdatering
- Inline detail-modal: Endpoint-fane, RADIUS/simulering-fane, Profil & IDs-fane, Historik-fane, ISE Session-fane
- Bulk-operationer: skift gruppe, custom attributes og ANC på flere endpoints i ét hug
- Gem som skabelon og anvend skabelon direkte fra Browse-Edit modal
- Kolonne-synlighed, saved views og gemte filterkombinationer
- Fremhævning af private/randomiserede MAC-adresser (LAA) med amber badge
- LAA-tæller i header — total fra database, uafhængig af aktivt filter
- Progress-indikator ved bulk-gem af flere endpoints

#### Endpoint historik og livscyklus
- **Første gang set**-database: SQLite med immutable timestamp per MAC, kolonne i Browse med dato+tid-filter
- Livscyklus-viewer (admin): find endpoints uden aktivitet i 30/60/90/180/365 dage med CSV-eksport
- Komplet sletnings-håndtering: portal-sletning, ISE-genskabelse (ID-skifte) og prewarm-scan

#### ISE pxGrid — real-time session data
- Phase 1: certifikat-opsætning (upload PEM eller generer CSR, 5-trins flow med ISE CA)
- Phase 2b: persistent STOMP-worker — abonnerer på session-events og opdaterer Browse live via SSE
- ISE Session-kolonne: auth-metode, authz-profiler, identity group, VLAN direkte i tabellen
- Periodisk MnT-berigelse (hvert 5. min): ISEPolicySetName, authorizationRuleName, VLAN
- Stale session-reconcile (hvert 10. min): genindlæser endpoints der har misset push-events
- Session anomali-detektion: bulk-disconnect og NAS-IP churn — advarselsbannere i Browse

#### Policy-administration og simulering
- Vis og redigér ISE endpoint authorization policy sets og regler
- 3-panel layout: policy sets (sidebar), regler (midt), detalje/editor (højre)
- Grafisk AND/OR-betingelses-visualisering med farvekodet nesting — identisk med ISE's editor
- **Endpoint-simulator**: vælg policy set eller Auto-mode (test alle sets fra rank 0, stopper ved første match)
- RADIUS-attributter i simulatoren med autocomplete og duplicate-nøgle-validering
- Gemte RADIUS-templates — deles mellem single- og batch-simulering
- **Batch-simulering**: simulér policy-match for markerede endpoints direkte fra Browse-toolbar

#### Overvågning og statistik
- **Trend Analyse**: endpoint tilgang/fragang og private MACs over tid (7d/30d/90d/1år, ren SVG)
- **Dashboard**: cache-status, pxGrid-status, aktive sessioner, ISE-forbindelsestilstand
- Systemlog direkte i Dashboard (admin): niveau-filter, fritekst-søgning, auto-refresh
- Alert-system med konfigurerbare betingelser og dismissible bannere i Browse

#### Audit og eksport
- Audit-log (admin-only): alle CRUD-operationer, login/logout, ISE circuit-events
- Audit-log CSV-eksport med aktive filtre (max 10 000 rækker)
- JSON-eksport fra Browse: valgte, filtrerede eller alle endpoints
- CSV-eksport fra Browse

#### Skabeloner
- Opret, rediger og slet endpoint-konfigurationsskabeloner
- Anvend skabelon i Browse-Edit og på Registreringssiden — sætter description til `Templet [navn]`
- PSK_Mode i skabeloner: prompter for nøgle ved anvendelse — nøglen gemmes aldrig

#### Registrering og import
- Registrér nye endpoints enkeltvis med gruppe, custom attributes og skabelon
- Bulk-import fra CSV med fleksibel kolonne-mapping til ISE-attributter (max 5 000 endpoints)

#### NAS platform management
- NAS-scan: henter alle network devices fra ISE rå fra NDG — grupperede og ikke-mappede
- Mapping-editor: tilknyt ISE device-type-paths til platform-labels

#### Autentisering og brugerstyring
- Lokal brugeradministration med roller: admin, editor, editor-psk, registrant, viewer
- **TACACS+-autentisering**: rolle og operatørprofil via TACACS+-attributter; shadow-records sikrer preferences og saved views for TACACS+-brugere
- Operatørprofil-katalog: standard-rolle og endpoint-roller per profil
- Silent token refresh: fornyes præcist 15 min inden udløb
- Account lockout: 5 fejllogins → 15 min lockout, persistent i SQLite (overlever genstart)
- Rate limiting på alle API-endpoints

#### Sikkerhed (akkumuleret over Security Patch 1–3)
- Komplet HTML-escaping med central `esc()` i alle views
- CSP: `script-src 'self'` (ingen `unsafe-inline`), `frame-ancestors 'none'`, HSTS
- TLS-verifikation af ISE-certifikat som standard; advarsel i log ved `ISE_VERIFY_TLS=false`
- `config.json` og operator-filer: `chmod 600` (Unix) / `icacls` (Windows)
- ZIP-bomb-beskyttelse ved upload af opdateringspakker (max 500 MB ukomprimeret)
- Kryptografisk sikker PSK-nøglegenerator (`secrets`-modulet)
- Input-validering på alle søge- og pagineringsparametre

#### Administration og drift
- **Config backup/restore** (admin): download og gendan alle konfigurationsfiler som ét JSON-dokument
- **GitHub-opdatering**: tjek og hent seneste version direkte fra portalen (main eller dev branch)
- **Tema**: Light, Dark, Midnight, Slate — gemmes per bruger
- **Lokalisering**: Dansk og Engelsk per bruger — skifter øjeblikkeligt
- Drip-refresh: alle endpoints opdateres kontinuerligt i baggrunden — ingen kold cache
- API-kald med 30 sekunders timeout — langsomme ISE-kald blokerer ikke UI
- Testdækning: 190 automatiserede tests (auth, endpoints, policy, pxGrid)

---

## [5.7.12] — 2026-05-23 — Skabelon: description sættes automatisk ved anvendelse

Når du anvender en skabelon i Browse/Edit-modal eller på Registreringssiden, sættes description-feltet automatisk til `Templet [skabelonnavn]`. Dette gør det nemt at se hvilken skabelon der er brugt på et endpoint.

---

## [5.7.11] — 2026-05-23 — Fix: "Show 500" gav 502-fejl

Valg af 500 i "Show"-dropdown fejlede med `502: ISE returnerede en uventet fejl (HTTP 400)`. ISE ERS API accepterer max 100 endpoints per side. Portalen bruger nu intern cache-paginering når cache er varm — ingen ISE-kald ved visning af mange endpoints på én side.

---

## [5.7.10] — 2026-05-23 — Privat MAC tæller: total fra database

LAA-tælleren viser nu det totale antal private MACs i hele databasen — uanset hvilket filter der er aktivt. Tællingen hentes fra backend ved sideindlæsning og ændres ikke ved filtrering.

`10 / 59 endpoints (filtreret)  [3 privat]`

De 3 private MACs er totalen i databasen — ikke bare dem der er synlige i filteret.

---

## [5.7.9] — 2026-05-23 — Privat MAC tæller i endpoint-oversigt

Endpoint-tælleren øverst i Browse viser nu antal privat/LAA MAC-adresser som et amber badge:

`59 / 59 endpoints  [3 privat]`

Tællingen følger det aktive filter — viser kun LAA-count for de endpoints der aktuelt er i view. Vises ikke hvis der ingen private MACs er.

---

## [5.7.8] — 2026-05-23 — Privat MAC-adresse fremhævning

Portalen markerer nu automatisk Locally Administered Addresses (LAA) — private eller randomiserede MAC-adresser. Første octet i MAC-kolonnen fremhæves med amber/gul baggrund og fed skrift, når bit 1 i første byte er sat.

**Eksempel:** `A6:D6:A4:B3:34:16` — `A6` fremhæves (A6 = 10100110₂, bit 1 = 1 → LAA).

Alle temaer understøttes (light, dark, midnight, slate).

---

## [5.7.7] — 2026-05-23 — TACACS: præferencer og gemte views virker nu

TACACS-brugere kan nu gemme præferencer og gemte views præcis som lokale brugere. Ved hvert vellykket TACACS-login opretter portalen automatisk et shadow-record i den lokale brugerdatabase — rolle og rettigheder synkroniseres fra operatørprofilen ved hvert login.

- Ingen manuel konfiguration påkrævet
- Shadow-records er ikke synlige i admin-bruger-oversigten
- Hvis operatørprofilens rolle ændres i ISE, slår det igennem ved næste login

### Første gang set: 24-timers klokkeslæt uden AM/PM

Dato+tid-inputfelterne i "Første gang set"-filteret bruger nu `type="text"` med `HH:MM`-format frem for browserens native `datetime-local`. Det sikrer 24-timers visning uanset Windows-sprogindstilling.

---

## [5.7.6] — 2026-05-23 — Update-check: release notes vises altid

Filterpanelet under "Første gang set"-kolonnen bruger nu `datetime-local`-input. Du kan angive **dato OG klokkeslæt** (timer/minutter) for både fra- og til-grænsen.

- Fra: eksakt starttidspunkt (f.eks. `20-05-2026 06:00`)
- Til: inklusive til og med slut-minuttet (+ 59 sek) — vælger du `23-05-2026 17:30` inkluderes endpoints set frem til `17:30:59`

Browseren åbner en native dato+tid-dialog med separate felter for dag, måned, år, time og minut.

---

## [5.7.6] — 2026-05-23 — Update-check: release notes vises altid

### Release notes vises også når portalen er à jour

Tidligere viste update-check ingen release notes, hvis portalen allerede kørte den nyeste version — og fejlede stille for debug-builds (f.eks. `5.7.4.5` fandt ikke `## [5.7.4]`).

**Rettelser:**
- Backend (`update_service.py`): fallback matcher nu på 3-parts semver. En debug-build som `5.7.4.5` finder korrekt sektionen `## [5.7.4]` i RELEASE_NOTES.md.
- Når portalen **er à jour**: vises release notes for den installerede version (hvad er nyt her).
- Når en **opdatering er tilgængelig**: alle sektioner fra installeret version op til den nye version vises — ældstet til nyest.
- Frontend: range-label bruger base-version (`5.7.4`, ikke `5.7.4.5`) for korrekt `vX.Y.Z → vA.B.C`-visning.

---

## [5.7.5] — 2026-05-23 — Skabelon gem/anvend i Browse-Edit og Registrering

### Gem endpoint som skabelon (Browse-Edit)

I detail-modalen er der nu en skabelon-bar under endpoint-fanens indhold — et dropdown til at vælge eksisterende skabeloner og to knapper: **Anvend skabelon** og **Gem som skabelon**.

**Gem som skabelon** indsamler de aktuelle formfelter (gruppe, beskrivelse, statisk tildeling, type, owner, lokation, VLAN, ACL, platform) og gemmer dem som en ny skabelon via den eksisterende skabelon-API. PSK_Mode-flaget kan indgå i skabelonen — **PSK-nøglen gemmes aldrig**.

### Anvend skabelon (Browse-Edit)

**Anvend skabelon**-dropdown lister alle tilgængelige skabeloner. Når en vælges og knappen klikkes, udfyldes formfelterne fra skabelonens data. Hvis skabelonen har `PSK_Mode = true`, promptes brugeren for PSK-nøglen — den indgår kun i den aktuelle formular-session og gemmes ikke.

### Registreringssiden: samme flow

Registreringssiden understøtter nu også:
- **Anvend skabelon**: eksisterende dropdown synlig for alle roller når skabeloner findes
- **Gem som skabelon**: ny knap synlig for editor/admin/editor-psk — gemmer den aktuelle formtilstand som skabelon og genindlæser skabelon-listen
- PSK_Mode fra skabelon: sætter PSK-tilstanden og prompter for nøgle (kun for PSK-editors)

---

## [5.7.4] — 2026-05-23 — Første gang set: bugfixes og komplet livscyklus-håndtering

### Kolonneforskydning rettet

**Problem:** "Første gang set"-kolonnen manglede en `<td>`-celle i datarækker, hvilket rykkede alle efterfølgende kolonner (NAS, ISE Session m.fl.) én position til venstre.
**Fix:** `cells`-objektet i `browse-table.js` havde ikke `first_seen`-nøgle — tilføjet.

### Præcist dato+tidspunkt

Kolonnen viser nu `DD-MM-YYYY HH:MM` (f.eks. `23-05-2026 09:15`) i stedet for relativ alder.

### Komplet livscyklus — alle 3 sletnings-scenarier håndteres

Tidsstemplet i portalens `first_seen.db` nulstilles korrekt i alle tilfælde:

| Scenario | Håndtering |
|---|---|
| **Slettet via portal** | MAC fjernes fra databasen øjeblikkeligt ved sletning |
| **Slettet i ISE, genskabt** | ISE tildeler nyt endpoint-ID — portalen opdager ID-skiftet ved næste observation og nulstiller tidsstemplet |
| **Slettet i ISE, aldrig tilbage** | Prewarm-scan (kører hvert 30. min) opdager at endpointet er forsvundet fra ISE og rydder databaseposten automatisk |

---

## [5.7.2] — 2026-05-22 — Første gang set: endpoint-database med dato-filter

### Ny "Første gang set" kolonne med historik-database

**Baggrund:** Portalen viste ingen information om hvornår et endpoint første gang dukkede op i ISE. Nu gemmer backend tidsstemplet for det første observerede tidspunkt i en SQLite-database — permanent og uforanderlig for hvert endpoint.

**Ændringer:**
- Ny SQLite-database `backend/cache/first_seen.db` — gemmer `(mac, first_seen_at, endpoint_id)` med `INSERT OR IGNORE` (første observation er immutable).
- `EndpointDetail.first_seen_at` (Unix-timestamp float) tilgængeligt på alle endpoints via `_fetch_endpoint_detail`.
- Browse-tabellen erstatter den gamle "Age"-kolonne med **"Første gang set"** — viser dato+tid (DD-MM-YYYY HH:MM).
- Filterpanelet på kolonnen viser to dato-picker inputs (Fra / Til) i stedet for tekstfilter.
- Filter understøtter åbne intervaller (kun fra-dato, kun til-dato, eller begge).
- Dato-filter gemmes/gendannes i saved views og ved sidegenindlæsning.
- Sortering på kolonnen virker numerisk på timestamp.

---

## [5.7.1] — 2026-05-22 — Batch-simulering: RADIUS-parametre og templates

### RADIUS-attributter i Batch policy-match

**Baggrund:** Batch-simulatoren matchede kun på endpoint-attributter (Owner, Type, Group m.m.) — RADIUS-betingelser (NAS-Port-Type, Called-Station-ID osv.) blev altid skippet. Nu kan man angive de samme RADIUS-parametre som i single-endpoint simulatoren.

**Ændringer:**
- Ny RADIUS-sektion i Batch-simuleringsmodalen: "+ Tilføj parameter"-knap, nøgle/værdi-felter med datalist-autocomplete.
- Template-support med load/gem/slet — deler localStorage-nøgle med single-endpoint simulatoren, så gemte templates er tilgængelige begge steder.
- Alle valgte endpoints simuleres med de samme RADIUS-værdier.
- Backend `BatchSimRequest` udvides med `radius_attrs: dict` — nul breaking change (default `{}`).

---

## [5.7.0] — 2026-05-22 — JSON-eksport, session anomali-detektion, silent token refresh

### Tre nye features i Browse og sikkerhed

**JSON-eksport fra Browse:**
- Ny "Eksportér JSON"-knap i Browse-toolbar ved siden af CSV-knappen.
- Eksporterer valgte, filtrerede eller alle endpoints som et JSON-array (`EndpointDetail`-format).
- Nyttig til API-consumption og scripting.

**Session anomali-detektion (pxGrid):**
- Ny `pxgrid/anomaly_detector.py` overvåger session-stream i realtid via observer-hook på `SessionCache`.
- Detekterer: **bulk-disconnect** (>10 disconnects på <30s) og **NAS-IP churn** (samme MAC skifter NAS-IP >3 gange på <60s).
- Anomalier vises som dismissible advarselsbannere øverst i Browse, og tæller med i nav-badge.
- Ny `GET /api/pxgrid/anomalies` returnerer aktive anomali-alerts.

**Access token silent refresh:**
- Opgraderet fra polling-baseret (`setInterval`) til scheduler-baseret (`scheduleTokenRefresh` i `auth.js`).
- Token fornyes præcist 15 min inden udløb via `setTimeout` — ingen UI-forstyrrelse.
- Polling-fallback hvert minut sikrer mod tab-sleep og clock-skew.
- `cancelTokenRefresh()` kaldes ved logout.

---

## [5.6.32] — 2026-05-22 — Kodebase-kvalitet P2 (tests, refaktor, arkitektur)

### 190 tests, service-split og API-split

**Baggrund:** P2-sprint baseret på kvalitetskontrol-rapport v5.6.31. Fokus på testdækning, kodeorganisering og dokumentation.

**Ny testdækning:**
- **test_endpoints.py:** 20 unit-tests for EndpointService CRUD (create, get, update, delete) med mock ISE-klient. Dækker PSK-masking, rolle-filtrering, audit-records og cache-invalidering.
- **test_policy.py:** 35 unit-tests for policy condition matching (`_eval_operator`, `_eval_identity_group`, `_get_ep_value`, AND/OR-blokke, Radius-skip, `match_endpoint` med disabled-regel-skip).
- **test_pxgrid.py:** 30 unit-tests for PxGrid session worker (`_parse_vlan`, `_extract_sessions`, `_extract_endpoints`, WorkerStatus, lifecycle start/stop).
- **Samlet: 190/190 tests bestået.**

**Kodeorganisering:**
- **`services/_endpoint_helpers.py`:** 144 linjer rene hjælpefunktioner udtrukket fra `endpoint_service.py` (PSK encode/mask/validate, custom attrs, rolle-filter, tekst-søgning).
- **`api/endpoints_ops.py`:** 204 linjer operationelle ruter (CoA, ANC, historik, bulk-CoA) udtrukket fra `api/endpoints.py`.
- **`api/_endpoint_api_helpers.py`:** Delte hjælpefunktioner til begge endpoint-routers.

**Bugfix:**
- `match_endpoint` sprang ikke disabled ISE-regler over under simulering — rettet til at matche ISE's faktiske evaluerings-adfærd.

**Tooling:**
- `pytest-cov` og `mypy` tilføjet til dev-afhængigheder.

---

## [5.6.31] — 2026-05-22 — Kvalitet og stabilitet (P1 afslutning)

### Timerlækage og testdækning

**Baggrund:** Fortsættelse af P1-kvalitetssprint — UX, robusthed og automatiseret testdækning.

**Rettelser:**
- **Timerlækage i metrics og policy:** Metrics- og policy-visningerne returnerer nu en cleanup-funktion der afregistrerer intervaller ved navigation. Forhindrer CPU-spild ved hyppig side-skift.
- **XSS-beskyttelse i metrics og policy:** De to resterende visninger med lokale `esc()`-kopier bruger nu den centrale implementation.
- **Async event loop stabilitet:** Tre baggrundstjenester (cache-sync, cache-prewarm, audit-retention) oprettede `asyncio.Event()` i `__init__` i stedet for ved `start()`. Dette forårsagede fejl ved genstart i en ny event loop. Rettet.
- **Python 3.14 UnboundLocalError:** En betinget lokal import i `login()` skyggede modul-level import og forårsagede `UnboundLocalError` på Python 3.14. Rettet.
- **Testsuite: 89/89 bestået:** 22 nye tests for auth og autorisation tilføjet og alle 89 tests kører nu fejlfrit.

---

## [5.6.30] — 2026-05-22 — Sikkerhedsfix (P1)

### Kritisk: XSS-beskyttelse og bug-fix i HTML-escaping

**Baggrund:** En kvalitetskontrol-analyse (P1 sprint) afslørede at HTML-escape-funktionen i browse-visningerne kun escaped `"` og `<` — ikke `&`, `>` eller `'`. En separat bug i importvisningen kaldte en funktion der ikke var defineret.

**Rettelser:**
- **Komplet HTML-escape overalt:** Alle views bruger nu én fælles `esc()`-funktion fra `browse-utils.js` med fuld escaping af `& < > " '`. Tidligere var 13 views afhængige af lokale kopier med varierende sikkerhedsniveau.
- **Bug i importvisning:** Importvisningen kaldte `esc()` som aldrig var defineret (kun `escapeHtml()` fandtes) — dette udløste en `ReferenceError` ved fejlvisning. Rettet.
- **Bulk-import grænse:** Maksimalt 5.000 endpoints ad gangen ved bulk-import (tidligere ingen grænse — potentiel ISE-overbelastning).

---

## [5.6.29] — 2026-05-22 — Forbedring

### Nyt layout i Policies-sektionen

**Policy-siden har fået et nyt, mere overskueligt 3-panel layout.**

- **Sidebar til venstre (Policy Sets):** Policy sets vises nu som en vertikal navigationsliste i stedet for en horisontal kortræk. Hvert set viser en farvet state-indikator (grøn = aktiv, grå = inaktiv), setnavn, service-navn og en status-pill. Det aktive set fremhæves med en blå kant og lysblå baggrund.
- **Regler i midten:** Autoriseringsreglerne for det valgte policy set er i et eget panel med selvstændig scroll.
- **Detalje/editor til højre:** Detaljepanelet fylder den resterende plads.
- Designet virker i både lys, mørk og midnight-tema.

---

## [5.6.27] — 2026-05-22 — Forbedring

### Progress-indikator ved gem af multiple endpoints

**Når du gemmer flere endpoints på én gang (Gem alle ændrede / Gem valgte) vises nu en fremgangsindikator.** Meldingsfeltet over tabellen viser "Gemmer X / Y… [MAC]" og en blå progress-bar der fylder sig op i takt med at hvert endpoint gemmes. Ved afslutning erstattes indikatoren af den sædvanlige succes/fejl-besked.

---

## [5.6.26] — 2026-05-21 — Bug fix release

### Valgte endpoints i browse-tabellen mistede selektion ved automatisk opdatering

**Valgte checkbokse i browse-tabellen nulstilles ikke længere ved automatisk baggrundsopdatering.** Fejlen opstod fordi pxGrid `endpoint_changed`-events triggede en fuld re-render af tabellen via `renderRows()`, som erstatter hele `tbody.innerHTML` og dermed sletter alle checkboks-tilstande. `renderRows()` gemmer nu de valgte endpoint-IDs inden re-render og gendanner dem i den nye HTML.

---

## [5.6.25] — 2026-05-21 — Bug fix release

### Batch-simulering viste fejl på alle endpoints

**Batch-simulering fra browse-tabellen virker nu korrekt.** Fejlen skyldtes at backend-koden refererede `result.matched_rule` og `result.matched_profile` — de korrekte feltnavne på `PolicyMatchResult`-objektet er `matched_rule_name` og `profiles`. Alle endpoints returnerede "has no attribute 'matched_rule'" i stedet for simuleringsresultater.

---

## [5.6.24] — 2026-05-21 — Forbedring

### Opdatering viser alle release notes fra nuværende til nyeste version

**Når portalen tjekker for opdateringer og der er en nyere version tilgængelig, vises nu alle release notes for mellemliggende versioner stacked i rækkefølge** — ikke blot den nyeste version. Er portalen eksempelvis på v5.6.19 og nyeste er v5.6.23, vises release notes for v5.6.20, v5.6.21, v5.6.22 og v5.6.23 under hinanden adskilt med en separator. Ældste øverst, nyeste nederst. Summary-linjen viser nu `v{nuværende} → v{nyeste}`.

---

## [5.6.23] — 2026-05-21 — Ny funktion

### Config backup og restore

**Ny fane "Backup / Restore" i Settings (admin-only).** Download en komplet backup af alle portalens konfigurationsfiler som ét JSON-dokument — indstillinger, brugere, skabeloner, roller og mapping. Gendan en backup ved at uploade filen og bekræfte — filer overskrives straks. Genstart backend efter restore for at ISE-forbindelsesindstillinger træder i kraft.

**Vigtigt:** Backup-filen indeholder credentials (ISE password og JWT-secret). Opbevar filen sikkert.

---

## [5.6.22] — 2026-05-21 — Ny funktion

### Batch-simulering af policy-match direkte fra browse-tabellen

**Vælg et eller flere endpoints i browse-tabellen og klik "Simulér match" i toolbar.** En modal åbner med alle policy-sæt i en dropdown. Klik "Kør simulering" og se resultater pr. endpoint: MAC-adresse, matchet regel, matchet profil og status (Match / Ingen match / Delvis / Fejl). Understøtter op til 100 endpoints pr. kørsel (begrænsning fra backend).

---

## [5.6.21] — 2026-05-21 — Ny funktion

### Audit-log CSV-eksport

**Audit-siden har nu en "Eksportér CSV"-knap.** Eksporterer alle audit-events der matcher de aktuelle filtre (ressourcetype og søgetekst) som en CSV-fil — maks. 10 000 rækker. Filen indeholder tidsstempel, bruger, handling, ressourcetype, ressource-ID og IP-adresse. Filen downloades direkte i browseren.

---

## [5.6.20] — 2026-05-21 — Ny funktion

### Livscyklus-viewer — find og ryd op i inaktive endpoints

**Ny side under Overvågning → Livscyklus (admin-only).** Viser alle endpoints der ikke har haft portal-aktivitet (opret, rediger, slet) i det valgte tidsrum. Valgmuligheder: 30, 60, 90, 180 eller 365 dage. Tabellen viser MAC-adresse, endpoint-gruppe, profil, ejer og cache-alder. Resultaterne kan eksporteres som CSV direkte fra browseren.

Data baseres på audit-loggen — kun aktivitet registreret i portalen tæller (ikke ændringer foretaget direkte i ISE).

---

## [5.6.19] — 2026-05-21 — Ydelsesforbedring

### Endpoint save er nu markant hurtigere

**Gemning af et enkelt endpoint er nu ca. 50% hurtigere.** Tidligere ventede portalen på to ISE API-kald i rækkefølge før siden responderede: først PUT (opdateringen) og derefter GET (snapshot til audit-log). Det betød typisk 600-1200ms ventetid. Nu returneres siden straks efter PUT — audit-snapshottet hentes i baggrunden uden at brugeren venter.

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
