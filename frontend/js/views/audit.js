import { api } from "../api.js";
import { auth } from "../auth.js";

function esc(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const RESOURCE_TYPES = [
  "", "endpoint", "dacl", "user", "custom_attribute",
  "platform_mapping", "backend_settings",
];

const ACTION_LABEL = {
  created: "Oprettet",
  updated: "Opdateret",
  deleted: "Slettet",
  value_added: "Værdi tilføjet",
  value_removed: "Værdi fjernet",
  mapping_updated: "Mapping opdateret",
  password_changed: "Password ændret",
  rolled_back: "Rullet tilbage",
};

const ROLLBACK_SUPPORTED = new Set(["endpoint", "dacl"]);

function fmtTs(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("da-DK", { hour12: false });
}

function actionLabel(a) {
  return ACTION_LABEL[a] || a;
}

function renderJson(value) {
  if (value === null || value === undefined) {
    return `<span class="audit-none">(ingen)</span>`;
  }
  try {
    return `<pre class="audit-json">${esc(JSON.stringify(value, null, 2))}</pre>`;
  } catch {
    return `<pre class="audit-json">${esc(String(value))}</pre>`;
  }
}

function canRollback(evt) {
  if (!ROLLBACK_SUPPORTED.has(evt.resource_type)) return false;
  if (evt.action === "rolled_back") return false;
  if (evt.action === "deleted") return false;
  return true;
}

export async function renderAudit(container) {
  const user = auth.getUser();
  const isAdmin = user && user.role === "admin";

  container.innerHTML = `
    <h2>Audit-log</h2>
    <p class="hint">
      Append-only log af alle skrive-operationer (2.9.0). Admins kan rulle
      Endpoints og DACL'er tilbage til tidligere tilstand; rollbacks bliver
      selv logget, så historikken forbliver komplet.
    </p>
    <div class="card">
      <div class="logs-toolbar">
        <label>
          Ressource
          <select id="audit-type">
            ${RESOURCE_TYPES.map((t) => `<option value="${t}">${t || "Alle"}</option>`).join("")}
          </select>
        </label>
        <label class="log-search-label">
          Søg
          <input type="text" id="audit-search" placeholder="aktør, id, MAC, JSON, IP, dato…" />
        </label>
        <label>
          Antal
          <select id="audit-limit">
            ${[50, 100, 250, 500].map((n) => `<option value="${n}"${n === 100 ? " selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>
        <button id="audit-refresh">Opdater</button>
        <span id="audit-meta" class="hint"></span>
      </div>
      <div id="audit-msg"></div>
      <div class="log-table-wrap">
        <table class="log-table">
          <thead>
            <tr>
              <th style="width:12rem;">Tidspunkt</th>
              <th style="width:8rem;">Aktør</th>
              <th style="width:7rem;">Handling</th>
              <th style="width:9rem;">Ressource</th>
              <th style="width:13rem;">ID</th>
              <th>Detaljer</th>
              <th class="audit-actions-col">&nbsp;</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">
            <tr><td colspan="7" class="empty">Henter…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div id="audit-drawer" class="audit-drawer" hidden>
      <div class="audit-drawer-header">
        <h3 id="audit-drawer-title">Audit-event</h3>
        <button id="audit-drawer-close" type="button">Luk</button>
      </div>
      <div id="audit-drawer-body"></div>
    </div>
  `;

  const tbody = container.querySelector("#audit-tbody");
  const msg = container.querySelector("#audit-msg");
  const meta = container.querySelector("#audit-meta");
  const typeSel = container.querySelector("#audit-type");
  const searchInput = container.querySelector("#audit-search");
  const limitSel = container.querySelector("#audit-limit");
  const refreshBtn = container.querySelector("#audit-refresh");
  const drawer = container.querySelector("#audit-drawer");
  const drawerTitle = container.querySelector("#audit-drawer-title");
  const drawerBody = container.querySelector("#audit-drawer-body");
  const drawerClose = container.querySelector("#audit-drawer-close");

  let debounce;
  let events = [];

  async function load() {
    msg.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Henter…</td></tr>`;
    try {
      const params = {
        resource_type: typeSel.value || undefined,
        search: searchInput.value.trim() || undefined,
        limit: parseInt(limitSel.value, 10),
      };
      const data = await api.listAuditEvents(params);
      events = data.events || [];
      if (!events.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty">Ingen events matcher filtrene.</td></tr>`;
        meta.textContent = `0 af ${data.total || 0} events`;
        return;
      }
      tbody.innerHTML = events
        .map((e) => {
          const summary = summarize(e);
          const rbBtn = isAdmin && canRollback(e)
            ? `<button class="audit-rollback" data-id="${e.id}">Rollback</button>`
            : "";
          return `
            <tr data-id="${e.id}">
              <td class="mono">${esc(fmtTs(e.ts))}</td>
              <td>${esc(e.actor_username)}</td>
              <td><span class="audit-action audit-action-${esc(e.action)}">${esc(actionLabel(e.action))}</span></td>
              <td class="mono">${esc(e.resource_type)}</td>
              <td class="mono">${esc(e.resource_id || "—")}</td>
              <td class="audit-summary">${summary}</td>
              <td class="audit-actions-cell">
                <button class="audit-view" data-id="${e.id}">Vis</button>
                ${rbBtn}
              </td>
            </tr>`;
        })
        .join("");
      meta.textContent = `${events.length} af ${data.total || events.length} events`;
    } catch (err) {
      tbody.innerHTML = "";
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      meta.textContent = "";
    }
  }

  function summarize(evt) {
    if (evt.resource_type === "endpoint" && evt.after && evt.after.mac) {
      return `MAC ${esc(evt.after.mac)}`;
    }
    if (evt.resource_type === "dacl" && evt.after && evt.after.name) {
      return `Navn: ${esc(evt.after.name)}`;
    }
    if (evt.resource_type === "user" && (evt.after || evt.before)) {
      const u = (evt.after && evt.after.username) || (evt.before && evt.before.username) || "";
      return esc(u);
    }
    if (evt.resource_type === "custom_attribute" && evt.resource_id) {
      const added = evt.after && evt.after.added;
      const removed = evt.after && evt.after.removed;
      if (added) return `+ "${esc(added)}"`;
      if (removed) return `− "${esc(removed)}"`;
    }
    return "";
  }

  function openDrawer(evt) {
    drawerTitle.textContent = `#${evt.id} — ${actionLabel(evt.action)} ${evt.resource_type}${evt.resource_id ? " " + evt.resource_id : ""}`;
    const rbBtn = isAdmin && canRollback(evt)
      ? `<button id="audit-drawer-rollback" data-id="${evt.id}" class="primary">Rul tilbage</button>`
      : "";
    drawerBody.innerHTML = `
      <div class="audit-meta-grid">
        <div><b>Tidspunkt:</b> ${esc(fmtTs(evt.ts))}</div>
        <div><b>Aktør:</b> ${esc(evt.actor_username)} ${evt.source_ip ? `(${esc(evt.source_ip)})` : ""}</div>
      </div>
      <div class="audit-diff">
        <div class="audit-pane">
          <h4>Før</h4>
          ${renderJson(evt.before)}
        </div>
        <div class="audit-pane">
          <h4>Efter</h4>
          ${renderJson(evt.after)}
        </div>
      </div>
      <div class="audit-drawer-footer">${rbBtn}</div>
    `;
    drawer.hidden = false;
    const rb = drawerBody.querySelector("#audit-drawer-rollback");
    if (rb) rb.addEventListener("click", () => runRollback(evt.id));
  }

  async function showEvent(id) {
    try {
      const evt = await api.getAuditEvent(id);
      openDrawer(evt);
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  }

  async function runRollback(id) {
    if (!window.confirm(`Rul audit-event #${id} tilbage? Handlingen logges som et nyt event.`)) {
      return;
    }
    msg.innerHTML = "";
    try {
      const result = await api.rollbackAuditEvent(id);
      msg.innerHTML = `<div class="alert success">${esc(result.message)}</div>`;
      drawer.hidden = true;
      await load();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">Rollback fejlede: ${esc(err.message)}</div>`;
    }
  }

  tbody.addEventListener("click", (e) => {
    const viewBtn = e.target.closest(".audit-view");
    if (viewBtn) {
      showEvent(parseInt(viewBtn.dataset.id, 10));
      return;
    }
    const rbBtn = e.target.closest(".audit-rollback");
    if (rbBtn) {
      runRollback(parseInt(rbBtn.dataset.id, 10));
    }
  });

  drawerClose.addEventListener("click", () => { drawer.hidden = true; });
  refreshBtn.addEventListener("click", load);
  typeSel.addEventListener("change", load);
  limitSel.addEventListener("change", load);
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 350);
  });
  searchInput.addEventListener("change", () => {
    clearTimeout(debounce);
    load();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(debounce);
      load();
    }
  });

  await load();
}
