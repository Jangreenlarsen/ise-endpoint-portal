# HyperVision ISE Portal

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Web-baseret administrationssystem til Cisco ISE 3.4 endpoint-management via REST API og pxGrid 2.0.

**Version 5.11.6 build 0550** — [Fuld manual](docs/INDEX.md) — [Changelog](CHANGELOG.md) — [Release Notes](RELEASE_NOTES.md)

Copyright (C) 2026 Jan Green Larsen — udgivet under [GNU Affero General Public License v3](LICENSE)

---

## Hvad er HyperVision ISE Portal, og hvorfor REST + pxGrid?

Cisco ISE er virksomhedens Network Access Control-system. Det er ISE der afgør hvilken VLAN en klient havner i, om den får adgang, og med hvilken policy. Bag den beslutning ligger endpoint-data: MAC-adresse, Identity Group, custom attributes som ejer, lokation, autorisations-VLAN og PSK-nøgle.

ISE's eget administrations-GUI er bygget til at konfigurere systemet som helhed. Det er ikke egnet til daglig operationel drift med hundredvis eller tusindvis af endpoints: det er langsomt, søgning er begrænset, der er ingen bulk-redigering, ingen brugerdefinerede attribut-workflows og alle ISE-admins deler fuld adgang.

HyperVision ISE Portal løser det operationelle arbejde. Den eksponerer præcis de felter der bruges dagligt, med de workflows der er relevante, og med rollebaseret adgangsstyring der begrænser hvad den enkelte bruger kan se og gøre.

Portalen kommunikerer med ISE via to separate protokoller der løser hvert sit problem:

**REST API (ERS + Open API + MnT)** er ISE's klassiske HTTP-baserede administrations-API på port 443. Portalen bruger det til al skrivning og læsning: opret endpoint, rediger attributter, slet group membership, administrer DACLs, hent endpoint-lister. ERS (Cisco ERS API) dækker endpoints og grupper; Open API dækker nyere konstrukter som custom attribute-definitioner; MnT (Monitoring and Troubleshooting API) giver adgang til aktive RADIUS-sessioner og CoA (Change of Authorization). REST er request-response og pull-baseret — portalen spørger, ISE svarer.

**pxGrid 2.0** er ISE's native event-bus. Via en persistent WebSocket-forbindelse på port 8910 med STOMP-protokol modtager portalen events i realtid: RADIUS-autentificeringer, session-oprettelse og -nedrivning, endpoint-ændringer registreret af ISE-profileren. Portalen abonnerer på `com.cisco.ise.session` og `com.cisco.ise.endpoint` og videresender events direkte til browseren via Server-Sent Events, så Browse opdateres inden for millisekunder uden polling.

Uden pxGrid ville sessionsfarver kræve MnT-polling hvert N sekund — unødvendig belastning på ISE og op til N sekunders forsinkelse. Uden REST kan man ikke skrive til ISE — pxGrid er read-only event-streaming.

De to protokoller supplerer hinanden: REST til management, pxGrid til observabilitet i realtid.

---

## Funktioner

### Endpoint-administration
- Opret endpoint — MAC, Identity Group, beskrivelse og alle custom attributes
- Import fra CSV — bulk-opret med auto-detektion af ISE-format og simpelt format, preview og succeeded/failed rapport
- Browse / Edit — tabelvisning med inline-redigering, filter, kolonnevalg og bulk-edit
- **Kolonne-tilpasning** — vælg hvilke kolonner der vises, træk kolonner til ny rækkefølge, og juster kolonnebredder med resize-handle. Alle tre præferencer gemmes automatisk server-side og gendannes på tværs af browsere og enheder (incognito, ny PC) — herunder for TACACS+-brugere
- **Gemte views** — gem og genaktiver navngivne filter+kolonne-kombinationer med ét klik; max 20 views pr. bruger
- **Første gang set** — portalens egen SQLite-database tracker hvornår hvert endpoint første gang blev observeret; kolonnen viser præcist dato+tid (DD-MM-YYYY HH:MM) med Fra/Til dato-filter og fuld sortering
- CoA reauth / disconnect — trigger Change of Authorization direkte fra Browse
- CSV export — ISE-kompatibel eksport med brugerdefineret kolonne-template
- JSON export — eksportér filtrerede eller alle endpoints som JSON-array

### Real-time sessioner
- pxGrid live-push — Browse farves grøn (aktiv RADIUS-session) / rød (ingen session) i realtid
- Baggrunds-refresh ved endpoint-ændringer (pxGrid `endpoint_changed`) sker stille uden loading-spinner — kolonner flipper ikke og selekterede rækker til bulk-edit bevares
- MnT-poll fallback når pxGrid ikke er aktiveret

### Adgangskontrol
- Roller: `admin`, `editor`, `editor-psk`, `viewer`, `registrant`, `registrant_templet`
- System adm — tag-baseret scopning: brugere ser og redigerer kun endpoints tagget med deres system adm-rolle
- PSK-management — MPSK/IPSK mode, PSK_Key og PSK_Mode custom attributes, editor-psk rolle
- **TACACS+-autentisering** — portal-login via ekstern TACACS+-server; brugerprofiler i portalen bestemmer rolle og adgang (admin logges altid lokalt)
- **Bruger/Operatør-type** — brugere klassificeres som Bruger (lokal login) eller Operatør (kun TACACS+); dropdown i Users-tabellen
- **Kopiér bruger** — kopiér eksisterende bruger/operatør til ny med auto-postfix `_copy`, inkl. rolle, System adm og skabeloner
- **Login auth-badge i sidebar** — viser TACACS+ eller LOCAL samt struktureret User / Rolle / Login auth-visning

### Cache og ydelse
- To-lags cache — in-memory (TTL + stale-while-revalidate) og disk-persistens
- Portal viser data øjeblikkeligt ved genstart; rækker med ældre data markeres med stale-badge
- Pre-warm worker scanner alle ISE endpoints i baggrunden med konfigurerbar concurrency
- Request-koalescering — samtidige fetches for samme endpoint deler eet ISE-kald
- First-seen SQLite-database — tracker portalens første observation per MAC; ryddes automatisk ved sletning (portal, ISE eller prewarm-scan)

### RADIUS Policy administration
- **Politikker-dashboard** — overblik over alle ISE policy sets med regelkort (rank-badge, betingelses-chips, autorisationsprofil-chips)
- **Master-detail layout** — regeldetaljer med betingelser til venstre og autoriseringsprofiler til højre
- **Sammenfoldet regeliste** — politikregler vises som kompakt liste (kun navn); klik folder reglen ud med betingelser og profiler
- **Nested AND/OR gruppe-editor** — opret og rediger betingelser med fuldt bevarede AND/OR-nesting-niveauer (ISE `ConditionAndBlock`/`ConditionOrBlock`)
- **Betingelsestyper** — EndPoints, IdentityGroup og Radius-attributter med dynamiske dropdowns for kendte værdier og gruppe-navne
- **Opret standard autoriseringsprofiler** — "Opret manglende profiler" opretter automatisk Endpoint_VLAN, Endpoint_DACL, Endpoint_PSK-KEY og Endpoint_AirSpaceACL i ISE
- **Policy match preview** — i endpoint-detail vises hvilke autoriseringsregler der matcher det aktuelle endpoint; live endpoint-data hentes fra ISE
- **RADIUS-parameter prompt** — simulatoren spørger om RADIUS-attributter krævet for præcis matching (NAS-Port-Type, Called-Station-ID m.fl.)
- **Profilerings-data viewer** — vis ISE-profileringsdata (OUI, profileringsresultater) direkte i endpoint-detail
- **Rule Builder Wizard** — opret ny autoriseringsregel direkte fra Browse med endpoint-attributterne præudfyldt

### Sikkerhed
- HTTP Security Headers — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy m.fl.
- Account lockout — 5 fejlede loginforsøg inden for 10 min giver 15 min lockout (HTTP 429)
- Login-events i audit-log — success og failure registreres med IP og tidsstempel
- Token TTL reduceret 8h → 1h med silent refresh (automatisk fornyelse inden udløb)
- Password-styrkekrav — minimum 10 tegn, mindst ét stort bogstav, ét lille bogstav, ét tal
- Tillidsproxy-liste — X-Forwarded-For til rate limiting kun fra konfigurerede proxy-IPs
- ISE CA-bundle — mulighed for at angive eget root-CA PEM til TLS-verifikation mod ISE

### Administration
- Downloadable ACL editor med live Cisco IOS ACL syntax-validering
- Custom attribute administration — værdier, PlatformType-mapping, CoA-binding
- Audit-log — alle ændringer logges med bruger, tidsstempel og felt-diff; FTS5 trigram-søgning
- Portal system-opdatering — admin uploader ZIP-pakke direkte i portalen
- **GitHub-opdateringscheck** — portalen tjekker automatisk GitHub for nye versioner og notificerer admin; git pull håndterer ejerskabs- og rettighedsproblemer automatisk
- Brugervenlige fejlbeskeder — ISE-utilgængelighed vises med klar dansk tekst og Prøv igen-knap

---

## Hurtigstart

```bash
git clone https://github.com/Jangreenlarsen/ise-endpoint-portal.git
cd ise-endpoint-portal/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e .
```

**Linux/server** (produktion):
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
```

**Windows** (udvikling): kør `START.bat` i projektmappen (auto-genstart ved fejl).

Åbn `http://localhost:8000` — første gang vises setup-flow til oprettelse af admin-bruger.

---

## Forudsætninger

| Krav | Detaljer |
|------|----------|
| Python | 3.11 eller nyere |
| Cisco ISE | 3.1 eller nyere (testet med 3.4) |
| ERS API | Aktiveret: Administration > System > Settings > API Settings |
| Open API | Aktiveret samme sted |
| ISE-bruger | Rollen ERS Admin (læs + skriv); MnT Admin til session-status og CoA |
| pxGrid (valgfri) | pxGrid Services aktiveret i ISE; certifikat-opsætning beskrives i manualen |
| TACACS+ (valgfri) | Ekstern TACACS+-server på TCP/49; shared secret og attribut-konfiguration beskrevet i manualen |
| Netværk | Backend skal nå ISE på port 443 (REST) og 8910 (pxGrid); TACACS+-server på port 49 |

---

## Dokumentation

| Dokument | Indhold |
|----------|---------|
| [docs/INDEX.md](docs/INDEX.md) | Hoveddokument med indholdsfortegnelse og versionslog for manualen |
| [docs/01-OVERBLIK.md](docs/01-OVERBLIK.md) | Systemoverblik, arkitektur, protokoller, roller, dataflow |
| [docs/02-INSTALLATION.md](docs/02-INSTALLATION.md) | Installation, ISE-konfiguration, opstart |
| [docs/03-BRUGERGUIDE.md](docs/03-BRUGERGUIDE.md) | Brugervejledning for alle portal-sider |
| [docs/04-ADMIN.md](docs/04-ADMIN.md) | Administratorvejledning: brugere, settings, TACACS+, opdatering, logs |
| [docs/05-DRIFT.md](docs/05-DRIFT.md) | Drift, backup, fejlsøgning, ydelsestuning |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Teknisk lag-arkitektur og regler |
| [ISE_API_REFERENCE.md](ISE_API_REFERENCE.md) | Cisco ISE 3.4 ERS og Open API reference |
| [CHANGELOG.md](CHANGELOG.md) | Alle kodeændringer med versionsnumre |

---

## Teknologier

Backend: Python 3.11+, FastAPI, httpx (async), Pydantic v2, PyJWT, bcrypt, tacacs-plus.
Frontend: Vanilla HTML/CSS/JS — ingen build-trin, ingen eksterne afhængigheder.
