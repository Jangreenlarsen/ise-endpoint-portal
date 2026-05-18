#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
#
# HyperVision ISE Portal — Første gangs opsætning (first-boot wizard)
#
# Køres automatisk ved første boot af OVA-imaget via first-boot.service.
# Konfigurerer hostname, statisk IP, gateway, DNS og root-adgangskode,
# derefter hentes og køres install.sh fra GitHub.

set -euo pipefail
export PATH="$PATH:/usr/sbin:/usr/local/sbin"

FLAGFILE="/etc/hypervision-firstboot-done"
INSTALL_URL="https://raw.githubusercontent.com/Jangreenlarsen/ise-endpoint-portal/main/install.sh"

[[ -f "$FLAGFILE" ]] && exit 0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[FEJL]${NC} $*"; exit 1; }

ask() {
    # ask <variabel> <prompt> [default]
    local __var=$1 __prompt=$2 __default=${3:-}
    local __val=""
    if [[ -n "$__default" ]]; then
        read -rp "$__prompt [$__default]: " __val </dev/tty
        __val="${__val:-$__default}"
    else
        while [[ -z "$__val" ]]; do
            read -rp "$__prompt: " __val </dev/tty
            [[ -z "$__val" ]] && echo "  (feltet er påkrævet)"
        done
    fi
    printf -v "$__var" '%s' "$__val"
}

clear
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     HyperVision ISE Portal — Første gangs opsætning         ║"
echo "║     © 2026 Jan Green Larsen <hypervision@laces.dk>          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Denne guide konfigurerer netværk og installerer portalen."
echo "  Du skal bruge: statisk IP-adresse, subnet-maske, gateway og DNS."
echo ""

# ── Hostname ──────────────────────────────────────────────────────────────────
ask HOSTNAME "Hostname" "hypervision"
hostnamectl set-hostname "$HOSTNAME"
# Opdatér /etc/hosts hvis nødvendigt
if ! grep -q "127.0.1.1" /etc/hosts; then
    echo "127.0.1.1 $HOSTNAME" >> /etc/hosts
else
    sed -i "s/^127\.0\.1\.1.*/127.0.1.1 $HOSTNAME/" /etc/hosts
fi
ok "Hostname: $HOSTNAME"
echo ""

# ── Netværksgrænseflade ───────────────────────────────────────────────────────
IFACE=$(ip -o link show | awk -F': ' '$2 != "lo" {print $2; exit}')
info "Netværksgrænseflade fundet: $IFACE"
echo ""

# ── Netværkskonfiguration ─────────────────────────────────────────────────────
ask IP_ADDR   "IP-adresse      (fx 192.168.1.100)"
ask NETMASK   "Subnet-maske    (fx 255.255.255.0)" "255.255.255.0"
ask GATEWAY   "Gateway         (fx 192.168.1.1)"
ask DNS1      "Primær DNS      (fx 8.8.8.8)"
read -rp "Sekundær DNS    (Enter for ingen): " DNS2 </dev/tty || DNS2=""

echo ""
echo "  ┌─ Netværksoversigt ───────────────────────────────────────┐"
printf  "  │  Interface : %-43s│\n" "$IFACE"
printf  "  │  IP-adresse: %-43s│\n" "$IP_ADDR"
printf  "  │  Subnet    : %-43s│\n" "$NETMASK"
printf  "  │  Gateway   : %-43s│\n" "$GATEWAY"
printf  "  │  DNS       : %-43s│\n" "$DNS1${DNS2:+, $DNS2}"
echo "  └──────────────────────────────────────────────────────────┘"
echo ""
read -rp "Er ovenstående korrekt? [J/n] " CONFIRM </dev/tty
if [[ "$CONFIRM" =~ ^[nN]$ ]]; then
    warn "Afbrudt — kør igen: bash /usr/local/sbin/hypervision-firstboot.sh"
    exit 1
fi

# Skriv /etc/network/interfaces
cat > /etc/network/interfaces <<EOF
# Genereret af HyperVision first-boot — $(date '+%Y-%m-%d %H:%M')
source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

auto $IFACE
iface $IFACE inet static
    address $IP_ADDR
    netmask $NETMASK
    gateway $GATEWAY
EOF

# DNS
{
    echo "nameserver $DNS1"
    [[ -n "$DNS2" ]] && echo "nameserver $DNS2"
} > /etc/resolv.conf

ok "Netværkskonfiguration skrevet"

# ── Root-adgangskode ──────────────────────────────────────────────────────────
echo ""
info "Sæt adgangskode til root-brugeren:"
passwd root </dev/tty
echo ""

# ── Anvend netværk med ip-kommandoer (mere robust end ifdown/ifup) ────────────
info "Anvender netværkskonfiguration..."

# Stop DHCP-klienter
pkill dhclient 2>/dev/null || true
pkill dhcpcd  2>/dev/null || true
sleep 1

# Anvend konfiguration via systemd networking
systemctl restart networking
sleep 2
ok "Netværk aktivt — IP: $IP_ADDR"
echo ""

# ── Vent på netværk — test i etaper ──────────────────────────────────────────
info "Tester netværksforbindelse..."

# 1. Gateway
TRIES=0
until ping -c 1 -W 2 "$GATEWAY" &>/dev/null; do
    TRIES=$((TRIES+1))
    [[ $TRIES -ge 10 ]] && error "Gateway $GATEWAY ikke nåbar — tjek IP/gateway-konfiguration"
    sleep 1
done
ok "Gateway nåbar ($GATEWAY)"

# 2. Internet (uden DNS)
TRIES=0
until ping -c 1 -W 2 8.8.8.8 &>/dev/null; do
    TRIES=$((TRIES+1))
    [[ $TRIES -ge 10 ]] && error "Ingen internetforbindelse — tjek at gateway har internet-adgang"
    sleep 1
done
ok "Internet nåbar"

# 3. DNS + HTTPS
TRIES=0
until wget -q --spider https://github.com 2>/dev/null; do
    TRIES=$((TRIES+1))
    [[ $TRIES -ge 15 ]] && error "DNS/HTTPS fejler — tjek DNS-server $DNS1"
    sleep 2
done
ok "Internetforbindelse OK"
echo ""

# ── Kør install.sh ────────────────────────────────────────────────────────────
info "Henter og kører HyperVision ISE Portal install.sh..."
echo ""
wget -qO- "$INSTALL_URL" | bash

# ── Markér færdig ─────────────────────────────────────────────────────────────
touch "$FLAGFILE"
systemctl disable hypervision-firstboot.service 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Første gangs opsætning fuldført!                           ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  Portal URL: http://%-40s║\n" "$IP_ADDR:8000"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
