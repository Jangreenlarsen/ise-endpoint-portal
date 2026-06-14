#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
"""
HyperVision ISE Portal — CLI Recovery Tool
==========================================
Kør dette script via SSH når du er låst ude af portalen:

    cd /opt/hypervision
    python3 backend/recover.py

    # Eller direkte via venv (hvis python3 ikke er i PATH):
    /opt/hypervision/venv/bin/python backend/recover.py

Kræver ingen kørende server og ingen afhængigheder udover stdlib.
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Paths (relative til dette scripts placering) ─────────────────────────────

_HERE       = Path(__file__).resolve().parent          # backend/
USERS_FILE  = _HERE / "users.json"
LOCKOUT_DB  = _HERE / "lockout.db"

# ── PBKDF2-parametre (SKAL matche app/core/auth.py) ──────────────────────────

PBKDF2_ITERATIONS = 600_000
SALT_BYTES        = 16

# ── ANSI farver ───────────────────────────────────────────────────────────────

USE_COLOR = sys.stdout.isatty()

def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text

def green(t: str)  -> str: return _c("32", t)
def yellow(t: str) -> str: return _c("33", t)
def red(t: str)    -> str: return _c("31", t)
def bold(t: str)   -> str: return _c("1",  t)
def cyan(t: str)   -> str: return _c("36", t)
def grey(t: str)   -> str: return _c("90", t)

# ── Password hashing ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    dk   = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters_s, salt_hex, hash_hex = stored.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    try:
        iters    = int(iters_s)
        salt     = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return hmac.compare_digest(dk, expected)

# ── users.json helpers ────────────────────────────────────────────────────────

def load_users() -> list[dict]:
    if not USERS_FILE.exists():
        return []
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (ValueError, OSError) as exc:
        print(red(f"Fejl ved læsning af {USERS_FILE}: {exc}"))
        return []


def save_users(users: list[dict]) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = USERS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(USERS_FILE)

# ── lockout.db helpers ────────────────────────────────────────────────────────

def _lockout_conn() -> sqlite3.Connection | None:
    if not LOCKOUT_DB.exists():
        return None
    try:
        conn = sqlite3.connect(LOCKOUT_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error:
        return None


def is_locked(username: str) -> float | None:
    """Returnerer locked_until timestamp eller None."""
    conn = _lockout_conn()
    if conn is None:
        return None
    try:
        row = conn.execute(
            "SELECT locked_until FROM lockout_state WHERE username = ?", (username,)
        ).fetchone()
        return float(row["locked_until"]) if row else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def clear_lockout(username: str) -> bool:
    conn = _lockout_conn()
    if conn is None:
        return False
    try:
        conn.execute("DELETE FROM lockout_state  WHERE username = ?", (username,))
        conn.execute("DELETE FROM lockout_failures WHERE username = ?", (username,))
        conn.commit()
        return True
    except sqlite3.Error as exc:
        print(red(f"DB-fejl: {exc}"))
        return False
    finally:
        conn.close()

# ── Formatering ───────────────────────────────────────────────────────────────

def _fmt_ts(ts: str | None) -> str:
    if not ts:
        return grey("—")
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return ts[:16]


def _role_color(role: str) -> str:
    return red(role) if role == "admin" else cyan(role)


def _locked_label(username: str) -> str:
    until = is_locked(username)
    if until is None:
        return ""
    remaining = int(until - time.time())
    if remaining <= 0:
        return grey(" [lockout udløbet]")
    mins = remaining // 60 + 1
    return red(f" [LÅST {mins} min]")

# ── Visning ───────────────────────────────────────────────────────────────────

def cmd_list(users: list[dict]) -> None:
    print()
    if not users:
        print(yellow("  Ingen brugere i users.json"))
        return
    print(bold(f"  {'#':<4} {'Brugernavn':<20} {'Rolle':<14} {'Aktiv':<8} {'Oprettet':<18} {'Status'}"))
    print("  " + "─" * 72)
    for i, u in enumerate(users, 1):
        name    = u.get("username", "?")
        role    = u.get("role", "?")
        active  = green("ja") if u.get("active", True) else red("nej")
        created = _fmt_ts(u.get("created_at"))
        locked  = _locked_label(name)
        print(f"  {i:<4} {name:<20} {_role_color(role):<23} {active:<17} {created:<18}{locked}")
    print()

# ── Reset password ────────────────────────────────────────────────────────────

def cmd_reset_password(users: list[dict], username: str | None = None) -> None:
    if not users:
        print(red("Ingen brugere fundet."))
        return

    if username is None:
        print()
        cmd_list(users)
        username = input("  Brugernavn at nulstille: ").strip()

    target = next((u for u in users if u.get("username", "").lower() == username.lower()), None)
    if target is None:
        print(red(f"  Bruger '{username}' ikke fundet."))
        return

    print()
    print(f"  Nulstiller adgangskode for: {bold(target['username'])} ({_role_color(target.get('role','?'))})")
    while True:
        pw1 = getpass.getpass("  Ny adgangskode: ")
        if len(pw1) < 8:
            print(yellow("  Adgangskode skal være mindst 8 tegn. Prøv igen."))
            continue
        pw2 = getpass.getpass("  Bekræft adgangskode: ")
        if pw1 != pw2:
            print(yellow("  Adgangskoderne matcher ikke. Prøv igen."))
            continue
        break

    target["password_hash"] = hash_password(pw1)
    target["token_gen"]     = target.get("token_gen", 0) + 1  # invalidér alle aktive sessioner
    save_users(users)

    # Ryd lockout så man kan logge ind med det samme
    cleared = clear_lockout(target["username"])
    print()
    print(green(f"  ✓ Adgangskode nulstillet for '{target['username']}'."))
    print(green(f"  ✓ Alle aktive sessioner er invalideret (token_gen={target['token_gen']})."))
    if cleared:
        print(green(f"  ✓ Lockout ryddet — brugeren kan logge ind nu."))
    print()

# ── Unlock ────────────────────────────────────────────────────────────────────

def cmd_unlock(users: list[dict], username: str | None = None) -> None:
    if username is None:
        print()
        cmd_list(users)
        username = input("  Brugernavn at låse op: ").strip()

    target = next((u for u in users if u.get("username", "").lower() == username.lower()), None)
    if target is None:
        print(red(f"  Bruger '{username}' ikke fundet."))
        return

    until = is_locked(target["username"])
    if until is None or time.time() >= until:
        print(yellow(f"  '{target['username']}' er ikke låst (eller lockout er udløbet)."))
        return

    ok = clear_lockout(target["username"])
    if ok:
        print(green(f"  ✓ Lockout ryddet — '{target['username']}' kan logge ind nu."))
    else:
        print(red("  Fejl ved rydning af lockout."))

# ── Opret nødadmin ────────────────────────────────────────────────────────────

def cmd_create_emergency_admin(users: list[dict]) -> None:
    admins = [u for u in users if u.get("role") == "admin" and u.get("active", True)]
    if admins:
        print()
        print(yellow("  Aktive admin-brugere eksisterer allerede:"))
        for a in admins:
            print(f"    - {a['username']}{_locked_label(a['username'])}")
        confirm = input(
            yellow("\n  Vil du stadig oprette en nødadmin? (ja/nej): ")
        ).strip().lower()
        if confirm not in ("ja", "j", "yes", "y"):
            print("  Afbrudt.")
            return

    print()
    default_user = "recovery_admin"
    username_in  = input(f"  Nyt admin-brugernavn [{default_user}]: ").strip()
    username     = username_in or default_user

    existing = next((u for u in users if u.get("username", "").lower() == username.lower()), None)
    if existing:
        print(red(f"  Brugernavn '{username}' er allerede i brug. Brug 'Nulstil adgangskode' i stedet."))
        return

    while True:
        pw1 = getpass.getpass("  Adgangskode: ")
        if len(pw1) < 8:
            print(yellow("  Mindst 8 tegn kræves."))
            continue
        pw2 = getpass.getpass("  Bekræft adgangskode: ")
        if pw1 != pw2:
            print(yellow("  Matcher ikke. Prøv igen."))
            continue
        break

    new_user = {
        "id":            secrets.token_urlsafe(16),
        "username":      username,
        "password_hash": hash_password(pw1),
        "role":          "admin",
        "active":        True,
        "token_gen":     0,
        "created_at":    datetime.now(timezone.utc).isoformat(),
        "created_by":    "cli_recovery",
        "display_name":  username,
    }
    users.append(new_user)
    save_users(users)
    print()
    print(green(f"  ✓ Nødadmin '{username}' oprettet med admin-rolle."))
    print(green("  ✓ Log ind på portalen og slet dette konto når krisen er løst."))
    print()

# ── Skift rolle ───────────────────────────────────────────────────────────────

def cmd_change_role(users: list[dict], username: str | None = None) -> None:
    if username is None:
        print()
        cmd_list(users)
        username = input("  Brugernavn: ").strip()

    target = next((u for u in users if u.get("username", "").lower() == username.lower()), None)
    if target is None:
        print(red(f"  Bruger '{username}' ikke fundet."))
        return

    current_role = target.get("role", "?")
    new_role     = "admin" if current_role != "admin" else "user"
    print()
    print(f"  Bruger:        {bold(target['username'])}")
    print(f"  Nuværende rolle: {_role_color(current_role)}")
    print(f"  Ny rolle:      {_role_color(new_role)}")
    confirm = input(yellow("  Bekræft skift? (ja/nej): ")).strip().lower()
    if confirm not in ("ja", "j", "yes", "y"):
        print("  Afbrudt.")
        return

    target["role"]      = new_role
    target["token_gen"] = target.get("token_gen", 0) + 1
    save_users(users)
    print(green(f"  ✓ Rolle ændret til '{new_role}'. Aktive sessioner invalideret."))

# ── Aktivér / deaktivér ───────────────────────────────────────────────────────

def cmd_toggle_active(users: list[dict], username: str | None = None) -> None:
    if username is None:
        print()
        cmd_list(users)
        username = input("  Brugernavn: ").strip()

    target = next((u for u in users if u.get("username", "").lower() == username.lower()), None)
    if target is None:
        print(red(f"  Bruger '{username}' ikke fundet."))
        return

    new_state = not target.get("active", True)
    verb      = green("aktivere") if new_state else red("deaktivere")
    confirm   = input(yellow(f"  Vil du {verb} '{target['username']}'? (ja/nej): ")).strip().lower()
    if confirm not in ("ja", "j", "yes", "y"):
        print("  Afbrudt.")
        return

    target["active"]    = new_state
    target["token_gen"] = target.get("token_gen", 0) + 1
    save_users(users)
    state_str = green("aktiveret") if new_state else red("deaktiveret")
    print(green(f"  ✓ Konto {state_str}. Aktive sessioner invalideret."))

# ── Verify password (debug) ───────────────────────────────────────────────────

def cmd_verify(users: list[dict]) -> None:
    print()
    cmd_list(users)
    username = input("  Brugernavn at teste: ").strip()
    target   = next((u for u in users if u.get("username", "").lower() == username.lower()), None)
    if target is None:
        print(red(f"  Bruger '{username}' ikke fundet."))
        return
    pw = getpass.getpass("  Adgangskode at teste: ")
    if verify_password(pw, target.get("password_hash", "")):
        print(green(f"  ✓ Adgangskode er KORREKT for '{username}'."))
    else:
        print(red(f"  ✗ Adgangskode er FORKERT for '{username}'."))

# ── Menu ──────────────────────────────────────────────────────────────────────

_MENU = [
    ("Vis alle brugere",          "list"),
    ("Nulstil adgangskode",       "reset"),
    ("Lås konto op",              "unlock"),
    ("Opret nødadmin",            "emergency"),
    ("Skift rolle (admin↔user)",  "role"),
    ("Aktivér / deaktivér konto", "toggle"),
    ("Test adgangskode",          "verify"),
    ("Afslut",                    "quit"),
]


def _print_header() -> None:
    print()
    print(bold(cyan("╔══════════════════════════════════════════════╗")))
    print(bold(cyan("║  HyperVision ISE Portal — CLI Recovery Tool  ║")))
    print(bold(cyan("╚══════════════════════════════════════════════╝")))
    print(grey(f"  users.json : {USERS_FILE}"))
    print(grey(f"  lockout.db : {LOCKOUT_DB}"))
    print()


def interactive_menu() -> None:
    _print_header()
    while True:
        users = load_users()  # reload each iteration so concurrent edits are visible

        # Byg en kort status-linje
        n_admin  = sum(1 for u in users if u.get("role") == "admin" and u.get("active", True))
        n_locked = sum(1 for u in users if is_locked(u.get("username", "")) is not None
                       and time.time() < (is_locked(u.get("username", "")) or 0))
        status = green(f"{len(users)} brugere")
        if n_admin == 0:
            status += "  " + red("INGEN AKTIVE ADMINS!")
        else:
            status += grey(f"  {n_admin} admin")
        if n_locked:
            status += "  " + yellow(f"{n_locked} låst")
        print(f"  Status: {status}")
        print()

        for i, (label, _) in enumerate(_MENU, 1):
            print(f"  {bold(str(i))}. {label}")
        print()

        try:
            choice = input("  Vælg [1-8]: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            print("  Afslutter.")
            break

        if not choice.isdigit() or not (1 <= int(choice) <= len(_MENU)):
            print(yellow("  Ugyldigt valg."))
            continue

        action = _MENU[int(choice) - 1][1]
        print()

        if   action == "list":      cmd_list(users)
        elif action == "reset":     cmd_reset_password(users)
        elif action == "unlock":    cmd_unlock(users)
        elif action == "emergency": cmd_create_emergency_admin(users)
        elif action == "role":      cmd_change_role(users)
        elif action == "toggle":    cmd_toggle_active(users)
        elif action == "verify":    cmd_verify(users)
        elif action == "quit":
            print("  Afslutter.")
            break

# ── CLI (ikke-interaktiv brug) ────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="HyperVision ISE Portal — CLI Recovery Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Eksempler:
  python3 backend/recover.py                    # interaktiv menu
  python3 backend/recover.py --list             # vis alle brugere
  python3 backend/recover.py --reset admin      # nulstil adgangskode
  python3 backend/recover.py --unlock admin     # lås konto op
  python3 backend/recover.py --emergency        # opret nødadmin
        """,
    )
    parser.add_argument("--list",      action="store_true",  help="Vis alle brugere og afslut")
    parser.add_argument("--reset",     metavar="BRUGERNAVN", help="Nulstil adgangskode for bruger")
    parser.add_argument("--unlock",    metavar="BRUGERNAVN", help="Lås konto op")
    parser.add_argument("--emergency", action="store_true",  help="Opret nødadmin (interaktivt)")
    args = parser.parse_args()

    if args.list:
        _print_header()
        cmd_list(load_users())
        return
    if args.reset:
        _print_header()
        cmd_reset_password(load_users(), username=args.reset)
        return
    if args.unlock:
        _print_header()
        cmd_unlock(load_users(), username=args.unlock)
        return
    if args.emergency:
        _print_header()
        cmd_create_emergency_admin(load_users())
        return

    # Ingen flag — start interaktiv menu
    interactive_menu()


if __name__ == "__main__":
    main()
