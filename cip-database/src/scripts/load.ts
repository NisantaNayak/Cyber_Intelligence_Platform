// Loads build/publish/*.json into Postgres. Production-equivalent contract
// (Snowflake PUBLISH -> Postgres). Full-refresh snapshot load using chunked
// createMany inside one transaction (the "load-and-swap" pattern), FK-safe
// and idempotent — re-running yields the same state.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../lib/db.js";

const OUT = resolve(process.cwd(), "build", "publish");
const load = (f: string) =>
  JSON.parse(readFileSync(resolve(OUT, f), "utf8")) as any[];
const d = (v: any) => (v ? new Date(v) : null);
const CHUNK = 1000;

async function createChunked(tx: any, model: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += CHUNK)
    await tx[model].createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
}

async function main() {
  const nodeRef = load("node_ref.json");
  const dimAsset = load("dim_asset.json").map((a) => ({
    assetId: a.asset_id, hostname: a.hostname, ipAddress: a.ip_address,
    macAddress: a.mac_address, deviceType: a.device_type, ownerDept: a.owner_dept,
    exposure: a.exposure, firstSeen: d(a.first_seen), lastSeen: d(a.last_seen),
  }));
  const dimUser = load("dim_user.json").map((u) => ({
    userId: u.user_id, email: u.email, upn: u.upn, employeeType: u.employee_type,
    managerId: u.manager_id, mfaEnabled: u.mfa_enabled,
  }));
  const dimVuln = load("dim_vuln.json").map((v) => ({
    vulnId: v.vuln_id, cveId: v.cve_id, cvssBase: v.cvss_base, severity: v.severity,
    exploitAvailable: v.exploit_available, kev: v.kev,
  }));
  const sourceDetail = load("source_detail.json").map((s) => ({
    obsId: s.obs_id, nodeId: s.node_id, sourceSystem: s.source_system,
    sourceNativeId: s.source_native_id, rawData: s.raw_data, loadedAt: d(s.loaded_at)!,
  }));
  const relEdge = load("rel_edge.json").map((e) => ({
    edgeId: e.edge_id, srcNode: e.src_node, dstNode: e.dst_node, edgeType: e.edge_type,
    confidence: e.confidence, sourceSystem: e.source_system,
    validFrom: d(e.valid_from)!, validTo: d(e.valid_to),
  }));
  const nodeRows = nodeRef.map((n) => ({
    nodeId: n.node_id, entityType: n.entity_type, domainPk: n.domain_pk,
    displayName: n.display_name, criticality: n.criticality, dataScope: n.data_scope,
  }));
  const searchRows = load("search_doc.json").map((s) => ({
    nodeId: s.node_id, entityType: s.entity_type, displayName: s.display_name,
    body: s.body, dataScope: s.data_scope,
  }));
  const dimSource = load("dim_source.json").map((s) => ({
    sourceSystem: s.source_system, domain: s.domain,
    fieldMapping: s.field_mapping, displayConfig: s.display_config, priority: s.priority,
  }));
  const attributeCatalog = load("attribute_catalog.json").map((a) => ({
    domain: a.domain, sourceSystem: a.source_system, attributeKey: a.attribute_key,
    dataType: a.data_type, piiClass: a.pii_class, indexed: a.indexed,
  }));

  await prisma.$transaction(
    async (tx) => {
      // delete children -> parents
      await tx.searchDoc.deleteMany();
      await tx.relEdge.deleteMany();
      await tx.sourceDetail.deleteMany();
      await tx.dimAsset.deleteMany();
      await tx.dimUser.deleteMany();
      await tx.dimVuln.deleteMany();
      await tx.attributeCatalog.deleteMany();
      await tx.dimSource.deleteMany();
      await tx.nodeRef.deleteMany();

      // insert parents -> children
      await createChunked(tx, "nodeRef", nodeRows);
      await createChunked(tx, "dimAsset", dimAsset);
      await createChunked(tx, "dimUser", dimUser);
      await createChunked(tx, "dimVuln", dimVuln);
      await createChunked(tx, "sourceDetail", sourceDetail);
      await createChunked(tx, "relEdge", relEdge);
      await createChunked(tx, "dimSource", dimSource);
      await createChunked(tx, "attributeCatalog", attributeCatalog);
      await createChunked(tx, "searchDoc", searchRows);

      await tx.loadState.upsert({
        where: { tableName: "ALL" },
        create: { tableName: "ALL", watermark: new Date().toISOString() },
        update: { watermark: new Date().toISOString(), updatedAt: new Date() },
      });
    },
    { timeout: 180_000, maxWait: 15_000 },
  );

  const byType: Record<string, number> = {};
  for (const n of nodeRef) byType[n.entity_type] = (byType[n.entity_type] ?? 0) + 1;
  console.log("Loaded nodes by domain:", byType);
  console.log(
    `Total: ${nodeRef.length} nodes, ${relEdge.length} edges, ` +
    `${sourceDetail.length} source records, ${searchRows.length} search docs.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
