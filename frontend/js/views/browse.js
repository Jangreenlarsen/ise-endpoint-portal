import { api } from "../api.js";

function esc(s) {
  return (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export async function renderBrowse(container) {
  container.innerHTML = `
    <h2>Browse / Edit endpoints</h2>
    <div class="card">
      <div class="toolbar">
        <button id="refresh-btn">Refresh</button>
        <input type="text" id="filter" placeholder="Filter (MAC, owner, lokation...)"
               style="padding:0.4rem 0.6rem;border:1px solid #d1d5db;border-radius:3px;min-width:220px;" />
        <div class="spacer"></div>
        <span id="count" class="hint"></span>
      </div>
      <div id="msg"></div>
      <div class="browse-table-wrap">
        <table>
          <thead>
            <tr>
              <th>MAC</th>
              <th>Group</th>
              <th>Description</th>
              <th>Owner</th>
              <th>Lokation</th>
              <th>AuthzVlan</th>
              <th style="width:120px;">Actions</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="7" class="empty">Indlæser...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = container.querySelector("#tbody");
  const msg = container.querySelector("#msg");
  const count = container.querySelector("#count");
  const filterInput = container.querySelector("#filter");
  let allRows = [];
  let groups = [];
  let caValues = { Owner: [], Lokation: [], AuthzVlan: [] };

  function optionsHtml(values, selected) {
    const opts = [`<option value="">—</option>`];
    for (const v of values) {
      const sel = v === selected ? " selected" : "";
      opts.push(`<option value="${esc(v)}"${sel}>${esc(v)}</option>`);
    }
    return opts.join("");
  }

  function groupOptionsHtml(selectedId) {
    const opts = [`<option value="">— ingen —</option>`];
    for (const g of groups) {
      const sel = g.id === selectedId ? " selected" : "";
      opts.push(`<option value="${esc(g.id)}"${sel}>${esc(g.name)}</option>`);
    }
    return opts.join("");
  }

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">Ingen resultater</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr data-id="${esc(r.id)}">
        <td class="mac-cell">${esc(r.mac || r.name)}</td>
        <td><select class="grp-select">${groupOptionsHtml(r.group_id)}</select></td>
        <td><input type="text" class="desc-input" value="${esc(r.description || "")}" /></td>
        <td><select class="ca-owner">${optionsHtml(caValues.Owner, r.owner)}</select></td>
        <td><select class="ca-lokation">${optionsHtml(caValues.Lokation, r.lokation)}</select></td>
        <td><select class="ca-authzvlan">${optionsHtml(caValues.AuthzVlan, r.authz_vlan)}</select></td>
        <td>
          <button class="save-btn small">Save</button>
          <button class="danger small del-btn">Del</button>
        </td>
      </tr>
    `).join("");
  }

  async function load() {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Henter detaljer fra ISE...</td></tr>`;
    msg.innerHTML = "";
    try {
      const [caData, grps, details] = await Promise.all([
        api.listCustomAttributes(),
        api.listGroups(),
        api.listEndpointDetails(1, 100),
      ]);
      groups = grps;
      for (const a of caData.attributes) {
        if (a.name in caValues) caValues[a.name] = a.values;
      }
      allRows = details;
      count.textContent = `${allRows.length} endpoints`;
      renderRows(allRows);
    } catch (err) {
      msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      tbody.innerHTML = "";
    }
  }

  filterInput.addEventListener("input", () => {
    const q = filterInput.value.toLowerCase().trim();
    const filtered = allRows.filter((r) =>
      (r.name || "").toLowerCase().includes(q) ||
      (r.mac || "").toLowerCase().includes(q) ||
      (r.owner || "").toLowerCase().includes(q) ||
      (r.lokation || "").toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q) ||
      (r.group_name || "").toLowerCase().includes(q),
    );
    renderRows(filtered);
    count.textContent = `${filtered.length} / ${allRows.length} endpoints`;
  });

  tbody.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;

    if (e.target.classList.contains("save-btn")) {
      const description = tr.querySelector(".desc-input").value;
      const group_id = tr.querySelector(".grp-select").value;
      const owner = tr.querySelector(".ca-owner").value;
      const lokation = tr.querySelector(".ca-lokation").value;
      const authzVlan = tr.querySelector(".ca-authzvlan").value;

      const payload = {
        description,
        group_id: group_id || null,
        custom_attributes: {
          Owner: owner,
          Lokation: lokation,
          AuthzVlan: authzVlan,
        },
      };

      try {
        await api.updateEndpoint(id, payload);
        const mac = tr.querySelector(".mac-cell").textContent;
        // Update local cache
        const row = allRows.find((r) => r.id === id);
        if (row) {
          row.description = description;
          row.group_id = group_id;
          row.owner = owner;
          row.lokation = lokation;
          row.authz_vlan = authzVlan;
        }
        msg.innerHTML = `<div class="alert success">Opdateret ${mac}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    } else if (e.target.classList.contains("del-btn")) {
      const mac = tr.querySelector(".mac-cell").textContent;
      if (!confirm(`Slet endpoint ${mac}?`)) return;
      try {
        await api.deleteEndpoint(id);
        tr.remove();
        allRows = allRows.filter((r) => r.id !== id);
        count.textContent = `${allRows.length} endpoints`;
        msg.innerHTML = `<div class="alert success">Slettet ${mac}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    }
  });

  container.querySelector("#refresh-btn").addEventListener("click", load);
  await load();
}
