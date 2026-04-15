# Arkitektur

## Overordnet

```
┌─────────────┐   HTTP/JSON   ┌─────────────────┐   HTTPS/JSON   ┌──────────────┐
│  Frontend   │ ────────────▶ │     Backend     │ ─────────────▶ │  Cisco ISE   │
│  (HTML/JS)  │               │    (FastAPI)    │                │     3.4      │
└─────────────┘               └─────────────────┘                └──────────────┘
```

**Regel 1**: Frontend må aldrig tale direkte med ISE. Al kommunikation går gennem backend.
**Regel 2**: Backend-lag kalder kun nedad. Aldrig opad, aldrig på tværs.

## Backend-lag

Backend er opdelt i fire lag under `backend/app/`:

| Lag | Mappe | Ansvar | Må kalde |
|---|---|---|---|
| **API** | `api/` | FastAPI routers. Validerer input, oversætter DTO ↔ service-kald, formaterer HTTP-svar. Ingen forretningslogik. | services, schemas, core |
| **Service** | `services/` | Forretningslogik, orkestrering af flere ISE-kald, fejlhåndtering på domæne-niveau. | ise, schemas, core |
| **Integration** | `ise/` | Eneste sted der taler HTTP med Cisco ISE. Indkapsler ERS (`/ers/config/...`) og Open API (`/api/v1/...`). | core |
| **Core** | `core/` | Config, logging, exceptions. Infrastruktur-bibliotek. | — |

Delt data: `schemas/` (pydantic DTOs). ISE-rå payloads må ikke lække direkte ud i API-laget — de skal oversættes i service-laget.

## Frontend

Simpel statisk web: HTML + CSS + vanilla JS. Ingen bundler kræves til at starte med.

| Fil | Ansvar |
|---|---|
| `index.html` | Entry og markup |
| `css/styles.css` | Styling |
| `js/api.js` | Wrapper omkring backend REST API (fetch) |
| `js/app.js` | UI-logik, event handlers |

Frontend serves enten direkte (åbn `index.html`) eller via backend som statiske filer på `/` (backend mount).

## Dataflow-eksempel: "Hent endpoints"

1. Bruger klikker "Refresh" i `frontend/js/app.js`
2. `frontend/js/api.js` kalder `GET /api/endpoints` mod backend
3. `backend/app/api/endpoints.py` (router) modtager og kalder service
4. `backend/app/services/endpoint_service.py` orkestrerer kald
5. `backend/app/ise/endpoints.py` laver HTTPS-kald mod ISE ERS
6. Svar bobler tilbage: ise → service (oversættes til DTO) → api → frontend
7. ISE-operationen logges i `backend/logs/app.log`
