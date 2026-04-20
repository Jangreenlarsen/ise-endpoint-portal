import { api } from "../api.js";
import { parseCsv } from "../csv.js";

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
        Understøtter to formater:<br>
        <strong>ISE format</strong> — CSV eksporteret fra ISE Context Visibility
        (kolonner: <code>MACAddress</code>, <code>IdentityGroup</code>, <code>Description</code>,
        <code>CUSTOM.Owner</code>, <code>CUSTOM.Lokation</code>, <code>CUSTOM.AuthzVlan</code>).<br>
        <strong>Simpelt format</strong> — <code>mac,group,description,type,owner,lokation,authz_vlan</code>
        (header valgfri).<br>
        Format detekteres automatisk. Hvis <code>group</code> mangler bruges fallback-gruppen.
      </p>
      <div class="field">
        <label for="csv-file">CSV fil</label>
        <input type="file" id="csv-file" accept=".csv,text/csv,text/plain" />
      </div>
      <div class="field">
        <label for="csv-text">...eller indsæt CSV indhold direkte</label>
        <textarea id="csv-text" placeholder="mac,group,description,type,owner,lokation,authz_vlan
AA:BB:CC:DD:EE:01,Unknown,lab device,Printer,IT,kontor1,VLAN100
AA:BB:CC:DD:EE:02,Profiled,printer,Camera,Facilities,,VLAN200"></textarea>
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
    const { format, items } = parseCsv(text);
    parsed = items;
    result.innerHTML = "";
    if (!parsed.length) {
      preview.innerHTML = `<div class="alert info">Ingen rækker fundet.</div>`;
      importBtn.disabled = true;
      return;
    }
    const valid = parsed.filter((p) => p.valid).length;
    const invalid = parsed.length - valid;
    const hasCA = parsed.some((p) => p.endpointType || p.owner || p.lokation || p.authzVlan || p.authzAcl || p.platformType);
    preview.innerHTML = `
      <div class="alert info">
        Detekteret format: <strong>${format === "ise" ? "ISE CSV" : "Simpelt"}</strong> —
        ${parsed.length} rækker, <strong>${valid}</strong> gyldige, <strong>${invalid}</strong> ugyldige.
      </div>
      <div class="preview-table">
        <table>
          <thead>
            <tr>
              <th>#</th><th>MAC</th><th>Group</th><th>Description</th>
              ${hasCA ? "<th>Type</th><th>Owner</th><th>Lokation</th><th>AuthzVlan</th><th>AuthzACL</th><th>PlatformType</th>" : ""}
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
                  <td>${escapeHtml(p.endpointType)}</td>
                  <td>${escapeHtml(p.owner)}</td>
                  <td>${escapeHtml(p.lokation)}</td>
                  <td>${escapeHtml(p.authzVlan)}</td>
                  <td>${escapeHtml(p.authzAcl)}</td>
                  <td>${escapeHtml(p.platformType)}</td>
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
        const ca = {};
        let hasCA = false;
        if (p.endpointType) { ca.Type = p.endpointType; hasCA = true; }
        if (p.owner) { ca.Owner = p.owner; hasCA = true; }
        if (p.lokation) { ca.Lokation = p.lokation; hasCA = true; }
        if (p.authzVlan) { ca.AuthzVlan = p.authzVlan; hasCA = true; }
        if (p.authzAcl) { ca.AuthzACL = p.authzAcl; hasCA = true; }
        if (p.platformType) { ca.PlatformType = p.platformType; hasCA = true; }
        if (hasCA) item.custom_attributes = ca;
        return item;
      });

    result.innerHTML = `<div class="alert info">Importerer ${items.length} endpoints...</div>`;
    importBtn.disabled = true;
    try {
      const res = await api.bulkCreateEndpoints(items);
      const skipped = res.skipped || [];
      const alertClass = res.failed.length ? "info" : "success";
      result.innerHTML = `
        <div class="alert ${alertClass}">
          Oprettet: <strong>${res.succeeded.length}</strong> —
          skipped (findes allerede): <strong>${skipped.length}</strong> —
          fejlet: <strong>${res.failed.length}</strong>
        </div>
        <div class="result-list">
          <div>
            <h4 class="succeeded">Succeeded (${res.succeeded.length})</h4>
            <ul>${res.succeeded.map((m) => `<li>${escapeHtml(m)}</li>`).join("") || "<li>(ingen)</li>"}</ul>
          </div>
          <div>
            <h4 class="skipped">Skipped (${skipped.length})</h4>
            <ul>${skipped.map((m) => `<li>${escapeHtml(m)}</li>`).join("") || "<li>(ingen)</li>"}</ul>
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
