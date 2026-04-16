# Bugs

Alle bugs registreres her så snart de opdages. Opdateres når de fikses.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte filer, løsning (hvis fixed).
**Status**: `open` · `investigating` · `fixed`

---

## Åbne

- `[fixed] 2026-04-16 — Custom attributes sættes ikke på endpoints` — To problemer: (1) `ensure_definitions` blev kun kaldt ved sync, ikke automatisk — fikset i build 0004. (2) **ERS stien `/ers/config/endpointcustomattribute` returnerer 404** — ERS API understøtter slet ikke oprettelse af custom attribute-definitioner. **Løsning** (build 0005): skiftet til ISE **Open API** (`/api/v1/endpoint-custom-attribute`) for at oprette definitioner. Klar fejlmeddelelse i log hvis Open API heller ikke er tilgængelig, med instruktion om manuel oprettelse i ISE GUI. Berørte filer: `ise/custom_attributes.py`, `endpoint_service.py`, `main.py`.

## Fixed

(ingen)
