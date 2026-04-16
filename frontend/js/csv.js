/**
 * Shared CSV utilities for ISE-compatible import/export.
 *
 * ISE 3.4 CSV format:
 *   - RFC 4180: double-quoted fields, commas inside quotes
 *   - Custom attributes prefixed with CUSTOM. (e.g. CUSTOM.Owner)
 *   - Values sometimes wrapped in single quotes: "'value'"
 *   - 100+ columns — most empty
 */

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

// Full ISE 3.4 CSV header (from Context Visibility export)
const ISE_COLUMNS = [
  "MACAddress","EndPointPolicy","IdentityGroup",
  "AuthenticationIdentityStore","AuthenticationMethod",
  "AllowedProtocolMatchedRule","AuthorizationPolicyMatchedRule",
  "SelectedAuthorizationProfiles","Description",
  "DeviceRegistrationStatus","BYODRegistration","Device Type",
  "EmailAddress","ip","ipv6","FirstName","host-name","LastName",
  "LogicalProfile","Total Certainty Factor","MDMCompliant",
  "MDMCompliantFailureReason","MDMDiskEncrypted","MDMJailBroken",
  "MDMPinLockSet","MDMServerID","MDMServerName","MDMEnrolled",
  "NADAddress","Location","NAS-IP-Address","NAS-IPv6-Address",
  "NAS-Port-Id","UserName","NetworkDeviceName","operating-system",
  "operating-system-result","PostureOS","OS Version","OUI",
  "PortalUser","PosturePolicyMatched","PostureStatus","User-Name",
  "StaticAssignment","StaticGroupAssignment","UpdateTime",
  "MessageCode","FailureReason","UserType","EndpointIdentityGroup",
  "EndpointOperatingSystem","MDMOSVersion","PortalUser.FirstName",
  "PortalUser.LastName","PortalUser.EmailAddress",
  "PortalUser.PhoneNumber","PortalUser.GuestType",
  "PortalUser.GuestStatus","PortalUser.Location",
  "PortalUser.GuestSponsor","PortalUser.CreationType","AUPAccepted",
  "EndPointGroup","EndPointProfilerServer","cts-security-group",
  "AntiVirusInstalled","AntiSpywareInstalled","Failure_Reason",
  "PassiveID_Username","DeviceCompliance","AD-Operating-System",
  "Certificate Expiration Date","Certificate Issue Date",
  "Certificate Issuer Name","User-Fetch-Department",
  "User-Fetch-Telephone","User-Fetch-Job-Title",
  "User-Fetch-Organizational-Unit","User-Fetch-CountryName",
  "User-Fetch-LocalityName","User-Fetch-StateOrProvinceName",
  "User-Fetch-StreetAddress","User-Fetch-First-Name",
  "User-Fetch-Email","User-Fetch-Last-Name","SSID","DTLSSupport",
  "Portal.Name","RegistrationTimeStamp","AnomalousBehaviour",
  "PhoneID","posturePassCondition","postureFailCondition","MDM-GUID",
  "epid","PreviousMACAddress","DEVICE_INFO_MODEL_NAME",
  "DEVICE_INFO_OS_VERSION","DEVICE_INFO_MANUFACTURER_NAME",
  "DEVICE_INFO_VENDOR_TYPE","DEVICE_INFO_MODEL_NUM",
  "DEVICE_INFO_FIRMWARE_VERSION","DEVICE_INFO_HW_MODEL",
  "MFCInfoHardwareManufacturer","MFCInfoHardwareModel",
  "MFCInfoOperatingSystem","MFCInfoEndpointType",
  "MFCInfoEndpointPolicy","CUSTOM.AuthzVlan","CUSTOM.Lokation",
  "CUSTOM.Owner","EA-deviceType","EA-hardwareManufacturer",
  "EA-hardwareModel","EA-operatingSystem","EA-trustScore",
  "EA-groupHierarchy","EA-aiAnomalyResult","EA-natAnomalyResult",
  "EA-mfcAnomalyResult","EA-cmdbAssetTag","EA-cmdbModelCategory",
  "EA-cmdbModel","EA-cmdbLocation","EA-cmdbDepartment",
  "EA-cmdbDisplayName","EA-cmdbManagedBy","EA-cmdbSerialNumber",
  "EA-concurrentMacAddressResult",
];

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
  const customAuthz = idx["custom.authzvlan"];
  const customLok = idx["custom.lokation"];
  const customOwner = idx["custom.owner"];

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseRow(lines[i]);
    const mac = (fields[macCol] || "").trim();
    if (!mac) continue;
    const groupName = stripQuotes((fields[groupCol] || "").trim());
    const description = stripQuotes((fields[descCol] || "").trim());
    const authzVlan = stripQuotes((fields[customAuthz] != null ? fields[customAuthz] : "").trim());
    const lokation = stripQuotes((fields[customLok] != null ? fields[customLok] : "").trim());
    const owner = stripQuotes((fields[customOwner] != null ? fields[customOwner] : "").trim());
    items.push({
      mac, groupName, description, owner, lokation, authzVlan,
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
      owner: parts[3] || "",
      lokation: parts[4] || "",
      authzVlan: parts[5] || "",
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
 * Fills in: MACAddress, IdentityGroup, Description, StaticAssignment,
 * StaticGroupAssignment, CUSTOM.AuthzVlan, CUSTOM.Lokation, CUSTOM.Owner.
 * All other columns are empty.
 */
export function toIseCsv(rows) {
  // Build column index for the fields we populate
  const colIdx = {};
  ISE_COLUMNS.forEach((c, i) => { colIdx[c] = i; });

  const headerLine = ISE_COLUMNS.map(csvQuote).join(",");
  const dataLines = rows.map((r) => {
    const cells = new Array(ISE_COLUMNS.length).fill("");
    cells[colIdx["MACAddress"]] = r.mac || r.name || "";
    cells[colIdx["IdentityGroup"]] = r.group_name || "";
    cells[colIdx["Description"]] = r.description || "";
    cells[colIdx["StaticAssignment"]] = r.group_name ? "true" : "false";
    cells[colIdx["StaticGroupAssignment"]] = r.group_name ? "true" : "false";
    cells[colIdx["CUSTOM.AuthzVlan"]] = r.authz_vlan || "";
    cells[colIdx["CUSTOM.Lokation"]] = r.lokation || "";
    cells[colIdx["CUSTOM.Owner"]] = r.owner || "";
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
