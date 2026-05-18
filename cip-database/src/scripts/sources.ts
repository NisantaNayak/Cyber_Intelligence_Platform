// Single source of truth for the raw-data placeholders. Each entry maps a
// data/<name>.xlsx file to seed/<name>.json (what the transform consumes).
// `fields` defines the columns; `sample` rows seed the xlsx template with a
// coherent demo scenario (jdoe / LAPTOP-JDOE-01 / CVE-2024-3094) so even a
// bare template produces a working graph.
export type SourceDef = {
  file: string; // base name (no extension) -> data/<file>.xlsx & seed/<file>.json
  fields: string[];
  sample: Record<string, unknown>[];
};

export const SOURCES: SourceDef[] = [
  {
    file: "asset_crowdstrike",
    fields: ["device_id", "hostname", "local_ip", "mac", "serial_number", "platform", "os_version", "agent_version", "last_seen", "loaded_at"],
    sample: [
      { device_id: "CS-0001", hostname: "LAPTOP-JDOE-01", local_ip: "10.0.5.21", mac: "AA:BB:CC:00:11:22", serial_number: "SN-AAA-111", platform: "Windows", os_version: "Windows 11 Pro", agent_version: "7.14.0", last_seen: "2026-05-14T22:00:00Z", loaded_at: "2026-05-15T01:00:00Z" },
    ],
  },
  {
    file: "asset_cmdb",
    fields: ["ci_id", "name", "ip", "mac_address", "serial", "ci_class", "owned_by", "department", "environment", "loaded_at"],
    sample: [
      { ci_id: "CI-0001", name: "laptop-jdoe-01", ip: "10.0.5.21", mac_address: "AA-BB-CC-00-11-22", serial: "SN-AAA-111", ci_class: "Computer", owned_by: "jdoe", department: "Finance", environment: "Corporate", loaded_at: "2026-05-15T01:05:00Z" },
    ],
  },
  {
    file: "asset_qualys",
    fields: ["qualys_asset_id", "dns_name", "ip_address", "netbios_mac", "asset_serial", "os", "last_scan", "loaded_at"],
    sample: [
      { qualys_asset_id: "QLY-0001", dns_name: "LAPTOP-JDOE-01.corp.com", ip_address: "10.0.5.21", netbios_mac: "aabbcc001122", asset_serial: "SN-AAA-111", os: "Windows 11 Pro 64-bit", last_scan: "2026-05-13T08:00:00Z", loaded_at: "2026-05-15T01:10:00Z" },
    ],
  },
  {
    file: "asset_forescout",
    fields: ["endpoint_id", "host", "ip", "mac", "serial_no", "device_class", "compliant", "loaded_at"],
    sample: [
      { endpoint_id: "FS-0001", host: "WS-ASMITH-02", ip: "10.0.6.40", mac: "DD:EE:FF:22:33:44", serial_no: "SN-BBB-222", device_class: "workstation", compliant: true, loaded_at: "2026-05-15T01:12:00Z" },
    ],
  },
  {
    file: "user_okta",
    fields: ["okta_id", "login", "email", "firstName", "lastName", "userType", "department", "manager", "mfa_enrolled", "status", "loaded_at"],
    sample: [
      { okta_id: "OKTA-0001", login: "jdoe@corp.com", email: "john.doe@corp.com", firstName: "John", lastName: "Doe", userType: "Employee", department: "Finance", manager: "OKTA-0009", mfa_enrolled: true, status: "ACTIVE", loaded_at: "2026-05-15T01:15:00Z" },
    ],
  },
  {
    file: "vuln_qualys",
    fields: ["finding_id", "asset_serial", "cve", "cvss_base", "severity", "kev", "exploit_available", "title", "first_detected", "loaded_at"],
    sample: [
      { finding_id: "QF-0001", asset_serial: "SN-AAA-111", cve: "CVE-2024-3094", cvss_base: 10.0, severity: "Critical", kev: true, exploit_available: true, title: "XZ Utils backdoor", first_detected: "2026-05-10T00:00:00Z", loaded_at: "2026-05-15T01:20:00Z" },
    ],
  },
  {
    file: "network_inventory",
    fields: ["net_id", "name", "cidr", "zone", "member_serial", "loaded_at"],
    sample: [
      { net_id: "SEG-0001", name: "VLAN-110 / Corporate", cidr: "10.0.5.0/24", zone: "Corporate", member_serial: "SN-AAA-111", loaded_at: "2026-05-15T01:25:00Z" },
    ],
  },
  {
    file: "incident_servicenow",
    fields: ["incident_id", "title", "severity", "status", "affected_serial", "opened_at", "loaded_at"],
    sample: [
      { incident_id: "INC-0001", title: "Suspicious activity on LAPTOP-JDOE-01", severity: "High", status: "Investigating", affected_serial: "SN-AAA-111", opened_at: "2026-05-13T00:00:00Z", loaded_at: "2026-05-15T01:30:00Z" },
    ],
  },
  {
    file: "risk_register",
    fields: ["risk_id", "title", "score", "category", "cve", "loaded_at"],
    sample: [
      { risk_id: "RISK-0001", title: "Risk from CVE-2024-3094", score: 90, category: "Operational", cve: "CVE-2024-3094", loaded_at: "2026-05-15T01:35:00Z" },
    ],
  },
];
