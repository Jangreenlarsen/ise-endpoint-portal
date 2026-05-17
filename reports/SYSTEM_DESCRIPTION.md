# HyperVision ISE Portal — Systembeskrivelse

## Formål

HyperVision ISE Portal er en web-baseret administrationsportal der giver netværks- og
sikkerhedsoperatører et samlet, brugervenligt interface til at styre endpoints i Cisco
Identity Services Engine (ISE) 3.4. Portalen erstatter direkte adgang til ISE's egen GUI
for de daglige driftsopgaver og tilbyder rollebaseret adgangsstyring, automatisering og
realtidsoverblik der ikke er muligt i standard-ISE-grænsefladen.

---

## Brugerroller

| Rolle | Adgang |
|---|---|
| **Admin** | Fuld adgang — konfiguration, brugerstyring, alle endpoints |
| **Editor** | Opret, rediger og slet endpoints. Ser egne og tilknyttede endpoints |
| **Editor-PSK** | Som editor + kan se og redigere PSK-nøgler i klartekst |
| **Registrant** | Forenklet registreringsflow: vælg skabelon + MAC — ingen konfigurationsadgang |
| **Viewer** | Skrivebeskyttet adgang til Browse |

Brugere autentiseres enten lokalt eller via en ekstern **TACACS+-server** der tildeler
rolle og operatørprofil via attributter. Admin-brugere valideres altid lokalt som
nødberedskab.

---

## Funktionsområder

### 1. Endpoint Browse — overblik og redigering

Portalens primære arbejdsflade. Viser alle ISE-endpoints i en tabel med kolonner for
MAC-adresse, beskrivelse, endpoint-gruppe, custom attributter (Owner, Type, Lokation,
PlatformType), PSK-status, ISE-session og alder.

- **Filtrering og søgning**: kolonnefiltre med regex-søgning på MAC, dropdowns per
  attribut og auth-status filter (autentiserede / ikke-autentiserede endpoints)
- **Inline-redigering**: attributter redigeres direkte i tabellen og gemmes til ISE uden
  at forlade visningen
- **Sortering**: klik på kolonneoverskrift sorterer stigende/faldende
- **Kolonnestyring**: synlighed og rækkefølge per kolonne kan tilpasses og gemmes
- **Gem filtre som views**: brugerdefinerede filterkombinationer gemmes som navngivne
  "Saved Views"
- **CSV-eksport**: eksportér det filtrerede datasæt i konfigurerbart format

### 2. Endpoint Detail-modal

Klik på et endpoint åbner en detaljeret modal med faneblade:

- **Stamdata**: alle ISE-attributter i redigerbar formular inkl. identitetsgruppe
  (hierarkisk dropdown), PSK-nøgle (maskeret for roller uden adgang) og beskrivelse
- **ISE IDs & Profil**: viser ISE Endpoint ID og Profiler Profile ID med lazy-loadet
  profileringsinfo
- **Profileringsdata**: alle probe-attributter ISE har indsamlet om devicet (DHCP, HTTP,
  MDM, netværk) via Open API
- **RADIUS / Politikker**: simulator der beregner hvilken RADIUS-autorisationsregel der
  ville ramme endpointet (se afsnit 6)
- **ANC (Adaptive Network Control)**: anvend eller fjern ISE ANC-politikker (karantæne,
  afvisning)
- **CoA (Change of Authorization)**: trigger Re-Auth eller Disconnect direkte fra portalen

### 3. Endpoint-registrering

Dedikeret registreringsformular til oprettelse af nye endpoints i ISE:

- Vælg skabelon der forududfylder feltværdier (gruppe, attributter, PSK-politik)
- Angiv MAC-adresse og beskrivelse
- Skabeloner kan begrænses til bestemte roller via `visible_to`-opsætning
- Registrant-rolle ser kun MAC-felt og skabelonvalg — al anden konfiguration er skjult
- Auto-tildeling af brugerens System adm-rolle ved oprettelse

### 4. Bulk-operationer

- **Bulk-opret**: importer endpoints fra CSV med konfigurerbart kolonneformat og
  template-baseret standardværdi-udfyldning; resultater opdeles i
  succeeded/skipped/overwritten/failed
- **Bulk-rediger**: rediger attributter på et udvalg af endpoints simultant
- **Bulk-slet**: slet markerede endpoints med bekræftelsesdialog
- **Bulk-disconnect**: trigger CoA-disconnect på alle valgte endpoints med aktiv session

### 5. ISE Session-integration (pxGrid + MnT)

Portalen integrerer med ISEs pxGrid 2.0-infrastruktur for realtidsdata:

- **pxGrid STOMP-worker**: vedvarende WebSocket-forbindelse der subscriber til
  `com.cisco.ise.session`-topic; opdaterer et in-memory session-cache i realtid
- **SSE-stream til frontend**: session-events streames direkte til Browse-viewet via
  Server-Sent Events — ingen polling nødvendig
- **MnT-berigelse**: supplerer pxGrid-data med autentiserings- og autorisationsdetaljer
  fra ISEs MnT-API (authz-profiler, VLAN, DACL, SGT, identity group)
- **Auto-platform-mapping**: NAS Device Type fra ISE mappes automatisk til portalens
  Platform-attribut via konfigurérbar mapping-tabel
- **Session-kolonnen** i Browse viser: autentiseringsmetode (MAB-badge), policy set-navn,
  authz-profiler, VLAN, DACL og TrustSec SGT

### 6. RADIUS Policy Simulator

I endpoint-detailmodalens RADIUS-faneblad:

- **Simulate Match**: backend henter endpointets live data direkte fra ISE ERS og
  evaluerer det mod alle autorisationsregler i den valgte policy set — returnerer den
  regel ISE sandsynligvis ville ramme
- **RADIUS-parameter prompt**: første simulate identificerer hvilke `Radius.*`-attributter
  (f.eks. `Called-Station-ID`, `NAS-Port-Type`) der indgår i reglerne men ikke kan kendes
  uden live RADIUS-session. Et inputpanel vises der beder brugeren udfylde disse — ny
  simulate med de kendte værdier giver et fuldt præcist match
- **Resultatvisning**: viser matched regel med rank, betingelsesdetaljer (✓ matchede /
  ✗ ikke-matchede / ? ukendte RADIUS-conditions), sub-rules for OR-grene og de tildelte
  authz-profiler
- **Rule Wizard**: opret en ny autorisationsregel i ISE preudfyldt med endpointets egne
  attributter som startbetingelser — condition-editoren understøtter rekursive
  AND/OR-blokke

### 7. Policy Dashboard

Selvstændigt "Politikker"-menupunkt med komplet overblik over ISE RADIUS Network Access:

- Alle policy sets vises som klikbare kort med navn, service og regelantal
- Regler vises som kollapsbar liste — klik på en regel folder den ud med
  betingelses-chips og authz-profiler
- Betingelser vises som farvekodede chips (dictionary:attribut = værdi)
- Opret, rediger og slet autorisationsregler direkte fra dashboardet
- Rekursiv AND/OR gruppe-editor til opbygning af komplekse ISE-betingelsesstrukturer

### 8. Custom Attributter og konfiguration

- **Attributkatalog**: definér dropdown-værdier for Owner, Type, Lokation, PlatformType,
  AuthzVlan, AuthzACL
- **Auto-discovery**: nye attributværdier opdages automatisk ved endpoint-opslag og
  tilføjes til kataloget
- **Raw→Local platform-mapping**: map ISE NAS Device Type NDG-stier til portalens
  Platform-labels med CoA-type per platform
- **ISE Custom Attribute bootstrapping**: portalen sikrer at ISE kender de nødvendige
  custom attribute-definitioner og opretter dem automatisk ved opstart

### 9. Authz Profile Manager

Settings-sektion der administrerer de ISE-autorisationsprofiler portalen bruger:

- Viser status for de fire standardprofiler (`Endpoint_VLAN`, `Endpoint_DACL`,
  `Endpoint_PSK-KEY`, `Endpoint_AirSpaceACL`)
- Opretter automatisk manglende profiler i ISE med korrekte attributter (VLAN fra
  `EndPoints:AuthzVlan`, DACL fra `EndPoints:AuthzACL`, PSK via cisco-av-pair)
- Viser alle ISE-autorisationsprofiler til reference

### 10. Drifts- og platformsfeatures

- **Caching**: in-memory endpoint-cache med TTL, FIFO-eviction (antal + hukommelse),
  disk-persistens og pre-warm ved opstart — Browse viser data øjeblikkeligt selv efter
  genstart
- **Prometheus metrics**: eksponerer `/metrics` med request-histogrammer, cache hit-rate,
  circuit-breaker-state og bulk-outcome-tællere
- **Metrics-dashboard**: live metrics-visning i portalen (kun admin) med
  auto-opdatering hvert 15 sek.
- **Circuit-breaker**: beskytter mod ISE-nedbrud — fast-failer med 503 ved gentagne
  transportfejl, automatisk recovery ved bedring
- **Watchdog-timer**: daemon-tråd der genstarter processen hvis asyncio event-loop hænger
- **Portalopdate via UI**: admin kan uploade en ZIP-opdateringspakke direkte i Settings
  uden SSH-adgang; preview viser hvilke filer der opdateres inden anvendelse
- **Audit-log**: alle ISE-operationer logges til `backend/logs/app.log`
- **Rollebaseret endpoint-synlighed**: endpoints tagges med "System adm"-roller —
  brugere ser kun endpoints der matcher deres egne roller

### 11. Lokalisering

Portalen er fuldt oversat til **dansk og engelsk**. Sprogvalg følger prioriteten:
brugerens præference (gemt server-side) → portal global default (admin-konfigurerbar) →
browser-sprog. Skift sker øjeblikkeligt uden sidegenindlæsning. TACACS+-brugere gemmer
præference i localStorage.

---

## Teknisk arkitektur

```
Browser (HTML/CSS/Vanilla JS)
        │  REST/JSON
        ▼
FastAPI Backend (Python)
        │  HTTPS + mTLS (pxGrid)
        ▼
Cisco ISE 3.4
  ├── ERS API (/ers/config/...)       — endpoints, grupper, NAS devices, profiler, SGT
  ├── Open API (/api/v1/...)          — policy sets, autorisationsregler, endpoint-profiler
  ├── MnT API (/admin/API/mnt/...)    — sessionsdata, auth-status
  └── pxGrid 2.0 (WebSocket/STOMP)   — realtids session- og endpoint-events
```

Frontend taler **aldrig** direkte med ISE — al kommunikation går gennem backend.
Backend er opdelt i fire klare lag:

| Lag | Mappe | Ansvar |
|---|---|---|
| **API** | `api/` | FastAPI routers — validerer input, HTTP-svar |
| **Service** | `services/` | Forretningslogik og orkestrering af ISE-kald |
| **ISE Integration** | `ise/` | Eneste sted der taler HTTP med Cisco ISE |
| **Core** | `core/` | Config, logging, exceptions, cache, metrics |

---

*Dokument genereret 2026-05-17 — version 5.4.8*
