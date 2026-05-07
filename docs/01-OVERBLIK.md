<!-- Version: 3.15.5 | Opdateret: 2026-05-07 -->

# 01 — Systemoverblik

---

## Formål og målgruppe

HyperVision ISE Portal er et web-baseret administrationssystem til daglig endpoint-drift i Cisco ISE 3.4. Målgruppen er netværks- og sikkerhedsadministratorer der opretter, redigerer og overvåger endpoints i større miljøer — og fieldteknikere der registrerer udstyr on-the-spot via mobiltelefon.

Portalen løser tre konkrete problemer med ISE's native GUI:

1. ISE's endpoint-administration er optimeret til opsætning, ikke til gentagen daglig brug. Selv simple opgaver som at skifte VLAN-attribut på ti endpoints kræver mange klik.
2. ISE har ingen struktureret rollemodel til at afgrænse hvilke endpoints den enkelte administrator må se og redigere.
3. ISE's GUI giver ingen realtidsoverblik over sessioners auth-status uden at navigere til Monitor-sektionen.

---

## Systemkomponenter

```
+-------------------+        HTTP/JSON         +---------------------+
|   Browser         | ─────────────────────── > |   FastAPI backend   |
|   (HTML/JS)       | < ─────────────────────── |   (Python 3.11+)    |
+-------------------+    SSE (pxGrid events)    +----------+----------+
                                                           |
                          +────────────────────────────────+
                          |                                |
                          v  HTTPS port 443                v  WSS port 8910
               +──────────────────────+        +──────────────────────+
               |   Cisco ISE 3.4      |        |   ISE pxGrid 2.0     |
               |   ERS / Open API /   |        |   pubsub-node        |
               |   MnT API            |        |   (WebSocket/STOMP)  |
               +──────────────────────+        +──────────────────────+
```

Frontend taler udelukkende med backend. Backend er den eneste komponent der kommunikerer med ISE. Ingen ISE-credentials eksponeres til browseren.

Backend er opdelt i fire lag:

| Lag | Mappe | Ansvar |
|---|---|---|
| **API** | `backend/app/api/` | FastAPI routers, auth-guards, input-validering, HTTP-svar |
| **Service** | `backend/app/services/` | Forretningslogik, orkestrering, fejlhåndtering |
| **Integration** | `backend/app/ise/` og `backend/app/pxgrid/` | Al kommunikation med ISE |
| **Core** | `backend/app/core/` | Config, logging, exceptions, persistens, cache |

---

## REST-integration

Portalen bruger tre REST-grænseflader mod ISE, alle på port 443.

### ERS (External RESTful Services)

ERS er ISE's primære konfigurationsAPI. Portalen bruger ERS til:

- List, hent, opret, opdater og slet endpoints (`/ers/config/endpoint/`)
- Hent endpoint-grupper (`/ers/config/endpointgroup/`)
- Filter-syntaks med operatorer som `CONTAINS`, `EQ`, `STARTSW` på MAC-adresse og andre felter
- Bulk-loop: ERS returnerer max 100 poster pr. side; portalen paginerer automatisk

ERS anvender HTTP Basic Auth og returnerer JSON. ISE afviser kald der overskrider ca. 5–10 requests/sekund, og portalen indfører 150 ms delay mellem kald i bulk-operationer.

### Open API

ISE's Open API (`/api/v1/`) bruges til:

- Custom attribute-definitioner (opret og hent)
- DACL-management (downloadable ACL'er)
- Endpoint-CRUD som alternativ til ERS (konfigurerbar via Settings)

Open API bruger Bearer Token-auth og returnerer JSON med en anden payload-struktur end ERS. Backend normaliserer begge til det samme interne DTO-format, så service-laget er API-type-agnostisk.

### MnT (Monitoring and Troubleshooting)

MnT API bruges til operationelle data der ikke er tilgængelige via ERS eller Open API:

- Aktive RADIUS-sessions (`/admin/API/mnt/Session/ActiveList`) — bruges til grøn/rød farve i Browse
- CoA Reauth (`/admin/API/mnt/CoA/Reauth/`) — tvinger fornyet policy-evaluering
- CoA Disconnect (`/admin/API/mnt/CoA/Disconnect/`) — deautentificerer klienten

MnT kræver en ISE-bruger med MnT Admin-rollen. MnT API er read-only undtagen CoA-kaldene.

---

## pxGrid 2.0

### Hvad er pxGrid 2.0?

pxGrid (Platform Exchange Grid) er ISE's native event-bus. Det er en publish-subscribe infrastruktur der lader tredjepartssystemer abonnere på ISE-events i realtid. pxGrid 2.0 bruger WebSocket med STOMP-protokollen og kører på port 8910.

Portalen etablerer en persistent WebSocket-forbindelse til ISE's pubsub-node og abonnerer på to topics:

- `com.cisco.ise.session` — session-events: sessionCreated, sessionUpdated, sessionDisconnected
- `com.cisco.ise.endpoint` — endpoint-ændringer (begrænset support i ISE 3.4, se nedenfor)

### Hvad sker der med pxGrid aktiv?

Når en RADIUS-session oprettes eller afsluttes sender ISE et event via pxGrid. Portalen modtager eventen, opdaterer sin in-memory session-cache og broadcaster ændringen til alle tilsluttede browsers via Server-Sent Events. Browse-sidens sessionsfarver skifter dermed live uden polling og uden at browse-siden skal genindlæse endpoints fra ISE.

### Hvad sker der uden pxGrid?

Uden pxGrid falder portalen tilbage til MnT-polling: Browse-siden forespørger periodisk listen over aktive RADIUS-sessions fra MnT API. Sessions-farverne opdateres med en forsinkelse svarende til poll-intervallet. Funktionen virker, men er ikke realtid.

### pxGrid og ISE 3.4 — kendte begrænsninger

ISE 3.4 publicerer ikke endpoint-CRUD-events via pxGrid selv med `com.cisco.ise.endpoint`-topic aktiveret. ServiceLookup og SUBSCRIBE accepteres, men ingen events leveres ved admin-oprettelse/-sletning i ISE-GUI. Det er Ciscos design for denne version. Portalen bruger i stedet sin pre-warm background-sync (default 30 min) som fallback for endpoint-cache-invalidering. pxGrid-endpoint-topic er bevaret som opt-in da den kan levere profiler-drevne ændringer.

### Autentificering mod pxGrid

pxGrid kræver X.509 klient-certifikat (mTLS). Portalen understøtter tre metoder til at etablere certifikatet:

1. CSR-flow mod ISE internal CA (portalen genererer nøglepar og CSR, admin godkender i ISE)
2. Upload af tre separate PEM-filer (cert, key, CA-chain)
3. Import af PKCS#12-bundle (.pfx fra MS certsrv eller anden CA)

---

## Cache-arkitektur

Portalen implementerer en to-lags cache for at minimere ISE-kald og give hurtig respons.

### Lag 1: In-memory cache (TTL + Stale-While-Revalidate)

Alle endpoint-detaljer gemmes i en in-memory dict med `{endpoint_id → (EndpointDetail, fetched_at)}`. Når data er freshe (inden for TTL, default 60 s) serveres de fra cache uden ISE-kald. Når data er stale men inden for SWR-vinduet returneres de øjeblikkeligt, og en baggrunds-refresh startes asynkront. Samtidige forespørgsler på samme endpoint koalescerer til ét ISE-kald.

### Lag 2: Disk-persistens

Cachen serialiseres til `cache/endpoints.json` ved shutdown og ved pre-warm-scans. Ved genstart indlæses disk-cachen øjeblikkeligt, så Browse viser data med det samme. Rækker der hviler på disk-cache markeres med et ⏱-badge i Browse-tabellen indtil de er valideret mod ISE.

### Pre-warm worker

En baggrunds-worker scanner alle ISE-endpoints ved startup og herefter med et konfigurerbart interval (default 30 min). Workeren bruger `asyncio.Semaphore(5)` (konfigurerbart) til at begrænse samtidige ISE-kald og undgå overbelastning. Interval og concurrency justeres i Settings → Cache.

### Cache-invalidering

Når portalen opretter, opdaterer eller sletter et endpoint opdateres cache-entry synkront efter det vellykkede ISE-kald. Edit-modalens "Hent fra ISE"-knap tvinger en force-fresh for det pågældende endpoint og sætter det øverst i pre-warm-køen.

---

## Bruger-roller og adgangskontrol

Portalen har fem bruger-roller:

| Rolle | Adgang |
|---|---|
| **admin** | Fuld adgang inkl. brugerstyring, settings, logs, system-opdatering |
| **editor** | Opret, rediger og slet endpoints, attributter, DACL'er, CoA |
| **editor-psk** | Som editor, plus kan se og redigere PSK-nøgler (umaskerede) |
| **viewer** | Kun læsning — kan se Browse men ikke redigere |
| **registrar** | Kan kun oprette endpoints via det mobiloptimerede register-view |

### System adm (endpoint-scoping)

Ud over de fem portal-roller har portalen et tag-baseret endpoint-scoping-system kaldet "System adm". Admin definerer et katalog af tags (f.eks. `PLC-HalA`, `alle-Printer`). Tags tildeles endpoints via `HypervisionRoles`-custom-attributten i ISE. Brugere tildeles et eller flere tags; de ser kun endpoints der matcher mindst ét af deres tags. Admin ser altid alle endpoints uanset tags.

Hver bruger har desuden automatisk sit eget username som implicit tag, så endpoints tagget med brugerens username altid er synlige for den pågældende bruger.

---

## Dataflow-eksempler

### Scenarie 1: Vis endpoint-liste (cache warm)

1. Browser kalder `GET /api/endpoints/details` mod backend.
2. Backend tjekker in-memory cache — data er friske (inden for TTL).
3. Backend returnerer cached data; ISE kontaktes ikke.
4. Responstid: under 10 ms.

### Scenarie 2: Rediger endpoint og gem

1. Bruger åbner edit-modal på et endpoint.
2. Modal kalder `GET /api/endpoints/{id}?force_fresh=true`.
3. Backend henter endpoint direkte fra ISE (bypass cache), opdaterer cache-entry.
4. Bruger ændrer f.eks. AuthzVlan og klikker Gem.
5. Browser sender `PUT /api/endpoints/{id}` med ændrede felter.
6. Backend kalder ISE ERS/Open API med fuld payload, modtager 200 OK.
7. Backend opdaterer cache-entry synkront.
8. Hvis CoA reauth er aktiveret i Browse-toolbar: backend sender CoA Reauth via MnT.
9. Browseren modtager success-respons og opdaterer tabel-rækken.

### Scenarie 3: Live session-opdatering via pxGrid

1. En klient forbinder til netværket og gennemfører RADIUS-autentificering.
2. ISE sender `sessionCreated`-event på `com.cisco.ise.session`-topic via pxGrid.
3. Portalens pxGrid-worker modtager STOMP MESSAGE-frame, parser session-data.
4. Worker opdaterer in-memory session-cache (`MAC → SessionInfo`).
5. Worker broadcaster `upsert`-event på SSE-bus.
6. Alle åbne Browse-faner modtager SSE-event og farver den pågældende rækkes checkbox grøn.
7. Ingen ISE-kald fra frontend; ingen polling.
