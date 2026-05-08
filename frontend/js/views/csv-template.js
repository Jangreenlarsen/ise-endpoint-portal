import { getCsvTemplate, setCsvTemplate, resetCsvTemplate, parseTemplateHeader, extendTemplateWithPortalColumns } from "../csv.js";

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export async function renderCsvTemplate(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">CSV Export Template</h2>
    </div>

    <div class="card">
      <h3>CSV Export Template</h3>
      <p class="hint">
        Definerer hvilke kolonner der inkluderes ved CSV-eksport fra Browse view.
        Importér en CSV-fil (kun header-rækken bruges) for at sætte en ny template.
      </p>
      <div id="csv-tpl-msg"></div>
      <div class="field">
        <label>Aktiv template (<span id="csv-tpl-count">0</span> kolonner)</label>
        <textarea id="csv-tpl-preview" rows="3" readonly
                  style="font-size:0.82rem;background:#f9fafb;"></textarea>
      </div>
      <div class="field">
        <label for="csv-tpl-file">Importér template fra CSV-fil</label>
        <input type="file" id="csv-tpl-file" accept=".csv,text/csv,text/plain" />
      </div>
      <div class="actions">
        <button type="button" id="csv-tpl-reset">Nulstil til standard</button>
      </div>
    </div>
  `;

  const csvTplMsg = container.querySelector("#csv-tpl-msg");
  const csvTplPreview = container.querySelector("#csv-tpl-preview");
  const csvTplCount = container.querySelector("#csv-tpl-count");

  function refreshTplPreview() {
    const tpl = getCsvTemplate();
    csvTplPreview.value = tpl.join(", ");
    csvTplCount.textContent = tpl.length;
  }
  refreshTplPreview();

  const csvTplFile = container.querySelector("#csv-tpl-file");
  csvTplFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const columns = parseTemplateHeader(text);
      if (!columns.length) {
        csvTplMsg.innerHTML = `<div class="alert error">Ingen kolonner fundet i filen — kontrollér at første linje er en header-række.</div>`;
        return;
      }
      const extended = extendTemplateWithPortalColumns(columns);
      setCsvTemplate(extended);
      refreshTplPreview();
      const added = extended.length - columns.length;
      const addedNote = added ? ` (+${added} portal-kolonner tilføjet)` : "";
      csvTplMsg.innerHTML = `<div class="alert success">Template importeret — ${extended.length} kolonner${addedNote}. Fremtidige exports bruger denne template.</div>`;
    } catch (err) {
      csvTplMsg.innerHTML = `<div class="alert error">Kunne ikke læse filen: ${esc(err.message)}</div>`;
    } finally {
      e.target.value = "";
    }
  });

  container.querySelector("#csv-tpl-reset").addEventListener("click", () => {
    resetCsvTemplate();
    csvTplFile.value = "";
    refreshTplPreview();
    csvTplMsg.innerHTML = `<div class="alert success">Template nulstillet til standard (${getCsvTemplate().length} kolonner).</div>`;
  });
}
