<!-- Version: 5.5.0 | Opdateret: 2026-05-18 -->

# 02 — Installation og første opsætning

---

## Installationsmetoder

| Metode | Hvornår |
|---|---|
| **OVA-image** (anbefalet) | Fresh server — importér OVA i ESXi, first-boot wizard konfigurerer alt |
| **install.sh** | Eksisterende Debian/Ubuntu-server |
| **Manuel** | Windows eller tilpassede Linux-opsætninger |

---

## Metode 1 — OVA-image til VMware ESXi (anbefalet)

OVA-imaget indeholder et rent Debian 13-system med en first-boot wizard. Wizarden konfigurerer netværk, hostname og root-adgangskode, og installerer derefter portalen automatisk fra GitHub.

### Forudsætninger

| Krav | Detaljer |
|---|---|
| VMware ESXi | 7.0 eller nyere |
| Internet | Serveren skal nå GitHub under first-boot |

### Trin 1 — Importér OVA i ESXi

1. Log ind i ESXi Host Client (`https://<esxi-ip>`)
2. **Create / Register VM → Deploy a virtual machine from an OVF or OVA file**
3. Vælg `hypervision-base.ova`
4. Vælg datastore og netværk
5. Gennemfør import

### Trin 2 — Start VM og kør first-boot wizard

1. Start VM'en i ESXi
2. Åbn konsollen: **Actions → Open console**
3. Wizarden starter automatisk og viser:

```
╔══════════════════════════════════════════════════════════════╗
║     HyperVision ISE Portal — First Boot Setup               ║
║     © 2026 Jan Green Larsen <hypervision@laces.dk>          ║
║     Wizard version: x.x.x build NNNN                        ║
╚══════════════════════════════════════════════════════════════╝
```

4. Besvar spørgsmålene:

| Felt | Eksempel | Bemærkning |
|---|---|---|
| Hostname | `hypervision` | Serverens hostnavn |
| IP address | `192.168.1.100` | Statisk IP |
| Subnet mask | `255.255.255.0` | Standard /24 |
| Gateway | `192.168.1.1` | Default gateway |
| Primary DNS | `8.8.8.8` | DNS-server |
| Secondary DNS | *(Enter for ingen)* | Valgfri |
| Root password | *(valgfri adgangskode)* | Sættes ved first-boot |

5. Bekræft med `Y` — wizarden:
   - Skriver `/etc/network/interfaces`
   - Genstarter netværk
   - Tester gateway → internet → DNS
   - Kører `install.sh` fra GitHub automatisk

6. Installation færdig — portalen er tilgængelig på `http://<ip>:8000`

### Trin 3 — Første login

Åbn `http://<ip>:8000` og opret admin-bruger ved første login.

---

## Oprettelse af nyt OVA-image (vedligehold)

Følg disse trin for at bygge et nyt OVA-image til distribution.

### Forudsætninger

| Krav | Detaljer |
|---|---|
| VMware ESXi | 7.0 eller nyere |
| VMware OVF Tool | Installeret på Windows: `C:\Program Files\VMware\VMware OVF Tool\ovftool.exe` |
| Internet | Build-VM skal nå GitHub og Debian apt-servere |

### Trin 1 — Opret fresh Debian 13 VM i ESXi

- **vCPU**: 2
- **RAM**: 2 GB
- **Disk**: 20 GB
- **OS**: Debian GNU/Linux 13 (64-bit)
- Installer Debian minimalt — vælg kun **SSH server** og **standard system utilities**

### Trin 2 — Kør prepare-ova-base.sh

SSH ind på VM'en og kør:

```bash
# Fjern CD-ROM apt-kilde hvis Debian er installeret fra DVD
sed -i '/^deb cdrom/s/^/#/' /etc/apt/sources.list

# Download og kør klargøringsscript
wget -qO /tmp/first-boot.sh "https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/main/deploy/first-boot.sh"
wget -qO /tmp/prepare-ova-base.sh "https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/main/deploy/prepare-ova-base.sh"
bash /tmp/prepare-ova-base.sh
```

Scriptet udfører automatisk:
- Installation af first-boot wizard
- Konfiguration af auto-login på tty1
- Fuld OS-opdatering (`apt-get upgrade`)
- Installation af `open-vm-tools` (VMware integration)
- Oprydning: machine-id, SSH host keys, logs, bash-historik
- Nulstilling af netværk til DHCP

### Trin 3 — Luk VM ned

```bash
systemctl poweroff
```

### Trin 4 — Eksporter OVA med ovftool

Kør på Windows (erstat `<vm-navn>` og adgangskode):

```powershell
New-Item -ItemType Directory -Path "C:\OVA" -Force

& "C:\Program Files\VMware\VMware OVF Tool\ovftool.exe" `
    --noSSLVerify `
    --powerOffSource `
    "vi://root:Adgangskode%21@esx2.ll.lan/<vm-navn>" `
    "C:\OVA\hypervision-base.ova"
```

> **Specialtegn i adgangskoden** skal URL-encodes: `!` → `%21`, `@` → `%40`, `#` → `%23`, `$` → `%24`

Resultatet er én enkelt `hypervision-base.ova` fil klar til distribution.

---

## Metode 2 — install.sh på eksisterende Debian/Ubuntu-server

Kør på en fresh Debian/Ubuntu-server som root:

```bash
wget -qO- https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/main/install.sh | bash
```

Scriptet installerer automatisk Python, git, nginx, opretter service-brugeren `hypervision`, kloner kode fra GitHub, sætter venv op og starter systemd-servicen.

> **Ingen curl?** Brug `wget -qO-` som vist ovenfor. curl installeres af scriptet.

---

## Metode 3 — Manuel installation

### Software

| Krav | Detaljer |
|---|---|
| Python | 3.11 eller nyere |
| Git | Kræves på Linux-server (til GitHub-opdatering fra portal). Valgfri på Windows. |
| Windows | 10/11 (anbefalet). Linux understøttes og er testet i produktion. |

### Cisco ISE

| Krav | Detaljer |
|---|---|
| ISE-version | 3.1 eller nyere. Testet og primært udviklet mod ISE 3.4 |
| ERS API | Skal være aktiveret: *Administration → System → Settings → API Settings → ERS* |
| Open API | Skal være aktiveret samme sted: *Open API* |
| ISE-bruger til portalen | Rollen **ERS Admin** (læs + skriv til endpoints og grupper) |
| ISE-bruger til portalen | Rollen **MnT Admin** (session-status og CoA-kald) |
| pxGrid (valgfri) | pxGrid Services aktiveret i ISE: *Administration → pxGrid Services → Enable* |
| Netværk | Backend skal nå ISE på port **443** (REST) og port **8910** (pxGrid) |

Det anbefales at oprette en dedikeret ISE service-account til portalen fremfor at genbruge en personlig admin-konto. Kontoen behøver ikke *SUPER ADMIN* — kun ERS Admin og MnT Admin.

### TACACS+-server (valgfri)

Kræves kun hvis portal-login skal gå via TACACS+ i stedet for lokal auth.

| Krav | Detaljer |
|---|---|
| TACACS+-server | Cisco ISE TACACS+, Cisco ACS, tac_plus eller tilsvarende |
| TCP-port | Backend skal nå TACACS+-serveren på port **49** |
| Shared secret | Konfigureres i Settings → Portal Auth Config |
| Attribut | Serveren skal returnere `portal-operator-profile = <profilnavn>` i Authorization-svar |

---

## Trin-for-trin installation

### 1. Hent kildekoden

```
git clone https://github.com/Jangreenlarsen/ise-endpoint-portal.git
cd ise-endpoint-portal
```

Alternativt: udpak ZIP-pakken fra GitHub releases direkte.

### 2. Opret Python virtual environment

```
cd backend
python -m venv .venv
```

### 3. Aktivér virtual environment og installér afhængigheder

Windows:
```
.venv\Scripts\activate
pip install -e .
```

Linux/macOS:
```
source .venv/bin/activate
pip install -e .
```

`pip install -e .` installerer portalen i editérbar tilstand via `pyproject.toml`. Alle afhængigheder (FastAPI, httpx, Pydantic v2, PyJWT, bcrypt, tacacs-plus m.fl.) hentes automatisk.

### 4. Start portalen

Den nemmeste metode på Windows er `START.bat` i projektmappens rod:

```
START.bat
```

`START.bat` starter backend og genstarter den automatisk ved fejl. Se [05-DRIFT.md](05-DRIFT.md#start-stop-og-genstart) for detaljer.

Alternativt manuelt fra projektroden:

```
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
```

### 5. Første opstart — opret admin-bruger

Åbn `http://localhost:8000` i en browser. Første gang vises et setup-flow:

1. Udfyld brugernavn og adgangskode for den første admin-konto.
2. Klik **Opret admin-bruger**.
3. Du logges automatisk ind og dirigeres til Settings.

Admin-brugeren valideres altid lokalt — også når TACACS+ er aktiveret.

### 6. Konfigurér ISE-forbindelsen

Under **Settings → ISE-forbindelsesindstillinger**:

- **ISE Host**: IP-adresse eller hostname for ISE Primary Admin Node (PAN). Brug ikke `https://` — bare hostname.
- **ERS Brugernavn / Adgangskode**: den dedikerede ISE service-account.
- **Timeout**: anbefalet 30 sekunder. Sæt ikke under 10 sekunder i produktionsmiljøer — ISE kan svare langsomt ved stor load.
- **Open API aktiveret**: slå til hvis du bruger Open API til DACL/custom attribute-administration.

Klik **Test forbindelse** — portalen forsøger et simpelt ERS-kald og rapporterer success eller fejlbeskrivelse.

Klik **Gem** — indstillingerne gemmes i `backend/data/settings_overrides.json`.

---

## ISE-konfiguration

### ERS API aktivering

1. Log ind i ISE som Super Admin.
2. Naviger til *Administration → System → Settings → API Settings*.
3. Under **ERS (External RESTful Services)**: sæt *ERS for Read/Write* til **Enabled**.
4. Under **Open API**: sæt til **Enabled** (kræves til DACL og custom attributes).
5. Klik **Save**.

ISE genstarter ikke af denne ændring — API er tilgængeligt øjeblikkeligt.

### ISE-bruger med korrekte roller

1. Naviger til *Administration → Admin Access → Administrators → Admin Users*.
2. Klik **Add**.
3. Udfyld brugernavn, kodeord og Admin Groups: tilføj **ERS Admin** og **MnT Admin**.
4. Gem.

Tjek at kontoen kan autentificere ved at kalde `https://<ISE>:9060/ers/config/endpointgroup` direkte i browser eller curl.

### pxGrid-aktivering (valgfri)

1. Naviger til *Administration → pxGrid Services*.
2. Sæt **Enable pxGrid** til aktiveret.
3. Portalen bruger certifikat-baseret autentificering. Se [04-ADMIN.md](04-ADMIN.md#pxgrid-opsætning) for certifikat-flow.

---

## Konfigurationsfiler

Portalen gemmer sin tilstand i filer under `backend/data/` (eller `backend/` afhængig af build):

| Fil | Indhold |
|---|---|
| `users.json` | Portal-brugere (bcrypt-hashede passwords, roller, System adm-tags, skabeloner) |
| `settings_overrides.json` | ISE-forbindelsesindstillinger, cache-parametre, pxGrid-config m.m. |
| `auth_config.json` | Portal Auth Config: auth-mode, TACACS+-server, secret (maskeret ved visning) |
| `roles.json` | System adm-katalog (brugerdefinerede tags) |

Disse filer oprettes automatisk ved første opstart. De er ikke versioneret i git (`.gitignore`). Sørg for at tage backup af disse filer regelmæssigt — se [05-DRIFT.md](05-DRIFT.md#backup).

DiskCache gemmes som standard i `backend/cache/endpoints.json`. Stien kan ændres i Settings → Cache.

---

## START.bat og auto-genstart

`START.bat` i projektmappen:

```batch
@echo off
:loop
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
echo Backend stoppede — genstarter om 3 sekunder...
timeout /t 3
goto loop
```

Scriptet genstarter automatisk backend hvis den crasher. Det er ikke en service-manager — til produktionsdrift anbefales NSSM (Non-Sucking Service Manager) til at pakke `START.bat` ind som Windows Service, så den starter automatisk ved serverens genstart.

NSSM-opsætning:
```
nssm install HyperVisionISE "C:\Projekter\ise-endpoint-portal\START.bat"
nssm set HyperVisionISE AppDirectory "C:\Projekter\ise-endpoint-portal"
nssm start HyperVisionISE
```

---

## Linux-server: opsætning af GitHub-deploy

Portalen er open source og hostet på GitHub (public repository). Når git er sat op på serveren, kan admin hente opdateringer direkte fra **Settings → GitHub-opdatering** i portalen — uden at SSH til serveren.

Følg disse trin **én gang** ved første installation.

### Første gang: initialiser git og kobl til GitHub

```bash
cd /opt/hypervision

# Initialiser git og sæt branch-navn
git init
git branch -m main

# Kobl til GitHub (repoet er public — ingen auth nødvendig)
git remote add origin https://github.com/Jangreenlarsen/ise-endpoint-portal.git

# Tillad git-adgang for alle brugere på serveren (system-wide)
# Kræves fordi portalen kører som en service-bruger (ikke root)
git config --system --add safe.directory /opt/hypervision

# Hent og synkroniser kode
git fetch origin main
git reset --hard origin/main
```

> **Bemærk:** Brug `--system` (ikke `--global`) til `safe.directory`. `--global` sætter kun
> indstillingen for root, mens service-brugeren (f.eks. `hypervision`) får "dubious ownership"-fejl
> og portalen viser "Server er ikke konfigureret med git".

### Vigtig sikkerhed: auth_secret.key

Portalen checker ved opstart at `backend/auth_secret.key` ikke er læsbar af andre brugere. Hvis filen har forkerte rettigheder (`mode=644`), afbrydes portalen med en CRITICAL-fejl.

```bash
# Sæt korrekte rettigheder (kræves kun én gang)
chmod 600 /opt/hypervision/backend/auth_secret.key
```

### Genstart portalen

```bash
systemctl restart hypervision
```

### Fremtidige opdateringer

Når git er sat op, kan alle fremtidige opdateringer hentes direkte i portalen:

**Settings → GitHub-opdatering → Tjek GitHub → Hent opdatering**

Portalen kører `git pull origin main` på serveren og viser output. Admin skal herefter genstarte serveren manuelt via **Genstart server**-knappen i Settings, eller:

```bash
systemctl restart hypervision
```

Alternativt fra kommandolinjen:

```bash
cd /opt/hypervision
git pull origin main
systemctl restart hypervision
```

---

## Verificering

Efter opsætning kan følgende tjekkes:

| Test | Forventet resultat |
|---|---|
| `http://localhost:8000` | Login-side eller Browse |
| Settings → Test forbindelse | "Forbindelse til ISE OK" |
| Browse viser endpoint-liste | Endpoints fra ISE indlæses |
| Browse-farvning | Grøn/rød farve vises (kræver pxGrid eller MnT) |
| `http://localhost:8000/api/health` | `{"status": "ok"}` |
| `backend/logs/app.log` | ISE-kald logges uden CRITICAL-fejl |
| Settings → Portal Auth Config → Test TACACS+ | "TACACS+ auth OK" (kun ved TACACS+-mode) |
| Settings → GitHub-opdatering → Tjek GitHub | Viser installeret og seneste version (ikke "Server er ikke konfigureret med git") |
