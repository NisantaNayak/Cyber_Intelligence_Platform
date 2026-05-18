// Generates ~1000 entities per domain across all six domains, written as
// Snowflake STG-shaped fixtures. Multi-source overlap on assets so entity
// resolution still collapses duplicates. The curated demo records
// (jdoe / asmith / LAPTOP-JDOE-01 / CVE-2024-3094) are preserved as the
// first rows so the smoke test keeps passing.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const N = 1000;
const SEED = resolve(process.cwd(), "seed");
mkdirSync(SEED, { recursive: true });
const pad = (i: number) => String(i).padStart(4, "0");
const w = (f: string, d: unknown[]) => {
  writeFileSync(resolve(SEED, f), JSON.stringify(d, null, 2));
  console.log(`seed/${f}: ${d.length} rows`);
};

const DEVICE = ["Computer", "Server", "Appliance", "Mobile", "Network Device"];
const SEV = ["Critical", "High", "Medium", "Low"];
const STATUS = ["Open", "Investigating", "Contained", "Closed"];
const ZONES = ["Corporate", "Production", "DMZ", "Restricted"];

type Asset = { hostname: string; serial: string; mac: string; ip: string; type: string; owner: string };

// --- build the logical asset list (demo first) ---
const assets: Asset[] = [];
const demo: Asset[] = [
  { hostname: "LAPTOP-JDOE-01", serial: "SN-AAA-111", mac: "AA:BB:CC:00:11:22", ip: "10.0.5.21", type: "Computer", owner: "jdoe" },
  { hostname: "SRV-APP-07",     serial: "SN-SRV-007", mac: "AA:BB:CC:99:00:07", ip: "10.0.9.7",  type: "Server",   owner: "jdoe" },
  { hostname: "WS-ASMITH-02",   serial: "SN-BBB-222", mac: "DD:EE:FF:22:33:44", ip: "10.0.6.40", type: "Computer", owner: "asmith" },
];
assets.push(...demo);
for (let i = demo.length + 1; i <= N; i++) {
  const o = i % 5;
  assets.push({
    hostname: `HOST-${pad(i)}`,
    serial: `SN-GEN-${pad(i)}`,
    mac: `0A:1B:2C:${pad(i).slice(0, 2)}:${pad(i).slice(2)}:0${i % 10}`,
    ip: `10.${(i >> 8) & 255}.${i & 255}.${i % 254 + 1}`,
    type: DEVICE[i % DEVICE.length],
    owner: o === 0 ? "" : `user${pad(i)}`, // ~20% unowned
  });
}

// --- asset sources (overlap drives entity resolution) ---
const cs: unknown[] = [], cmdb: unknown[] = [], qualys: unknown[] = [], fs: unknown[] = [];
assets.forEach((a, idx) => {
  const i = idx + 1;
  const loaded = "2026-05-15T01:00:00Z";
  cmdb.push({ ci_id: `CI-${pad(i)}`, name: a.hostname.toLowerCase(), ip: a.ip,
    mac_address: a.mac.replace(/:/g, "-"), serial: a.serial, ci_class: a.type,
    owned_by: a.owner, department: a.owner ? (i % 2 ? "Finance" : "Engineering") : "Unassigned",
    environment: ZONES[i % ZONES.length], loaded_at: loaded });
  if (i % 10 < 7)
    cs.push({ device_id: `CS-${pad(i)}`, hostname: a.hostname, local_ip: a.ip, mac: a.mac,
      serial_number: a.serial, platform: i % 2 ? "Windows" : "Linux",
      os_version: i % 2 ? "Windows 11 Pro" : "Ubuntu 22.04", agent_version: "7.14.0",
      last_seen: "2026-05-14T22:00:00Z", loaded_at: loaded });
  if (i % 2 === 0)
    qualys.push({ qualys_asset_id: `QLY-${pad(i)}`, dns_name: `${a.hostname}.corp.com`,
      ip_address: a.ip, netbios_mac: a.mac.replace(/:/g, "").toLowerCase(),
      asset_serial: a.serial, os: i % 2 ? "Windows 11 Pro 64-bit" : "Ubuntu 22.04 LTS",
      last_scan: "2026-05-13T08:00:00Z", loaded_at: loaded });
  if (i % 5 === 0)
    fs.push({ endpoint_id: `FS-${pad(i)}`, host: a.hostname, ip: a.ip, mac: a.mac,
      serial_no: a.serial, device_class: a.type.toLowerCase(), compliant: i % 3 !== 0,
      loaded_at: loaded });
});

// --- users (demo first) ---
const users: unknown[] = [
  { okta_id: "OKTA-0001", login: "jdoe@corp.com", email: "john.doe@corp.com", firstName: "John", lastName: "Doe", userType: "Employee", department: "Finance", manager: "OKTA-0009", mfa_enrolled: true, status: "ACTIVE", loaded_at: "2026-05-15T01:15:00Z" },
  { okta_id: "OKTA-0002", login: "asmith@corp.com", email: "alice.smith@corp.com", firstName: "Alice", lastName: "Smith", userType: "Employee", department: "Engineering", manager: "OKTA-0009", mfa_enrolled: false, status: "ACTIVE", loaded_at: "2026-05-15T01:15:00Z" },
];
for (let i = users.length + 1; i <= N; i++)
  users.push({ okta_id: `OKTA-${pad(i)}`, login: `user${pad(i)}@corp.com`,
    email: `user${pad(i)}@corp.com`, firstName: `User${i}`, lastName: "Gen",
    userType: i % 7 === 0 ? "Contractor" : "Employee",
    department: i % 2 ? "Finance" : "Engineering", manager: "OKTA-0009",
    mfa_enrolled: i % 3 !== 0, status: i % 11 === 0 ? "SUSPENDED" : "ACTIVE",
    loaded_at: "2026-05-15T01:15:00Z" });

// --- vulnerabilities (one finding per asset, demo CVEs first) ---
const vulns: unknown[] = [
  { finding_id: "QF-0001", asset_serial: "SN-AAA-111", cve: "CVE-2024-3094", cvss_base: 10.0, severity: "Critical", kev: true, exploit_available: true, title: "XZ Utils backdoor", first_detected: "2026-05-10T00:00:00Z", loaded_at: "2026-05-15T01:20:00Z" },
  { finding_id: "QF-0002", asset_serial: "SN-SRV-007", cve: "CVE-2023-1234", cvss_base: 7.5, severity: "High", kev: false, exploit_available: false, title: "OpenSSL buffer overflow", first_detected: "2026-05-11T00:00:00Z", loaded_at: "2026-05-15T01:20:00Z" },
];
for (let i = vulns.length + 1; i <= N; i++) {
  const a = assets[(i - 1) % assets.length];
  const sev = SEV[i % SEV.length];
  vulns.push({ finding_id: `QF-${pad(i)}`, asset_serial: a.serial,
    cve: `CVE-2026-${pad(i)}`, cvss_base: [9.8, 7.5, 5.3, 3.1][i % 4],
    severity: sev, kev: i % 50 === 0, exploit_available: i % 7 === 0,
    title: `${sev} finding ${i}`, first_detected: "2026-05-12T00:00:00Z",
    loaded_at: "2026-05-15T01:20:00Z" });
}

// --- network segments (1:1 with an asset for a bounded edge count) ---
const network: unknown[] = [];
for (let i = 1; i <= N; i++) {
  const a = assets[(i - 1) % assets.length];
  network.push({ net_id: `SEG-${pad(i)}`, name: `VLAN-${100 + (i % 50)} / ${ZONES[i % ZONES.length]}`,
    cidr: `10.${(i >> 8) & 255}.${i & 255}.0/24`, zone: ZONES[i % ZONES.length],
    member_serial: a.serial, loaded_at: "2026-05-15T01:25:00Z" });
}

// --- incidents (affect an asset) ---
const incident: unknown[] = [];
for (let i = 1; i <= N; i++) {
  const a = assets[(i - 1) % assets.length];
  incident.push({ incident_id: `INC-${pad(i)}`, title: `Incident ${i}: suspicious activity on ${a.hostname}`,
    severity: SEV[i % SEV.length], status: STATUS[i % STATUS.length],
    affected_serial: a.serial, opened_at: "2026-05-13T00:00:00Z",
    loaded_at: "2026-05-15T01:30:00Z" });
}

// --- risks (derived from a vulnerability) ---
const risk: unknown[] = [];
for (let i = 1; i <= N; i++) {
  const v = vulns[(i - 1) % vulns.length] as any;
  risk.push({ risk_id: `RISK-${pad(i)}`, title: `Risk ${i} from ${v.cve}`,
    score: [90, 70, 45, 20][i % 4], category: ["Operational", "Compliance", "Strategic"][i % 3],
    cve: v.cve, loaded_at: "2026-05-15T01:35:00Z" });
}

w("asset_crowdstrike.json", cs);
w("asset_cmdb.json", cmdb);
w("asset_qualys.json", qualys);
w("asset_forescout.json", fs);
w("user_okta.json", users);
w("vuln_qualys.json", vulns);
w("network_inventory.json", network);
w("incident_servicenow.json", incident);
w("risk_register.json", risk);
console.log(
  `\nGenerated ~${N}/domain. Asset observations: ${cs.length + cmdb.length + qualys.length + fs.length} -> ~${assets.length} golden assets after resolution.`,
);
