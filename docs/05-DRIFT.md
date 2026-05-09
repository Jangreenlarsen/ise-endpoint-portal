<!-- Version: 4.0.1 | Opdateret: 2026-05-09 -->

# 05 — Drift og vedligeholdelse

---

## Start, stop og genstart

### Normal start

```powershell
cd C:\HyperVision
START.bat
```

START.bat er loop-baseret: hvis processen afsluttes (fejl, opdatering, manuel stop) genstartes den automatisk efter 3 sekunder. CMD-vinduet skal forblive åbent.

### Stop

Luk CMD-vinduet, eller tryk Ctrl+C i vinduet (to gange kan være nødvendigt for at afbryde loopet).

### Genstart (manuel)

Luk CMD-vinduet og åbn et nyt med START.bat, eller tryk Ctrl+C og lad START.bat's loop-genstart håndtere det.

### Windows-tjeneste (NSSM)

Hvis portalen kører som Windows-tjeneste via NSSM:

```powershell
# Stop tjenesten
nssm stop HyperVisionISE

# Start tjenesten
nssm start HyperVisionISE

# Genstart tjenesten
nssm restart HyperVisionISE

# Se status
nssm status HyperVisionISE
```

### Genstart via portal

Admin kan genstarte backend direkte fra Settings → Opdatering → "Genstart server". Portalen kalder `os._exit(0)` og START.bat (eller NSSM) genstarter processen automatisk.

### Opstartstid

Ved første opstart (tom cache): portalen er klar til login i ca. 5–10 sekunder. Browse vil vise ⏱-badges på alle rækker indtil pre-warm-workeren har gennemgået ISE-endpoints (varierer med antal endpoints og ISE-latency).

Ved genstart (disk-cache eksisterer): portalen viser cached data øjeblikkeligt. ⏱-badges fjernes efterhånden som pre-warm validerer.

---

## Backup

### Hvilke filer skal tages backup af

| Fil / Mappe | Indhold | Kritikalitet |
|---|---|---|
| `backend/config.json` | ISE-credentials, alle settings | Kritisk |
| `backend/users.json` | Alle brugerkonti med hashede passwords | Kritisk |
| `backend/auth_secret.key` | JWT-signeringsnøgle | Kritisk — tab af denne ugyldiggør alle sessioner |
| `backend/custom_attr_values.json` | Tilladte værdier for managed attributter | Vigtig |
| `backend/platform_mapping.json` | PlatformType-mapping med CoA-binding | Vigtig |
| `backend/endpoint_roles.json` | System adm-tag-katalog | Vigtig |
| `backend/pxgrid/` | pxGrid-certifikatfiler | Vigtig — genskabes via CSR-flow men kræver ISE-godkendelse |
| `cache/endpoints.json` | Disk-persisteret endpoint-cache | Ikke kritisk — regenereres automatisk |
| `backend/logs/` | Runtime-logfiler | Anbefalet til audit-trail |

### Backup-procedure

```powershell
# Simpel filkopi til backup-mappe
$dato = Get-Date -Format "yyyyMMdd-HHmm"
Copy-Item "C:\HyperVision\backend\config.json" "C:\Backup\HV-$dato-config.json"
Copy-Item "C:\HyperVision\backend\users.json" "C:\Backup\HV-$dato-users.json"
Copy-Item "C:\HyperVision\backend\auth_secret.key" "C:\Backup\HV-$dato-auth_secret.key"
```

Alternativt: inkludér hele `C:\HyperVision\backend\` i virksomhedens standard backup-job, ekskl. `.venv\`-mappen (genskabes via `pip install`).

### Frekvens

Backup af config.json, users.json og auth_secret.key bør tages minimum dagligt og ved enhver ændring af brugere eller settings.

---

## Log-rotation og -vedligeholdelse

### Automatisk rotation

`backend/logs/app.log` roteres automatisk:

- Maksimal filstørrelse: **5 MB**
- Antal backup-filer: **3** (`app.log.1`, `app.log.2`, `app.log.3`)
- Samlet maksimalt log-forbrug: ca. **20 MB**

Rotation sker i processen og kræver ingen ekstern opsætning.

### Manuel oprydning

Hvis logfiler er vokset meget (f.eks. efter fejlsøgning med DEBUG-niveau), kan de slettes manuelt mens portalen kører — Python åbner logfilen på ny ved næste rotation. Stop portalen inden sletning hvis du vil slette den aktive `app.log`.

```powershell
# Slet backup-logfiler (bevar aktiv log)
Remove-Item "C:\HyperVision\backend\logs\app.log.*"
```

### Log-niveau

Log-niveau konfigureres i `backend/app/core/logging.py`. DEBUG-niveau genererer meget data og bør kun bruges kortvarigt under fejlsøgning. Default er INFO.

---

## Fejlsøgningsguide

| Symptom | Sandsynlig årsag | Løsning |
|---|---|---|
| Browse viser "503 ISE midlertidigt utilgængelig" | Backend kan ikke nå ISE (netværk, ISE nede, forkert URL) | Tjek netværksforbindelsen fra portal-server til ISE port 443. Tjek ISE-status. Verificér ISE URL i Settings |
| Browse viser data men ⏱ på alle rækker | Portalen netop genstartet og pre-warm ikke færdig endnu | Vent — badges forsvinder efterhånden |
| pxGrid-worker viser "Disconnected" i Settings | WebSocket-forbindelsen til ISE mistet | Tjek at ISE pxGrid Service kører. Tjek port 8910. Se "Last error" i worker-status. Klik "Genstart worker" |
| pxGrid forbinder men modtager 0 session-events | Ingen aktiv RADIUS-trafik i testperioden, eller ISE-klient ikke godkendt | Kør STOMP-prober under aktiv bruger-login. Verificér at klienten er "Approved" i ISE pxGrid Clients |
| Login fejler med "Ugyldige credentials" | Forkert password, eller auth_secret.key er ændret/slettet | Nulstil brugerens password via admin-bruger. Hvis auth_secret.key mangler: genopret fra backup |
| Alle brugere logges ud efter genstart | auth_secret.key er regenereret (f.eks. efter manuel sletning) | Alle brugere skal logge ind igen. Tag backup af auth_secret.key |
| CSV-import fejler med "Failed: N" | Ugyldige MAC-adresser, ISE rate-limit eller ISE-fejl | Se fejl-kolonnens MAC-liste. Tjek app.log for ISE-fejlkode. Prøv igen med færre rækker |
| CoA reauth virker ikke | PSN-hostnavn forkert, ISE-bruger mangler MnT Admin-rolle, forkert reauth-type | Kontrollér PSN-hostnavn i Settings. Verificér MnT Admin-rollen på ISE-brugeren. Tjek app.log for MnT-fejlkode |
| PlatformType sync fra MnT returnerer 0 | Ingen aktive RADIUS-sessions med genkendelig platform-AVP | Kør sync under aktiv netværkstrafik. Kontrollér at ISE RADIUS-accounting er aktiveret |
| Edit-modal viser "Henter..." i lang tid | Force-fresh-kald til ISE tager lang tid (høj ISE-latency) | Hæv `ise_timeout` i Settings. Kontrollér ISE-load |
| Portal starter ikke (START.bat afsluttes straks) | Python-fejl ved opstart — typisk syntaksfejl i opdateret kode eller manglende dependency | Start manuelt: `cd backend && .venv\Scripts\python -m uvicorn app.main:app` og læs fejloutput |
| "400 Ugyldig DACL — src skal være any" fra ISE | En ACE har konkret source-IP (portalen burde have fanget dette) | Ret ACE til `any` som source. Rapportér som bug |

---

## Ydelsestuning

### Cache TTL og pre-warm interval

Sammenhængen mellem de to parametre:

- **Lav TTL + lavt interval:** Høj konsistens med ISE, høj ISE-belastning. Egnet til miljøer med <100 endpoints og kritisk konsistens-krav.
- **Høj TTL + højt interval:** Lav ISE-belastning, lav konsistens. Egnet til miljøer med pxGrid aktivt (der håndterer session-events i realtid) og stabile endpoint-konfigurationer.
- **Anbefalet udgangspunkt:** TTL 60 s, interval 1800 s. Justér baseret på observeret ISE-load.

### Pre-warm concurrency i forhold til ISE-belastning

ISE ERS har en praktisk rate-limit på ca. 5–10 requests/sek. Med concurrency=5 og 150 ms bulk-delay er den effektive rate ca. 6 req/sek — tæt på grænsen.

| Endpoint-antal | Anbefalet concurrency |
|---|---|
| Under 200 | 5 (default) |
| 200–500 | 5 |
| 500–1000 | 3 |
| Over 1000 | 2–3 og hæv interval til 3600 s |

### pxGrid som ydelsesoptimering

Med pxGrid aktivt og stabile session-events kan pre-warm-intervallet hæves til 3600 s (60 min) eller mere, fordi session-cache holdes aktuel via push. Cache-TTL kan ligeledes hæves til 300 s da endpoint-konfigurationer ændres sjældnere end sessions.

---

## ISE-timeout anbefalinger

ISE's svartider varierer med belastning og deployment-størrelse.

| Scenarie | Anbefalet `ise_timeout` |
|---|---|
| Lille deployment (<200 endpoints, lokal ISE) | 15 s |
| Mellemstor deployment (200–500 endpoints) | 30 s (default) |
| Stor deployment (>500 endpoints) eller ISE over WAN | 60 s |
| ISE under høj belastning (mange samtidige sessions) | 60–90 s |

En for lav timeout medfører at ISE-kald afbrydes og returnerer 503 til brugeren selv om ISE ville have svaret. En for høj timeout betyder at brugere venter unødigt lang tid ved reelle fejl.

Timeoutten gælder per HTTP-kald. Bulk-operationer (pre-warm, CSV-import) summerer timeouts over mange kald; den samlede ventetid begrænses af concurrency og antal endpoints, ikke af den individuelle timeout.
