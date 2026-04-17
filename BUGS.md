# Bugs

Alle bugs registreres her så snart de opdages. Opdateres når de fikses.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte filer, løsning (hvis fixed).
**Status**: `open` · `investigating` · `fixed`

---

## Åbne

- `[fixed] 2026-04-16 — Custom attributes sættes ikke på endpoints` — To problemer: (1) `ensure_definitions` blev kun kaldt ved sync, ikke automatisk — fikset i build 0004. (2) **ERS stien `/ers/config/endpointcustomattribute` returnerer 404** — ERS API understøtter slet ikke oprettelse af custom attribute-definitioner. **Løsning** (build 0005): skiftet til ISE **Open API** (`/api/v1/endpoint-custom-attribute`) for at oprette definitioner.
- `[fixed] 2026-04-16 — "Location" konflikter med ISE built-in profiler attribut` — ISE returnerer 500: `"LocationLocation is refered in Profielr Rules"` ved forsøg på at oprette custom attribute "Location". ISE har et indbygget profiler-attribut med samme navn. **Løsning** (build 0006): omdøbt til `Lokation` i hele systemet (schema, store, frontend).

- `[fixed] 2026-04-17 — Save i Browse/Edit sætter altid staticGroupAssignment=true` — Når man redigerede attributter (description, owner osv.) uden at ændre Identity Group, blev tilknytning sat til Statisk fordi group_id altid blev sendt i payload. **Løsning** (build 0015): frontend sender kun `group_id` når gruppen faktisk blev ændret.
- `[fixed] 2026-04-17 — Browse/Edit refresh nulstiller filter` — Hvis man har sat et filter i Browse/Edit og trykker Refresh, vises alle endpoints i stedet for kun dem der matcher filteret. **Løsning** (build 0011): `load()` kalder nu `applyFilter()` i stedet for direkte `renderRows(allRows)`, så filter og portal-toggle bevares efter refresh.

- `[fixed] 2026-04-17 — Browse/Edit ignorerer "Default page size" preference` — Indstillingen "Default page size (browse view)" under Frontend preferences gemmes korrekt i localStorage, men Browse/Edit view brugte altid hardkodet `100` i `api.listEndpointDetails(1, 100)`. **Løsning** (build 0022): `browse.js` læser nu `pageSize` fra localStorage via `getPageSize()`.
- `[fixed] 2026-04-17 — Tema-valg slår ikke igennem` — Valg af tema under Frontend preferences gemt i localStorage men blev aldrig anvendt på DOM. **Løsning** (build 0022): tilføjet `applyTheme()`/`initTheme()` i `settings.js`, kaldt ved app-start i `app.js`, og komplet dark mode CSS i `styles.css` via `[data-theme="dark"]` selektorer.

## Fixed

(ingen)
