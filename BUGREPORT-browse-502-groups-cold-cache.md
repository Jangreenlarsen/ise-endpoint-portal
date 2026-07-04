# Bug Report: Browse viser `502` og tom tabel når `/groups` timer ud (trods varm disk-cache)

> **Status:** FIXED — frontend-resiliens (v6.21.0722) + groups disk-persistens (v6.21.0723). Fuldt løst.
> **Severity:** Middel — Browse ubrugelig i perioder efter genstart/ISE-udfald, selvom data findes i cachen
> **Type:** Frontend-orkestrering (ét ikke-kritisk kald vælter hele viewet) + manglende offline-cache for grupper
> **Primære filer:** `frontend/js/views/browse-table.js`, `backend/app/api/groups.py`, `backend/app/core/endpoint_cache.py`
>
> Skrevet til brug i **fremtidige fejlfindings-sessioner**. Beslægtet med — men adskilt fra —
> [BUGREPORT-ise-endpointgroup-storm.md](BUGREPORT-ise-endpointgroup-storm.md). Begge handler om
> skrøbelighed i gruppe-stien mod ISE; denne handler om **resiliens ved visning**, ikke om kald-mængde.

---

## 1. Symptom (hvad man ser)

- I Browse-viewet, **fra tid til anden**, vises fejlen:
  ```
  502: ISE API 0: transport error: ReadTimeout:
  ```
- Tabellen er **tom** — ingen endpoints vises overhovedet.
- Forventningen brydes: disk-cachen har endpoint-data der burde kunne vises straks.
- Selv-helende: efter et stykke tid (når ISE svarer igen) virker Browse igen.

### Fejl-fingeraftryk (diskriminator)

- **`502` (ikke `503`)** er nøglen. `/endpoints/*`-stierne konverterer transport-fejl via
  `_ise_http_error` → **`503`** ("ISE midlertidigt utilgængelig"). En rå **`502`** med teksten
  `ISE API 0: transport error: ...` kommer fra `/groups`
  ([groups.py:23](backend/app/api/groups.py#L23)): `raise HTTPException(502, detail=str(exc))`.
- Så: **`502` = grupper (eller anden rå-502-handler), `503` = endpoints.** Jag ikke endpoint-
  stien når teksten siger 502.

---

## 2. Root cause

To ting kombineret:

**(A) Frontend: ét ikke-kritisk kald kan vælte hele Browse.**
`browse-table.js` `load()` henter alt i ét `Promise.all`
([browse-table.js:607](frontend/js/views/browse-table.js#L607)). De fleste kald havde
`.catch()`-fallback, men **`api.listGroups()` og `api.listCustomAttributes()` havde ikke**.
`Promise.all` afvises hvis ét løfte afvises → `catch`-blokken kører → `tbody` ryddes → tom tabel.
Det sker selvom `api.listEndpointDetails()` ville have returneret disk-cachen fint
(`cache.detail_count() > 0` → synkron snapshot, ingen ISE — se
[endpoint_service.py:386](backend/app/services/endpoint_service.py#L386)).

**(B) Backend: gruppe-cachen har ingen offline-data.**
`EndpointCache` persisterer kun endpoint-**details** til disk (`save_to_disk`/`load_from_disk`
gemmer `_details`, ikke `_groups`). Efter en portal-genstart — eller efter `invalidate_all()`
(settings-save, pxGrid-event, manuel cache-clear) — er `_groups = None`. Første `/groups`-kald
går derfor i `get_groups()`s miss-gren og laver et **blokerende** `list_all()` mod ISE
([endpoint_cache.py:606](backend/app/core/endpoint_cache.py#L606)). Er ISE langsom i det øjeblik
→ `ReadTimeout` → `IseApiError(0)` → 502.

### Hvorfor det er intermittent
Gruppe-cachen serverer stale i op til TTL×30 (=2,5t) via SWR uden at blokere. Blokerende ISE-kald
sker kun når `_groups` er **None** (frisk genstart / lige efter invalidering) **eller** ældre end
2,5t. Rammer man Browse i præcis det vindue mens ISE er langsom, fejler det. Ellers ikke.

### Hvorfor disk-cachen "ikke hjalp"
Den hjalp — for endpoints. `listEndpointDetails` returnerede disk-data. Men det fejlende
`listGroups` afviste `Promise.all` **før** endpoint-dataene blev renderet. Symptomet lignede
"disk-cache virker ikke", men var i virkeligheden "grupper vælter visningen af disk-cachen".

---

## 3. Fixen (v6.21.0722) — frontend-resiliens

`browse-table.js`: kun `listEndpointDetails` er nu en hård afhængighed. Hjælpe-data får `.catch`:

```js
api.listCustomAttributes().catch(() => ({ attributes: [] })),
api.listGroups().catch(() => state.groups || []),   // behold sidst-kendte grupper
api.listEndpointDetails(...),                        // hård afhængighed — serverer fra cache
```

Endpoint-tabellen renderer nu altid fra disk-/memory-cachen, også når ISE er nede.
Gruppe-dropdown og filtre degraderer blødt og self-healer via SWR når ISE svarer igen.

---

## 4. Backend follow-up — groups disk-persistens (LØST i v6.21.0723)

Frontend-fixen fjernede symptomet, men gruppe-dropdown'en var stadig tom indtil første
succesfulde ISE-svar efter genstart. Løst ved at persistere gruppe-cachen til disk:

- `_save_snapshot` gemmer nu et `"groups"`-felt (`{fetched_at, value:[EndpointGroupSummary…]}`);
  `save_to_disk`/`save_to_disk_async` sender `self._groups` med.
- `DISK_CACHE_VERSION` 4→5 (gamle disk-caches droppes én gang og genopbygges ved første scan).
- `load_from_disk` gendanner `_groups` hvis `None`, med `fetched_at = now - ttl - 1` så
  `get_groups()` serverer dem **øjeblikkeligt** og spawner en ikke-blokerende SWR-refresh
  (samme princip som disk-loadede details). Ingen blokerende ISE-kald efter genstart.
- Verificeret med round-trip (gem → load i ny cache → serveres straks + bg-refresh spawnet) +
  `tests/test_endpoint_cache.py` grønne.

Yderligere mulig hærdning (ikke nødvendig efter ovenstående, noteret for fuldstændighed):
lad `/groups` degradere til sidst-kendt/tomt svar i stedet for rå 502, eller genbrug
`_shared_group_names` (id→navn fra 6.21.0721) som nød-fallback til dropdown'en.

---

## 5. Sådan verificeres fixen

1. Genstart portalen, og indlæs Browse mens ISE er langsom/utilgængelig (eller simulér ved at
   pege ISE-URL forkert kortvarigt). **Endpoint-tabellen skal stadig vise data fra disk-cachen.**
2. Ingen `502`-alert i Browse længere; i stedet evt. tom gruppe-dropdown der udfyldes efter få sek.
3. Når ISE svarer igen: gruppe-filtre/dropdown populeres automatisk (SWR) uden reload.

---

## 6. Regressions-vagt (tjek i fremtidige sessioner)

- **Nye kald i `browse-table.js` `load()`s `Promise.all` skal have `.catch`** medmindre de er
  ægte hårde afhængigheder. Kun `listEndpointDetails` bør kunne vælte tabellen.
- Samme mønster findes i andre views der kalder `api.listGroups()` uden `.catch`
  (`browse.js:893`, `register.js:132`, `import.js:62`, `policy.js:141`). De vælter deres eget view
  ved et group-502. Registrar/import har grupper som kerne-data (kan ikke oprette uden), så dér er
  en hård fejl mere acceptabel — men overvej samme degradering hvis det rapporteres.
- Fjern IKKE `.catch` fra `listGroups`/`listCustomAttributes` i browse igen "for at fange fejl" —
  fejlene hører til i hjælpe-data, ikke i endpoint-renderingen.

---

## 7. Relaterede bugs

- [BUGREPORT-ise-endpointgroup-storm.md](BUGREPORT-ise-endpointgroup-storm.md) — samme gruppe-sti,
  men kald-mængde/N+1 (6.21.0721).
- BUGS.md `[FIXED 6.14.0697]` — Browse tom efter genstart (disk-details vist for sent) — beslægtet
  disk-cache-resiliens for endpoints.
- BUGS.md `[FIXED 6.21.0718]` — Browse-reload latens (MnT-kald blokerede render) — samme princip:
  ikke-kritiske ISE-kald må ikke blokere/vælte endpoint-renderingen.
