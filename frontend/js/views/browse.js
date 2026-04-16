import { api } from "../api.js";

function escapeAttr(s) {
  return (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export async function renderBrowse(container) {
  container.innerHTML = `
    <h2>Browse / Edit endpoints</h2>
    <div class="card">
      <div class="toolbar">
        <button id="refresh-btn">Refresh</button>
        <input type="text" id="filter" placeholder="Filter MAC..." style="padding: 0.4rem 0.6rem; border: 1px solid #d1d5db; border-radius: 3px;" />
        <div class="spacer"></div>
        <span id="count" class="hint"></span>
      </div>
      <div id="msg"></div>
      <div class="browse-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name (MAC)</th>
              <th>Description</th>
              <th>Owner</th>
              <th>Location</th>
              <th>AuthzVlan</th>
              <th style="width: 130px;">Actions</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="6" class="empty">Indlæser...</td></tr>
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
  let caValues = { Owner: [], Location: [], AuthzVlan: [] };

  function optionsHtml(values, selected) {
    const opts = [`<option value="">—</option>`];
    for (const v of values) {
      const sel = v === selected ? " selected" : "";
      opts.push(`<option value="${escapeAttr(v)}"${sel}>${escapeAttr(v)}</option>`);
    }
    return opts.join("");
  }

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Ingen resultater</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr data-id="${escapeAttr(r.id)}">
        <td>${escapeAttr(r.name)}</td>
        <td><input type="text" class="desc-input" value="${escapeAttr(r.description || "")}" /></td>
        <td><select class="ca-owner">${optionsHtml(caValues.Owner, r.owner)}</select></td>
        <td><select class="ca-location">${optionsHtml(caValues.Location, r.location)}</select></td>
        <td><select class="ca-authzvlan">${optionsHtml(caValues.AuthzVlan, r.authz_vlan)}</select></td>
        <td>
          <button class="save-btn small">Save</button>
          <button class="danger small del-btn">Del</button>
        </td>
      </tr>
    `).join("");
  }

  async function load() {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Indlæser detaljer fra ISE...</td></tr>`;
    msg.innerHTML = "";
    try {
      // Load custom attribute allowed values and endpoint details in parallel
      const [caData, details] = await Promise.all([
        api.listCustomAttributes(),
        api.listEndpointDetails(1, 100),
      ]);
      for (const a of caData.attributes) {
        caValues[a.name] = a.values;
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
      (r.owner || "").toLowerCase().includes(q) ||
      (r.location || "").toLowerCase().includes(q),
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
      const owner = tr.querySelector(".ca-owner").value;
      const location = tr.querySelector(".ca-location").value;
      const authzVlan = tr.querySelector(".ca-authzvlan").value;
      const payload = { description };
      // Include custom attributes if any value is set
      if (owner || location || authzVlan) {
        payload.custom_attributes = {
          Owner: owner,
          Location: location,
          AuthzVlan: authzVlan,
        };
      }
      try {
        await api.updateEndpoint(id, payload);
        // Update local data
        const row = allRows.find((r) => r.id === id);
        if (row) {
          row.description = description;
          row.owner = owner;
          row.location = location;
          row.authz_vlan = authzVlan;
        }
        msg.innerHTML = `<div class="alert success">Opdateret ${tr.querySelector("td").textContent}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    } else if (e.target.classList.contains("del-btn")) {
      const name = tr.querySelector("td").textContent;
      if (!confirm(`Slet endpoint ${name}?`)) return;
      try {
        await api.deleteEndpoint(id);
        tr.remove();
        allRows = allRows.filter((r) => r.id !== id);
        count.textContent = `${allRows.length} endpoints`;
        msg.innerHTML = `<div class="alert success">Slettet ${name}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    }
  });

  container.querySelector("#refresh-btn").addEventListener("click", load);
  await load();
}
