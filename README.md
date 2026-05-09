# HyperVision ISE Portal

Web-baseret administrationssystem til Cisco ISE 3.4 endpoint-management via REST API og pxGrid 2.0.

**Version 4.0.1 build 0220** — [Fuld manual](docs/INDEX.md) — [Changelog](CHANGELOG.md)

---

## Hvad er HyperVision ISE Portal, og hvorfor REST + pxGrid?

Cisco ISE er virksomhedens Network Access Control-system. Det er ISE der afgør hvilken VLAN en klient havner i, om den far adgang, og med hvilken policy. Bag den beslutning ligger endpoint-data: MAC-adresse, Identity Group, custom attributes som ejer, lokation, autorisations-VLAN og PSK-noegle.

ISE's eget administrations-GUI er bygget til at konfigurere systemet som helhed. Det er ikke egnet til daglig operationel drift med hundredvis eller tusindvis af endpoints: det er langsomt, soegning er begraenset, der er ingen bulk-redigering, ingen brugerdefinerede attribut-workflows og alle ISE-admins deler fuld adgang.

HyperVision ISE Portal loser det operationelle arbejde. Den eksponerer praecis de felter der bruges dagligt, med de workflows der er relevante, og med rollebaseret adgangsstyring der begraenser hvad den enkelte bruger kan se og gore.

Portalen kommunikerer med ISE via to separate protokoller der loser hvert sit problem:

**REST API (ERS + Open API + MnT)** er ISE's klassiske HTTP-baserede administrations-API pa port 443. Portalen bruger det til al skrivning og laesning: opret endpoint, rediger attributter, slet group membership, administrer DACLs, hent endpoint-lister. ERS (Cisco ERS API) daeKker endpoints og grupper; Open API daeKker nyere konstrukter som custom attribute-definitioner; MnT (Monitoring and Troubleshooting API) giver adgang til aktive RADIUS-sessioner og CoA (Change of Authorization). REST er request-response og pull-baseret — portalen spoerger, ISE svarer.

**pxGrid 2.0** er ISE's native event-bus. Via en persistent WebSocket-forbindelse pa port 8910 med STOMP-protokol modtager portalen events i realtid: RADIUS-autentificeringer, session-oprettelse og -nedrivning, endpoint-aendringer registreret af ISE-profileren. Portalen abonnerer pa `com.cisco.ise.session` og `com.cisco.ise.endpoint` og videresender events direkte til browseren via Server-Sent Events, sa Browse opdateres inden for millisekunder uden polling.

Uden pxGrid ville sessionsfarver kraeve MnT-polling hvert N sekund — unoevendig belastning pa ISE og op til N sekunders forsinkelse. Uden REST kan man ikke skrive til ISE — pxGrid er read-only event-streaming.

De to protokoller supplerer hinanden: REST til management, pxGrid til observabilitet i realtid.

---

## Funktioner

### Endpoint-administration
- Opret endpoint — MAC, Identity Group, beskrivelse og alle custom attributes
- Import fra CSV — bulk-opret med auto-detektion af ISE-format og simpelt format, preview og succeeded/failed rapport
- Browse / Edit — tabelvisning med inline-redigering, filter, kolonnevalg og bulk-edit
- CoA reauth / disconnect — trigger Change of Authorization direkte fra Browse
- CSV export — ISE-kompatibel eksport med brugerdefineret kolonne-template

### Real-time sessioner
- pxGrid live-push — Browse farves groen (aktiv RADIUS-session) / roed (ingen session) i realtid
- MnT-poll fallback naar pxGrid ikke er aktiveret

### Adgangskontrol
- Roller: `admin`, `editor`, `editor-psk`, `viewer`, `registrant`, `registrant_templet`
- System adm — tag-baseret scopning: brugere ser og redigerer kun endpoints tagget med deres system adm-rolle
- PSK-management — MPSK/IPSK mode, PSK_Key og PSK_Mode custom attributes, editor-psk rolle
- **TACACS+-autentisering** — portal-login via ekstern TACACS+-server; brugerprofiler i portalen bestemmer rolle og adgang (admin logges altid lokalt)

### Cache og ydelse
- To-lags cache — in-memory (TTL + stale-while-revalidate) og disk-persistens
- Portal viser data oejeblikkeligt ved genstart; raekker med aeldre data markeres med stale-badge
- Pre-warm worker scanner alle ISE endpoints i baggrunden med konfigurerbar concurrency
- Request-koalescering — samtidige fetches for samme endpoint deler eet ISE-kald

### Administration
- Downloadable ACL editor med live Cisco IOS ACL syntax-validering
- Custom attribute administration — vaerdier, PlatformType-mapping, CoA-binding
- Audit-log — alle aendringer logges med bruger, tidsstempel og felt-diff
- Portal system-opdatering — admin uploader ZIP-pakke direkte i portalen
- Brugervenlige fejlbeskeder — ISE-utilgaengelighed vises med klar dansk tekst og Proev igen-knap

---

## Hurtigstart

```
git clone https://github.com/Jangreenlarsen/ise-endpoint-portal.git
cd ise-endpoint-portal\backend
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

Start: kob `START.bat` i projektmappen (Windows — auto-genstart ved fejl).
Eller manuelt: `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend`

Abn `http://localhost:8000` — forste gang vises setup-flow til oprettelse af admin-bruger.

---

## Forudsaetninger

| Krav | Detaljer |
|------|----------|
| Python | 3.11 eller nyere |
| Cisco ISE | 3.1 eller nyere (testet med 3.4) |
| ERS API | Aktiveret: Administration > System > Settings > API Settings |
| Open API | Aktiveret samme sted |
| ISE-bruger | Rollen ERS Admin (laes + skriv); MnT Admin til session-status og CoA |
| pxGrid (valgfri) | pxGrid Services aktiveret i ISE; certifikat-opsaetning beskrives i manualen |
| TACACS+ (valgfri) | Ekstern TACACS+-server paa TCP/49; shared secret og attribut-konfiguration beskrevet i manualen |
| Netvaerk | Backend skal naes ISE pa port 443 (REST) og 8910 (pxGrid); TACACS+-server pa port 49 |

---

## Dokumentation

| Dokument | Indhold |
|----------|---------|
| [docs/INDEX.md](docs/INDEX.md) | Hoveddokument med indholdsfortegnelse og versionslog for manualen |
| [docs/01-OVERBLIK.md](docs/01-OVERBLIK.md) | Systemoverblik, arkitektur, protokoller, roller, dataflow |
| [docs/02-INSTALLATION.md](docs/02-INSTALLATION.md) | Installation, ISE-konfiguration, opstart |
| [docs/03-BRUGERGUIDE.md](docs/03-BRUGERGUIDE.md) | Brugervejledning for alle portal-sider |
| [docs/04-ADMIN.md](docs/04-ADMIN.md) | Administratorvejledning: brugere, settings, TACACS+, opdatering, logs |
| [docs/05-DRIFT.md](docs/05-DRIFT.md) | Drift, backup, fejlsoegning, ydelsestuning |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Teknisk lag-arkitektur og regler |
| [ISE_API_REFERENCE.md](ISE_API_REFERENCE.md) | Cisco ISE 3.4 ERS og Open API reference |
| [CHANGELOG.md](CHANGELOG.md) | Alle kodeaendringer med versionsnumre |

---

## Teknologier

Backend: Python 3.11+, FastAPI, httpx (async), Pydantic v2, PyJWT, bcrypt, tacacs-plus.
Frontend: Vanilla HTML/CSS/JS — ingen build-trin, ingen externe afhangigheder.
