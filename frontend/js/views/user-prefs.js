import { api } from "../api.js";
import { auth } from "../auth.js";
import { t, setLocale, getLocale } from "../i18n.js";
import { applyTheme } from "./settings.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const FRONTEND_PREFS_KEY = "ise_portal_prefs";

function loadFrontendPrefs() {
  try { return JSON.parse(localStorage.getItem(FRONTEND_PREFS_KEY) || "{}"); }
  catch { return {}; }
}

function saveFrontendPrefs(prefs) {
  localStorage.setItem(FRONTEND_PREFS_KEY, JSON.stringify(prefs));
}

export async function renderUserPrefs(container) {
  const currentUser = auth.getUser();
  const isTacacs = auth.isTacacs();

  // Hent brugerpræference fra server for at vise korrekt valgt sprog
  let serverLang = null;
  try {
    const prefs = await api.getMyPrefs();
    serverLang = prefs?.language || null;
  } catch { /* ignore — TACACS+ eller netværksfejl */ }

  const passwordCard = isTacacs
    ? `<div class="card">
        <h3>Password</h3>
        <p class="hint">${t("prefs.pw_logged_in_as")} <b>${esc(currentUser?.username || "")}</b> ${t("prefs.pw_tacacs_via")} <strong>TACACS+</strong>.</p>
        <p>${t("prefs.pw_tacacs_hint")}</p>
      </div>`
    : `<div class="card">
        <h3>${t("prefs.pw_card")}</h3>
        <p class="hint">${t("prefs.pw_logged_in_as")} <b>${esc(currentUser?.username || "")}</b> (${t("prefs.pw_role")}: ${esc(currentUser?.role || "")}).</p>
        <div id="pw-msg"></div>
        <form id="pw-form" class="pw-form">
          <div class="field">
            <label for="pw-current">${t("prefs.pw_current")}</label>
            <input type="password" id="pw-current" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="pw-new">${t("prefs.pw_new")}</label>
            <input type="password" id="pw-new" autocomplete="new-password" minlength="8" required />
          </div>
          <div class="field">
            <label for="pw-new2">${t("prefs.pw_new2")}</label>
            <input type="password" id="pw-new2" autocomplete="new-password" minlength="8" required />
          </div>
          <div class="actions">
            <button type="submit">${t("prefs.pw_submit")}</button>
          </div>
        </form>
      </div>`;

  container.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">${t("prefs.title")}</h2>
    </div>
    ${passwordCard}

    <div class="card">
      <h3>${t("prefs.frontend_card")}</h3>
      <p class="hint">${t("prefs.frontend_hint")}</p>
      <div id="frontend-msg"></div>
      <form id="frontend-form">
        <div class="field">
          <label for="page_size">${t("prefs.page_size")}</label>
          <input type="number" id="page_size" min="10" max="500" step="10" />
        </div>
        <div class="field">
          <label for="theme">${t("prefs.theme")}</label>
          <select id="theme">
            <option value="light">${t("prefs.theme_light")}</option>
            <option value="dark">${t("prefs.theme_dark")}</option>
            <option value="midnight">${t("prefs.theme_midnight")}</option>
            <option value="slate">${t("prefs.theme_slate")}</option>
          </select>
        </div>
        <div class="field">
          <label for="language">${t("prefs.language")}</label>
          <select id="language">
            <option value="">${t("prefs.lang_auto")}</option>
            <option value="da">${t("prefs.lang_da")}</option>
            <option value="en">${t("prefs.lang_en")}</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit">${t("prefs.submit")}</button>
        </div>
      </form>
    </div>
  `;

  if (!isTacacs) {
    const pwMsg = container.querySelector("#pw-msg");
    container.querySelector("#pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      pwMsg.innerHTML = "";
      const current = container.querySelector("#pw-current").value;
      const newPw = container.querySelector("#pw-new").value;
      const newPw2 = container.querySelector("#pw-new2").value;
      if (newPw !== newPw2) {
        pwMsg.innerHTML = `<div class="alert error">${t("prefs.pw_err_match")}</div>`;
        return;
      }
      try {
        await api.changePassword(current, newPw);
        container.querySelector("#pw-form").reset();
        pwMsg.innerHTML = `<div class="alert success">${t("prefs.pw_success")}</div>`;
      } catch (err) {
        pwMsg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    });
  }

  const prefs = loadFrontendPrefs();
  container.querySelector("#page_size").value = prefs.pageSize || 100;
  container.querySelector("#theme").value = prefs.theme || "light";
  // Sprogvælger: vis server-præference hvis sat, ellers aktuel locale
  container.querySelector("#language").value = serverLang || "";

  const frontendMsg = container.querySelector("#frontend-msg");
  container.querySelector("#frontend-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newLang = container.querySelector("#language").value || null;
    const newPrefs = {
      pageSize: parseInt(container.querySelector("#page_size").value, 10),
      theme: container.querySelector("#theme").value,
    };
    saveFrontendPrefs(newPrefs);
    applyTheme(newPrefs.theme);
    try {
      await setLocale(newLang, (payload) => api.updateMyPrefs(payload));
    } catch (err) {
      frontendMsg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      return;
    }
    frontendMsg.innerHTML = `<div class="alert success">${t("prefs.success")}</div>`;
  });
}
