import { api } from "../api.js";

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return [];
  let startIdx = 0;
  const firstCell = lines[0].split(",")[0].trim();
  if (!MAC_RE.test(firstCell) && lines[0].toLowerCase().includes("mac")) {
    startIdx = 1;
  }
  const items = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    const mac = parts[0];
    const groupName = parts[1] || "";
    const description = parts[2] || "";
    const owner = parts[3] || "";
    const location = parts[4] || "";
    const authzVlan = parts[5] || "";
    items.push({ mac, groupName, description, owner, location, authzVlan, valid: MAC_RE.test(mac) });
  }
  return items;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export async function renderImport(container) {
  container.innerHTML = `
    <h2>Import fra CSV</h2>
    <div class="card">
      <p class="hint">
        CSV format: <code>mac,group,description,owner,lokation,authz_vlan</code>.<br>
        De tre sidste kolonner (owner, location, authz_vlan) er valgfrie custom attributes.<br>
        Header-række er valgfri (auto-detekteres). Hvis <code>group</code> mangler bruges fallback-gruppen.
      </p>
      <div class="field">
        <label for="csv-file">CSV fil</label>
        <input type="file" id="csv-file" accept=".csv,text/csv,text/plain" />
      </div>
      <div class="field">
        <label for="csv-text">...eller indsæt CSV indhold direkte</label>
        <textarea id="csv-text" placeholder="mac,group,description,owner,lokation,authz_vlan
AA:BB:CC:DD:EE:01,Unknown,lab device,IT,BLR-1F,VLAN100
AA:BB:CC:DD:EE:02,Profiled,printer,Facilities,,VLAN200"></textarea>
      </div>
      <div class="field">
        <label for="fallback-group">Fallback endpoint group</label>
        <select id="fallback-group"></select>
      </div>
      <div class="actions">
        <button id="preview-btn" type="button">Preview</button>
        <button id="import-btn" type="button" disabled>Import</button>
      </div>
      <div id="msg"></div>
      <div id="preview"></div>
      <div id="result"></div>
    </div>
  `;

  let groups = [];
  let parsed = [];

  const fallback = container.querySelector("#fallback-group");
  const msg = container.querySelector("#msg");
  const preview = container.querySelector("#preview");
  const result = container.querySelector("#result");
  const importBtn = container.querySelector("#import-btn");

  try {
    groups = await api.listGroups();
    fallback.innerHTML = groups
      .map((g) => `<option value="${g.id}">${g.name}</option>`)
      .join("");
  } catch (err) {
    msg.innerHTML = `<div class="alert error">Kunne ikke hente groups: ${err.message}</div>`;
  }

  container.querySelector("#csv-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    container.querySelector("#csv-text").value = text;
  });

  container.querySelector("#preview-btn").addEventListener("click", () => {
    const text = container.querySelector("#csv-text").value;
    parsed = parseCsv(text);
    result.innerHTML = "";
    if (!parsed.length) {
      preview.innerHTML = `<div class="alert info">Ingen rækker fundet.</div>`;
      importBtn.disabled = true;
      return;
    }
    const valid = parsed.filter((p) => p.valid).length;
    const invalid = parsed.length - valid;
    const hasCA = parsed.some((p) => p.owner || p.location || p.authzVlan);
    preview.innerHTML = `
      <div class="alert info">
        ${parsed.length} rækker — <strong>${valid}</strong> gyldige, <strong>${invalid}</strong> ugyldige.
      </div>
      <div class="preview-table">
        <table>
          <thead>
            <tr>
              <th>#</th><th>MAC</th><th>Group (CSV)</th><th>Description</th>
              ${hasCA ? "<th>Owner</th><th>Lokation</th><th>AuthzVlan</th>" : ""}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${parsed.map((p, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(p.mac)}</td>
                <td>${p.groupName ? escapeHtml(p.groupName) : "<em>fallback</em>"}</td>
                <td>${escapeHtml(p.description)}</td>
                ${hasCA ? `
                  <td>${escapeHtml(p.owner)}</td>
                  <td>${escapeHtml(p.location)}</td>
                  <td>${escapeHtml(p.authzVlan)}</td>
                ` : ""}
                <td>${p.valid ? "✓" : '<span class="invalid">ugyldig MAC</span>'}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
    importBtn.disabled = valid === 0;
  });

  importBtn.addEventListener("click", async () => {
    const fallbackId = fallback.value;
    const groupsByName = new Map(
      groups.map((g) => [g.name.toLowerCase(), g.id]),
    );
    const items = parsed
      .filter((p) => p.valid)
      .map((p) => {
        const item = {
          mac: p.mac.toUpperCase().replace(/-/g, ":"),
          group_id: p.groupName
            ? (groupsByName.get(p.groupName.toLowerCase()) || fallbackId)
            : fallbackId,
          description: p.description,
        };
        // Add custom attributes if any are present
        const ca = {};
        let hasCA = false;
        if (p.owner) { ca.Owner = p.owner; hasCA = true; }
        if (p.location) { ca.Lokation = p.location; hasCA = true; }
        if (p.authzVlan) { ca.AuthzVlan = p.authzVlan; hasCA = true; }
        if (hasCA) item.custom_attributes = ca;
        return item;
      });

    result.innerHTML = `<div class="alert info">Importerer ${items.length} endpoints...</div>`;
    importBtn.disabled = true;
    try {
      const res = await api.bulkCreateEndpoints(items);
      result.innerHTML = `
        <div class="alert ${res.failed.length ? "info" : "success"}">
          Oprettet: <strong>${res.succeeded.length}</strong> — fejlet: <strong>${res.failed.length}</strong>
        </div>
        <div class="result-list">
          <div>
            <h4 class="succeeded">Succeeded (${res.succeeded.length})</h4>
            <ul>${res.succeeded.map((m) => `<li>${escapeHtml(m)}</li>`).join("") || "<li>(ingen)</li>"}</ul>
          </div>
          <div>
            <h4 class="failed">Failed (${res.failed.length})</h4>
            <ul>${res.failed.map((f) => `<li>${escapeHtml(f.mac)}: ${escapeHtml(f.error)}</li>`).join("") || "<li>(ingen)</li>"}</ul>
          </div>
        </div>
      `;
    } catch (err) {
      result.innerHTML = `<div class="alert error">Bulk import fejlede: ${err.message}</div>`;
    } finally {
      importBtn.disabled = false;
    }
  });
}
