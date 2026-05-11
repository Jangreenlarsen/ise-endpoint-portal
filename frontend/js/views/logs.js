import { api } from "../api.js";
import { t } from "../i18n.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const LEVELS = ["", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
const LINE_OPTIONS = [100, 250, 500, 1000, 2500, 5000];

export async function renderLogs(container) {
  container.innerHTML = `
    <h2>${t("logs.title")}</h2>
    <p class="hint">${t("logs.hint")}</p>
    <div class="card">
      <div class="logs-toolbar">
        <label>
          ${t("logs.label_level")}
          <select id="log-level">
            ${LEVELS.map((l) => `<option value="${l}">${l || t("logs.all_levels")}</option>`).join("")}
          </select>
        </label>
        <label>
          ${t("logs.label_lines")}
          <select id="log-lines">
            ${LINE_OPTIONS.map((n) => `<option value="${n}"${n === 500 ? " selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>
        <label class="log-search-label">
          ${t("logs.label_search")}
          <input type="text" id="log-search" placeholder="${t("logs.search_placeholder")}" />
        </label>
        <button id="log-refresh">${t("logs.btn_refresh")}</button>
        <span id="log-meta" class="hint"></span>
      </div>
      <div id="log-msg"></div>
      <div class="log-table-wrap">
        <table class="log-table">
          <thead>
            <tr>
              <th style="width:11rem;">${t("logs.col_time")}</th>
              <th style="width:5.5rem;">${t("logs.col_level")}</th>
              <th style="width:14rem;">${t("logs.col_logger")}</th>
              <th>${t("logs.col_msg")}</th>
            </tr>
          </thead>
          <tbody id="log-tbody">
            <tr><td colspan="4" class="empty">${t("logs.loading")}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = container.querySelector("#log-tbody");
  const msg = container.querySelector("#log-msg");
  const meta = container.querySelector("#log-meta");
  const levelSel = container.querySelector("#log-level");
  const linesSel = container.querySelector("#log-lines");
  const searchInput = container.querySelector("#log-search");
  const refreshBtn = container.querySelector("#log-refresh");

  let debounce;

  async function load() {
    msg.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="4" class="empty">${t("logs.loading")}</td></tr>`;
    try {
      const data = await api.getLogs(
        parseInt(linesSel.value, 10),
        levelSel.value,
        searchInput.value.trim(),
      );
      const entries = data.entries || [];
      if (!entries.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty">${t("logs.no_entries")}</td></tr>`;
        meta.textContent = `0 entries`;
        return;
      }
      tbody.innerHTML = entries
        .map((e) => {
          const lvl = (e.level || "").toUpperCase();
          const lvlClass = `log-level log-level-${lvl.toLowerCase()}`;
          return `
            <tr>
              <td class="mono">${esc(e.timestamp)}</td>
              <td><span class="${lvlClass}">${esc(lvl)}</span></td>
              <td class="mono">${esc(e.logger)}</td>
              <td class="log-msg-cell">${esc(e.message)}</td>
            </tr>`;
        })
        .join("");
      meta.textContent = `${entries.length} entries`;
    } catch (err) {
      tbody.innerHTML = "";
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      meta.textContent = "";
    }
  }

  refreshBtn.addEventListener("click", load);
  levelSel.addEventListener("change", load);
  linesSel.addEventListener("change", load);
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 350);
  });

  await load();
}
