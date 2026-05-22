# Telemetri-analyse: Session-data flow i HyperVision ISE Portal

**Dato:** 2026-05-20  
**Version analyseret:** 5.6.8 build 0455  
**Formål:** To-faset analyse af session-telemetri — afdækning af alle datakilder (fase 1) efterfulgt af dybdegående vurdering af identificerede risikozoner (fase 2).

---

## FASE 1 — Afdækning: Kortlægning af alle datakilde-flows

### Oversigt over datakilder

Der er 7 distinkte kilder der kan skrive til `SessionCache`. Rækkefølgen herunder afspejler den kronologiske aktiveringsrækkefølge ved opstart.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ DATAKILDER → SessionCache                                                │
├────┬─────────────────────────────────┬───────────────┬──────────────────┤
│ #  │ Kilde                           │ Timing        │ Triggeres af     │
├────┼─────────────────────────────────┼───────────────┼──────────────────┤
│ 1  │ Disk cache (load_from_disk)     │ Synkron/start │ Backend-opstart  │
│ 2  │ pxGrid getSessions              │ +~5-30s       │ STOMP connect    │
│ 2b │ MnT ActiveList (fallback)       │ +~5-30s       │ getSessions fejl │
│ 3  │ pxGrid STOMP real-time          │ Løbende       │ ISE auth-event   │
│ 4  │ MnT real-time (_enrich_single)  │ +sekunder     │ STOMP-event      │
│ 5  │ MnT periodic (_enrich_sessions) │ +45s, hvert 5 min │ Timer        │
│ 6  │ MnT stale (reconcile_stale)     │ +120s, hvert 10 min │ Timer      │
└────┴─────────────────────────────────┴───────────────┴──────────────────┘
```

---

### Kilde 1: Disk cache — `session_cache.load_from_disk()`

- **Fil:** `backend/app/pxgrid/session_cache.py:205`
- **Hvornår:** Synkront ved backend-opstart, **før** pxGrid-worker starter
- **Hvad den leverer:** Alle `SessionInfo`-felter incl. VLAN, dacl, identity_group fra forrige kørsel
- **Prioritet:** Lavest — overskrives af alle efterfølgende kilder
- **Risiko:** Dataalderen er ukendt. Genstartes backend efter en lang offline-periode kan disk-cachen indeholde sessioner der er afbrudt siden, og VLAN-data der er forældet med timer

```python
# session_cache.py:220-239
info = SessionInfo(
    mac=mac,
    vlan=item.get("vlan", ""),  # ← direkte fra JSON, ingen validering af alder
    ...
)
self._sessions[mac] = info  # ← overskrives ikke — gemmes til reconcile rydder op
```

**Vinduesbredte:** Fra opstart til getSessions-reconcile er færdig (typisk 5-30s afhængig af ISE-responstid). I det vindue vises potentielt forældet VLAN til brugeren.

---

### Kilde 2: pxGrid getSessions — `_reconcile_from_pxgrid()`

- **Fil:** `backend/app/pxgrid/session_worker.py:637`
- **Hvornår:** Umiddelbart efter STOMP CONNECT+SUBSCRIBE lykkes (dvs. ved opstart og ved reconnect)
- **Hvad den leverer:** Fuld pxGrid-session payload inkl. `tunnelPrivateGroupId` → VLAN via `_parse_vlan()`
- **Prioritet for VLAN:** `info.vlan or (existing.vlan if existing else "")` — pxGrid foretrækkes

**Eviction-logik:** Fjerner alle cache-entries hvis MAC ikke er i getSessions-resultatet (afbrudte sessioner ryddes op).

**Update-logik for eksisterende entries:**
```python
# session_worker.py:704-708
new_has_data = bool(info_with_mac.policy_set_name or info_with_mac.authz_profiles)
existing_lacks_data = existing and not existing.policy_set_name and not existing.authz_profiles
nas_improved = bool(nas_device_type and not (existing and existing.nas_device_type))
if (existing_lacks_data and new_has_data) or nas_improved:
    await cache.upsert(info_with_mac)
```

**Kritisk observation:** Eksisterende entries med policy-data opdateres **ikke** ved reconnect. Kun entries der mangler policy_set_name/authz_profiles, eller hvor NAS-info forbedres. VLAN-ændringer der sker mens STOMP er offline vil **ikke** blive reflekteret for veletablerede sessions.

---

### Kilde 2b: MnT ActiveList fallback — `_reconcile_from_mnt()`

- **Fil:** `backend/app/pxgrid/session_worker.py:719`
- **Aktiveres kun:** Hvis getSessions fejler (timeout, ISE-fejl)
- **Hvad den leverer:** Reduceret data — mangler authz_profiles, policy_set_name, VLAN er ikke altid med
- **Begrænsning:** Seeder kun nye entries (MAC'er der ikke allerede er i cachen), opdaterer ikke eksisterende

---

### Kilde 3: pxGrid STOMP real-time — `_handle_message_body()`

- **Fil:** `backend/app/pxgrid/session_worker.py:369`
- **Hvornår:** Straks ved ISE auth/re-auth/disconnect-event
- **Hvad den leverer:** Real-time session-state, VLAN via `tunnelPrivateGroupId` (normaliseret af `_parse_vlan()`)
- **Arvs-logik:**

```python
# session_worker.py:396-416
is_new_session = bool(
    info.audit_session_id and existing.audit_session_id
    and info.audit_session_id != existing.audit_session_id
)
if not info.dacl and not is_new_session:
    info.dacl = existing.dacl          # arv kun fra SAMME session
if not info.vlan and not is_new_session:
    info.vlan = existing.vlan          # arv kun fra SAMME session
if not info.cts_security_group and not is_new_session:
    info.cts_security_group = existing.cts_security_group
```

**Design:** `audit_session_id`-check sikrer at vlan/dacl/sgt fra en gammel session **ikke** arves til en ny session (re-auth). Mangler STOMP-event `tunnelPrivateGroupId` og det er en re-auth, sættes vlan til "" og MnT-berigelse tager over.

**Disconnect-håndtering:** Events med state "DISCONNECTED"/"STOPPED"/"TERMINATED" kalder `cache.remove(mac)` — MAC fjernes fuldstændig fra cachen.

---

### Kilde 4: MnT real-time per-endpoint — `_enrich_single_from_mnt()`

- **Fil:** `backend/app/pxgrid/session_worker.py:825`
- **Hvornår:** Fire-and-forget task, trigges fra `_handle_message_body` når `not info.identity_group or not info.endpoint_policy or not info.vlan`
- **Latens:** Millisekunder til sekunder efter STOMP-event (MnT HTTP-kald, 15s timeout)
- **VLAN-prioritet:** `current.vlan or data.get("vlan")` → **pxGrid foretrækkes**

```python
# session_worker.py:866
vlan=current.vlan or data.get("vlan"),
```

**Begrundelse for pxGrid-præference:** Funktionen aktiveres straks efter STOMP. MnT lagger typisk sekunder til minutter. Hvis STOMP leverede korrekt VLAN (tunnelPrivateGroupId), er MnT'S svar stadig det FORRIGE VLAN.

**Felter der foretrækker MnT:** identity_group, auth_method, endpoint_policy, dacl, cts_security_group — disse er ikke reliable i STOMP-payload, så MnT er autoritativ.

---

### Kilde 5: MnT periodisk enrich — `_enrich_sessions_from_mnt()`

- **Fil:** `backend/app/pxgrid/session_worker.py:890`
- **Timing:** 45s initial delay, derefter hvert 5. minut
- **Filter:** Kører kun for sessions med `not s.identity_group or not s.endpoint_policy or not s.authz_profiles`
- **VLAN-prioritet:** `data.get("vlan") or current.vlan` → **MnT foretrækkes**

```python
# session_worker.py:936
vlan=data.get("vlan") or current.vlan,
```

**Potentielt problem:** MnT foretrækkes her under antagelse af at MnT har nået at indhente. Men hvis en VLAN-ændring sker tæt på et 5-minutters-tjek (fx 10 sekunder før), kan MnT stadig returnere det gamle VLAN og overskrive det korrekte pxGrid-VLAN i cachen. Se Fase 2 for analyse.

---

### Kilde 6: MnT stale reconcile — `reconcile_stale_sessions()`

- **Fil:** `backend/app/pxgrid/session_worker.py:953`
- **Timing:** 120s initial delay, derefter hvert 10. minut (konfigurerbar)
- **Filter:** Kører kun for endpoints hvis `endpoint_cache.detail_age(ep_id) > TTL` — dvs. endpoints der er stale i endpoint-cachen
- **Max batch:** 50 entries pr. kørsel, ældst-stale-først
- **VLAN-prioritet:** `data.get("vlan") or existing.vlan` → **MnT foretrækkes**

**Formål:** Fanger endpoints for hvem pxGrid STOMP-events aldrig ankom (PSN failover, WSS timeout, netværksfejl). For disse endpoints er MnT den eneste kilde til aktuel session-info — pxGrid-data er fraværende.

---

### Kilde 7: SSE broadcast — `SessionCache._broadcast()`

- **Fil:** `backend/app/pxgrid/session_cache.py:89`
- **Hvornår:** Udsendes ved hvert `cache.upsert()` og `cache.remove()`
- **Indhold:** Alle `SessionInfo`-felter excl. `raw`
- **Modtagere:** Alle aktive SSE-subscribere (frontend Browse-side)

Frontend-visning er konsistent med hvad der sidst blev skrevet til cachen — SSE sender aldrig forældet data.

---

### VLAN-prioritetsmatrix — opsummering

| Datakilde | VLAN-prioritet | Begrundelse |
|---|---|---|
| Disk cache | Hvad der blev gemt | Potentielt forældet |
| getSessions (reconnect) | pxGrid > cache | pxGrid er frisk ved reconnect |
| STOMP real-time | pxGrid direkte | Frisk fra ISE |
| `_enrich_single_from_mnt` | **pxGrid > MnT** | MnT stale, kører straks |
| `_enrich_sessions_from_mnt` | **MnT > pxGrid** | Antages at MnT har indhentet |
| `reconcile_stale_sessions` | **MnT > pxGrid** | Periodisk, MnT anses reliable |

---

## FASE 2 — Risikovurdering: Dybdegående analyse af identificerede problemzoner

### Problem 1: `_enrich_sessions_from_mnt` — MnT kan overskrive korrekt VLAN

**Prioritet: HØJ**

`_enrich_sessions_from_mnt` bruger `data.get("vlan") or current.vlan` (MnT foretrækkes). Den kører hvert 5. minut og behandler sessions med ufuldstændige felter (manglende identity_group, endpoint_policy, eller authz_profiles).

**Scenarie der bryder:**
1. T=0: Endpoint re-auther med ny VLAN 32. STOMP sender event med `tunnelPrivateGroupId=(tag=0) 32`. Cache: VLAN=32.
2. T=2s: `_enrich_single_from_mnt` kører. MnT returnerer VLAN=10 (gammelt, MnT ikke opdateret). Men `current.vlan or data.get("vlan")` → VLAN=32 bevares ✓
3. T=4m50s: `_enrich_sessions_from_mnt` kører (endpoint mangler fx authz_profiles). `data.get("vlan") or current.vlan` → MnT returnerer VLAN=10 (MnT lagger stadig 5+ min) → VLAN i cache overskrives til 10 ✗

**Bekræftelse:** Dette er den samme kategori fejl som den "ét skridt bagud"-fejl der blev fixet i `_enrich_single_from_mnt`. Funktionen er parallel men er ikke blevet rettet.

**Fix:** Skift linje 936 til samme pxGrid-præference som `_enrich_single_from_mnt`:
```python
# FØR:
vlan=data.get("vlan") or current.vlan,
# EFTER:
vlan=current.vlan or data.get("vlan"),
```

**Bemærkning:** `reconcile_stale_sessions` bruger MnT-præference (linje 1031) og det er korrekt der — den kører kun på endpoints der er "stale" i endpoint-cachen, og er designet til at indhente sessioner der ALDRIG fik et STOMP-event. MnT er autoritativ i den kontekst.

---

### Problem 2: `_reconcile_from_pxgrid` opdaterer ikke eksisterende entries med policy-data

**Prioritet: MEDIUM**

Ved STOMP-reconnect kører `_reconcile_from_pxgrid()`. For eksisterende cache-entries tjekkes:

```python
new_has_data = bool(info_with_mac.policy_set_name or info_with_mac.authz_profiles)
existing_lacks_data = existing and not existing.policy_set_name and not existing.authz_profiles
if (existing_lacks_data and new_has_data) or nas_improved:
    await cache.upsert(info_with_mac)
```

Entries med `policy_set_name` eller `authz_profiles` allerede sat **springes over**. Dvs. VLAN-ændringer der sker mens STOMP er offline reflekteres ikke ved reconnect for veletablerede sessions.

**Scenarie der bryder:**
1. STOMP-forbindelsen falder ud pga. PSN failover (f.eks. 10 minutter)
2. I offline-vinduet ændres VLAN for 5 endpoints (802.1X re-auth)
3. STOMP reconnect → getSessions kører → de 5 endpoints har policy_set_name sat → springes over
4. Cache viser fortsat det gamle VLAN for de 5 endpoints

**Hvornår rettes det?** Senest efter 10 minutter via `reconcile_stale_sessions` (hvis endpoints er stale i endpoint-cachen). Hvis endpoints er friske i endpoint-cachen, er der **ingen automatisk mekanisme** der opdaterer VLAN — det sker kun ved næste STOMP-event (re-auth).

**Potentielt fix:** Opdater VLAN (og dacl/sgt) for eksisterende entries ved reconnect uanset policy-data:
```python
# Tilføj: opdatér ALTID session-specifikke felter fra getSessions ved reconnect
if existing and info_with_mac.vlan and info_with_mac.vlan != existing.vlan:
    await cache.upsert(info_with_mac)
    updated += 1
```

**Forsigtighed:** getSessions returnerer snapshots — der er en lille risiko for at vi modtager et forældet getSessions-svar. I praksis er ISE's getSessions ganske aktuelt.

---

### Problem 3: Race condition mellem `_enrich_single_from_mnt` og `_enrich_sessions_from_mnt`

**Prioritet: LAV-MEDIUM**

Der er ingen koordinering mellem de to MnT-berigelsesvejer. Begge kan eksekvere parallelt for den samme MAC:

- STOMP-event ankommer → `_enrich_single_from_mnt` startes som fire-and-forget task (asyncio.create_task)
- `_enrich_sessions_from_mnt` kører samtidig (er midt i sin 5-minutters-cyklus)
- Begge laver `cache.get(mac)`, begge bygger en `updated` SessionInfo, begge kalder `cache.upsert(updated)`
- Det **sidste** kald vinder

**Effekt:** Afhænger af rækkefølgen. Da `_enrich_sessions_from_mnt` bruger MnT-præference for VLAN og `_enrich_single_from_mnt` bruger pxGrid-præference, kan rækkefølgen af de to `upsert()`-kald bestemme om det korrekte VLAN vises.

Dette er en "last-write-wins"-race. Sandsynligheden for at de overlapper er lav (5-minutters-cyklus vs. få sekunder), men den er ikke nul.

---

### Problem 4: Disk cache — stale data ved lang offline-periode

**Prioritet: LAV**

`load_from_disk()` indlæser sessions synkront ved opstart uden at validere `last_event_at`. Sessioner fra den forrige kørsel kan repræsentere endpoints der for længst er logget af.

**Tidsvindue med stale data:** Fra opstart til `_reconcile_from_pxgrid` er færdig (typisk 5-30s). Frontend-brugere der tilgår portalen i dette vindue kan se afbrudte sessioner eller gamle VLAN-værdier.

**Eksisterende mitigering:** `_reconcile_from_pxgrid` evicterer sessions der ikke er i getSessions-resultatet. Vinduet er kort i normal drift.

**Potentielt fix:** Markér disk-indlæste sessions med et flag (`from_disk=True`) og vis dem med en "stale"-indikator i UI'et indtil reconcile er bekræftet.

---

### Problem 5: Fire-and-forget task-akkumulering ved travl ISE-trafik

**Prioritet: LAV**

For hvert STOMP-event med `not info.identity_group or not info.endpoint_policy or not info.vlan` startes en ny asyncio-task:

```python
asyncio.create_task(
    _enrich_single_from_mnt(cache, info.mac),
    name=f"mnt-enrich-{info.mac[:8]}",
)
```

Der er **ingen throttling** eller deduplicering på MAC-niveau. Ankommer 100 STOMP-events på ét sekund for 100 endpoints, spawnes 100 MnT HTTP-tasks med timeout 15s. Ved høj ISE-aktivitet (fx CoA til mange endpoints) kan dette bygge op.

**Effekt:** Øget load på MnT API, potentiel ISE-rate-limiting. Ikke en korrekthedsfejl, men en skalerbarhedsrisiko.

**Potentielt fix:** Deduplicer per MAC — hold et in-flight sæt og skip task-spawn hvis MAC allerede er under berigelse:
```python
_enrich_in_flight: set[str] = set()

if mac not in _enrich_in_flight:
    _enrich_in_flight.add(mac)
    asyncio.create_task(_enrich_single_from_mnt_tracked(cache, mac, _enrich_in_flight))
```

---

### Problem 6: `reconcile_stale_sessions` — max_batch=50 kan efterlade mange endpoints stale

**Prioritet: LAV**

Kører hvert 10. minut og behandler max 50 endpoints. Ældst-stale-først. I et deployment med 500+ endpoints kan endpoints vente 10× 10 min = 100 minutter på at blive reconciled.

**Mitigering:** STOMP real-time er primærkilden. `reconcile_stale_sessions` er kun safety-net for endpoints der aldrig modtog STOMP-events. For aktive endpoints (der re-auther) opdateres de via STOMP uanset batch-størrelsen.

---

### Problem 7: VLAN-kilde i `fetch_session_by_mac` — Session/MACAddress vs AuthStatus prioritet

**Prioritet: LAV**

`fetch_session_by_mac` henter VLAN fra to MnT-endpoints:

1. `Session/MACAddress` → `out["vlan"]` sættes direkte fra XML-felt
2. `AuthStatus/MACAddress` → `out["vlan"]` sættes KUN hvis `not out["vlan"]` (dvs. kun som fallback)

```python
# mnt_sessions.py:208-213
if not out["vlan"]:
    resp_str = elem.get("response", "")
    m = re.search(r"Tunnel-Private-Group-ID=(?:\(tag=\d+\)\s*)?(\d+)", resp_str)
    if m:
        out["vlan"] = m.group(1)
```

**Mulig fejlkilde:** Hvis `Session/MACAddress` returnerer et VLAN (fra en GAMMEL session der ikke er ryddet op i MnT) og `AuthStatus` har det korrekte nyere VLAN i AV-pair-strengen, bruges det forkerte. Session/MACAddress er typisk mere opdateret end AuthStatus — men ikke altid.

**Konsekvens:** Normalt ubetydelig. Men i edge-cases med ISE's session-overlap (gammel session ryddes langsomt op) kan det give forkert VLAN fra MnT.

---

## Sammenfatning og prioriteret handlingsplan

| # | Problem | Prioritet | Fix-kompleksitet |
|---|---|---|---|
| 1 | `_enrich_sessions_from_mnt` VLAN overskriver korrekt pxGrid-VLAN | HØJ | Lav — 1-linje fix |
| 2 | `_reconcile_from_pxgrid` opdaterer ikke VLAN for veletablerede sessions ved reconnect | MEDIUM | Medium |
| 3 | Race condition: to MnT-berigelsesvejer uden koordinering | LAV-MEDIUM | Medium |
| 4 | Disk cache viser stale data i startup-vinduet | LAV | Lav (UI-indikator) |
| 5 | Fire-and-forget task-akkumulering ved høj ISE-trafik | LAV | Medium |
| 6 | max_batch=50 i stale-reconcile utilstrækkelig ved store deployments | LAV | Lav (konfig) |
| 7 | Session/MACAddress VLAN kan overskygge nyere AuthStatus VLAN | LAV | Medium |

**Anbefalet næste skridt:** Fix Problem 1 (`_enrich_sessions_from_mnt` linje 936) — det er det eneste resterende tilfælde af den "MnT overskriver korrekt pxGrid-VLAN"-fejlklasse der allerede er fixet i `_enrich_single_from_mnt` og bekræftet som reel bug.
