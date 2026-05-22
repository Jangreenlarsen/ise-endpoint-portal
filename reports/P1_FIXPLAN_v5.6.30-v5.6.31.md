# HyperVision ISE Portal — P1 Fix-plan
## Sprint: v5.6.30 → v5.6.31

**Baseret på:** QUALITY_REPORT_2026-05-22.md  
**Udarbejdet:** 2026-05-22  
**Målversioner:** v5.6.30 (kritiske + sikkerhed) → v5.6.31 (UX + kvalitet)

---

## Undersøgelsesresultater (uddyber rapporten)

Under planudarbejdelsen er der foretaget en dybere analyse. Nogle fund fra rapporten er opdateret:

| Fund | Rapport-status | Verificeret status |
|------|---------------|-------------------|
| Rate limiting på `/auth/login` | ⚠️ Advarsel | ✅ OK — middleware dækker alle `/api/`-paths incl. login |
| `dashboard.js` cleanup | ⚠️ Advarsel | ✅ OK — returnerer cleanup-funktion korrekt |
| `policy.js` event listener cleanup | ⚠️ Advarsel | ⚠️ Lavere risiko — listeners er på container-children der erstattes ved re-render |
| `metrics.js` setInterval | ⚠️ Advarsel | ⚠️ Lavere risiko — `container.isConnected`-guard stopper timer automatisk |
| **`import.js` kald til udefineret `esc()`** | _(ikke opdaget)_ | 🔴 **KRITISK BUG** — `escapeHtml()` defineret, `esc()` kaldt |
| **`browse-utils.js:esc()` ufuldstændig** | _(nævnt)_ | 🔴 **SIKKERHEDSFEJL** — mangler `&`, `>`, `'` escape |

---

## Prioriteret fix-liste

### 🔴 KRITISK — skal fixes i v5.6.30

#### Fix 1: `import.js` — udefineret `esc()` (ReferenceError ved fejlvisning)

**Problem:**  
`import.js` definerer `escapeHtml(s)` (linje 7) men kalder `esc(err.message)` (linje 72 og 202). `esc` er aldrig defineret i modulet → `ReferenceError` kastes hver gang en fejl skal vises til brugeren. Fejlen er skjult bag en fejlsituation og er derfor svær at opdage i normal brug.

**Berørte filer:** `frontend/js/views/import.js`

**Fix:**  
Tilføj import af `esc` fra `browse-utils.js` og fjern den lokale `escapeHtml()`:
```javascript
// Tilføj i toppen:
import { esc } from "./browse-utils.js";

// Fjern linje 7-11 (lokal escapeHtml-definition)
```

**Risiko ved fix:** Meget lav — ren import-ændring.

---

#### Fix 2: `browse-utils.js:esc()` — ufuldstændig HTML-escaping (XSS-risiko)

**Problem:**  
`browse-utils.js` linje 72-74 definerer:
```javascript
export function esc(s) {
  return (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
```
Denne funktion **mangler escape af `&`, `>` og `'`**. Den bruges via import i `browse-bulk.js`, `browse-detail.js` og `browse-table.js` — alle kritiske komponenter der renderer ISE-data i innerHTML.

Korrekt implementering (som bruges i `settings/shared.js`):
```javascript
export function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
```

**Berørte filer:**  
- `frontend/js/views/browse-utils.js` (fix her)
- `frontend/js/views/browse-bulk.js` (bruger allerede import — får fix gratis)
- `frontend/js/views/browse-detail.js` (bruger allerede import — får fix gratis)
- `frontend/js/views/browse-table.js` (bruger allerede import — får fix gratis)

**Fix:** Erstat `esc()`-implementeringen i `browse-utils.js` med den fulde 5-tegns version.

**Risiko ved fix:** Meget lav — strenge med `&` vises nu korrekt som `&amp;` i HTML.

---

#### Fix 3: Centraliser `esc()` — erstat 12 lokale kopier med import

**Problem:**  
12 view-filer definerer deres egen lokale `esc()` med varierende sikkerhedsniveau. Hverken konsistent eller vedligeholdelsesvenligt.

**Berørte filer og nuværende implementation:**

| Fil | Nuværende esc() | Sikkerhedsniveau |
|-----|----------------|-----------------|
| `attributes.js:6` | lokal definition | ❓ Ukendt variant |
| `audit.js:7` | lokal definition | ❓ |
| `csv-template.js:6` | lokal definition | ❓ |
| `dacls.js:6` | lokal definition | ❓ |
| `dashboard.js:10` | lokal definition | ❓ |
| `lifecycle.js:6` | lokal definition | ❓ |
| `login.js:7` | lokal definition | ❓ |
| `logs.js:6` | lokal definition | ❓ |
| `metrics.js:239` | lokal inline (3-tegn) | ⚠️ Mangler `"` og `'` |
| `policy.js:14` | lokal (5-tegn, fuld) | ✅ |
| `policy-condition-builder.js:8` | lokal definition | ❓ |
| `register.js:23` | lokal definition | ❓ |
| `user-prefs.js:8` | lokal definition | ❓ |
| `section-authz-profiles.js:6` | lokal definition | ❓ |

**Strategi:**  
- `browse-utils.js` er allerede imported i browse-* filer → fix #2 ovenfor løser disse
- Settings-filer bruger `settings/shared.js:esc` (som har fuld implementation) → efterlades uændret
- Alle øvrige view-filer: tilføj `import { esc } from "./browse-utils.js";` og slet lokal definition

**Fix per fil (gentages for alle):**
```javascript
// TILFØJ (øverst i imports):
import { esc } from "./browse-utils.js";

// FJERN: den lokale `function esc(s) { ... }` blok
```

**Undtagelse:** `metrics.js` bruger en inline `esc` inde i en nested funktion (linje 239). Her defineres variablen som lokal konstant. Fix: Hoist til module-scope som import.

**Risiko ved fix:** Lav — ren refaktor, logikken er identisk efter fix #2.

---

#### Fix 4: `BulkCreateRequest` — tilføj max_items grænse

**Problem:**  
`backend/app/schemas/endpoint.py` linje 71-73:
```python
class BulkCreateRequest(BaseModel):
    items: list[CreateEndpointRequest]
    overwrite: bool = False
```
Ingen øvre grænse. En CSV med 100.000 rækker processeres komplet, hvilket kan:
- Overbelaste ISE (rate limiting på ISE-siden)
- Udtømme server-hukommelse
- Blokere andre requests i lang tid

**Fix:**
```python
class BulkCreateRequest(BaseModel):
    items: list[CreateEndpointRequest] = Field(..., max_length=5_000)
    overwrite: bool = False
```

**Berørte filer:** `backend/app/schemas/endpoint.py`

**Frontend-konsekvens:** `frontend/js/views/import.js` bør vise en klar fejlbesked ved 422 (Pydantic vil returnere `422 Unprocessable Entity` med detail om `max_length`).

**Risiko ved fix:** Meget lav — kun store uploads berøres.

---

### ⚠️ ADVARSEL — fixes i v5.6.31

#### Fix 5: `policy.js` — silent catches giver tom editor uden feedback

**Problem:**  
`policy.js` linje 73-84:
```javascript
api.listCustomAttributes().then((res) => {
  if (res?.attributes) {
    for (const a of res.attributes) caValues[a.name] = a.values || [];
  }
}).catch(() => {});   // ← silent!

api.listGroups().then((res) => {
  ...
}).catch(() => {});   // ← silent!
```

Hvis disse kald fejler (ISE nede, netværk), forbliver `caValues` tom. Brugeren åbner policy-editoren og ser tomme dropdowns — ingen forklaring.

**Fix:**  
Tilføj en mild advarsel i form af en console.warn og evt. en toast-notifikation. Da `caValues` er kosmetisk (editoren virker stadig), er en inline-fejlbesked ikke nødvendig — men `console.warn` hjælper debugging:
```javascript
api.listCustomAttributes().then((res) => {
  if (res?.attributes) {
    for (const a of res.attributes) caValues[a.name] = a.values || [];
  }
}).catch((err) => {
  console.warn("[policy] Custom attributes unavailable:", err.message);
});
```

**Berørte filer:** `frontend/js/views/policy.js`

---

#### Fix 6: `policy.js` — mangler cleanup-funktion

**Problem:**  
`renderPolicy()` returnerer ikke en cleanup-funktion. Selvom container-children erstattes ved næste render (og listeners derved orphanes), er det god praksis at eksplicit rydde op. Intern state (`selectedSetId`, `selectedRuleId`, `caValues`) beholdes heller ikke korrekt ved re-entry.

**Fix:**  
```javascript
// Sidst i renderPolicy(), efter `await loadSets();`:
return function cleanup() {
  // Intet eksplicit at fjerne — listeners er på container-children
  // der ryddes af app.js. Men returner funktion for konsistens.
};
```

**Berørte filer:** `frontend/js/views/policy.js`

---

#### Fix 7: `metrics.js` — tilføj cleanup-funktion

**Problem:**  
`metrics.js` har `setInterval` via `startTimer()` (linje 265-273) men returnerer ingen cleanup-funktion. Selvom `container.isConnected`-guard stopper timeren automatisk ved næste tick, er der potentielt et interval der kører én gang for meget efter navigation.

**Fix:**
```javascript
// Eksporter timer-ref og returner cleanup:
let timer = null;
// ... (eksisterende startTimer beholder clearInterval-guard)

await load();
startTimer();

return function cleanup() {
  if (timer) { clearInterval(timer); timer = null; }
};
```

**Berørte filer:** `frontend/js/views/metrics.js`

---

#### Fix 8: Test-dækning — auth-endpoints

**Problem:**  
`/auth/login`, `/auth/refresh` og `require_admin`/`require_editor` middleware er ikke testet. Et silent regression her ville ikke opdages.

**Nye testfiler:**
- `backend/tests/test_auth.py` — login succes, forkert password, token refresh, udløbet token
- `backend/tests/test_authz.py` — admin-endpoint med viewer-token → 403, editor-endpoint med admin-token → 200

**Berørte filer:** `backend/tests/` (nye filer)

---

## Versionsoversigt

```
v5.6.29 (nuværende)
  │
  ├─ v5.6.30 — Kritiske fixes + Sikkerhed
  │     Fix 1: import.js — udefineret esc() → ReferenceError
  │     Fix 2: browse-utils.js — esc() opgraderet til fuld 5-tegns escape
  │     Fix 3: 12 view-filer — centralisér esc() via import
  │     Fix 4: BulkCreateRequest — max_length=5000
  │
  └─ v5.6.31 — UX + Kvalitet
        Fix 5: policy.js — silent catches → console.warn
        Fix 6: policy.js — cleanup-funktion
        Fix 7: metrics.js — cleanup-funktion
        Fix 8: tests/test_auth.py + test_authz.py
```

---

## Rækkefølge og afhængigheder

```
Fix 2 (browse-utils.js esc)
  └─ skal laves FØR Fix 3 (ellers importerer filerne stadig en dårlig esc)

Fix 1 (import.js)
  └─ kan laves uafhængigt af Fix 2/3

Fix 4 (BulkCreateRequest)
  └─ kan laves uafhængigt

Fix 5+6 (policy.js)
  └─ kan laves i ét commit

Fix 7 (metrics.js)
  └─ kan laves uafhængigt

Fix 8 (tests)
  └─ kan laves uafhængigt
```

---

## Estimat

| Fix | Kompleksitet | Tid |
|-----|-------------|-----|
| Fix 1 — import.js esc | Triviel | 5 min |
| Fix 2 — browse-utils.js esc upgrade | Triviel | 5 min |
| Fix 3 — 12 filer centralisér esc | Lav (gentaget) | 20 min |
| Fix 4 — BulkCreateRequest max_length | Triviel | 5 min |
| Fix 5+6 — policy.js cleanup + catch | Lav | 10 min |
| Fix 7 — metrics.js cleanup | Lav | 10 min |
| Fix 8 — auth tests | Medium | 45 min |
| **Total** | | **~100 min** |

---

*Plan udarbejdet 2026-05-22 — klar til implementering*
