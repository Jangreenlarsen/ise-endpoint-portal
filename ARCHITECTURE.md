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

## Endpoint-cache

Endpoint-detaljer (full EndpointDetail) caches i `backend/app/core/endpoint_cache.py`:

- **Stale-while-revalidate (SWR)**: Cachen serverer stale entries mens et baggrunds-refresh kører. Brugeren ser aldrig et tomt skærmbillede.
- **LRU eviction**: Max `cache_max_entries` (default 5000) entries + `cache_max_memory_mb` (default 300 MB) i hukommelse.
- **Disk-persistering** (`DISK_CACHE_VERSION`): Både endpoint-detaljer **og** gruppe-liste gemmes til `cache/endpoints.json` og genindlæses ved opstart — ISE behøver ikke svare for at portalen er brugbar. Læse-kompatibel på tværs af additive format-bumps (se `_DISK_READABLE_VERSIONS`), så en gyldig cache aldrig kasseres unødigt.
- **TTL**: `cache_ttl_seconds` (default 300s). Entries ældre end TTL × `STALE_MAX_FACTOR` (30) anses som "very stale". `_ttl()` (freshness/UI) er altid base-TTL.
- **3-tier prioritering**: Hvert endpoint får et EMA over historisk ændringsfrekvens → hot/warm/cold. Drip-køen (`get_priority_stale_ids`) refresher hot oftere, cold sjældnere.
- **Roles-indeks**: Endpoint-ID → rolle-sæt-mapping for hurtig non-admin filtering uden at kalde ISE.
- **Pre-warm + drip**: `services/cache_prewarm.py` — inkrementel fuld-scan (hvert `cache_prewarm_interval_s`) + kontinuerlig drip-refresh. Prioriterings-kø bruges af edit-modal (`POST /endpoints/{id}/prioritize`).
- **Cache-sync**: `services/cache_sync.py` worker synkroniserer cachen med ISE periodisk som backup til pxGrid.

### Selvregulerende ISE-belastning

Cache-motoren tilpasser sig automatisk ISE's kapacitet og portalens brug — to uafhængige mekanismer:

- **Adaptiv drip-hastighed** (`AdaptivePacer` i `cache_prewarm.py`): AIMD-regulering (som TCP) af drip-tempoet ud fra in-process ISE-svar (succes/fejl pr. fetch + circuit-breaker-state). Additiv forøgelse ved succes, multiplikativ nedsættelse ved fejl. Klampet til ±`adaptive_pacing_range_pct`. Styrer *hvor hårdt* der hentes.
- **Aktivitetsstyret TTL** (`EndpointCache.effective_ttl()` + `core/portal_activity.py`): `portal_activity.touch()` kaldes i `get_current_user` på hver autentificeret request. Ved aktivitet = base-TTL (hot); ved inaktivitet rampes den effektive drip-TTL op mod `adaptive_ttl_max_seconds` over 10× base-TTL. Styrer *hvor ofte* der hentes. Påvirker kun drip-frekvensen, ikke UI-freshness.
- **Circuit breaker** (`ise/circuit_breaker.py`, brugt i `ise/client.py`): Fast-fejler ISE-kald efter `ise_cb_failure_threshold` fejl i træk; recovery-prober efter `ise_cb_recovery_timeout_s`. Drip pauser CB-aware og skruer den adaptive hastighed hårdt ned.

Alle adaptive størrelser eksponeres som Prometheus-gauges (`ise_portal_cache_adaptive_speed_factor`, `_effective_ttl_seconds`, `ise_portal_portal_idle_seconds`) og vises live i Dashboard + Metrics.

## First-seen database

`backend/app/core/first_seen_store.py` — SQLite-database (`backend/cache/first_seen.db`) der tracker hvornår portalen første gang observerede et endpoint.

**Principper:**
- Tidsstemplet sættes én gang og er immutabelt — det repræsenterer portalens første observation, ikke ISE's oprettelsestidspunkt.
- `record(mac, endpoint_id)` kaldes fra `_fetch_endpoint_detail` ved hvert detail-fetch. Returnerer altid det eksisterende tidsstempel — medmindre `endpoint_id` er ændret (endpoint slettet og genskabt i ISE), i så fald nulstilles tidsstemplet.
- `delete(mac)` fjerner posten helt — endpoint behandles som nyt ved næste observation.

**Livscyklus og cleanup (alle 3 scenarier):**

| Scenario | Håndtering |
|---|---|
| Slettet via portal | `delete_endpoint()` kalder `delete(mac)` øjeblikkeligt |
| Slettet i ISE, genskabt | `record()` opdager ændret `endpoint_id` → nulstil tidsstempel |
| Slettet i ISE, aldrig tilbage | `_full_scan()` i prewarm kalder `delete(mac)` når endpoint forsvinder fra ISE-listen |

**Frontend:**
- Kolonnen "Første gang set" i Browse viser `DD-MM-YYYY HH:MM`.
- Filterpanelet tilbyder Fra/Til dato-picker i stedet for tekstfilter.
- Sortering, filter og saved-views-persistens understøttes fuldt.

**Gitignore:** `backend/cache/` er gitignored — databasen er runtime-data og committed aldrig til git.

## PxGrid (Cisco Platform Exchange Grid)

PxGrid er et Cisco-proprietært pub/sub-system til real-time events. Portalen kan abonnere på session- og endpoint-events.

```
ISE pxGrid ─── WebSocket/STOMP ──▶ backend/app/pxgrid/
                                        session_worker.py   (event-loop + reconnect)
                                        session_cache.py    (in-memory session-state)
                                        probe.py            (REST getSessions pre-load)
                                        stomp.py            (STOMP-protokol-parser)
                                        cert_manager.py     (mTLS-cert håndtering)
                                    ──▶ session-cache SSE ──▶ Frontend (badge/VLAN)
```

**Konfiguration** (alle i `backend/app/core/config.py`):

| Setting | Default | Beskrivelse |
|---------|---------|-------------|
| `pxgrid_enabled` | `False` | Master-flag — intet pxGrid hvis False |
| `pxgrid_worker_enabled` | `True` | Start STOMP-worker |
| `pxgrid_session_topic` | `com.cisco.ise.session` | STOMP-topic |
| `pxgrid_endpoint_topic_enabled` | `False` | Abonnér også på endpoint-events |
| `pxgrid_node` | `""` | pxGrid REST-node URL |

**Worker lifecycle**:
1. `PxGridSessionWorker.start()` — opretter asyncio task, abonnerer på STOMP
2. `_run_loop()` — genopbygger forbindelsen ved disconnect (eksponentiel backoff)
3. `_handle_message_body()` — parser session-JSON og opdaterer `session_cache`
4. `_handle_endpoint_body()` — parser endpoint-events og invaliderer `endpoint_cache`
5. `PxGridSessionWorker.stop()` — rydder op og broadcaster `pxgrid_disabled` til SSE

**Session-cache** (`pxgrid/session_cache.py`):
- In-memory dict: MAC → SessionInfo (VLAN, ACL, authz-profil, nas-ip, ...)
- MnT-reconciliation: Periodic check mod ISE MnT for at fange events misset under disconnect
- Stale cleanup: Sessions ældre end `pxgrid_session_max_age_s` fjernes automatisk

## Endpoints API-split (P2)

`endpoints.py` er opdelt i to routers:

| Fil | Prefix | Ansvar |
|-----|--------|--------|
| `api/endpoints.py` | `/api/endpoints` | Core CRUD: list, get, create, update, delete, bulk |
| `api/endpoints_ops.py` | `/api/endpoints` | Operationelle: CoA, bulk-CoA, ANC, historik |
| `api/_endpoint_api_helpers.py` | — | Delte hjælper-funktioner til begge routers |

## Dataflow-eksempel: "Hent endpoints"

1. Bruger klikker "Refresh" i `frontend/js/app.js`
2. `frontend/js/api.js` kalder `GET /api/endpoints` mod backend
3. `backend/app/api/endpoints.py` (router) modtager og kalder service
4. `backend/app/services/endpoint_service.py` orkestrerer kald
5. `backend/app/ise/endpoints.py` laver HTTPS-kald mod ISE ERS
6. Svar bobler tilbage: ise → service (oversættes til DTO) → api → frontend
7. ISE-operationen logges i `backend/logs/app.log`

## Service-split (P2)

`endpoint_service.py`'s hjælpefunktioner er udtrukket til `services/_endpoint_helpers.py`:

| Fil | Indhold |
|-----|---------|
| `services/endpoint_service.py` | `EndpointService`-klasse + alle metoder |
| `services/_endpoint_helpers.py` | Rene hjælpefunktioner: PSK encode/mask/validate, custom attrs, rolle-filter, tekst-søgning |
