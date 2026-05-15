import { api } from "../api.js";
import { auth } from "../auth.js";
import { t, getLocale } from "../i18n.js";

function esc(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const RESOURCE_TYPES = [
  "", "endpoint", "dacl", "user", "custom_attribute",
  "platform_mapping", "backend_settings",
];

const ROLLBACK_SUPPORTED = new Set(["endpoint", "dacl"]);

function fmtTs(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(getLocale() === "da" ? "da-DK" : "en-GB", { hour12: false });
}

function actionLabel(a) {
  return t(`audit.action_${a}`) !== `audit.action_${a}` ? t(`audit.action_${a}`) : a;
}

function renderJson(value) {
  if (value === null || value === undefined) {
    return `<span class="audit-none">${t("audit.none")}</span>`;
  }
  try {
    return `<pre class="audit-json">${esc(JSON.stringify(value, null, 2))}</pre>`;
  } catch {
    return `<pre class="audit-json">${esc(String(value))}</pre>`;
  }
}

function renderJsonDiff(before, after) {
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObj(before) || !isObj(after)) {
    return { beforeHtml: renderJson(before), afterHtml: renderJson(after) };
  }
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  function lineHtml(cls, key, val) {
    const raw = JSON.stringify(val, null, 2)
      .split("\n")
      .map((l, i) => (i === 0 ? `  "${esc(key)}": ${esc(l)}` : `  ${esc(l)}`))
      .join("\n");
    return `<span class="audit-diff-line ${cls}">${raw}</span>`;
  }
  const beforeLines = [];
  const afterLines = [];
  beforeLines.push("{");
  afterLines.push("{");
  let firstB = true, firstA = true;
  for (const key of allKeys) {
    const inBefore = Object.prototype.hasOwnProperty.call(before, key);
    const inAfter  = Object.prototype.hasOwnProperty.call(after, key);
    const sep = (first) => first ? "" : ",\n";
    if (inBefore && inAfter) {
      const changed = JSON.stringify(before[key]) !== JSON.stringify(after[key]);
      const cls = changed ? "audit-diff-changed" : "";
      beforeLines.push(sep(firstB) + lineHtml(cls, key, before[key]));
      afterLines.push(sep(firstA)  + lineHtml(cls, key, after[key]));
      firstB = false; firstA = false;
    } else if (inBefore) {
      beforeLines.push(sep(firstB) + lineHtml("audit-diff-removed", key, before[key]));
      afterLines.push(sep(firstA)  + lineHtml("audit-diff-removed", key, null));
      firstB = false; firstA = false;
    } else {
      beforeLines.push(sep(firstB) + lineHtml("audit-diff-added", key, null));
      afterLines.push(sep(firstA)  + lineHtml("audit-diff-added", key, after[key]));
      firstB = false; firstA = false;
    }
  }
  beforeLines.push("\n}");
  afterLines.push("\n}");
  return {
    beforeHtml: `<pre class="audit-json">${beforeLines.join("")}</pre>`,
    afterHtml:  `<pre class="audit-json">${afterLines.join("")}</pre>`,
  };
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
    <h2>${t("audit.title")}</h2>
    <p class="hint">${t("audit.hint")}</p>
    <div class="card">
      <div class="logs-toolbar">
        <label>
          ${t("audit.label_resource")}
          <select id="audit-type">
            ${RESOURCE_TYPES.map((tp) => `<option value="${tp}">${tp || t("audit.all_resources")}</option>`).join("")}
          </select>
        </label>
        <label class="log-search-label">
          ${t("audit.label_search")}
          <input type="text" id="audit-search" placeholder="${t("audit.search_placeholder")}" />
        </label>
        <label>
          ${t("audit.label_count")}
          <select id="audit-limit">
            ${[50, 100, 250, 500].map((n) => `<option value="${n}"${n === 100 ? " selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>
        <button id="audit-refresh">${t("audit.btn_refresh")}</button>
        <span id="audit-meta" class="hint"></span>
      </div>
      <div id="audit-msg"></div>
      <div class="log-table-wrap">
        <table class="log-table">
          <thead>
            <tr>
              <th style="width:12rem;">${t("audit.col_time")}</th>
              <th style="width:8rem;">${t("audit.col_actor")}</th>
              <th style="width:7rem;">${t("audit.col_action")}</th>
              <th style="width:9rem;">${t("audit.col_resource")}</th>
              <th style="width:13rem;">${t("audit.col_id")}</th>
              <th>${t("audit.col_details")}</th>
              <th class="audit-actions-col">&nbsp;</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">
            <tr><td colspan="7" class="empty">${t("audit.loading")}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div id="audit-drawer" class="audit-drawer" hidden>
      <div class="audit-drawer-header">
        <h3 id="audit-drawer-title">Audit</h3>
        <button id="audit-drawer-close" type="button">${t("audit.drawer_close")}</button>
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
    tbody.innerHTML = `<tr><td colspan="7" class="empty">${t("audit.loading")}</td></tr>`;
    try {
      const params = {
        resource_type: typeSel.value || undefined,
        search: searchInput.value.trim() || undefined,
        limit: parseInt(limitSel.value, 10),
      };
      const data = await api.listAuditEvents(params);
      events = data.events || [];
      if (!events.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty">${t("audit.no_events")}</td></tr>`;
        meta.textContent = `0 af ${data.total || 0} events`;
        return;
      }
      tbody.innerHTML = events
        .map((e) => {
          const summary = summarize(e);
          const rbBtn = isAdmin && canRollback(e)
            ? `<button class="audit-rollback" data-id="${e.id}">${t("audit.btn_rollback")}</button>`
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
                <button class="audit-view" data-id="${e.id}">${t("audit.btn_view")}</button>
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
      ? `<button id="audit-drawer-rollback" data-id="${evt.id}" class="primary">${t("audit.btn_rollback_confirm")}</button>`
      : "";
    const diff = renderJsonDiff(evt.before, evt.after);
    drawerBody.innerHTML = `
      <div class="audit-meta-grid">
        <div><b>${t("audit.drawer_time")}</b> ${esc(fmtTs(evt.ts))}</div>
        <div><b>${t("audit.drawer_actor")}</b> ${esc(evt.actor_username)} ${evt.source_ip ? `(${esc(evt.source_ip)})` : ""}</div>
      </div>
      <div class="audit-diff">
        <div class="audit-pane">
          <h4>${t("audit.drawer_before")}</h4>
          ${diff.beforeHtml}
        </div>
        <div class="audit-pane">
          <h4>${t("audit.drawer_after")}</h4>
          ${diff.afterHtml}
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
    if (!window.confirm(t("audit.confirm_rollback").replace("{id}", id))) return;
    msg.innerHTML = "";
    try {
      const result = await api.rollbackAuditEvent(id);
      msg.innerHTML = `<div class="alert success">${esc(result.message)}</div>`;
      drawer.hidden = true;
      await load();
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${t("audit.rollback_error").replace("{msg}", esc(err.message))}</div>`;
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
