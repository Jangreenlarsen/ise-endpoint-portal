# Projekt: HyperVision ISE Portal

Dette er Claudes system-prompt for dette projekt. Den læses altid først og følges uden undtagelser.

## Faste regler

1. **Versionering (UFRAVIGELIG)**: Projektet versioneres via [version.json](version.json). Denne fil er den **eneste** kilde til versionsnumre — alle andre steder (backend, frontend, changelog) læser herfra.
   - Format: `{ "version": "MAJOR.MINOR.PATCH", "build": "NNNN" }`
   - **build**: incrementeres med **1** ved HVERT commit (0001 → 0002 → 0003 ...).
   - **PATCH**: incrementeres ved bug fixes. Build nulstilles IKKE.
   - **MINOR**: incrementeres ved nye features. PATCH sættes til 0.
   - **MAJOR**: incrementeres ved breaking changes eller store milepæle. MINOR og PATCH sættes til 0.
   - Changelog-entries tagges med versionsnummer: `## [1.0.0 build 0001] — 2026-04-16 — beskrivelse`.
   - Claude **skal** opdatere `version.json` og vise den nye version i commit-beskeden.
2. **Ny funktionalitet (features)** skal ALTID registreres i [FEATURES.md](FEATURES.md) *før* implementering påbegyndes. Opdatér status når den er færdig.
2. **Bugs** skal ALTID registreres i [BUGS.md](BUGS.md) så snart de opdages. Opdatér med løsning når de er fikset.
3. **Alle kodeændringer** skal logges i [CHANGELOG.md](CHANGELOG.md) med version, dato, berørte filer og kort beskrivelse. Nyeste øverst.
4. **Lag-arkitekturen** beskrevet i [ARCHITECTURE.md](ARCHITECTURE.md) skal respekteres. Frontend må aldrig tale direkte med ISE — kun gennem backend. Backend-lagene kalder kun nedad.
5. **ISE API reference**: [ISE_API_REFERENCE.md](ISE_API_REFERENCE.md) indeholder ERS og Open API paths, payloads, filter-syntaks, status codes og gotchas for Cisco ISE 3.4. Konsulter dette dokument ved al ISE-integration og hold det opdateret med nye fund.
6. **Runtime-logging**: Backend skal logge alle ISE-operationer til [backend/logs/app.log](backend/logs/app.log).
7. **Read/write rettigheder**: Claude har forhåndsgodkendelse (via [.claude/settings.local.json](.claude/settings.local.json)) til at læse, skrive og redigere filer i projektmappen.
8. **Versionskontrol**: Projektet er et git-repo fra start. Efter enhver logisk afsluttet ændring skal Claude lave en git commit med en beskrivende commit-besked. Aldrig bulk-commits af urelaterede ændringer.
9. **GitHub branch-strategi (UFRAVIGELIG)**:
   - `dev` — aktiv udviklingsbranch. **Al ny kode commites hertil.** Claude arbejder altid på `dev`.
   - `main` — stabil release-branch. Kun opdateret via PR/merge fra `dev` når en release er klar. Produktionsserver følger `main`.
   - Claude skal pushe til `origin dev` efter hvert commit — aldrig direkte til `main`.
   - Portalens GitHub-opdateringscheck følger `main` (produktionsstabil).
   - Merge `dev` → `main` gøres manuelt af Jan når en release er godkendt.
10. **Push og merge efter commit (UFRAVIGELIG)**: Efter ethvert commit skal Claude automatisk:
    - Pushe til `origin dev`
    - Spørge Jan: *"Vil du også merge til `main` og pushe?"*
    - Hvis ja: merge `dev` → `main` med `--no-ff` og pushe `origin main`
    - Hvis nej: forblive på `dev` og informere om at `main` ikke er opdateret

## Workflow for enhver opgave

1. Tilføj entry i `FEATURES.md` (feature) eller `BUGS.md` (bug).
2. Implementer ændringen i det korrekte lag jf. `ARCHITECTURE.md`.
3. Opdater `version.json`: bump build (altid), bump version (hvis feature/bugfix/breaking).
4. Tilføj entry i `CHANGELOG.md` med `[version build NNNN]` prefix.
5. Kør tests hvis relevant.
6. `git add` + `git commit` med besked der inkluderer version: `v1.0.0-b0001: beskrivelse`.
7. `git push origin dev` til GitHub.
8. Spørg Jan: *"Vil du også merge til `main`?"* — merge og push `origin main` hvis ja.

## Projektstruktur

```
.
├── CLAUDE.md              # denne fil — regler Claude altid følger
├── version.json           # SINGLE SOURCE OF TRUTH for version + build
├── ARCHITECTURE.md        # lag-struktur og arkitekturregler
├── ISE_API_REFERENCE.md   # Cisco ISE 3.4 ERS + Open API reference
├── FEATURES.md            # features (planned / in-progress / done)
├── BUGS.md                # bugs (open / fixed)
├── CHANGELOG.md           # alle kodeændringer, nyeste øverst
├── .claude/
│   └── settings.local.json
├── backend/               # FastAPI server — eneste der taler med ISE
│   ├── app/
│   │   ├── api/           # HTTP-lag (FastAPI routers)
│   │   ├── services/      # forretningslogik
│   │   ├── ise/           # ISE REST integration (ERS + Open API)
│   │   ├── schemas/       # pydantic DTOs
│   │   ├── core/          # config, logging, exceptions
│   │   └── main.py        # FastAPI entry
│   ├── tests/
│   ├── logs/              # runtime log (app.log)
│   └── pyproject.toml
└── frontend/              # web UI — taler kun med backend
    ├── index.html
    ├── css/
    └── js/
```
