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
      <table>
        <thead>
          <tr>
            <th>Name (MAC)</th>
            <th style="width: 280px;">ID</th>
            <th>Description</th>
            <th style="width: 150px;">Actions</th>
          </tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="4" class="empty">Indlæser...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector("#tbody");
  const msg = container.querySelector("#msg");
  const count = container.querySelector("#count");
  const filterInput = container.querySelector("#filter");
  let allRows = [];

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">Ingen resultater</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr data-id="${escapeAttr(r.id)}">
        <td>${escapeAttr(r.name)}</td>
        <td><code style="font-size: 0.75rem;">${escapeAttr(r.id)}</code></td>
        <td><input type="text" class="desc-input" value="${escapeAttr(r.description || "")}" /></td>
        <td>
          <button class="save-btn">Save</button>
          <button class="danger del-btn">Del</button>
        </td>
      </tr>
    `).join("");
  }

  async function load() {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">Indlæser...</td></tr>`;
    msg.innerHTML = "";
    try {
      allRows = await api.listEndpoints(1, 100);
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
      (r.name || "").toLowerCase().includes(q),
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
      try {
        await api.updateEndpoint(id, { description });
        msg.innerHTML = `<div class="alert success">Opdateret ${id}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    } else if (e.target.classList.contains("del-btn")) {
      if (!confirm(`Slet endpoint ${id}?`)) return;
      try {
        await api.deleteEndpoint(id);
        tr.remove();
        allRows = allRows.filter((r) => r.id !== id);
        count.textContent = `${allRows.length} endpoints`;
        msg.innerHTML = `<div class="alert success">Slettet ${id}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="alert error">${err.message}</div>`;
      }
    }
  });

  container.querySelector("#refresh-btn").addEventListener("click", load);
  await load();
}
