# Frontend smoke-tests (Playwright)

Et startniveau af end-to-end smoke-tests for portalens frontend. De åbner SPA'en i
en rigtig browser (Chromium) med **mocket backend-API** — ingen live backend eller
ISE kræves. Formålet er at fange hårde render-/boot-regressioner (import-fejl,
router-fejl, i18n-fejl, manglende felter) som `node --check` ikke ser.

## Kør

```bash
cd frontend-tests
npm install                 # engangs — henter @playwright/test
npm run install-browser     # engangs — henter Chromium (~100-300 MB)
npm test                    # kør alle smoke-tests
npm run test:headed         # samme, men med synlig browser
```

Playwright starter selv en statisk fil-server (`python -m http.server 8080` mod
`../frontend`) via `webServer` i `playwright.config.ts` og lukker den ned igen.

## Struktur

- `fixtures.ts` — `seedAdminSession()` (logget-ind localStorage-state) + `installApiMock()`
  (mocker alle `/api/**`-kald; overskriv pr. test).
- `tests/smoke-login.spec.ts` — login-formularen renderes for uautentificeret bruger.
- `tests/smoke-shell.spec.ts` — autentificeret shell (sidebar + bruger-badge) renderes uden crash.
- `tests/smoke-settings.spec.ts` — Settings → ISE-forbindelse indeholder `#base_url` + det nye `#read_base_url`-felt (Fase B).
- `tests/smoke-policy.spec.ts` — policy-viewet navigerer og renderer uden crash.

## Udvid

Tilføj dybere assertions ved at mocke de relevante endpoints i `installApiMock(page, {...})`
og assert på konkrete DOM-elementer (fx tabel-rækker i Browse, `.cond-view-*`-blokke i Policy).
Nøglen er path efter `/api/` (fx `"endpoints/details/all"`), værdien er JSON-body'en.
