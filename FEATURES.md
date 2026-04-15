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

## Planlagte

(ingen)
