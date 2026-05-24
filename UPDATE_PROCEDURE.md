# HyperVision ISE Portal — Opdateringsprocedure (Linux server)

Denne guide beskriver hvordan portalen opdateres på produktionsserveren og hvordan de hyppigste fejl diagnosticeres og løses.

---

## Hurtig opdatering (normal procedure)

```bash
cd /opt/hypervision
git pull origin main
systemctl restart hypervision
```

Tjek at den starter korrekt:

```bash
journalctl -u hypervision -f -o short-precise
```

Vellykket opstart viser:

```
INFO  HyperVision ISE Portal vX.Y.Z build NNNN starting
INFO  lockout_store: initialiseret ...
INFO  Waiting for application startup.
INFO  Application startup complete.
```

---

## Trin-for-trin opdateringsprocedure

### 1. Verificér nuværende version

```bash
cat /opt/hypervision/version.json
```

### 2. Stop service (valgfrit — git pull virker uden)

```bash
systemctl stop hypervision
```

### 3. Hent seneste kode

```bash
cd /opt/hypervision
git pull origin main
```

Forventet output:

```
Updating abc1234..def5678
Fast-forward
 backend/app/... | ...
```

Hvis du ser `Already up to date` er der intet nyt at hente.

### 4. Installer nye Python-pakker (kun hvis `pyproject.toml` er ændret)

```bash
cd /opt/hypervision/backend
/opt/hypervision/venv/bin/pip install -e . --quiet
```

### 5. Genstart og tjek

```bash
systemctl restart hypervision
journalctl -u hypervision -f -o short-precise
```

Tryk `Ctrl+C` for at stoppe log-visningen når du er tilfreds.

---

## Diagnose: Portal svarer ikke

### Trin 1 — Tjek service-status

```bash
systemctl status hypervision
```

- `active (running)` → backend kører, fejlen er sandsynligvis i frontend/netværk
- `activating` → backend forsøger at starte (loop)
- `failed` → backend crasher ved opstart

### Trin 2 — Se fejlbesked i log

```bash
journalctl -u hypervision -n 50 --no-pager
```

Find linjer med `ERROR` eller `ModuleNotFoundError` eller `ImportError`.

### Trin 3 — Tjek hvilken version der kører

```bash
journalctl -u hypervision -n 5 --no-pager | grep "build"
```

Sammenlign med `cat /opt/hypervision/version.json`. Hvis de er forskellige er serveren ikke opdateret.

---

## Hyppige fejl og løsninger

---

### `ModuleNotFoundError: No module named 'app.core.X'`

**Årsag:** En ny Python-fil er tilføjet til git men serveren har ikke pullet den.

**Symptom i log:**
```
ModuleNotFoundError: No module named 'app.core.lockout_store'
ERROR: Application startup failed. Exiting.
```

**Løsning:**
```bash
cd /opt/hypervision
git pull origin main
systemctl restart hypervision
```

---

### `git pull` fejler: `not a git repository`

**Årsag:** Du er i den forkerte mappe.

**Løsning:**
```bash
cd /opt/hypervision   # projektets placering
git pull origin main
```

Verificér placering:
```bash
ls /opt/hypervision/version.json   # skal eksistere
```

---

### `git pull` fejler: `Your local changes would be overwritten`

**Årsag:** En fil er ændret lokalt på serveren (f.eks. config.json, .env).

**Løsning — bevar lokale ændringer:**
```bash
cd /opt/hypervision
git stash
git pull origin main
git stash pop
systemctl restart hypervision
```

**Løsning — kassér lokale ændringer (pas på!):**
```bash
cd /opt/hypervision
git checkout -- .
git pull origin main
systemctl restart hypervision
```

---

### `git pull` fejler: `insufficient permission for adding an object to repository database`

**Årsag:** Filrettigheder på `.git/objects`-mappen er forkerte — typisk opstår det hvis git-mappen er oprettet af én bruger men tilgås af en anden, eller efter en manuel kopiering af repo'et.

**Symptom (i portalen eller terminal):**
```
error: insufficient permission for adding an object to repository database .git/objects
fatal: failed to write object
fatal: unpack-objects failed
```

**Løsning:**
```bash
find /opt/hypervision/.git/objects -type d -exec chmod 755 {} \;
find /opt/hypervision/.git/objects -type f -exec chmod 644 {} \;
```

Herefter kan du køre git pull som normalt:
```bash
cd /opt/hypervision
git pull origin main
systemctl restart hypervision
```

---

### `git pull` fejler: `Permission denied`

**Årsag:** Git-credentials er ikke sat op eller SSH-nøgle mangler.

**Løsning (HTTPS med token):**
```bash
git remote set-url origin https://<TOKEN>@github.com/Jangreenlarsen/ise-endpoint-portal.git
git pull origin main
```

---

### Service starter men portal viser ingenting / 502

**Årsag:** Backend kører men kan ikke nå ISE, eller frontend-filer mangler.

**Diagnose:**
```bash
# Tjek at backend svarer
curl -s http://localhost:8000/api/health | python3 -m json.tool

# Tjek ISE-forbindelse i log
journalctl -u hypervision -n 30 --no-pager | grep -i "ise\|circuit\|transport"
```

---

### Service starter men `ImportError` på en pakke

**Årsag:** En ny Python-afhængighed er tilføjet i `pyproject.toml` men ikke installeret.

**Symptom:**
```
ImportError: No module named 'some_package'
```

**Løsning:**
```bash
cd /opt/hypervision/backend
/opt/hypervision/venv/bin/pip install -e . --quiet
systemctl restart hypervision
```

---

### Rollback til forrige version

Hvis en opdatering fejler og skal tilbagerulle:

```bash
cd /opt/hypervision

# Se seneste commits
git log --oneline -10

# Gå tilbage til forrige commit (erstat HASH med commit fra listen)
git checkout HASH

systemctl restart hypervision
```

For at komme frem igen:
```bash
git checkout main
git pull origin main
systemctl restart hypervision
```

---

## Nyttige kommandoer

| Kommando | Formål |
|----------|--------|
| `systemctl status hypervision` | Service-status |
| `systemctl restart hypervision` | Genstart |
| `systemctl stop hypervision` | Stop |
| `systemctl start hypervision` | Start |
| `journalctl -u hypervision -f` | Live log |
| `journalctl -u hypervision -n 100 --no-pager` | Seneste 100 linjer |
| `cat /opt/hypervision/version.json` | Nuværende version på server |
| `git -C /opt/hypervision log --oneline -5` | Seneste commits på server |
| `git -C /opt/hypervision fetch && git -C /opt/hypervision status` | Tjek om server er bagud |

---

## Tjek om server er bagud uden at pulle

```bash
cd /opt/hypervision
git fetch origin main
git status
```

Hvis output er:
```
Your branch is behind 'origin/main' by N commits
```
...skal du køre `git pull origin main` + `systemctl restart hypervision`.
