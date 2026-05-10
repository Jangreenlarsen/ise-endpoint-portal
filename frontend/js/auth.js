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
};
