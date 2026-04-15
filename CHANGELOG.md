# Changelog

Alle kodeændringer registreres her. Nyeste øverst.

---

## 2026-04-15 — feat: sidebar + CRUD views + settings

- **backend**: `BulkCreateRequest`, `BulkResult`, `EndpointUpdate`, `BulkFailure` DTOs (`app/schemas/endpoint.py`).
- **backend**: generisk `IseEndpointRepository.update()` erstatter `update_group()` (`app/ise/endpoints.py`).
- **backend**: service-lag `update_endpoint`, `bulk_create` (`app/services/endpoint_service.py`).
- **backend**: nye routes `POST /api/endpoints/bulk`, `PUT /api/endpoints/{id}` (`app/api/endpoints.py`).
- **backend**: settings-lag — `app/core/settings_store.py` (JSON persistence), `Settings.refresh_settings()`, `app/schemas/settings.py`, `app/services/settings_service.py`, `app/api/settings.py`. Nye routes `GET/PUT /api/settings/backend`.
- **backend**: `IseClient` læser nu `config.settings` dynamisk, så reset efter settings-ændring virker.
- **backend**: `config.json` tilføjet til `.gitignore`.
- **frontend**: sidebar layout — `index.html` med venstre-menu (Opret / Import / Browse / Settings).
- **frontend**: hash-baseret router i `js/app.js`, views opdelt i `js/views/{create,import,browse,settings}.js`.
- **frontend**: Opret endpoint view med MAC-validering og group-dropdown.
- **frontend**: CSV Import view — fil-upload eller paste, parse, preview-tabel, bulk opret med succeeded/failed resultat.
- **frontend**: Browse/Edit view — tabel med inline description-edit, filter, delete.
- **frontend**: Settings view — backend ISE connection (url, user, password-write-only, api type, verify_tls, timeout) + frontend preferences i localStorage.
- **frontend**: `api.js` udvidet med `bulkCreateEndpoints`, `updateEndpoint`, `get/updateBackendSettings`.
- **frontend**: komplet CSS-omskrivning til sidebar layout (`css/styles.css`).

## 2026-04-15

- **git**: initialiseret git-repo, initial commit med projektstruktur. Versionskontrol og push til GitHub er nu del af workflow (se `CLAUDE.md` regel 7-8).
- **bootstrap**: oprettet projekt-regler og struktur — `CLAUDE.md`, `ARCHITECTURE.md`, `FEATURES.md`, `BUGS.md`, `CHANGELOG.md`, `.claude/settings.local.json`.
- **backend**: FastAPI skeleton — `app/main.py`, `app/core/config.py`, `app/core/logging.py`, `app/core/exceptions.py`.
- **backend**: ISE integrationslag — `app/ise/client.py` (async httpx), `app/ise/endpoints.py` (ERS endpoint + endpoint group kald).
- **backend**: service-lag — `app/services/endpoint_service.py`.
- **backend**: API-lag — `app/api/health.py`, `app/api/endpoints.py`, `app/api/groups.py`.
- **backend**: DTOs — `app/schemas/endpoint.py`.
- **backend**: pyproject.toml med FastAPI, httpx, pydantic, pytest, respx.
- **frontend**: statisk web UI — `index.html`, `css/styles.css`, `js/api.js`, `js/app.js`. Viser endpoints og endpoint groups fra backend.
- **cleanup**: fjernet tidligere flad struktur (`src/ise_portal/`, rod `pyproject.toml`, `tests/`).
