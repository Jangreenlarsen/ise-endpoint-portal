# HyperVision ISE Portal — Sikkerheds- og Funktionsanalyse

*Udført: 2026-05-17 — Version 5.4.8 build 0386*

---

## Fase 1: Kortlægning

### 1. Autentisering

- Passwords hashes med PBKDF2-HMAC-SHA256 (600.000 iterationer) — solid standard
- Token-system er hjemmebygget (`base64url(payload).HMAC-SHA256`) — ikke standard JWT, men fungerer korrekt
- Token-TTL: 8 timer — ingen refresh-mekanisme, stateless logout (token lever videre på serversiden)
- TACACS+ integration med lokal fallback. Admin valideres altid lokalt (korrekt)
- `auth_secret.key` gemmes med filrettigheder `644` — world-readable på multi-user systemer

### 2. Autorisering (RBAC)

- 6 roller implementeret konsekvent med `require_roles()` decorators i `backend/app/api/deps.py`
- Endpoint-synlighed håndhæves i service-laget — non-admin ser kun egne endpoints
- PSK-felter maskeres for roller uden `editor-psk` — korrekt placering i service-laget
- `POST /policy-sets/{id}/match` accepterer frit `dict` uden schema-validering

### 3. Input-validering

- Pydantic v2 på alle request-schemas — god baselinje
- Policy-regelnavne valideres med regex
- Frontend bruger `esc()`-helper mange steder, men ikke konsekvent
- `frontend/js/app.js` linje 140: `err.message` sættes direkte i `innerHTML` uden escaping

### 4. API-sikkerhed

- CORS: `allow_methods=["*"]`, `allow_headers=["*"]`, `allow_credentials=True` — bred konfiguration
- Rate limiter: 200 req/min (glidende vindue pr. IP), men stoler blindt på `X-Forwarded-For`
- Ingen sikkerhedsheadere: ingen `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`
- HTTPS er deploymentansvar — ikke konfigureret i koden

### 5. Credential-håndtering

- ISE-password, TACACS+ secret og pxGrid-password gemmes i klartekst i JSON-filer på disk
- Filerne er korrekt gitignored men ubeskyttede på filsystemet
- API-svar afslører aldrig selve hemmeligheder (returnerer `password_set: bool`) — korrekt

### 6. Frontend-sikkerhed

- Token gemmes i `localStorage` — tilgængeligt for al JavaScript (XSS-risiko)
- Portalen bruger `Authorization: Bearer` header — klassisk CSRF er ikke muligt
- 29 JS-filer bruger `innerHTML`; `esc()` bruges de fleste steder men ikke alle

### 7. Audit og logging

- SQLite audit-log (FTS5) med god dækning af write-operationer
- `actor_ctx` (ContextVar) propagerer bruger/IP implicit — elegant design
- Login-hændelser (success og fejl) logges til `app.log` men IKKE til audit-databasen
- Logfiler kræver admin-rolle at tilgå — korrekt

### 8. Netværkssikkerhed mod ISE

- `ise_verify_tls=False` i `.env` og `config.json` — ISE-certifikatet verificeres ikke
- ISE ERS-kald bruger Basic Auth over HTTPS (men TLS verificeres ikke)
- pxGrid bruger mTLS (klient-cert) — sikrere end ERS-forbindelsen
- Circuit-breaker og retry-logik implementeret — god driftsrobusthed

---

## Fase 2: Dybdeanalyse

| # | Fund | Alvorlighed | Konsekvens | Anbefaling |
|---|------|-------------|------------|------------|
| 1 | `auth_secret.key` er world-readable (644) | **Høj** | Lokal bruger kan læse HMAC-secret og forge gyldige admin-tokens | `chmod 600` + startup-check der afbryder hvis filen er world-readable |
| 2 | `ise_verify_tls=False` | **Høj** | MITM mod portal→ISE: svar kan forfalskes, ISE-password eksponeres i transit | Importer ISE's CA og sæt `ISE_VERIFY_TLS=true` i `.env` |
| 3 | Credentials i klartekst på disk | **Høj** | Filsystemadgang (lokal bruger, backup) eksponerer ISE-password, TACACS+ secret, pxGrid-password | Windows Credential Manager (`keyring`) eller `chmod 600` + dokumenteret backup-procedure |
| 4 | Ingen account lockout på login | **Høj** | Brute-force mod lokale konti: 200 req/min = ~3 forsøg/sek → 10.000/time | Per-bruger failed-login tæller i memory; 5 fejl → 15 min lockout; log til audit-db |
| 5 | Token i `localStorage` | **Medium** | XSS-angreb kan stjæle session-token med 8 timers levetid | `HttpOnly`-cookie eller kortere TTL (30–60 min) + silent refresh |
| 6 | Ingen HTTP sikkerhedsheadere | **Medium** | Clickjacking muligt; forværrer XSS-konsekvens; MIME-sniffing på uploads | Middleware med `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, grundlæggende CSP |
| 7 | `err.message` i `innerHTML` (`app.js:140`) | **Medium** | ISE-fejlsvar med HTML/JS i body kan eksekveres i browser ved kompromitteret ISE | Erstat med `textContent`; gennemgå alle 29 JS-filer systematisk |
| 8 | `X-Forwarded-For` spoofing i rate limiter | **Medium** | Angriber kan omgå IP-baseret rate limit ved at sætte falsk header | Betroet proxy-liste; kun acceptér `X-Forwarded-For` fra kendte proxy-IP'er |
| 9 | Stateless logout | **Lav** | Stjålet token kan bruges i op til 8 timer efter logout | Token-revocation-liste i memory; eller kortere TTL |
| 10 | Bred CORS-konfiguration | **Lav** | Unødvendigt brede kald tillades; `allow_credentials=True` + bred origin er risikabelt ved XSS | Begræns til `["GET","POST","PUT","DELETE"]` og `["Authorization","Content-Type"]` |
| 11 | Svag password-politik | **Lav** | Kun min. 8 tegn; kombineret med manglende lockout er svage passwords sårbare | Gennemtving kompleksitetskrav identisk med PSK-politikken |
| 12 | Login-events mangler i audit-db | **Lav** | Security incident response kræver søgning i to systemer; app.log roteres | `audit_store.record("login_success"/"login_failed")` i `user_service.login()` |
| 13 | `match_endpoint` accepterer frit dict | **Lav** | Authenticated bruger kan sende vilkårlig data til ISE-simulation | Definer `EndpointMatchRequest` Pydantic-schema med tilladte felter |

---

## Samlet rapport og prioriteret handlingsliste

**Deploymentkontekst**: Intern netværksportal tilgået af netværks-/sikkerhedsadministratorer.
Primære trusler er insidere, kompromitteret intern maskine og ISE-credentials eksponering —
ikke ekstern angriber.

**Overordnet vurdering**: Portalen er sikkerhedsmæssigt gennemtænkt i sin arkitektur med god
laginddeling, konsekvent RBAC og solidt audit-system. De alvorligste fund er operationelle
konfigurationsproblemer, ikke fundamentale designfejl. Fund 1–3 kan implementeres på én
arbejdsdag og løfter sikkerhedsniveauet markant.

### Top-10 handlingsliste (prioriteret: risiko × implementeringsomkostning)

| Pri | Handling | Berørt fil | Indsats | Effekt |
|-----|----------|-----------|---------|--------|
| **1** | `chmod 600 auth_secret.key` + startup-validering der afbryder ved world-readable | `backend/app/core/auth.py` | 15 min | Eliminerer token-forge-risiko |
| **2** | Sikkerhedsheadere-middleware (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`) | `backend/app/main.py` | 1 time | Eliminerer clickjacking, reducerer XSS-konsekvens |
| **3** | Erstat `innerHTML` med `textContent` på alle `err.message`-visninger; systematisk gennemgang af alle 29 JS-filer | `frontend/js/app.js` + øvrige | 2–3 timer | Lukker XSS-vektor |
| **4** | Account lockout: per-bruger failed-login tæller (5 fejl → 15 min lockout) + log til audit-db | `backend/app/services/user_service.py` | 4 timer | Stopper brute-force mod lokale konti |
| **5** | TLS-verifikation mod ISE: `ISE_VERIFY_TLS=true` + importer ISE root-CA | `backend/.env` + `config.py` | 4 t + netadmin | Eliminerer MITM-risiko mod ISE |
| **6** | Credential-opbevaring: Windows Credential Manager via `keyring` eller minimum `chmod 600` på config-filer | `backend/config.json`, `auth_config.json` | 4–8 timer | Reducerer eksponering ved filsystemkompromittering |
| **7** | Login-events i audit-db: `audit_store.record()` på login-success og login-failure | `backend/app/services/user_service.py` | 2 timer | Samlet sporbarhed i ét system |
| **8** | CORS-stramning: begræns metoder og headere, fjern localhost-origins i produktion | `backend/app/main.py` | 1 time | Reducerer angrebsflade |
| **9** | `X-Forwarded-For` betroet proxy-liste i rate limiter | `backend/app/core/rate_limiter.py` | 2 timer | Forhindrer rate limit-omgåelse |
| **10** | Kortere token-TTL (60 min) + silent refresh | `backend/app/core/auth.py`, `frontend/js/auth.js` | 8 timer | Reducerer konsekvens af token-tyveri |

---

*Næste revision anbefales ved: større arkitekturændringer, ekstern deployment eller efter
implementering af handlingspunkterne ovenfor.*
