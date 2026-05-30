// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
//
// Token-strategi: JWT gemmes i httpOnly cookie (sat af backend ved login/refresh).
// Cookien er utilgængelig fra JavaScript — XSS kan ikke stjæle den.
// localStorage indeholder kun ikke-sensitive metadata: udløbstidspunkt og auth-type.
const TOKEN_META_KEY = "hv_ise_token_meta";
const USER_KEY = "hv_ise_user";

export const auth = {
  // Token er i httpOnly cookie — ikke tilgængeligt fra JS.
  // Returnerer null; alle API-kald sender automatisk cookien via credentials: include.
  getToken() {
    return null;
  },
  getUser() {
    const raw = localStorage.getItem(USER_KEY);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  _getMeta() {
    const raw = localStorage.getItem(TOKEN_META_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  // tokenMeta: { expires_at: ISO-string, auth_type: "local"|"tacacs" }
  // user: User-objekt fra LoginResponse
  save(tokenMeta, user) {
    if (tokenMeta && typeof tokenMeta === "object" && tokenMeta.expires_at) {
      localStorage.setItem(TOKEN_META_KEY, JSON.stringify(tokenMeta));
    }
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  },
  clear() {
    localStorage.removeItem(TOKEN_META_KEY);
    localStorage.removeItem(USER_KEY);
  },
  isAdmin() {
    const u = this.getUser();
    return u && u.role === "admin";
  },
  isEditor() {
    const u = this.getUser();
    return u && (u.role === "admin" || u.role === "editor");
  },
  hasRole(...roles) {
    const u = this.getUser();
    return u && roles.includes(u.role);
  },
  isTacacs() {
    const meta = this._getMeta();
    return meta?.auth_type === "tacacs";
  },
  isTokenExpired() {
    const meta = this._getMeta();
    if (!meta?.expires_at) return true;
    return new Date(meta.expires_at).getTime() < Date.now();
  },
  secondsUntilExpiry() {
    const meta = this._getMeta();
    if (!meta?.expires_at) return 0;
    return Math.max(0, Math.floor((new Date(meta.expires_at).getTime() - Date.now()) / 1000));
  },
};

// ── Silent token refresh ──────────────────────────────────────────────────────
// Schedules a single setTimeout to fire 15 min before token expiry.
// refreshFn: async () => void — called when it's time to refresh.
// Returns a cancel function.
const REFRESH_BEFORE_EXPIRY_S = 15 * 60;
let _refreshTimer = null;

export function scheduleTokenRefresh(refreshFn) {
  cancelTokenRefresh();
  const secs = auth.secondsUntilExpiry();
  if (secs <= 0) return;
  const delay = Math.max(0, (secs - REFRESH_BEFORE_EXPIRY_S) * 1000);
  _refreshTimer = setTimeout(async () => {
    _refreshTimer = null;
    if (auth.isTokenExpired()) return;
    try {
      await refreshFn();
    } catch { /* ignore — next schedule picks it up */ }
  }, delay);
}

export function cancelTokenRefresh() {
  if (_refreshTimer !== null) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
}
