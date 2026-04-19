import { api } from "../api.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const LEVELS = ["", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
const LINE_OPTIONS = [100, 250, 500, 1000, 2500, 5000];

export async function renderLogs(container) {
  container.innerHTML = `
    <h2>Log</h2>
    <p class="hint">
      Viser entries fra backend-loggen (<code>backend/logs/app.log</code>) — nyeste øverst.
    </p>
    <div class="card">
      <div class="logs-toolbar">
        <label>
          Niveau
          <select id="log-level">
            ${LEVELS.map((l) => `<option value="${l}">${l || "Alle"}</option>`).join("")}
          </select>
        </label>
        <label>
          Linjer
          <select id="log-lines">
            ${LINE_OPTIONS.map((n) => `<option value="${n}"${n === 500 ? " selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>
        <label class="log-search-label">
          Søg
          <input type="text" id="log-search" placeholder="fritekst (MAC, logger, besked…)" />
        </label>
        <button id="log-refresh">Opdater</button>
        <span id="log-meta" class="hint"></span>
      </div>
      <div id="log-msg"></div>
      <div class="log-table-wrap">
        <table class="log-table">
          <thead>
            <tr>
              <th style="width:11rem;">Tidspunkt</th>
              <th style="width:5.5rem;">Niveau</th>
              <th style="width:14rem;">Logger</th>
              <th>Besked</th>
            </tr>
          </thead>
          <tbody id="log-tbody">
            <tr><td colspan="4" class="empty">Henter…</td></tr>
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
    tbody.innerHTML = `<tr><td colspan="4" class="empty">Henter…</td></tr>`;
    try {
      const data = await api.getLogs(
        parseInt(linesSel.value, 10),
        levelSel.value,
        searchInput.value.trim(),
      );
      const entries = data.entries || [];
      if (!entries.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty">Ingen entries matcher filtrene.</td></tr>`;
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
