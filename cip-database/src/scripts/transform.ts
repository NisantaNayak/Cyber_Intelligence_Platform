// LOCAL STAND-IN FOR SNOWFLAKE  (RAW -> STG -> INT -> PUBLISH)
// ------------------------------------------------------------------
// In production this logic lives in dbt models inside Snowflake and the
// output is the PUBLISH schema. Here we read seed fixtures and emit
// PUBLISH-shaped JSON into build/publish/. The loader is identical to prod.
//
// Pipeline: normalize per source -> entity resolution (match keys +
// union-find) -> survivorship -> build node_ref / dim_* / rel_edge /
// source_detail / search_doc.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const SEED = resolve(process.cwd(), "seed");
const OUT = resolve(process.cwd(), "build", "publish");
mkdirSync(OUT, { recursive: true });

const read = (f: string) =>
  JSON.parse(readFileSync(resolve(SEED, f), "utf8")) as any[];

// Deterministic UUID (v5-style) so re-runs produce stable ids without an
// external xref store — the local equivalent of INT.*_XREF.
function uuid(ns: string, name: string): string {
  const h = createHash("sha1").update(`${ns}:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${(
    (parseInt(h.slice(16, 18), 16) & 0x3f) |
    0x80
  )
    .toString(16)
    .padStart(2, "0")}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

// --- match-key normalizers (INT.MATCH_RULES) ---
const normHost = (s?: string) =>
  (s ?? "").toLowerCase().trim().split(".")[0] || undefined;
const normMac = (s?: string) =>
  (s ?? "").toLowerCase().replace(/[^a-f0-9]/g, "") || undefined;
const normSerial = (s?: string) =>
  (s ?? "").toUpperCase().trim() || undefined;

type AssetObs = {
  sourceSystem: string;
  sourceNativeId: string;
  raw: any;
  loadedAt: string;
  keys: { serial?: string; mac?: string; host?: string };
  fields: Record<string, any>;
};

// --- per-source normalization (STG.ASSET__*) ---
function normalizeAssets(): AssetObs[] {
  const obs: AssetObs[] = [];

  for (const r of read("asset_crowdstrike.json"))
    obs.push({
      sourceSystem: "CROWDSTRIKE",
      sourceNativeId: r.device_id,
      raw: r,
      loadedAt: r.loaded_at,
      keys: { serial: normSerial(r.serial_number), mac: normMac(r.mac), host: normHost(r.hostname) },
      fields: { hostname: r.hostname, ip: r.local_ip, mac: r.mac, osVersion: r.os_version, lastSeen: r.last_seen },
    });

  for (const r of read("asset_cmdb.json"))
    obs.push({
      sourceSystem: "CMDB",
      sourceNativeId: r.ci_id,
      raw: r,
      loadedAt: r.loaded_at,
      keys: { serial: normSerial(r.serial), mac: normMac(r.mac_address), host: normHost(r.name) },
      fields: { hostname: r.name, ip: r.ip, mac: r.mac_address, deviceType: r.ci_class, ownerDept: r.department, ownedBy: r.owned_by, exposure: r.environment },
    });

  for (const r of read("asset_qualys.json"))
    obs.push({
      sourceSystem: "QUALYS",
      sourceNativeId: r.qualys_asset_id,
      raw: r,
      loadedAt: r.loaded_at,
      keys: { serial: normSerial(r.asset_serial), mac: normMac(r.netbios_mac), host: normHost(r.dns_name) },
      fields: { hostname: r.dns_name, ip: r.ip_address, osVersion: r.os, lastSeen: r.last_scan },
    });

  for (const r of read("asset_forescout.json"))
    obs.push({
      sourceSystem: "FORESCOUT",
      sourceNativeId: r.endpoint_id,
      raw: r,
      loadedAt: r.loaded_at,
      keys: { serial: normSerial(r.serial_no), mac: normMac(r.mac), host: normHost(r.host) },
      fields: { hostname: r.host, ip: r.ip, mac: r.mac, deviceType: r.device_class },
    });

  return obs;
}

// --- entity resolution: union-find over match keys (serial|mac|host) ---
function resolveAssets(obs: AssetObs[]) {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    while (parent.get(x)! !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: number, b: number) => parent.set(find(a), find(b));

  obs.forEach((_, i) => parent.set(i, i));
  const byKey = new Map<string, number>();
  obs.forEach((o, i) => {
    for (const k of ["serial", "mac", "host"] as const) {
      const v = o.keys[k];
      if (!v) continue;
      const tag = `${k}:${v}`;
      if (byKey.has(tag)) union(i, byKey.get(tag)!);
      else byKey.set(tag, i);
    }
  });

  const clusters = new Map<number, AssetObs[]>();
  obs.forEach((o, i) => {
    const root = find(i);
    (clusters.get(root) ?? clusters.set(root, []).get(root)!).push(o);
  });
  return [...clusters.values()];
}

// survivorship: highest-priority source with a non-null value wins.
const ASSET_PRIORITY: Record<string, number> = {
  CMDB: 4, CROWDSTRIKE: 3, QUALYS: 2, FORESCOUT: 1,
};
function survive(cluster: AssetObs[], field: string) {
  return [...cluster]
    .filter((o) => o.fields[field] != null && o.fields[field] !== "")
    .sort((a, b) => ASSET_PRIORITY[b.sourceSystem] - ASSET_PRIORITY[a.sourceSystem])[0]
    ?.fields[field];
}

function main() {
  const nodeRef: any[] = [];
  const dimAsset: any[] = [];
  const dimUser: any[] = [];
  const dimVuln: any[] = [];
  const sourceDetail: any[] = [];
  const relEdge: any[] = [];
  const searchDoc: any[] = [];

  const obsId = (s: string, n: string) => uuid("obs", `${s}:${n}`);
  const edgeId = (a: string, b: string, t: string, s: string) =>
    uuid("edge", `${a}|${b}|${t}|${s}`);

  // ---- ASSETS ----
  const assetObs = normalizeAssets();
  const clusters = resolveAssets(assetObs);
  const serialToAsset = new Map<string, string>();
  const ownerToAssets = new Map<string, Set<string>>();

  for (const cluster of clusters) {
    // canonical id from the strongest stable key (serial > mac > host)
    const k =
      cluster.map((c) => c.keys.serial).find(Boolean) ??
      cluster.map((c) => c.keys.mac).find(Boolean) ??
      cluster.map((c) => c.keys.host).find(Boolean)!;
    const assetId = uuid("asset", k);
    const hostname = survive(cluster, "hostname");
    const displayName = (hostname ?? k).toString().split(".")[0];

    nodeRef.push({
      node_id: assetId, entity_type: "ASSET", domain_pk: assetId,
      display_name: displayName, criticality: 50, data_scope: "*",
    });
    dimAsset.push({
      asset_id: assetId,
      hostname: hostname ? hostname.toString().split(".")[0] : null,
      ip_address: survive(cluster, "ip") ?? null,
      mac_address: survive(cluster, "mac") ?? null,
      device_type: survive(cluster, "deviceType") ?? null,
      owner_dept: survive(cluster, "ownerDept") ?? null,
      exposure: survive(cluster, "exposure") ?? null,
      first_seen: null,
      last_seen: survive(cluster, "lastSeen") ?? null,
    });

    const ids = new Set<string>();
    for (const o of cluster) {
      if (o.keys.serial) {
        serialToAsset.set(o.keys.serial, assetId);
        ids.add(o.keys.serial);
      }
      const ob = o.fields.ownedBy;
      if (ob) {
        if (!ownerToAssets.has(ob)) ownerToAssets.set(ob, new Set());
        ownerToAssets.get(ob)!.add(assetId);
      }
      sourceDetail.push({
        obs_id: obsId(o.sourceSystem, o.sourceNativeId),
        node_id: assetId,
        source_system: o.sourceSystem,
        source_native_id: o.sourceNativeId,
        raw_data: o.raw,
        loaded_at: o.loadedAt,
      });
    }
    // MAC is searched as an identifier: index it in every common format
    // (hex-only, colon, dash) plus whatever raw form survived, so a query
    // typed in any notation hits via the body trigram/ILIKE path.
    const macHex = cluster.map((c) => c.keys.mac).find(Boolean);
    const macForms = macHex
      ? [macHex, macHex.match(/.{2}/g)!.join(":"), macHex.match(/.{2}/g)!.join("-")]
      : [];
    searchDoc.push({
      node_id: assetId, entity_type: "ASSET", display_name: displayName,
      body: [
        displayName,
        ...ids,
        survive(cluster, "ip"),
        survive(cluster, "osVersion"),
        survive(cluster, "mac"),
        ...macForms,
      ].filter(Boolean).join(" "),
      data_scope: "*",
    });
  }

  // ---- USERS ----
  const loginToUser = new Map<string, string>();
  for (const r of read("user_okta.json")) {
    const userId = uuid("user", r.login.toLowerCase());
    const display = `${r.firstName} ${r.lastName}`;
    loginToUser.set(r.login.split("@")[0].toLowerCase(), userId);
    nodeRef.push({
      node_id: userId, entity_type: "USER", domain_pk: userId,
      display_name: display, criticality: 40, data_scope: "*",
    });
    dimUser.push({
      user_id: userId, email: r.email, upn: r.login,
      employee_type: r.userType, manager_id: null, mfa_enabled: !!r.mfa_enrolled,
    });
    sourceDetail.push({
      obs_id: obsId("OKTA", r.okta_id), node_id: userId,
      source_system: "OKTA", source_native_id: r.okta_id,
      raw_data: r, loaded_at: r.loaded_at,
    });
    searchDoc.push({
      node_id: userId, entity_type: "USER", display_name: display,
      // include tokenized identifiers (login/email local-parts) so a search
      // for "jdoe" matches even though to_tsvector keeps emails as one token
      body: [
        display, r.login, r.email, r.department,
        r.login?.split("@")[0], r.email?.split("@")[0],
      ].filter(Boolean).join(" "),
      data_scope: "*",
    });
  }

  // ---- VULNERABILITIES + edges ----
  const seenVuln = new Map<string, string>();
  for (const r of read("vuln_qualys.json")) {
    let vulnId = seenVuln.get(r.cve);
    if (!vulnId) {
      vulnId = uuid("vuln", r.cve);
      seenVuln.set(r.cve, vulnId);
      nodeRef.push({
        node_id: vulnId, entity_type: "VULN", domain_pk: vulnId,
        display_name: r.cve,
        criticality: r.kev ? 95 : Math.round((r.cvss_base ?? 0) * 10),
        data_scope: "*",
      });
      dimVuln.push({
        vuln_id: vulnId, cve_id: r.cve, cvss_base: r.cvss_base,
        severity: r.severity, exploit_available: !!r.exploit_available, kev: !!r.kev,
      });
      searchDoc.push({
        node_id: vulnId, entity_type: "VULN", display_name: r.cve,
        body: [r.cve, r.title, r.severity, r.kev ? "KEV" : ""].filter(Boolean).join(" "),
        data_scope: "*",
      });
    }
    sourceDetail.push({
      obs_id: obsId("QUALYS_VULN", r.finding_id), node_id: vulnId,
      source_system: "QUALYS", source_native_id: r.finding_id,
      raw_data: r, loaded_at: r.loaded_at,
    });
    const assetId = serialToAsset.get(normSerial(r.asset_serial)!);
    if (assetId)
      relEdge.push({
        edge_id: edgeId(assetId, vulnId, "HAS_FINDING", "QUALYS"),
        src_node: assetId, dst_node: vulnId, edge_type: "HAS_FINDING",
        confidence: 1.0, source_system: "QUALYS",
        valid_from: r.first_detected, valid_to: null,
      });
  }

  // ---- USER --OWNS--> ASSET (derived from CMDB owned_by) ----
  for (const [owner, assets] of ownerToAssets) {
    const userId = loginToUser.get(owner.toLowerCase());
    if (!userId) continue;
    for (const assetId of assets)
      relEdge.push({
        edge_id: edgeId(userId, assetId, "OWNS", "CMDB"),
        src_node: userId, dst_node: assetId, edge_type: "OWNS",
        confidence: 0.9, source_system: "CMDB",
        valid_from: "2026-05-15T00:00:00Z", valid_to: null,
      });
  }

  // ---- NETWORK segments (Asset --CONNECTS_ON--> Network) ----
  for (const r of read("network_inventory.json")) {
    const netId = uuid("network", r.net_id);
    nodeRef.push({
      node_id: netId, entity_type: "NETWORK", domain_pk: netId,
      display_name: r.name, criticality: 30, data_scope: "*",
    });
    sourceDetail.push({
      obs_id: obsId("NETWORK_INV", r.net_id), node_id: netId,
      source_system: "NETWORK_INVENTORY", source_native_id: r.net_id,
      raw_data: r, loaded_at: r.loaded_at,
    });
    searchDoc.push({
      node_id: netId, entity_type: "NETWORK", display_name: r.name,
      body: [r.net_id, r.name, r.cidr, r.zone].filter(Boolean).join(" "),
      data_scope: "*",
    });
    const assetId = serialToAsset.get(normSerial(r.member_serial)!);
    if (assetId)
      relEdge.push({
        edge_id: edgeId(assetId, netId, "CONNECTS_ON", "NETWORK_INVENTORY"),
        src_node: assetId, dst_node: netId, edge_type: "CONNECTS_ON",
        confidence: 0.8, source_system: "NETWORK_INVENTORY",
        valid_from: r.loaded_at, valid_to: null,
      });
  }

  // ---- INCIDENTS (Incident --AFFECTS--> Asset) ----
  for (const r of read("incident_servicenow.json")) {
    const incId = uuid("incident", r.incident_id);
    const sevScore: Record<string, number> = { Critical: 90, High: 70, Medium: 45, Low: 20 };
    nodeRef.push({
      node_id: incId, entity_type: "INCIDENT", domain_pk: incId,
      display_name: r.incident_id, criticality: sevScore[r.severity] ?? 40, data_scope: "*",
    });
    sourceDetail.push({
      obs_id: obsId("SERVICENOW", r.incident_id), node_id: incId,
      source_system: "SERVICENOW", source_native_id: r.incident_id,
      raw_data: r, loaded_at: r.loaded_at,
    });
    searchDoc.push({
      node_id: incId, entity_type: "INCIDENT", display_name: r.incident_id,
      body: [r.incident_id, r.title, r.severity, r.status].filter(Boolean).join(" "),
      data_scope: "*",
    });
    const assetId = serialToAsset.get(normSerial(r.affected_serial)!);
    if (assetId)
      relEdge.push({
        edge_id: edgeId(incId, assetId, "AFFECTS", "SERVICENOW"),
        src_node: incId, dst_node: assetId, edge_type: "AFFECTS",
        confidence: 1.0, source_system: "SERVICENOW",
        valid_from: r.opened_at, valid_to: null,
      });
  }

  // ---- RISKS (Risk --DERIVED_FROM--> Vulnerability) ----
  for (const r of read("risk_register.json")) {
    const riskId = uuid("risk", r.risk_id);
    nodeRef.push({
      node_id: riskId, entity_type: "RISK", domain_pk: riskId,
      display_name: r.risk_id, criticality: r.score ?? 50, data_scope: "*",
    });
    sourceDetail.push({
      obs_id: obsId("RISK_REGISTER", r.risk_id), node_id: riskId,
      source_system: "RISK_REGISTER", source_native_id: r.risk_id,
      raw_data: r, loaded_at: r.loaded_at,
    });
    searchDoc.push({
      node_id: riskId, entity_type: "RISK", display_name: r.risk_id,
      body: [r.risk_id, r.title, r.category, r.cve].filter(Boolean).join(" "),
      data_scope: "*",
    });
    const vulnId = seenVuln.get(r.cve);
    if (vulnId)
      relEdge.push({
        edge_id: edgeId(riskId, vulnId, "DERIVED_FROM", "RISK_REGISTER"),
        src_node: riskId, dst_node: vulnId, edge_type: "DERIVED_FROM",
        confidence: 0.9, source_system: "RISK_REGISTER",
        valid_from: r.loaded_at, valid_to: null,
      });
  }

  // ---- config tables ----
  const dimSource = [
    { source_system: "CROWDSTRIKE", domain: "ASSET", field_mapping: {}, display_config: { tab: "EDR" }, priority: 3 },
    { source_system: "CMDB", domain: "ASSET", field_mapping: {}, display_config: { tab: "CMDB" }, priority: 4 },
    { source_system: "QUALYS", domain: "ASSET", field_mapping: {}, display_config: { tab: "Vuln Scan" }, priority: 2 },
    { source_system: "FORESCOUT", domain: "ASSET", field_mapping: {}, display_config: { tab: "NAC" }, priority: 1 },
    { source_system: "OKTA", domain: "USER", field_mapping: {}, display_config: { tab: "IAM" }, priority: 5 },
    { source_system: "QUALYS_VULN", domain: "VULN", field_mapping: {}, display_config: { tab: "Findings" }, priority: 5 },
    { source_system: "NETWORK_INVENTORY", domain: "NETWORK", field_mapping: {}, display_config: { tab: "Network" }, priority: 5 },
    { source_system: "SERVICENOW", domain: "INCIDENT", field_mapping: {}, display_config: { tab: "Incident" }, priority: 5 },
    { source_system: "RISK_REGISTER", domain: "RISK", field_mapping: {}, display_config: { tab: "Risk" }, priority: 5 },
  ];
  const attributeCatalog = [
    { domain: "ASSET", source_system: "CMDB", attribute_key: "owned_by", data_type: "string", pii_class: "internal", indexed: false },
    { domain: "USER", source_system: "OKTA", attribute_key: "email", data_type: "string", pii_class: "pii", indexed: true },
  ];

  const files: Record<string, any[]> = {
    "node_ref.json": nodeRef,
    "dim_asset.json": dimAsset,
    "dim_user.json": dimUser,
    "dim_vuln.json": dimVuln,
    "source_detail.json": sourceDetail,
    "rel_edge.json": relEdge,
    "dim_source.json": dimSource,
    "attribute_catalog.json": attributeCatalog,
    "search_doc.json": searchDoc,
  };
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(resolve(OUT, name), JSON.stringify(data, null, 2));
    console.log(`PUBLISH/${name}: ${data.length} rows`);
  }
  console.log(`\nResolved ${assetObs.length} asset observations -> ${clusters.length} golden assets.`);
  console.log("Transform complete ->", OUT);
  void readdirSync;
}

main();
