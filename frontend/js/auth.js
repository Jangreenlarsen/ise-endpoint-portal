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
};
