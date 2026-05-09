<!-- Version: 4.0.1 | Opdateret: 2026-05-09 -->

# 04 — Administratorvejledning

---

## Brugerstyring

Brugere administreres under Settings → Brugere & Bruger grupper. Kun admin-brugere har adgang til denne sektion.

### Opret bruger

1. Klik "Opret bruger" (formularen nederst i brugertabellen).
2. Angiv brugernavn (unikt, kun alfanumeriske tegn og bindestreg, 3–64 tegn).
3. Angiv initialt password (min. 8 tegn). I **TACACS+-mode** er password-feltet valgfrit — TACACS+-serveren håndterer autentiseringen. Lades det tomt genereres et tilfældigt hash der aldrig bruges.
4. Vælg rolle.
5. Klik **Opret bruger**.

Portalen opretter automatisk et System adm-tag i kataloget med navn = brugerens username. Tagget kan bruges til at mærke endpoints så den pågældende bruger altid kan se sine egne endpoints. Tagget tildeles også brugeren automatisk.

### Roller

| Rolle | Beskrivelse |
|---|---|
| **admin** | Fuld adgang til alle funktioner inkl. brugerstyring, settings, logs og system-opdatering |
| **editor** | Opret, rediger og slet endpoints, attributter og DACL'er; send CoA |
| **editor-psk** | Som editor, plus kan se og redigere umaskerede PSK-nøgler |
| **viewer** | Læseadgang til Browse; ingen skrivning |
| **registrant** | Kan kun oprette endpoints via det mobiloptimerede register-view (alle formularfelter) |
| **registrant_templet** | Begrænset registrering — vælger en skabelon og udfylder kun MAC og beskrivelse |

### Slet bruger

Klik skraldespands-ikonet ud for brugeren og bekræft. Sletning er permanent; endpoints ejerskab flyttes ikke. Admin-kontoen der udfører sletningen kan ikke slettes af sig selv.

### Skift password

Alle brugere kan skifte eget password via Settings → Skift password. Admin kan sætte et nyt password på enhver bruger via Users-siden uden at kende det gamle. TACACS+-brugere kan ikke skifte password via portalen (TACACS+-serveren administrerer passwords).

### System adm-tildeling

Under hver bruger i Users-siden kan admin vælge hvilke System adm-tags brugeren er tildelt via checkboxe. En bruger med tag `PLC-HalA` ser kun endpoints der er tagget med `PLC-HalA` (samt endpoints tagget med brugerens eget username). Admin ser altid alle endpoints.

### Skabelon-tildeling (registrant_templet)

Brugere med rollen `registrant_templet` tildeles specifikke skabeloner via checkboxe i brugertabellen. Kun de tildelte skabeloner er tilgængelige i brugerens register-view.

### Brugere som operatørprofiler (TACACS+-mode)

Når TACACS+-autentisering er aktiveret, fungerer portal-brugerne som **operatørprofiler**: TACACS+-serveren sender attributten `portal-operator-profile = <profilnavn>` i sit Authorization-svar. Portalen slår profilnavnet op som et brugernavn i Users-listen og bruger den matchede brugers rolle, System adm-tags og skabeloner.

Profilnavn i TACACS+-serveren skal matche brugernavnet i portalen **præcist**. Admin-brugere logges altid ind lokalt.

---

## Settings-sektioner

Settings-siden er opdelt i kort. Kun admin har adgang.

### ISE-forbindelse

| Felt | Beskrivelse |
|---|---|
| **ISE URL** | Base-URL til ISE admin-node, f.eks. `https://ise.example.local` |
| **Brugernavn** | ISE-bruger med ERS Admin og MnT Admin roller |
| **Password** | Gemmes i `config.json`; vises ikke ved næste åbning |
| **API-type** | `ERS` eller `Open API` — afgør hvilken ISE-API portalen bruger til endpoint-CRUD |
| **Verificér TLS** | Aktivér certifikat-validering. Kræver at ISE's certifikat er gyldigt og betroet |
| **Timeout (sek.)** | HTTP-timeout per ISE-kald; hæv ved høj latency |
| **PSN-hostnavn** | Bruges til CoA-kald via MnT. Efterlades blank for at udlede fra ISE URL |

Klik "Test forbindelse" for at verificere indstillingerne inden gem.

### Cache

| Felt | Default | Beskrivelse |
|---|---|---|
| **Cache aktiveret** | Ja | Deaktivér kun til fejlsøgning — medfører ISE-kald ved hvert sidevisning |
| **TTL (sek.)** | 60 | Sekunder inden en cache-entry betragtes stale og baggrunds-refresh trigges |
| **Pre-warm interval (sek.)** | 1800 | Sekunder mellem komplette baggrunds-scans af alle ISE-endpoints |
| **Pre-warm concurrency** | 5 | Samtidige ISE-kald under pre-warm; sæt lavere ved belastet ISE |

Se [Cache-indstillinger](#cache-indstillinger) nedenfor for detaljeret forklaring.

### pxGrid

Se [pxGrid-opsætning](#pxgrid-opsætning) nedenfor.

### PSK-politik

| Felt | Beskrivelse |
|---|---|
| **PSK-mode** | `MPSK` eller `IPSK` — afgør om `psk=`-præfix tilføjes/fjernes automatisk |
| **Minimum nøglelængde** | PSK-nøgler kortere end denne afvises |
| **Kræv store bogstaver** | Nøglen skal indeholde mindst ét stort bogstav |
| **Kræv tal** | Nøglen skal indeholde mindst ét ciffer |
| **Kræv specialtegn** | Nøglen skal indeholde mindst ét specialtegn |

Ændringer i PSK-politikken valideres mod nye nøgler fra det øjeblik indstillingen gemmes. Eksisterende nøgler i ISE valideres ikke retroaktivt.

### System adm-roller

Viser kataloget over System adm-tags. Admin kan:

- Oprette nye tags (navn + valgfri beskrivelse).
- Slette tags der ikke er i brug på endpoints.

Tags der er i brug på ISE-endpoints bør fjernes fra endpoints før tagget slettes, ellers forbliver `HypervisionRoles`-attributten på endpoints uændret.

### Portal Auth Config (TACACS+)

Se [Portal Auth Config (TACACS+)](#portal-auth-config-tacacs) nedenfor.

### Portal-opdatering

Se [System-opdatering](#system-opdatering) nedenfor.

---

## Portal Auth Config (TACACS+)

Settings → Portal Auth Config giver mulighed for at vælge om portal-brugere autentiseres lokalt (standard) eller via en ekstern TACACS+-server.

### Auth-mode

| Valg | Beskrivelse |
|---|---|
| **Lokal** | Portalen validerer password mod det lokalt gemte bcrypt-hash. Standard. |
| **TACACS+** | Portalen sender credentials til TACACS+-serveren. Profil og adgangsrettigheder hentes fra den matchede portal-bruger. |

Admin-brugere valideres **altid lokalt** uanset auth-mode. Det sikrer adgang selv ved TACACS+-serverfejl.

### TACACS+-indstillinger

| Felt | Default | Beskrivelse |
|---|---|---|
| **TACACS+ server host** | — | Hostname eller IP på TACACS+-serveren |
| **Port** | 49 | TCP-port. Cisco standard er 49 |
| **Shared secret** | — | Fælles nøgle konfigureret på TACACS+-serveren. Gemmes krypteret; vises ikke igen |
| **Timeout (sek.)** | 5 | Sekunder portalen venter på TACACS+-svar. Øg ved langsom forbindelse |
| **Fallback til lokal auth** | Ja | Hvis TACACS+-serveren er utilgængelig: forsøg lokal auth. Deaktivér for at blokere login ved TACACS+-fejl |
| **Operator-profil attribut** | `portal-operator-profile` | Det TACACS+-attributnavn der indeholder profilnavnet. Ændres kun ved afvigelse fra standard |

### Test TACACS+-forbindelsen

Klik **Test TACACS+** og angiv et testbrugernavn og -password. Portalen udfører et komplet auth + authorization-flow mod TACACS+-serveren og viser:

- **OK**: returneret operatørprofil-navn. Kontrollér at dette navn matcher et brugernavn i "Brugere & Bruger grupper".
- **Fejl**: fejlbeskrivelse — typisk forkerte credentials, forkert server/port, forkert shared secret eller netværksproblem.

### TACACS+-server konfiguration

TACACS+-serveren skal returnere `portal-operator-profile`-attributten i Authorization-svaret. Attributten sættes per bruger eller per gruppe. Eksempel (Cisco ISE TACACS+ Shell Profile):

```
Shell Profile: portal-netadmin
  Custom Attributes:
    Attribute: portal-operator-profile
    Value: netadmin
```

Profilnavnet (`netadmin`) skal præcist matche brugernavnet i portalen. Portalen er case-sensitive i opslaget.

Hvis TACACS+-serveren ikke returnerer attributten, bruges selve login-brugernavnet som fallback-profil.

### Aktivering af TACACS+-mode

1. Opret portal-brugere der matcher TACACS+-profilnavne (Settings → Brugere).
2. Udfyld TACACS+-indstillinger og klik **Test TACACS+** for at verificere.
3. Gem indstillingerne — auth-mode skifter øjeblikkeligt.
4. Eksisterende lokal-auth-sessioner beholdes til token-udløb.

---

## Cache-indstillinger

### TTL (Time-to-Live)

TTL bestemmer hvor lang tid en cache-entry betragtes som frisk. En lav TTL (f.eks. 30 s) giver hurtigere konsistens med ISE men øger ISE-belastningen ved mange brugere. En høj TTL (f.eks. 300 s) reducerer ISE-kald markant men betyder at ændringer foretaget direkte i ISE-GUI ikke reflekteres i portalen før TTL udløber.

Anbefaling: Hold TTL på 60 s (default) i normale driftsmiljøer. Sæt den højere (300 s) hvis pxGrid er aktivt og session-events er den primære ændringsdriver.

### Stale-While-Revalidate (SWR)

Når en entry er stale men en bruger anmoder om data, returnerer portalen de stale data øjeblikkeligt og starter en baggrunds-refresh. SWR-semantikken er altid aktiv og kan ikke deaktiveres selvstændigt.

### Pre-warm interval

Pre-warm-workeren scanner alle ISE-endpoints i baggrunden og holder cachen komplet og aktuel. Intervallet sættes typisk til 1800 s (30 min). Et kortere interval (f.eks. 300 s) kan bruges i dynamiske miljøer med hyppige ISE-ændringer men øger belastningen på ISE.

Workeren kører med `Semaphore(n)` concurrent ISE-kald; default er 5. ISE har typisk en øvre grænse på 5–10 req/sek — sæt concurrency til 3 i miljøer med mere end 500 endpoints for at undgå at ISE throttler.

### Konkret effekt på ISE-load

Med 500 endpoints, TTL 60 s, interval 1800 s og concurrency 5: Pre-warm-scannen tager ca. 500/5 × 0.15 s (bulk delay) = ca. 15 s og afvikles 2 gange i timen. ISE-belastning er minimal i ro (cache-hits). Hæv interval til 3600 s hvis ISE's CPU-load er et problem.

---

## pxGrid-opsætning

pxGrid kræver at portalen er registreret som klient i ISE med et X.509-certifikat. Der er tre fremgangsmåder.

### Metode 1: CSR-flow mod ISE internal CA (anbefalet)

1. Under Settings → pxGrid, angiv **Node-navn** (portalens identitet i ISE, f.eks. `hypervision-portal`) og **PSN FQDN** (ISE pubsub-node, f.eks. `ise-psn1.example.local`).
2. Klik "Generér CSR". Portalen genererer nøglepar og CSR; CSR downloades automatisk.
3. Log ind i ISE: Administration > pxGrid Services > Certificates > Generate pxGrid certificates > CSR.
4. Indsend CSR og download det signerede certifikat samt CA-chain fra ISE.
5. Upload certifikat og CA-chain under "Upload certifikat" og "Upload CA-chain".
6. I ISE: Administration > pxGrid Services > Clients — find portal-klientens entry og klik Approve.
7. Aktivér pxGrid-toggle og gem Settings.

### Metode 2: Upload af separate PEM-filer

Brug dette hvis certifikatet er udstedt af en ekstern CA. Upload tre separate PEM-filer: klient-certifikat, privat nøgle og CA-chain.

### Metode 3: PKCS#12-import (.pfx)

Brug dette hvis certifikatet er eksporteret fra MS certsrv eller en anden CA som en .pfx-bundle.

1. Upload .pfx-filen under "Importér PKCS#12".
2. Angiv .pfx-password.
3. Klik "Importér PKCS#12". Portalen splitter bundlet og gemmer cert/key/CA som separate PEM-filer.
4. Godkend klienten i ISE som i Metode 1, trin 6.
5. Aktivér pxGrid-toggle og gem Settings.

### Verificering med STOMP-prober

Klik "Test STOMP-subscription (10 s)" under pxGrid-kortet. Portalen etablerer en 10 s WebSocket/STOMP-session mod ISE's pubsub-node og rapporterer antal modtagne MESSAGE-frames samt sample-payload. 0 events er ikke en fejl — det kan blot betyde lav RADIUS-trafik i testperioden. En fejl i trin `cert` eller `connect` indikerer certifikat- eller netværksproblem.

### Nulstil registrering

Klik "Nulstil registrering" (rød knap) for at slette portalens certifikatfiler og rydde cert-stier i settings. Brug dette ved server-skift, forkert certifikat eller fejlsøgning. Klient-entry i ISE slettes ikke automatisk — slet den manuelt i ISE Administration > pxGrid Services > Clients hvis et rent flow ønskes.

### Worker-status

Under pxGrid-kortet vises automatisk-opdaterende worker-status:

- **Running / Connected** — pxGrid-worker kører og er forbundet
- **Peer** — ISE PSN som pxGrid er forbundet til
- **Session events / Endpoint events** — antal events modtaget siden opstart
- **Cache-størrelse** — antal MAC-entries i in-memory session-cache
- **Reconnects** — antal genoprettede forbindelser
- **Last error** — seneste fejlbesked

---

## System-opdatering

Portalen understøtter opdatering via ZIP-pakke uploadet direkte i Settings → Opdatering. Ingen SSH eller manuel filkopiering er nødvendig.

### Forberedelse af opdateringspakke

En gyldig opdateringspakke er et ZIP-arkiv der:

- Indeholder `version.json` i roden (krævet).
- Ikke indeholder `.env`-filer eller andre sekretfiler (blokeres af portalen).
- Ikke indeholder path-traversal-stier (blokeres af portalen).

Opdateringspakken kan indeholde en delmængde af projektfilerne — kun de inkluderede filer overskrives.

### Opdateringsflow

1. Under Settings → Opdatering: klik "Vælg fil" og upload ZIP-pakken.
2. Portalen validerer pakken og viser preview:
   - Filer der vil blive opdateret
   - Filer der er blokeret (`.env`, path-traversal)
3. Klik "Anvend opdatering". Portalen skriver filerne til disk; frontend-filer er aktive med det samme.
4. Klik "Genstart server". Portalen kalder `os._exit(0)`; START.bat genstarter processen med den nye kode.
5. Genindlæs browser efter 5–10 sekunder.

Frontend-ændringer aktiveres uden genstart. Backend-ændringer kræver genstart.

---

## Logs-siden

Logs-siden (kun admin) viser de seneste entries fra `backend/logs/app.log` i real-time.

### Hvad man kigger efter

| Log-niveau | Typisk indhold | Handling |
|---|---|---|
| **INFO** | Vellykkede ISE-operationer, opstart, cache-events, TACACS+-login | Ingen — normal drift |
| **WARNING** | Stale cache-hits, ISE-svartider over threshold, TACACS+-fejl, ukendte operatørprofiler | Overvåg — kan eskalere |
| **ERROR** | Fejlede ISE-kald, auth-fejl, pxGrid-fejl | Undersøg årsag |
| **CRITICAL** | Ubehandlede exceptions, disk-fejl | Handl straks |

### Filtrering

Filtrér på log-niveau (DEBUG/INFO/WARNING/ERROR) og fritekst. Søg f.eks. på `pxgrid` for at isolere pxGrid-relaterede hændelser, på `tacacs` for TACACS+-hændelser, eller på et specifikt endpoint-ID for at følge en operationssekvens.

### Log-rotation

`app.log` roteres automatisk ved 5 MB med 3 backup-filer (`app.log.1`, `app.log.2`, `app.log.3`). Logs-siden viser kun den aktive log-fil. For ældre entries: se `app.log.1` osv. direkte på filsystemet.
