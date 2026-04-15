# Changelog

Alle kodeændringer registreres her. Nyeste øverst.

---

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
