#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
#
# HyperVision ISE Portal — installations-script til Debian/Ubuntu
#
# Brug (curl):
#   curl -fsSL https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/main/install.sh | bash
#
# Brug (wget — hvis curl ikke er installeret):
#   wget -qO- https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/main/install.sh | bash
#
# Eller efter download:
#   chmod +x install.sh && sudo ./install.sh
#
# Hvad scriptet gør:
#   1. Kontrollerer forudsætninger (root, Debian/Ubuntu, Python 3.11+)
#   2. Installerer system-pakker (python3, python3-venv, git, nginx)
#   3. Opretter system-bruger 'hypervision' og mappe /opt/hypervision
#   4. Kloner kode fra GitHub
#   5. Opretter Python virtual environment og installerer afhængigheder
#   6. Sætter fil-rettigheder korrekt
#   7. Installerer og starter systemd-service
#   8. Opsætter nginx som reverse proxy (valgfri)

set -euo pipefail

# ── Farver ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Konfiguration ────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/hypervision"
SERVICE_USER="hypervision"
REPO_URL="https://github.com/Jangreenlarsen/ise-endpoint-portal.git"
SERVICE_FILE="/etc/systemd/system/hypervision.service"
PORT=8000

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          HyperVision ISE Portal — Installation               ║"
echo "║          © 2026 Jan Green Larsen <hypervision@laces.dk>      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Forudsætninger ────────────────────────────────────────────────────────
info "Kontrollerer forudsætninger..."

[[ $EUID -ne 0 ]] && error "Scriptet skal køres som root (sudo ./install.sh)"

if ! grep -qiE "debian|ubuntu" /etc/os-release 2>/dev/null; then
    warn "Scriptet er testet på Debian/Ubuntu. Fortsætter alligevel..."
fi

# Fjern CD-ROM kilde fra sources.list (blokerer apt på fresh DVD-install)
if grep -q "^deb cdrom" /etc/apt/sources.list 2>/dev/null; then
    info "Deaktiverer CD-ROM apt-kilde..."
    sed -i '/^deb cdrom/s/^/#/' /etc/apt/sources.list
    ok "CD-ROM kilde deaktiveret"
fi

# Python 3.11+ krav
PYTHON_BIN=""
for py in python3.12 python3.11 python3; do
    if command -v "$py" &>/dev/null; then
        ver=$("$py" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo "0")
        maj=$("$py" -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo "0")
        if [[ "$maj" -eq 3 && "$ver" -ge 11 ]]; then
            PYTHON_BIN="$py"
            break
        fi
    fi
done

if [[ -z "$PYTHON_BIN" ]]; then
    info "Python 3.11+ ikke fundet — installerer python3.11..."
    apt-get update -qq
    apt-get install -y python3.11 python3.11-venv python3.11-dev
    PYTHON_BIN="python3.11"
fi

ok "Python: $($PYTHON_BIN --version)"

# ── 2. System-pakker ─────────────────────────────────────────────────────────
info "Installerer system-pakker..."
apt-get update -qq
apt-get install -y git python3-venv curl nginx
ok "System-pakker installeret"

# ── 3. Opret bruger og mappe ─────────────────────────────────────────────────
if id "$SERVICE_USER" &>/dev/null; then
    ok "Bruger '$SERVICE_USER' eksisterer allerede"
else
    info "Opretter system-bruger '$SERVICE_USER'..."
    useradd --system --shell /usr/sbin/nologin --home-dir "$INSTALL_DIR" --create-home "$SERVICE_USER"
    ok "Bruger '$SERVICE_USER' oprettet"
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
    mkdir -p "$INSTALL_DIR"
fi

# ── 4. Klon eller opdatér kode ───────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Repo eksisterer — opdaterer til seneste main..."
    git config --system --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
    git -C "$INSTALL_DIR" fetch origin main
    git -C "$INSTALL_DIR" reset --hard origin/main
    ok "Kode opdateret"
else
    info "Kloner kode fra GitHub..."
    git clone --branch main --depth 1 "$REPO_URL" "$INSTALL_DIR"
    git config --system --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
    ok "Kode klonet"
fi

# ── 5. Python virtual environment ────────────────────────────────────────────
VENV_DIR="$INSTALL_DIR/backend/.venv"
if [[ ! -d "$VENV_DIR" ]]; then
    info "Opretter Python virtual environment..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    ok "Venv oprettet"
else
    ok "Venv eksisterer allerede"
fi

info "Installerer Python-afhængigheder..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -e "$INSTALL_DIR/backend"
ok "Python-afhængigheder installeret"

# ── 6. Rettigheder ───────────────────────────────────────────────────────────
info "Sætter fil-rettigheder..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# auth_secret.key kræver 600 — oprettes ved første start
SECRET_KEY="$INSTALL_DIR/backend/auth_secret.key"
if [[ -f "$SECRET_KEY" ]]; then
    chmod 600 "$SECRET_KEY"
    ok "auth_secret.key: chmod 600"
fi

ok "Rettigheder sat"

# ── 7. Systemd service ───────────────────────────────────────────────────────
info "Installerer systemd-service..."
cp "$INSTALL_DIR/deploy/hypervision.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable hypervision
systemctl restart hypervision
sleep 2

if systemctl is-active --quiet hypervision; then
    ok "hypervision.service kører"
else
    warn "Service startede ikke — tjek: journalctl -u hypervision -n 50"
fi

# auth_secret.key oprettes ved første start — sæt rettigheder
if [[ -f "$SECRET_KEY" ]]; then
    chmod 600 "$SECRET_KEY"
    chown "$SERVICE_USER:$SERVICE_USER" "$SECRET_KEY"
    systemctl restart hypervision
fi

# ── 8. Nginx ─────────────────────────────────────────────────────────────────
echo ""
read -rp "Vil du opsætte nginx som reverse proxy? [j/N] " setup_nginx
if [[ "$setup_nginx" =~ ^[jJyY]$ ]]; then
    cp "$INSTALL_DIR/deploy/nginx-hypervision.conf" /etc/nginx/sites-available/hypervision
    ln -sf /etc/nginx/sites-available/hypervision /etc/nginx/sites-enabled/hypervision
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    ok "Nginx konfigureret (lytter på port 80 → 443)"
    echo ""
    warn "TLS-certifikat mangler endnu. Kør:"
    echo "  apt-get install -y certbot python3-certbot-nginx"
    echo "  certbot --nginx -d <dit-hostname>"
fi

# ── Færdig ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Installation fuldført!                                      ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  Portal URL:    http://%-38s║\n" "$(hostname -I | awk '{print $1}'):$PORT"
echo "║  Service:       systemctl status hypervision                 ║"
echo "║  Log:           journalctl -u hypervision -f                 ║"
echo "║  Konfiguration: /opt/hypervision/backend/data/               ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Næste skridt:                                               ║"
echo "║  1. Åbn portalen og opret admin-bruger                       ║"
echo "║  2. Konfigurér ISE-forbindelsen under Settings               ║"
echo "║  3. Opsæt TLS via nginx + certbot (anbefalet)                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
