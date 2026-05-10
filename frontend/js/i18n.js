/**
 * i18n — minimalt oversættelsessystem til HyperVision ISE Portal.
 *
 * Prioritet: bruger-præference (server) → portal global default → browser-sprog → "en"
 *
 * Brug: import { t, setLocale, resolveLocale } from "./i18n.js";
 */

const TRANSLATIONS = {
  da: {
    // Navigation
    "nav.browse":       "Gennemse",
    "nav.register":     "Registrér",
    "nav.import":       "Importer",
    "nav.attributes":   "Attributter",
    "nav.dacls":        "DACL'er",
    "nav.logs":         "Logs",
    "nav.audit":        "Audit",
    "nav.metrics":      "Metrics",
    "nav.settings":     "Indstillinger",
    "nav.user-prefs":   "Præferencer",
    "nav.csv-template": "CSV Skabelon",

    // Fælles knapper / labels
    "btn.save":         "Gem",
    "btn.cancel":       "Annuller",
    "btn.delete":       "Slet",
    "btn.edit":         "Rediger",
    "btn.search":       "Søg",
    "btn.refresh":      "Opdater",
    "btn.export":       "Eksportér CSV",
    "btn.close":        "Luk",
    "btn.confirm":      "Bekræft",
    "btn.create":       "Opret",
    "btn.yes":          "Ja",
    "btn.no":           "Nej",

    // Login
    "login.title":         "Log ind",
    "login.setup_title":   "Første-gangs opsætning",
    "login.username":      "Brugernavn",
    "login.password":      "Password",
    "login.password2":     "Bekræft password",
    "login.submit":        "Log ind",
    "login.setup_submit":  "Opret admin & log ind",
    "login.setup_hint":    "Der er ingen brugere endnu. Opret en administrator for at komme i gang.",
    "login.err_backend":   "Kan ikke kontakte backend",
    "login.err_pw_match":  "Passwords matcher ikke",

    // Browse
    "browse.title":              "Gennemse / Rediger endpoints",
    "browse.btn_refresh":        "Opdater",
    "browse.btn_export":         "Eksportér CSV",
    "browse.btn_columns":        "Kolonner ▾",
    "browse.btn_views":          "📁 Views ▾",
    "browse.btn_portal_filter":  "Kun portal",
    "browse.btn_coa_off":        "CoA reauth: FRA",
    "browse.btn_coa_on":         "CoA reauth: TIL",
    "browse.btn_save_all":       "Gem alle",
    "browse.btn_bulk_edit":      "Rediger valgte",
    "browse.btn_bulk_save":      "Gem valgte",
    "browse.btn_bulk_disconnect":"Disconnect",
    "browse.btn_bulk_delete":    "Slet",
    "browse.label_show":         "Vis",
    "browse.select_all_title":   "Vælg alle",
    "browse.pxgrid_badge":       "⚪ Auth-status: ukendt",
    "browse.pxgrid_badge_title": "Hvor auth-status kommer fra: pxGrid push (live) eller MnT pull (5-15s forsinkelse)",

    // Browse detail-panel
    "detail.title":        "Endpoint detaljer",
    "detail.mac":          "MAC-adresse",
    "detail.group":        "Gruppe",
    "detail.description":  "Beskrivelse",
    "detail.created":      "Oprettet",
    "detail.updated":      "Opdateret",
    "detail.btn_save":     "Gem ændringer",
    "detail.btn_delete":   "Slet endpoint",
    "detail.btn_coa":      "CoA Reauth",
    "detail.btn_disconnect": "CoA Disconnect",
    "detail.no_selection": "Vælg et endpoint for at se detaljer",

    // User-prefs
    "prefs.title":             "Præferencer",
    "prefs.pw_card":           "Skift dit password",
    "prefs.pw_logged_in_as":   "Logget ind som",
    "prefs.pw_role":           "rolle",
    "prefs.pw_current":        "Nuværende password",
    "prefs.pw_new":            "Nyt password (min. 8 tegn)",
    "prefs.pw_new2":           "Bekræft nyt password",
    "prefs.pw_submit":         "Skift password",
    "prefs.pw_success":        "Password skiftet.",
    "prefs.pw_err_match":      "De to nye passwords matcher ikke.",
    "prefs.pw_tacacs_hint":    "Password administreres af TACACS+-serveren — det kan ikke skiftes her i portalen.",
    "prefs.pw_tacacs_via":     "via",
    "prefs.frontend_card":     "Frontend-præferencer",
    "prefs.frontend_hint":     "Gemmes i din browser og synkroniseres med serveren.",
    "prefs.page_size":         "Standard sidestørrelse (browse-visning)",
    "prefs.theme":             "Tema",
    "prefs.language":          "Sprog",
    "prefs.lang_auto":         "Automatisk (portal standard)",
    "prefs.lang_da":           "Dansk",
    "prefs.lang_en":           "English",
    "prefs.theme_light":       "Light",
    "prefs.theme_dark":        "Dark",
    "prefs.theme_midnight":    "Midnight",
    "prefs.theme_slate":       "Slate",
    "prefs.submit":            "Gem præferencer",
    "prefs.success":           "Præferencer gemt.",

    // Settings — locale panel
    "settings.locale_card":    "Portalsrog",
    "settings.locale_hint":    "Standardsprog for brugere uden personligt sprogvalg.",
    "settings.locale_label":   "Standard sprog",
    "settings.locale_submit":  "Gem sprogindstilling",
    "settings.locale_success": "Sprogindstilling gemt.",

    // Generelle alert-tekster
    "alert.loading":   "Indlæser…",
    "alert.error":     "Fejl",
    "alert.saved":     "Gemt.",
    "alert.deleted":   "Slettet.",
    "alert.no_access": "Din rolle har ikke adgang til denne side.",
  },

  en: {
    // Navigation
    "nav.browse":       "Browse",
    "nav.register":     "Register",
    "nav.import":       "Import",
    "nav.attributes":   "Attributes",
    "nav.dacls":        "DACLs",
    "nav.logs":         "Logs",
    "nav.audit":        "Audit",
    "nav.metrics":      "Metrics",
    "nav.settings":     "Settings",
    "nav.user-prefs":   "Preferences",
    "nav.csv-template": "CSV Template",

    // Common buttons / labels
    "btn.save":         "Save",
    "btn.cancel":       "Cancel",
    "btn.delete":       "Delete",
    "btn.edit":         "Edit",
    "btn.search":       "Search",
    "btn.refresh":      "Refresh",
    "btn.export":       "Export CSV",
    "btn.close":        "Close",
    "btn.confirm":      "Confirm",
    "btn.create":       "Create",
    "btn.yes":          "Yes",
    "btn.no":           "No",

    // Login
    "login.title":         "Log in",
    "login.setup_title":   "First-time setup",
    "login.username":      "Username",
    "login.password":      "Password",
    "login.password2":     "Confirm password",
    "login.submit":        "Log in",
    "login.setup_submit":  "Create admin & log in",
    "login.setup_hint":    "No users exist yet. Create an administrator to get started.",
    "login.err_backend":   "Cannot reach backend",
    "login.err_pw_match":  "Passwords do not match",

    // Browse
    "browse.title":              "Browse / Edit endpoints",
    "browse.btn_refresh":        "Refresh",
    "browse.btn_export":         "Export CSV",
    "browse.btn_columns":        "Columns ▾",
    "browse.btn_views":          "📁 Views ▾",
    "browse.btn_portal_filter":  "Portal only",
    "browse.btn_coa_off":        "CoA reauth: OFF",
    "browse.btn_coa_on":         "CoA reauth: ON",
    "browse.btn_save_all":       "Save all",
    "browse.btn_bulk_edit":      "Edit selected",
    "browse.btn_bulk_save":      "Save selected",
    "browse.btn_bulk_disconnect":"Disconnect",
    "browse.btn_bulk_delete":    "Delete",
    "browse.label_show":         "Show",
    "browse.select_all_title":   "Select all",
    "browse.pxgrid_badge":       "⚪ Auth-status: unknown",
    "browse.pxgrid_badge_title": "Where auth-status comes from: pxGrid push (live) or MnT pull (5-15s delay)",

    // Browse detail panel
    "detail.title":        "Endpoint details",
    "detail.mac":          "MAC address",
    "detail.group":        "Group",
    "detail.description":  "Description",
    "detail.created":      "Created",
    "detail.updated":      "Updated",
    "detail.btn_save":     "Save changes",
    "detail.btn_delete":   "Delete endpoint",
    "detail.btn_coa":      "CoA Reauth",
    "detail.btn_disconnect": "CoA Disconnect",
    "detail.no_selection": "Select an endpoint to view details",

    // User-prefs
    "prefs.title":             "Preferences",
    "prefs.pw_card":           "Change your password",
    "prefs.pw_logged_in_as":   "Logged in as",
    "prefs.pw_role":           "role",
    "prefs.pw_current":        "Current password",
    "prefs.pw_new":            "New password (min. 8 chars)",
    "prefs.pw_new2":           "Confirm new password",
    "prefs.pw_submit":         "Change password",
    "prefs.pw_success":        "Password changed.",
    "prefs.pw_err_match":      "The two new passwords do not match.",
    "prefs.pw_tacacs_hint":    "Password is managed by the TACACS+ server — it cannot be changed here.",
    "prefs.pw_tacacs_via":     "via",
    "prefs.frontend_card":     "Frontend preferences",
    "prefs.frontend_hint":     "Saved in your browser and synced with the server.",
    "prefs.page_size":         "Default page size (browse view)",
    "prefs.theme":             "Theme",
    "prefs.language":          "Language",
    "prefs.lang_auto":         "Automatic (portal default)",
    "prefs.lang_da":           "Dansk",
    "prefs.lang_en":           "English",
    "prefs.theme_light":       "Light",
    "prefs.theme_dark":        "Dark",
    "prefs.theme_midnight":    "Midnight",
    "prefs.theme_slate":       "Slate",
    "prefs.submit":            "Save preferences",
    "prefs.success":           "Preferences saved.",

    // Settings — locale panel
    "settings.locale_card":    "Portal language",
    "settings.locale_hint":    "Default language for users without a personal language selection.",
    "settings.locale_label":   "Default language",
    "settings.locale_submit":  "Save language setting",
    "settings.locale_success": "Language setting saved.",

    // General alert texts
    "alert.loading":   "Loading…",
    "alert.error":     "Error",
    "alert.saved":     "Saved.",
    "alert.deleted":   "Deleted.",
    "alert.no_access": "Your role does not have access to this page.",
  },
};

// Aktiv locale — sættes ved resolveLocale(), ændres ved setLocale()
let _locale = "en";

// Callback der kaldes efter setLocale() for at re-rendre aktuel view
let _rerenderFn = null;

export function registerRerenderCallback(fn) {
  _rerenderFn = fn;
}

export function getLocale() {
  return _locale;
}

/**
 * t(key) — slår nøgle op i aktivt sprog. Falder tilbage til key hvis ukendt.
 */
export function t(key) {
  return (TRANSLATIONS[_locale] || TRANSLATIONS.en)[key] ?? key;
}

/**
 * resolveLocale(portalDefault) — bestemmer startsprog.
 * Kalder GET /api/me/prefs for brugerpræference; falder tilbage i prioritetsrækkefølge.
 * Skal kaldes efter login.
 */
export async function resolveLocale(portalDefault, apiGetMyPrefs) {
  // 1) Forsøg bruger-præference fra server
  try {
    const prefs = await apiGetMyPrefs();
    if (prefs?.language) {
      _locale = prefs.language;
      return;
    }
  } catch { /* ingen server-præference — fortsæt */ }

  // 2) Portal global default (bundlet i AuthStatus)
  if (portalDefault && TRANSLATIONS[portalDefault]) {
    _locale = portalDefault;
    return;
  }

  // 3) Browser-sprog
  const browserLang = (navigator.language || "").toLowerCase().split("-")[0];
  if (TRANSLATIONS[browserLang]) {
    _locale = browserLang;
    return;
  }

  // 4) Hardcoded fallback
  _locale = "en";
}

/**
 * setLocale(lang) — opdaterer locale, gemmer på server, re-renderer aktuel view.
 * language=null → rydder bruger-præference (brug portal/browser default).
 */
export async function setLocale(lang, apiPutMyPrefs) {
  try {
    await apiPutMyPrefs({ language: lang || null });
  } catch (err) {
    // TACACS+-brugere kan ikke gemme server-side — gem i localStorage som fallback
    if (err.message && err.message.includes("403")) {
      try {
        const stored = JSON.parse(localStorage.getItem("ise_portal_prefs") || "{}");
        stored.language = lang || undefined;
        localStorage.setItem("ise_portal_prefs", JSON.stringify(stored));
      } catch { /* ignore */ }
    } else {
      throw err;
    }
  }
  if (lang && TRANSLATIONS[lang]) {
    _locale = lang;
  }
  if (_rerenderFn) _rerenderFn();
}

/**
 * initLocaleFromStorage(portalDefault) — bruges på boot FØR login for at
 * anvende evt. gemt locale fra localStorage (TACACS+-fallback eller tidligere session).
 */
export function initLocaleFromStorage(portalDefault) {
  try {
    const stored = JSON.parse(localStorage.getItem("ise_portal_prefs") || "{}");
    if (stored.language && TRANSLATIONS[stored.language]) {
      _locale = stored.language;
      return;
    }
  } catch { /* ignore */ }
  if (portalDefault && TRANSLATIONS[portalDefault]) {
    _locale = portalDefault;
    return;
  }
  const browserLang = (navigator.language || "").toLowerCase().split("-")[0];
  _locale = TRANSLATIONS[browserLang] ? browserLang : "en";
}
