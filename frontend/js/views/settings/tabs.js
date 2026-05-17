// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jan Green Larsen <jgl@laces.dk>
/* Settings tab + sub-tab navigation.
 * Hoved-tabs: data-tab på .settings-tab knapper.
 * Sub-tabs: .settings-subtab-nav[data-for-tab] med .settings-subtab[data-subtab] knapper.
 * Kort med data-subtab vises kun når det matchende sub-tab er aktivt.
 * Kort uden data-subtab vises altid når hoved-tab er aktiv. */
const SETTINGS_TAB_KEY = "ise_portal_settings_tab";
export function initSettingsTabs(container, isAdmin, isPskEditorUser = false) {
  const tabs = container.querySelectorAll(".settings-tab");
  if (!tabs.length) return;

  const validTabs = Array.from(tabs).map(t => t.dataset.tab);
  const defaultTab = isAdmin ? "ise-connection" : "portal-config";
  let stored = null;
  try { stored = localStorage.getItem(SETTINGS_TAB_KEY); } catch { /* ignore */ }
  const initial = validTabs.includes(stored) ? stored : defaultTab;

  // Aktive sub-tab pr. hoved-tab (initialiseres nedenfor)
  const activeSubTab = {};

  function activateTab(tabId) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
    try { localStorage.setItem(SETTINGS_TAB_KEY, tabId); } catch { /* ignore */ }

    // Vis/skjul sub-nav barer
    container.querySelectorAll(".settings-subtab-nav").forEach(nav => {
      nav.style.display = nav.dataset.forTab === tabId ? "" : "none";
    });

    // Vis/skjul kort
    container.querySelectorAll(".settings-panels .card[data-tab]").forEach(c => {
      if (c.dataset.tab !== tabId) { c.style.display = "none"; return; }
      const sub = c.dataset.subtab;
      c.style.display = (!sub || !activeSubTab[tabId] || sub === activeSubTab[tabId]) ? "" : "none";
    });
  }

  // Initialiser sub-tab navigationerne
  container.querySelectorAll(".settings-subtab-nav").forEach(nav => {
    const forTab = nav.dataset.forTab;
    const btns = nav.querySelectorAll(".settings-subtab");
    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        activeSubTab[forTab] = btn.dataset.subtab;
        btns.forEach(b => b.classList.toggle("active", b === btn));
        activateTab(forTab);
      });
    });
    if (btns.length) {
      activeSubTab[forTab] = btns[0].dataset.subtab;
      btns[0].classList.add("active");
    }
  });

  tabs.forEach(t => t.addEventListener("click", () => activateTab(t.dataset.tab)));
  activateTab(initial);
}
