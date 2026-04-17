# Bugs

Alle bugs registreres her så snart de opdages. Opdateres når de fikses.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte filer, løsning (hvis fixed).
**Status**: `open` · `investigating` · `fixed`

---

## Åbne

- `[fixed] 2026-04-16 — Custom attributes sættes ikke på endpoints` — To problemer: (1) `ensure_definitions` blev kun kaldt ved sync, ikke automatisk — fikset i build 0004. (2) **ERS stien `/ers/config/endpointcustomattribute` returnerer 404** — ERS API understøtter slet ikke oprettelse af custom attribute-definitioner. **Løsning** (build 0005): skiftet til ISE **Open API** (`/api/v1/endpoint-custom-attribute`) for at oprette definitioner.
- `[fixed] 2026-04-16 — "Location" konflikter med ISE built-in profiler attribut` — ISE returnerer 500: `"LocationLocation is refered in Profielr Rules"` ved forsøg på at oprette custom attribute "Location". ISE har et indbygget profiler-attribut med samme navn. **Løsning** (build 0006): omdøbt til `Lokation` i hele systemet (schema, store, frontend).

- `[fixed] 2026-04-17 — Browse/Edit refresh nulstiller filter` — Hvis man har sat et filter i Browse/Edit og trykker Refresh, vises alle endpoints i stedet for kun dem der matcher filteret. **Løsning** (build 0011): `load()` kalder nu `applyFilter()` i stedet for direkte `renderRows(allRows)`, så filter og portal-toggle bevares efter refresh.

## Fixed

(ingen)
