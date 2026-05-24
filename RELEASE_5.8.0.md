# HyperVision ISE Portal — v5.8.0

**Udgivelsesdato:** 2026-05-24
**Platform:** Debian Linux (systemd) · Python 3.11+ · FastAPI · Vanilla JS

---

## Hvad er HyperVision ISE Portal?

HyperVision ISE Portal er en webbaseret administrationsportal til Cisco Identity Services Engine (ISE) 3.4.
Portalen giver netværks- og sikkerhedsadministratorer et samlet overblik over alle endpoints i ISE samt
værktøjer til at administrere, registrere og simulere policy-match — uden at skulle arbejde direkte i ISE's UI.

Portalen kommunikerer med ISE via ERS API og Open API og kan integreres med ISE pxGrid for real-time session data.

---

## Hvad er nyt i v5.8.0?

### Trend Analyse

Nyt overvågningsview under *Overvågning → Trend Analyse*. Viser endpoint-bevægelser og private MAC-adresser over tid baseret på audit-loggen.

- Daglige linjediagrammer: endpoint tilgang (grøn), fragang (rød) og netto (blå)
- Separat diagram for private/randomiserede MAC-adresser (LAA)
- Stat-kort: total endpoints, antal private MACs, LAA-%, periode-summer
- Periode-vælger: 7 dage · 30 dage · 90 dage · 1 år
- Ingen eksterne chart-afhængigheder — ren SVG

### Security Patch 3

Syv sikkerheds-hardening-fixes baseret på en dyb analyse af kodebasen:

- XSS-fix i frontend ved rolle-visning
- CSP hardening: `script-src` tillader ikke længere inline script-udførelse
- Opstartsadvarsler i log ved `ISE_VERIFY_TLS=false` og ved dev-CORS-origins i produktion
- `config.json` beskyttes på Windows via `icacls` (svarende til `chmod 600`)
- Account lockout persisteres nu i SQLite og overlever backend-genstart
- Input-validering på søge- og pagineringsparametre i endpoints- og audit-API

### Stabilitets-fix

Kritisk fix der forhindrer portal-crash ved startup hvis lockout-databasen ikke kan initialiseres.
Portalen degraderer nu stille til in-memory lockout og starter altid op.

---

## Hvad kan portalen?

### Endpoint Browse og redigering

Søgbar og filtrerbar tabel med alle ISE-endpoints med live opdatering via pxGrid eller polling.

- Filtrering per kolonne med fritekst og regex
- Inline redigering via detail-modal: endpoint-data, RADIUS-simulering, profil, historik, ISE session
- Bulk-operationer: skift gruppe og custom attributes på mange endpoints i ét hug
- Fremhævning af private/randomiserede MAC-adresser (LAA) med tæller
- Saved views: gem filterkombinationer til genbrug
- JSON- og CSV-eksport af endpoints

### Policy-simulering

Simulér ISE policy-match direkte fra portalen — uden at sende reel RADIUS-trafik.

- Vælg policy set manuelt eller brug Auto-mode der tester alle sets fra rank 0 (som ISE gør det)
- Tilføj RADIUS-attributter (Called-Station-ID, NAS-Port-Type m.fl.) med autocomplete
- Gem og genindlæs RADIUS-parameter-templates
- Batch-simulering: simulér match for op til 100 markerede endpoints ad gangen
- Grafisk AND/OR-betingelsesvisning — identisk med ISE's policy-editor

### ISE pxGrid — real-time session data

Forbind portalen til ISE pxGrid (port 8910) for real-time RADIUS-session events.

- Certifikat-opsætning direkte i portalen (upload PEM eller generer CSR med 5-trins flow)
- STOMP-worker abonnerer på session-events og opdaterer Browse-tabellen live
- ISE Session-kolonne: auth-metode, authz-profiler, VLAN, identity group
- Periodisk MnT-berigelse og stale session-reconcile

### Livscyklus og historik

- **Første gang set**: database med immutable timestamp per MAC — kolonne i Browse med dato+tid-filter
- **Livscyklus-viewer** (admin): find endpoints uden aktivitet i 30/60/90/180/365 dage
- **Endpoint historik**: alle ændringer på et endpoint med præcis beskrivelse af hvad der ændrede sig

### Audit og overvågning

- Audit-log (admin): alle CRUD-operationer, login/logout og ISE-forbindelsesfejl med CSV-eksport
- Dashboard: cache-status, pxGrid-status, aktive sessioner, ISE-forbindelsestilstand
- Systemlog direkte i Dashboard: niveau-filter, fritekst-søgning, auto-refresh
- Alert-system med konfigurerbare betingelser
- **Trend Analyse**: endpoint bevægelser og private MACs over tid (v5.8.0)

### Skabeloner

- Opret og gem endpoint-konfigurationsskabeloner (gruppe, custom attributes, VLAN, ACL, platform m.m.)
- Anvend skabelon i Browse-Edit og på Registreringssiden — sætter description automatisk
- PSK-støtte: skabelon kan markere PSK-mode — nøglen promptes ved anvendelse og gemmes aldrig

### Registrering og import

- Registrér nye endpoints enkeltvis med gruppe, custom attributes og valgfri skabelon
- Bulk-import fra CSV med fleksibel kolonne-mapping til ISE-attributter (max 5 000 endpoints pr. kørsel)

### Autentisering og brugerstyring

**Lokale brugere** med roller: `admin` · `editor` · `editor-psk` · `registrant` · `viewer`

**TACACS+-autentisering**: rolle og operatørprofil sættes via TACACS+-attributter.
Portalen opretter automatisk et shadow-record ved TACACS+-login, så preferences og saved views virker
præcis som for lokale brugere.

- Account lockout: 5 fejllogins → 15 min lockout (persisteres i SQLite)
- Silent token refresh: fornyes 15 min inden udløb uden UI-forstyrrelse
- Rate limiting på alle API-endpoints

### Sikkerhed

- TLS-verifikation af ISE-certifikat som standard
- CSP, HSTS, X-Frame-Options, X-Content-Type-Options på alle svar
- HTML-escaping med central `esc()` funktion i alle views
- `config.json` og operator-filer: `chmod 600` (Linux) / `icacls` (Windows)
- Kryptografisk sikker PSK-nøglegenerator
- ZIP-bomb-beskyttelse ved upload (max 500 MB ukomprimeret)

### Administration og drift

- **Config backup/restore** (admin): download og gendan alle konfigurationsfiler som ét JSON-dokument
- **GitHub-opdatering**: tjek og hent seneste version direkte fra portalen
- **Tema**: Light · Dark · Midnight · Slate — gemmes per bruger
- **Lokalisering**: Dansk og Engelsk per bruger

---

## Installation og opgradering

### Ny installation

```bash
curl -fsSL https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/main/install.sh | bash
```

### Opgradering fra tidligere version

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

### Nye filer der oprettes automatisk

| Fil | Formål |
|-----|--------|
| `backend/lockout.db` | Persistent account lockout (SQLite) |

---

## Kendte begrænsninger

- Trend Analyse kræver at audit-loggen har data for den valgte periode — ny installation vil vise tomme grafer de første dage
- Livscyklus-viewer baseres på audit-loggen — kun aktivitet registreret i portalen tæller (ikke ændringer foretaget direkte i ISE)
- pxGrid STOMP-worker kræver manuelt certifikat-setup og ISE-admin approval inden aktivering

---

## Licens

AGPL-3.0-or-later · Copyright © 2026 Jan Green Larsen <jgl@laces.dk>
