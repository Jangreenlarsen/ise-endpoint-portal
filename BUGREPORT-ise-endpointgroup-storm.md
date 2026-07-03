# Bug Report: ISE `/ers/config/endpointgroup` ReadTimeout / circuit-breaker storm

> **Status:** FIXED i v6.21.0721 (2026-07-03)
> **Severity:** Høj — konstant ISE-overbelastning, CB åbner 10-13×/dag, fresh% ustabil
> **Type:** Selvforskyldt API-amplifikation (N+1 i drip-loop)
> **Primær fil:** `backend/app/services/endpoint_service.py` (`_resolve_group_name`)
>
> Denne rapport er skrevet til brug i **fremtidige fejlfindings-sessioner**. Problemet
> blev bekæmpet gennem 5+ versioner (6.14–6.21) uden at grundårsagen blev fundet, fordi
> symptomerne (ReadTimeout, CB-lock) pegede på netværk/keepalive frem for på et
> selvforskyldt kald-mønster. Læs "Hvorfor tidligere fixes fejlede" før du jager
> ReadTimeouts som et transport-problem igen.

---

## 1. Symptom (hvad man ser)

- Loggen er domineret af `WARNING`/`ERROR` fra `app.ise.client` på **`GET /ers/config/endpointgroup`** (listen) og **`/endpointgroup/<uuid>`** (per-gruppe).
- Alle fejl er `ReadTimeout`. Circuit breaker (`app.ise.circuit_breaker`) åbner "after 5 consecutive failures" og cykler OPEN→CLOSED mange gange dagligt.
- I condensed log-eksporten: `top_loggers_by_issues.app.ise.client` er ~10.000+ mens alle andre loggere er < 25.
- Fresh endpoint-% i UI er ustabil / falder; brugere ser ⏱-stale-badges.
- **Endpoint-detaljer (`/endpoint/<uuid>`) er en LILLE brøkdel af fejlene** — det er gruppe-kaldene der brænder.

### Log-fingeraftryk (til hurtig genkendelse)

```
top_issue_messages domineret af:
  "ISE retry #1: GET /ers/config/endpointgroup"          (tusinder)
  "ISE retry #2: GET /ers/config/endpointgroup"          (tusinder)
  "ISE transport error on GET /ers/config/endpointgroup:  (ReadTimeout) [idle_before=Ns]"
  "ISE retry #1: GET /ers/config/endpointgroup/<uuid>"   (hundreder)
```

**Nøgle-diskriminator:** `transport_errors.idle_before_s` — hvis en stor andel (her ~37%,
1050/2800) har **`idle_before=0s`** (frisk forbindelse) og fejler ALLIGEVEL, er det
**IKKE** et stale-connection-problem. Det er ægte ISE-overbelastning fra for mange kald.

---

## 2. Root cause

Drip-refresh-loopen genopretter en `EndpointService` på **hver iteration**, og hvert
endpoint-detalje-fetch resolver gruppenavn via et **per-instans** gruppe-cache der
derfor altid er tomt → falder igennem til en fuld N+1 hierarki-hentning fra ISE.

### Kald-kæden (før fix)

1. `cache_prewarm._drip_loop()` — `service = EndpointService(get_ise_client())` oprettes
   **inde i `while`-loopen** ([cache_prewarm.py:289](backend/app/services/cache_prewarm.py#L289)).
   Ny instans hver tick ⇒ tomt `_group_cache`.
2. `_drip_one(ep_id)` → `service._fetch_endpoint_detail(ep_id)`
   ([endpoint_service.py:220](backend/app/services/endpoint_service.py#L220)).
3. `group_name = await self._resolve_group_name(group_id)`
   ([endpoint_service.py:231](backend/app/services/endpoint_service.py#L231)).
4. `_resolve_group_name` — cache-miss (instansen er ny) → kalder **`self.groups.list_all()`
   direkte** (bypasser den delte, TTL-cachede `get_cache().get_groups()`).
5. `IseEndpointGroupRepository.list_all()`
   ([endpoints.py:200](backend/app/ise/endpoints.py#L200)) er **N+1**:
   - Step 1: list alle grupper (sider à 100) — `GET /ers/config/endpointgroup`
   - Step 2: **`GET /ers/config/endpointgroup/{id}` for HVER gruppe** (sem=8) — kun for at
     hente `parentId` til hierarki-stien (`_full_path`), som drip **ikke engang bruger**.

Ét gruppe-navneopslag = `1 + N/100 + N` ISE-kald. Ved ~1 drip-refresh/5s og N≈50-150
grupper giver det **titusindvis af group-kald/time** — langt over ISE ERS' ~5-10 req/s.
ISE kan ikke svare → `ReadTimeout` → 2 retries (yderligere last) → CB åbner efter 5
fejl → CB lukker → stormen genoptages. Kører i ring hele dagen.

### Hvorfor fejlene "forsvinder" på højere log-niveau

`_resolve_group_name` slugte `IseApiError` tavst, og `list_all()` Step 2 sluger
`Exception`. Derfor ser man ~10.000 fejl på `app.ise.client` men næsten ingen på
`app.core.endpoint_cache`/service-niveau. **Led efter kilden på transport-niveau, ikke
efter en "groups failed"-besked** — den findes ikke for denne sti.

---

## 3. Hvorfor tidligere fixes fejlede (vigtig kontekst)

Alle disse behandlede **symptomer** på samme grundårsag og gav midlertidig/ingen lindring:

| Version | Fix | Hvorfor det ikke løste det |
|---|---|---|
| 6.18.0711 | `keepalive_expiry=30s` mod stale idle-forbindelser | Adresserer forbindelses-alder, ikke kald-mængde |
| 6.21.0720 | `keepalive_expiry 30s→10s` | 37% af timeouts er på friske forbindelser (`idle_before=0s`) — alder er ikke problemet |
| 6.15.0702 | Drip back-off ved fejlende endpoint | Reducerer ét endpoints hammering, ikke group-stormen |
| 6.14.0699 | List-view bruger `snapshot_*` i stedet for N `gather`-fetches | Fjernede N+1 i **list-view**, men overså samme mønster i **drip-loopen** |

**Lærdom:** Når `GET /ers/config/endpointgroup` timer ud i massevis, så tæl først
hvor mange kald portalen *selv genererer* (drip + full-scan + request-stier) før du
antager at ISE/netværk er skyld. `idle_before`-fordelingen er den hurtigste
diskriminator.

---

## 4. Fixen (v6.21.0721)

Delt gruppe-navne-cache på modul-niveau, der deles på tværs af **alle**
`EndpointService`-instanser — TTL-styret og coalesced via én lås.

- **`endpoint_service.py`**: Nye modul-globaler `_shared_group_names` (id→kort navn),
  `_shared_group_names_at`, `_shared_group_names_lock` + `invalidate_group_names()`.
  `_resolve_group_name` delegerer nu til ny `_get_group_names(force=False)`:
  - Refresher fra ISE **højst én gang pr. `cache_ttl_seconds`** (default 300s).
  - Concurrent kaldere coalescer på én lås ⇒ kun **ét** `list_all()` pr. refresh-vindue.
  - Ved ISE-fejl: server forrige map (evt. tomt ved cold start) + back-off ~30s.
  - Korte navne bevares — **identisk display-adfærd** som før.
- **`create_group`** kalder `invalidate_group_names()` så nye grupper ses straks.
- **`cache_prewarm._full_scan`**: pre-warmer nu den delte cache via
  `service._get_group_names(force=True)` (fanger nye/omdøbte grupper pr. scan).
  Coalescing-låsen erstatter den gamle grund til at pre-warme (undgå N parallelle
  `list_all()`).

**Effekt:** group-hierarki hentes ~1×/300s i stedet for ~1×/5s → group-kald falder
med ~1000×. N+1 i `list_all()` kører stadig, men nu sjældent nok til at være
harmløst (N kald pr. 5 min, ikke pr. 5 sek).

---

## 5. Sådan verificeres fixen

1. **Log efter deploy:** `top_loggers_by_issues.app.ise.client` skal falde drastisk;
   `GET /ers/config/endpointgroup` retry/timeout skal stort set forsvinde fra
   `top_issue_messages`. CB `open_count` skal nærme sig 0/dag.
2. **Ny INFO-linje:** `"group-name cache refreshed (N groups)"` skal optræde ~hvert
   5. minut (TTL) — IKKE hvert par sekunder. Optræder den ofte, er cachen ikke delt.
3. **`ise_requests.outcomes`:** `error`-andel skal falde markant mod `2xx`.
4. **Funktionelt:** Endpoint-detaljer skal stadig vise korrekt (kort) gruppenavn i UI.

---

## 6. Regressions-vagt (tjek i fremtidige sessioner)

- **Genopret ikke `EndpointService` pr. iteration uden delt cache.** Hvis nogen
  refaktorerer drip/scan til per-instans gruppe-state igen, vender stormen tilbage.
- **Tilføj gruppe-write-stier til invalideringen.** Får `endpoint_service` en
  `delete_group`/`rename_group`, skal den kalde `invalidate_group_names()` (kun
  `create_group` gør det i dag).
- **`list_all()` er stadig N+1.** Bruges den et nyt sted på en varm sti, kan stormen
  komme igen i anden forklædning. Overvej en `list_names()` (kun list-sider, ingen
  per-gruppe-GET) hvis navneopslag skal skaleres yderligere (dette var "fix #3", ikke
  implementeret da #1+#2 var tilstrækkeligt).

---

## 7. Relaterede bugs

- BUGS.md `[FIXED 6.21.0720]` — keepalive 30→10s (symptom på samme grundårsag).
- BUGS.md `[FIXED 6.18.0711]` — keepalive introduceret (symptom).
- BUGS.md `[FIXED 6.15.0702]` — drip-loop back-off.
- BUGS.md `[FIXED 6.14.0699]` — samme N+1-mønster fjernet i list-view (men overså drip).
