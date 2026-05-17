#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
#
# HyperVision ISE Portal — klargør et Debian-system som OVA-base.
#
# Køres ÉN gang på en fresh Debian minimal VM (som root) inden eksport til OVA.
# Scriptet installerer first-boot wizarden og rydder op så kloner er unikke.
#
# Workflow:
#   1. Opret Debian 12/13 minimal VM i VMware (2 vCPU, 2 GB RAM, 20 GB disk)
#   2. Klon repo: git clone https://github.com/Jangreenlarsen/ise-endpoint-portal.git /tmp/portal
#   3. Kør dette script: bash /tmp/portal/deploy/prepare-ova-base.sh
#   4. Vent på "Klar til eksport" besked
#   5. Eksporter VM som OVA fra ESXi/vSphere web-klient

set -euo pipefail
export PATH="$PATH:/usr/sbin:/usr/local/sbin"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[FEJL]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Kør som root"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     HyperVision ISE Portal — OVA Base Klargøring            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Installer first-boot wizard ───────────────────────────────────────────────
info "Installerer first-boot wizard..."
cp "$SCRIPT_DIR/first-boot.sh" /usr/local/sbin/hypervision-firstboot.sh
chmod +x /usr/local/sbin/hypervision-firstboot.sh

cp "$SCRIPT_DIR/first-boot.service" /etc/systemd/system/hypervision-firstboot.service
systemctl daemon-reload
systemctl enable hypervision-firstboot.service
ok "First-boot wizard installeret og aktiveret"

# ── Fjern CD-ROM apt-kilde ────────────────────────────────────────────────────
if grep -q "^deb cdrom" /etc/apt/sources.list 2>/dev/null; then
    sed -i '/^deb cdrom/s/^/#/' /etc/apt/sources.list
    ok "CD-ROM apt-kilde deaktiveret"
fi

# ── Installer open-vm-tools (VMware integration) ──────────────────────────────
info "Installerer open-vm-tools til VMware..."
apt-get update -qq
apt-get install -y open-vm-tools
ok "open-vm-tools installeret"

# ── Ryd op — sikrer unikke kloner ────────────────────────────────────────────
info "Rydder op til OVA-eksport..."

# Ryd logs
find /var/log -type f -exec truncate -s 0 {} \;

# Ryd bash-historik
history -c 2>/dev/null || true
truncate -s 0 /root/.bash_history 2>/dev/null || true

# Reset machine-id (ny genereres ved første boot af klon)
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
ln -sf /etc/machine-id /var/lib/dbus/machine-id

# Fjern SSH host keys (nye genereres ved første boot)
rm -f /etc/ssh/ssh_host_*
# Generer nye SSH host keys ved boot
cat > /etc/rc.local <<'EOF'
#!/bin/bash
if ! ls /etc/ssh/ssh_host_* 1>/dev/null 2>&1; then
    dpkg-reconfigure openssh-server
fi
exit 0
EOF
chmod +x /etc/rc.local

# Ryd tmp
rm -rf /tmp/* /var/tmp/* 2>/dev/null || true

ok "Oprydning færdig"

# ── Sæt DHCP midlertidigt til eksport ─────────────────────────────────────────
# First-boot wizard konfigurerer statisk IP — vi nulstiller til DHCP på base-imaget
IFACE=$(ip -o link show | awk -F': ' '$2 != "lo" {print $2; exit}')
cat > /etc/network/interfaces <<EOF
# Nulstillet til DHCP — first-boot wizard konfigurerer statisk IP ved første boot
source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

auto $IFACE
iface $IFACE inet dhcp
EOF
ok "Netværk nulstillet til DHCP (first-boot wizard sætter statisk IP)"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Klar til OVA-eksport!                                      ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Næste skridt:                                               ║"
echo "║  1. Luk VM ned: systemctl poweroff                          ║"
echo "║  2. Eksporter som OVA fra ESXi/vSphere web-klient           ║"
echo "║     Actions > Export > Download as OVF/OVA                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
warn "VM er IKKE lukket ned automatisk — kør: systemctl poweroff"
echo ""
