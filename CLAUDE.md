# Projekt: ISE REST API Endpoint Portal

Dette er Claudes system-prompt for dette projekt. Den læses altid først og følges uden undtagelser.

## Faste regler

1. **Ny funktionalitet (features)** skal ALTID registreres i [FEATURES.md](FEATURES.md) *før* implementering påbegyndes. Opdatér status når den er færdig.
2. **Bugs** skal ALTID registreres i [BUGS.md](BUGS.md) så snart de opdages. Opdatér med løsning når de er fikset.
3. **Alle kodeændringer** skal logges i [CHANGELOG.md](CHANGELOG.md) med dato, berørte filer og kort beskrivelse. Nyeste øverst.
4. **Lag-arkitekturen** beskrevet i [ARCHITECTURE.md](ARCHITECTURE.md) skal respekteres. Frontend må aldrig tale direkte med ISE — kun gennem backend. Backend-lagene kalder kun nedad.
5. **ISE API reference**: [ISE_API_REFERENCE.md](ISE_API_REFERENCE.md) indeholder ERS og Open API paths, payloads, filter-syntaks, status codes og gotchas for Cisco ISE 3.4. Konsulter dette dokument ved al ISE-integration og hold det opdateret med nye fund.
6. **Runtime-logging**: Backend skal logge alle ISE-operationer til [backend/logs/app.log](backend/logs/app.log).
7. **Read/write rettigheder**: Claude har forhåndsgodkendelse (via [.claude/settings.local.json](.claude/settings.local.json)) til at læse, skrive og redigere filer i projektmappen.
8. **Versionskontrol**: Projektet er et git-repo fra start. Efter enhver logisk afsluttet ændring skal Claude lave en git commit med en beskrivende commit-besked. Aldrig bulk-commits af urelaterede ændringer.
9. **GitHub**: Alle commits skal pushes til det tilknyttede GitHub remote (`origin`) efter hver commit. Hvis remote ikke er sat op, skal Claude påminde brugeren.

## Workflow for enhver opgave

1. Tilføj entry i `FEATURES.md` (feature) eller `BUGS.md` (bug).
2. Implementer ændringen i det korrekte lag jf. `ARCHITECTURE.md`.
3. Tilføj entry i `CHANGELOG.md` når ændringen er commit-klar.
4. Kør tests hvis relevant.
5. `git add` + `git commit` med en beskrivende besked.
6. `git push origin <branch>` til GitHub.

## Projektstruktur

```
.
├── CLAUDE.md              # denne fil — regler Claude altid følger
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
