/**
 * Shared CSV utilities for ISE-compatible import/export.
 *
 * ISE 3.4 CSV format:
 *   - RFC 4180: double-quoted fields, commas inside quotes
 *   - Custom attributes prefixed with CUSTOM. (e.g. CUSTOM.Owner)
 *   - Values sometimes wrapped in single quotes: "'value'"
 *   - Column template is user-configurable (default: 34 ISE columns)
 */

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

const CSV_TEMPLATE_KEY = "ise_portal_csv_template";

// Portal-only default template — kun kolonner portalen selv udfylder.
const DEFAULT_TEMPLATE = [
  "MACAddress","IdentityGroup","Description","StaticGroupAssignment",
  "CUSTOM.Type","CUSTOM.Owner","CUSTOM.Lokation","CUSTOM.AuthzVlan",
  "CUSTOM.AuthzACL","CUSTOM.HypervisionISEPortal",
];

/**
 * Get the active CSV export template (from localStorage or default).
 */
export function getCsvTemplate() {
  try {
    const stored = localStorage.getItem(CSV_TEMPLATE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_TEMPLATE;
}

/**
 * Save a custom CSV export template to localStorage.
 */
export function setCsvTemplate(columns) {
  localStorage.setItem(CSV_TEMPLATE_KEY, JSON.stringify(columns));
}

/**
 * Extend an imported template with any portal-default columns it is missing.
 * Imported order is preserved; missing portal columns are appended.
 */
export function extendTemplateWithPortalColumns(columns) {
  const existing = new Set(columns);
  const extra = DEFAULT_TEMPLATE.filter((c) => !existing.has(c));
  return [...columns, ...extra];
}

/**
 * Reset to the built-in default template.
 */
export function resetCsvTemplate() {
  localStorage.removeItem(CSV_TEMPLATE_KEY);
}

/**
 * Parse a CSV header line and return the column names as an array.
 * Useful for importing a template from a file.
 */
export function parseTemplateHeader(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  return parseRow(lines[0]).map((h) => h.trim()).filter(Boolean);
}

/**
 * Parse an RFC 4180 CSV line respecting quoted fields.
 */
function parseRow(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i >= line.length) { fields.push(""); break; }
    if (line[i] === '"') {
      let val = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += line[i];
          i++;
        }
      }
      fields.push(val);
      if (i < line.length && line[i] === ',') i++; // skip comma
    } else {
      const next = line.indexOf(',', i);
      if (next === -1) {
        fields.push(line.substring(i));
        break;
      }
      fields.push(line.substring(i, next));
      i = next + 1;
    }
  }
  return fields;
}

/**
 * Strip surrounding single quotes from ISE values: "'value'" → "value"
 */
function stripQuotes(s) {
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Detect CSV format and parse into normalised rows.
 *
 * Supports:
 *   1. ISE format — header contains "MACAddress"
 *   2. Simple format — mac,group,description,owner,lokation,authz_vlan
 *
 * Returns: { format: "ise"|"simple", items: [...] }
 */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { format: "simple", items: [] };

  const firstRow = parseRow(lines[0]);
  const headerLower = firstRow.map((h) => h.trim().toLowerCase());

  // Detect ISE format by looking for "macaddress" header
  if (headerLower.includes("macaddress")) {
    return { format: "ise", items: parseIseFormat(headerLower, firstRow, lines) };
  }

  // Detect simple format with header
  if (headerLower[0] === "mac" || headerLower.includes("mac")) {
    return { format: "simple", items: parseSimpleFormat(lines, 1) };
  }

  // No header — try simple format from first line
  return { format: "simple", items: parseSimpleFormat(lines, 0) };
}

function parseIseFormat(headerLower, headerRaw, lines) {
  // Build column index map
  const idx = {};
  headerLower.forEach((h, i) => { idx[h] = i; });

  const macCol = idx["macaddress"];
  const groupCol = idx["identitygroup"];
  const descCol = idx["description"];
  const customType = idx["custom.type"];
  const customAuthz = idx["custom.authzvlan"];
  const customAuthzAcl = idx["custom.authzacl"];
  const customLok = idx["custom.lokation"];
  const customOwner = idx["custom.owner"];

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseRow(lines[i]);
    const mac = (fields[macCol] || "").trim();
    if (!mac) continue;
    const groupName = stripQuotes((fields[groupCol] || "").trim());
    const description = stripQuotes((fields[descCol] || "").trim());
    const endpointType = stripQuotes((fields[customType] != null ? fields[customType] : "").trim());
    const authzVlan = stripQuotes((fields[customAuthz] != null ? fields[customAuthz] : "").trim());
    const authzAcl = stripQuotes((fields[customAuthzAcl] != null ? fields[customAuthzAcl] : "").trim());
    const lokation = stripQuotes((fields[customLok] != null ? fields[customLok] : "").trim());
    const owner = stripQuotes((fields[customOwner] != null ? fields[customOwner] : "").trim());
    items.push({
      mac, groupName, description, endpointType, owner, lokation, authzVlan, authzAcl,
      valid: MAC_RE.test(mac),
    });
  }
  return items;
}

function parseSimpleFormat(lines, startIdx) {
  const items = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = parseRow(lines[i]).map((p) => p.trim());
    items.push({
      mac: parts[0] || "",
      groupName: parts[1] || "",
      description: parts[2] || "",
      endpointType: parts[3] || "",
      owner: parts[4] || "",
      lokation: parts[5] || "",
      authzVlan: parts[6] || "",
      authzAcl: parts[7] || "",
      valid: MAC_RE.test((parts[0] || "").trim()),
    });
  }
  return items;
}

/**
 * Quote a value for CSV output (RFC 4180).
 */
function csvQuote(val) {
  const s = val == null ? "" : String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return '"' + s + '"';
}

/**
 * Generate ISE-compatible CSV from endpoint detail rows.
 *
 * Uses the active CSV template (user-configurable, persisted in localStorage).
 * Fills in known fields; all other columns are empty.
 */
export function toIseCsv(rows) {
  const template = getCsvTemplate();

  // Build column index for the fields we populate
  const colIdx = {};
  template.forEach((c, i) => { colIdx[c] = i; });

  const headerLine = template.map(csvQuote).join(",");
  const dataLines = rows.map((r) => {
    const cells = new Array(template.length).fill("");
    if ("MACAddress" in colIdx) cells[colIdx["MACAddress"]] = r.mac || r.name || "";
    if ("IdentityGroup" in colIdx) cells[colIdx["IdentityGroup"]] = r.group_name || "";
    if ("Description" in colIdx) cells[colIdx["Description"]] = r.description || "";
    if ("StaticAssignment" in colIdx) cells[colIdx["StaticAssignment"]] = r.group_name ? "true" : "false";
    if ("StaticGroupAssignment" in colIdx) cells[colIdx["StaticGroupAssignment"]] = r.group_name ? "true" : "false";
    if ("CUSTOM.Type" in colIdx) cells[colIdx["CUSTOM.Type"]] = r.endpoint_type || "";
    if ("CUSTOM.AuthzVlan" in colIdx) cells[colIdx["CUSTOM.AuthzVlan"]] = r.authz_vlan || "";
    if ("CUSTOM.AuthzACL" in colIdx) cells[colIdx["CUSTOM.AuthzACL"]] = r.authz_acl || "";
    if ("CUSTOM.Lokation" in colIdx) cells[colIdx["CUSTOM.Lokation"]] = r.lokation || "";
    if ("CUSTOM.Owner" in colIdx) cells[colIdx["CUSTOM.Owner"]] = r.owner || "";
    if ("CUSTOM.HypervisionISEPortal" in colIdx) cells[colIdx["CUSTOM.HypervisionISEPortal"]] = r.hypervision || "";
    return cells.map(csvQuote).join(",");
  });

  return headerLine + "\n" + dataLines.join("\n") + "\n";
}

/**
 * Trigger a file download in the browser.
 */
export function downloadCsv(csvString, filename) {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { MAC_RE };
