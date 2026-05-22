// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
const TOKEN_KEY = "hv_ise_token";
const USER_KEY = "hv_ise_user";

export const auth = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
  getUser() {
    const raw = localStorage.getItem(USER_KEY);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
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
    const token = this.getToken();
    if (!token) return false;
    try {
      const [payloadB64] = token.split(".");
      const padding = "=".repeat((4 - (payloadB64.length % 4)) % 4);
      const payload = JSON.parse(
        atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/") + padding),
      );
      return payload.auth_type === "tacacs";
    } catch {
      return false;
    }
  },
  // Decodes the token payload locally (no signature check) and returns true if
  // the token is missing, malformed, or past its exp claim.
  isTokenExpired() {
    const token = this.getToken();
    if (!token) return true;
    try {
      const [payloadB64] = token.split(".");
      const padding = "=".repeat((4 - (payloadB64.length % 4)) % 4);
      const payload = JSON.parse(
        atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/") + padding),
      );
      return !payload.exp || payload.exp < Math.floor(Date.now() / 1000);
    } catch {
      return true;
    }
  },
  // Returns seconds until token expires, or 0 if expired/missing.
  secondsUntilExpiry() {
    const token = this.getToken();
    if (!token) return 0;
    try {
      const [payloadB64] = token.split(".");
      const padding = "=".repeat((4 - (payloadB64.length % 4)) % 4);
      const payload = JSON.parse(
        atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/") + padding),
      );
      return Math.max(0, (payload.exp || 0) - Math.floor(Date.now() / 1000));
    } catch {
      return 0;
    }
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
