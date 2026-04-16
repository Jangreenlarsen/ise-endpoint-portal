# Features

Alle nye features registreres her FØR implementering påbegyndes.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte lag.
**Status**: `planned` · `in-progress` · `done`

---

## Aktive / færdige

- `[done] 2026-04-15 — Projekt bootstrap` — oprettet regel-filer, backend FastAPI skeleton, frontend skeleton. Lag: alle.
- `[done] 2026-04-15 — ISE endpoint listning` — hent liste af endpoints fra ISE 3.4 ERS API og vis i frontend tabel. Lag: backend (api, services, ise), frontend.
- `[done] 2026-04-15 — ISE endpoint group listning` — hent endpoint groups. Lag: backend (api, services, ise), frontend.
- `[done] 2026-04-15 — Health check endpoint` — `/api/health` til at verificere backend kører. Lag: backend (api).
- `[done] 2026-04-15 — Sidebar navigation` — venstre-menu med views: Opret / Import / Browse / Settings. Hash-baseret routing. Lag: frontend.
- `[done] 2026-04-15 — Opret endpoint view` — manuel indtastning af MAC, gruppe, beskrivelse. Validering af MAC format. Lag: frontend.
- `[done] 2026-04-15 — CSV import view` — upload fil eller paste CSV, preview med validering, bulk opret via backend. Lag: frontend, backend (api, services, ise).
- `[done] 2026-04-15 — Bulk create endpoints` — `POST /api/endpoints/bulk` der tager en liste og returnerer succeeded/failed. Lag: backend.
- `[done] 2026-04-15 — Browse/edit view` — liste endpoints, inline rediger beskrivelse, slet. Lag: frontend, backend (api PUT/DELETE).
- `[done] 2026-04-15 — Update endpoint endpoint` — `PUT /api/endpoints/{id}` generisk (description, group_id). Erstatter tidligere update_group. Lag: backend (ise, services, api).
- `[done] 2026-04-15 — Backend settings persistence` — `backend/config.json` override-fil. `GET/PUT /api/settings/backend` eksponerer ISE connection settings (url, user, password, api_type, verify_tls, timeout). Refresh af settings + reset af ISE client efter save. Lag: backend (core, schemas, services, api).
- `[done] 2026-04-15 — Settings view` — frontend form for backend ISE connection (password write-only) + frontend preferences (localStorage). Lag: frontend.

## Planlagte — Prioritet 1 (vigtigt nu)

- `[planned] 2026-04-16 — Bulk throttling` — tilføj 100–200ms delay mellem ISE-kald i `bulk_create` for at overholde Ciscos 5–10 req/sec grænse. Forhindrer ERS overload ved store CSV imports. Lag: backend (services). Ref: [ISE_API_REFERENCE.md § Bulk](ISE_API_REFERENCE.md).
- `[planned] 2026-04-16 — 409 Conflict → "skipped"` — ISE returnerer HTTP 409 når endpoint allerede eksisterer. Mappér til en `skipped` liste i `BulkResult` i stedet for `failed`, så bruger kan skelne fejl fra dubletter. Lag: backend (services, schemas), frontend (import view). Ref: ISE status code 409.
- `[planned] 2026-04-16 — Server-side filter/search` — brug ERS filter-syntaks (`?filter=mac.CONTAINS.xx`) i `/api/endpoints` så Browse view ikke er begrænset til max 100 endpoints client-side. Tilføj `?search=` query param i backend router der oversættes til ERS filter. Lag: backend (api, ise). Ref: [ISE_API_REFERENCE.md § Filter syntax](ISE_API_REFERENCE.md).
- `[planned] 2026-04-16 — Parse Location header efter POST` — ERS returnerer `Location: .../endpoint/{uuid}` ved 201 Created. Parse dette for at returnere det nye endpoint-ID direkte, i stedet for en follow-up GET. Lag: backend (ise client, endpoints repository).
- `[planned] 2026-04-16 — ISE connectivity test` — "Test forbindelse" knap i Settings der prøver en autenticeret GET mod ISE og viser success/fejl uden at gemme. Giver bruger feedback inden save. Lag: backend (api/settings ny route), frontend (settings view).

## Planlagte — Prioritet 2 (bør have)

- `[planned] — Endpoint detalje-view` — klik på et endpoint i Browse for at se alle felter (groupId, profileId, customAttributes) via individual GET. Inline edit af alle felter. Lag: frontend, backend (api, services).
- `[planned] — ERS filter-operatorer i Browse` — dropdown i UI for felt (mac, name, description) + operator (EQ, CONTAINS, STARTSW) til at bygge server-side filter. Lag: frontend, backend.
- `[planned] — Gruppevalg i Browse/edit` — tilføj dropdown i rækken så bruger kan flytte endpoint til en anden gruppe direkte. Lag: frontend (browse view), bruger allerede PUT /api/endpoints/{id}.
- `[planned] — Multi-page pagination` — Browse view viser kun side 1 (max 100). Tilføj paginering (forrige/næste) der bruger `?page=N`. Lag: frontend, backend (returnér total count).
- `[planned] — Open API support` — implementer parallel integration mod `/api/v1/endpoint` (ISE 3.4 default). Payload og response shapes afviger fra ERS. Bruger vælger api_type i Settings. Lag: backend (ny `app/ise/openapi_endpoints.py`), service-lag dispatcher baseret på `config.settings.ise_api_type`. Ref: [ISE_API_REFERENCE.md § Open API](ISE_API_REFERENCE.md).

## Planlagte — Prioritet 3 (nice to have)

- `[planned] — ANC quarantine actions` — "Quarantine" og "Clear" knapper per endpoint i Browse view. Bruger ERS `/ers/config/ancendpoint/apply` og `/clear`. Lag: backend (ise, services, api), frontend.
- `[done] 2026-04-16 — Installations- og driftsdokumentation` — INSTALL.md med forudsætninger, opsætning, konfiguration, brug af alle views, API-reference, logning, fejlsøgning, drift og sikkerhed. Lag: docs.
- `[done] 2026-04-16 — Custom endpoint attributes (Owner, Location, AuthzVlan)` — dropdown-lister i Opret endpoint view med mulighed for at tilføje nye værdier. CSV import understøtter custom attr kolonner. Backend: lokal registry (`custom_attr_values.json`), ISE sync, attribute definition management. Lag: backend (core, ise, schemas, services, api), frontend (api, create view, import view).
- `[planned] — SGT (Security Group Tag) tildeling` — vis/ændr `securityGroupId` per endpoint. Kræver lookup mod `/ers/config/sgt`. Lag: backend (ise, services), frontend.
- `[planned] — Dark mode` — theme toggle i frontend preferences (CSS variabler). Lag: frontend.
- `[planned] — Export til CSV` — "Download CSV" knap i Browse view der eksporterer nuværende liste. Lag: frontend.
- `[planned] — Audit log view` — læs `backend/logs/app.log` og vis i en tabel i frontend. Lag: backend (api), frontend.
