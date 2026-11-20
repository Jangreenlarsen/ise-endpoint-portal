// Fiktive demodata til manualens skærmbilleder. Ingen rigtige MAC-adresser eller brugere.
const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86400_000).toISOString();

const base = {
  description: "", static_group: true, static_profile: false, portal_user: "", identity_store: "",
  identity_store_id: "", profile_id: "", status: "", cache_stale: false, guest_expery_date: "",
  guest_access_expire: "", psk_mode: false, psk_key: "", authz_acl: "", hypervision: "",
};

export const ENDPOINTS = [
  { ...base, id: "e01", mac: "00:1B:63:4A:10:01", name: "00:1B:63:4A:10:01", group_id: "g1", group_name: "Corp-Laptops", endpoint_type: "Laptop", owner: "mette.k", lokation: "Aarhus", authz_vlan: "110", platform_type: "Windows", registret_by: "admin", vendor: "Dell Inc.", profiler_name: "Windows11-Workstation", roles: ["IT"], active_status: "Aktiv", create_time: iso(120), update_time: iso(2) },
  { ...base, id: "e02", mac: "3C:22:FB:91:7E:02", name: "3C:22:FB:91:7E:02", group_id: "g1", group_name: "Corp-Laptops", endpoint_type: "Laptop", owner: "lars.p", lokation: "Aarhus", authz_vlan: "110", platform_type: "macOS", registret_by: "admin", vendor: "Apple, Inc.", profiler_name: "Apple-MacBook", roles: ["IT"], active_status: "Aktiv", create_time: iso(95), update_time: iso(5) },
  { ...base, id: "e03", mac: "00:0D:4B:22:31:03", name: "00:0D:4B:22:31:03", group_id: "g2", group_name: "IoT-Kameraer", endpoint_type: "Kamera", owner: "facility", lokation: "Lager 2", authz_vlan: "240", authz_acl: "DACL-IoT-Camera", platform_type: "Embedded", registret_by: "jens.h", vendor: "Axis Communications", profiler_name: "Axis-Device", roles: ["Facility"], active_status: "Aktiv", create_time: iso(300), update_time: iso(30) },
  { ...base, id: "e04", mac: "00:0D:4B:22:31:04", name: "00:0D:4B:22:31:04", group_id: "g2", group_name: "IoT-Kameraer", endpoint_type: "Kamera", owner: "facility", lokation: "Lager 2", authz_vlan: "240", authz_acl: "DACL-IoT-Camera", platform_type: "Embedded", registret_by: "jens.h", vendor: "Axis Communications", profiler_name: "Axis-Device", roles: ["Facility"], active_status: "Inaktiv", create_time: iso(300), update_time: iso(110) },
  { ...base, id: "e05", mac: "B8:27:EB:5C:44:05", name: "B8:27:EB:5C:44:05", group_id: "g3", group_name: "IoT-Sensorer", endpoint_type: "Sensor", owner: "drift", lokation: "Kontor 1.12", authz_vlan: "250", platform_type: "Linux", registret_by: "registrant1", vendor: "Raspberry Pi Foundation", profiler_name: "Linux-Workstation", roles: ["Facility"], psk_mode: true, psk_key: "Sensor-Kontor-112", active_status: "Aktiv", create_time: iso(40), update_time: iso(1) },
  { ...base, id: "e06", mac: "A4:83:E7:0F:12:06", name: "A4:83:E7:0F:12:06", group_id: "g4", group_name: "IPSK-Enheder", endpoint_type: "Smart-TV", owner: "kantine", lokation: "Kantine", authz_vlan: "260", platform_type: "Android", registret_by: "editor-psk1", vendor: "Samsung Electronics", profiler_name: "Samsung-Device", roles: ["Facility"], psk_mode: true, psk_key: "Kantine-TV-2026", active_status: "Aktiv", create_time: iso(14), update_time: iso(3) },
  { ...base, id: "e07", mac: "F0:9F:C2:33:A1:07", name: "F0:9F:C2:33:A1:07", group_id: "g5", group_name: "Printere", endpoint_type: "Printer", owner: "drift", lokation: "Aarhus", authz_vlan: "120", platform_type: "Embedded", registret_by: "admin", vendor: "HP Inc.", profiler_name: "HP-Printer", roles: ["IT"], active_status: "Aktiv", create_time: iso(400), update_time: iso(60) },
  { ...base, id: "e08", mac: "DA:A1:19:7C:55:08", name: "DA:A1:19:7C:55:08", group_id: "g6", group_name: "Gaest", endpoint_type: "Mobil", owner: "", lokation: "", authz_vlan: "900", platform_type: "iOS", registret_by: "selvregistrering", guest_registration: "Ja", vendor: "", profiler_name: "Apple-iPhone", roles: [], active_status: "Aktiv", guest_access_expire: iso(-25), create_time: iso(5), update_time: iso(5) },
  { ...base, id: "e09", mac: "00:50:56:AB:01:09", name: "00:50:56:AB:01:09", group_id: "g7", group_name: "Servere", endpoint_type: "Server", owner: "it-drift", lokation: "Datacenter", authz_vlan: "10", platform_type: "Linux", registret_by: "admin", vendor: "VMware, Inc.", profiler_name: "VMware-Device", roles: ["IT"], active_status: "Aktiv", create_time: iso(700), update_time: iso(90) },
  { ...base, id: "e10", mac: "00:1B:63:4A:10:10", name: "00:1B:63:4A:10:10", group_id: "g1", group_name: "Corp-Laptops", endpoint_type: "Laptop", owner: "sara.n", lokation: "København", authz_vlan: "110", platform_type: "Windows", registret_by: "admin", vendor: "Dell Inc.", profiler_name: "Windows11-Workstation", roles: ["IT"], active_status: "Aktiv", create_time: iso(60), update_time: iso(7) },
];

export const GROUPS = ["Corp-Laptops", "IoT-Kameraer", "IoT-Sensorer", "IPSK-Enheder", "Printere", "Gaest", "Servere"]
  .map((n, i) => ({ id: `g${i + 1}`, name: n, description: "" }));

const attr = (name: string, values: string[] = []) => ({ name, type: "String", values, description: "" });
export const CUSTOM_ATTRS = {
  attributes: [
    attr("Type", ["Laptop", "Kamera", "Sensor", "Printer", "Smart-TV", "Server", "Mobil"]),
    attr("Owner", ["mette.k", "lars.p", "sara.n", "facility", "drift", "kantine", "it-drift"]), attr("Lokation", ["Aarhus", "København", "Lager 2", "Kontor 1.12", "Kantine", "Datacenter"]),
    attr("AuthzVlan", ["10", "110", "120", "240", "250", "260", "900"]),
    attr("AuthzACL", ["DACL-IoT-Camera", "DACL-Printer"]),
    attr("PlatformType", ["Windows", "macOS", "Linux", "Embedded", "Android", "iOS"]),
    attr("RegistretBy"), attr("GuestRegistration"), attr("HypervisionRoles"),
    attr("PSK_Mode", ["true", "false"]), attr("PSK_Key"),
  ],
};

export const ROLES = { roles: [{ name: "IT", description: "IT-afdelingen" }, { name: "Facility", description: "Bygningsdrift" }] };

export const PSK_POLICY = {
  psk_type: "IPSK", show_key_in_table: false, min_length: 12, require_uppercase: true,
  require_numbers: true, require_special: false, disconnect_on_change: true,
};

export const TEMPLATES = {
  templates: [
    { id: "t1", name: "IoT-Kamera", description: "Axis-kameraer på lagre", group_id: "g2", group_id: "g2", group_name: "IoT-Kameraer", static_group_assignment: true, custom_attributes: { Type: "Kamera", AuthzVlan: "240", AuthzACL: "DACL-IoT-Camera", PlatformType: "Embedded" }, visible_to: [] },
    { id: "t2", name: "IPSK-sensor", description: "Sensorer med egen nøgle", group_id: "g4", group_id: "g4", group_name: "IPSK-Enheder", static_group_assignment: true, custom_attributes: { Type: "Sensor", AuthzVlan: "250", PSK_Mode: "true" }, visible_to: [] },
  ],
};

export const DASHBOARD = {
  circuit_breaker: { state: 0, state_label: "ISE svarer normalt" },
  endpoints: { total: 4812 },
  cache: { hit_rate_pct: 97.4, hits: 18233, misses: 486, stale_serves: 12, disk_loaded_at_startup: true },
  prewarm: { scan_number: 212, total_endpoints: 4812, last_full_scan_age_s: 140, scanning: false, scan_source: "openapi_list", last_scan_duration_s: 6.2 },
  sessions: { active: 1630 },
  recent_events: [
    { ts: iso(0.01), actor_username: "editor-psk1", action: "endpoint.update", resource_type: "endpoint", resource_id: "A4:83:E7:0F:12:06" },
    { ts: iso(0.05), actor_username: "registrant1", action: "endpoint.create", resource_type: "endpoint", resource_id: "B8:27:EB:5C:44:05" },
    { ts: iso(0.2), actor_username: "selvregistrering", action: "endpoint.create", resource_type: "endpoint", resource_id: "DA:A1:19:7C:55:08" },
    { ts: iso(0.4), actor_username: "admin", action: "endpoint.coa", resource_type: "bulk", resource_id: "" },
  ],
};

export function trends() {
  const labels: string[] = [];
  const added: number[] = [];
  const removed: number[] = [];
  for (let i = 29; i >= 0; i--) {
    labels.push(new Date(now - i * 86400_000).toISOString().slice(0, 10));
    added.push(8 + Math.round(6 * Math.abs(Math.sin(i / 3))));
    removed.push(2 + Math.round(4 * Math.abs(Math.cos(i / 4))));
  }
  return {
    snapshot: { total: 4812, laa: 611, laa_pct: 12.7 },
    labels, added, removed, net: added.map((a, i) => a - removed[i]),
    days: labels.map((d, i) => ({ date: d, added: added[i], removed: removed[i], net: added[i] - removed[i], total: 4500 + i * 10 })),
  };
}

export const DIAG_QUICK = {
  overall: "ok",
  checks: [
    { name: "ISE ERS API", status: "ok", message: "Svarer (42 ms)" },
    { name: "ISE Open API", status: "ok", message: "Svarer (55 ms)" },
    { name: "Cache", status: "ok", message: "4812 endpoints, varm" },
    { name: "pxGrid", status: "ok", message: "Forbundet" },
  ],
};

export const ISE_CONN = {
  nodes: [
    { host: "ise-pan01.example.lan", role: "primary", status: "up", last_latency_ms: 42 },
    { host: "ise-psn01.example.lan", role: "read", status: "up", last_latency_ms: 38 },
  ],
};
