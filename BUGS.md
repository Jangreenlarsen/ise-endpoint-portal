# Bugs

Alle bugs registreres her så snart de opdages. Opdateres når de fikses.

**Format**: `[status] YYYY-MM-DD — Titel` — beskrivelse, berørte filer, løsning (hvis fixed).
**Status**: `open` · `investigating` · `fixed`

---

## Åbne

- `[fixed] 2026-04-16 — Custom attributes sættes ikke på endpoints` — ISE ignorerer custom attribute værdier ved endpoint create/update fordi attribute-definitionerne (Owner, Location, AuthzVlan) ikke oprettes i ISE inden brug. `ensure_definitions` blev kun kaldt ved sync, aldrig automatisk. **Løsning**: `EndpointService` kalder nu `_ensure_ca_definitions()` automatisk (én gang per session) inden create/update med custom attributes. Berørte filer: `endpoint_service.py`.

## Fixed

(ingen)
