// Detector engine. Each detector is a cross-domain rule that emits Findings
// into the `finding` table. Idempotent: re-running upserts current matches
// (preserving first_seen, refreshing last_seen) and prunes findings that no
// longer hold, so the table always reflects the latest world state.
//
// Add a rule by appending to DETECTORS — no other wiring needed.
import { createHash } from "node:crypto";
import { prisma } from "../lib/db.js";

type FindingRow = {
  ruleKey: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  primaryNode: string;
  relatedNodes: string[];
  evidence: unknown;
  dataScope: string;
};

type Detector = {
  key: string;
  description: string;
  run: () => Promise<FindingRow[]>;
};

const fid = (ruleKey: string, primaryNode: string) =>
  createHash("sha1").update(`${ruleKey}|${primaryNode}`).digest("hex");

// ── Rule: toxic-triad ────────────────────────────────────────────────────
// An internet-facing (DMZ) asset that (a) has an exploitable vulnerability
// — KEV or known exploit available — and (b) is owned by a user without
// MFA. The combination is a directly walkable attack path, far more urgent
// than any of the three signals alone.
const toxicTriad: Detector = {
  key: "toxic-triad",
  description: "Internet-facing asset + exploitable vuln + owner without MFA",
  run: async () => {
    const rows = await prisma.$queryRaw<
      {
        primary_node: string;
        asset_name: string;
        exposure: string;
        owner_id: string;
        owner_name: string;
        data_scope: string;
        vulns: { vulnId: string; cve: string | null; severity: string | null; kev: boolean; exploitAvailable: boolean; cvss: number | null }[];
      }[]
    >`
      SELECT a.asset_id                       AS primary_node,
             arn.display_name                 AS asset_name,
             a.exposure                       AS exposure,
             u.user_id                        AS owner_id,
             urn.display_name                 AS owner_name,
             arn.data_scope                   AS data_scope,
             json_agg(json_build_object(
               'vulnId', v.vuln_id, 'cve', v.cve_id, 'severity', v.severity,
               'kev', v.kev, 'exploitAvailable', v.exploit_available, 'cvss', v.cvss_base
             ) ORDER BY v.kev DESC, v.cvss_base DESC NULLS LAST) AS vulns
      FROM dim_asset a
      JOIN node_ref  arn ON arn.node_id = a.asset_id
      JOIN rel_edge  fe  ON fe.src_node = a.asset_id AND fe.edge_type = 'HAS_FINDING'
      JOIN dim_vuln  v   ON v.vuln_id   = fe.dst_node
                         AND (v.kev = true OR v.exploit_available = true)
      JOIN rel_edge  oe  ON oe.dst_node = a.asset_id AND oe.edge_type = 'OWNS'
      JOIN dim_user  u   ON u.user_id   = oe.src_node AND u.mfa_enabled = false
      JOIN node_ref  urn ON urn.node_id = u.user_id
      WHERE a.exposure = 'DMZ'
      GROUP BY a.asset_id, arn.display_name, a.exposure,
               u.user_id, urn.display_name, arn.data_scope
    `;

    return rows.map((r) => {
      const hasKev = r.vulns.some((v) => v.kev);
      return {
        ruleKey: toxicTriad.key,
        severity: hasKev ? "CRITICAL" : "HIGH",
        title: `Internet-facing ${r.asset_name} has an exploitable vulnerability and an owner without MFA`,
        primaryNode: r.primary_node,
        relatedNodes: [r.owner_id, ...r.vulns.map((v) => v.vulnId)],
        evidence: {
          exposure: r.exposure,
          owner: { nodeId: r.owner_id, displayName: r.owner_name, mfaEnabled: false },
          vulnerabilities: r.vulns,
        },
        dataScope: r.data_scope,
      };
    });
  },
};

const DETECTORS: Detector[] = [toxicTriad];

async function main() {
  for (const d of DETECTORS) {
    const found = await d.run();
    const keepIds: string[] = [];

    for (const f of found) {
      const id = fid(f.ruleKey, f.primaryNode);
      keepIds.push(id);
      await prisma.finding.upsert({
        where: { findingId: id },
        create: {
          findingId: id,
          ruleKey: f.ruleKey,
          severity: f.severity,
          title: f.title,
          primaryNode: f.primaryNode,
          relatedNodes: f.relatedNodes,
          evidence: f.evidence as object,
          dataScope: f.dataScope,
        },
        update: {
          severity: f.severity,
          title: f.title,
          relatedNodes: f.relatedNodes,
          evidence: f.evidence as object,
          dataScope: f.dataScope,
          lastSeen: new Date(),
        },
      });
    }

    // Prune findings for this rule that no longer hold (resolved).
    const pruned = await prisma.finding.deleteMany({
      where: { ruleKey: d.key, findingId: { notIn: keepIds.length ? keepIds : ["__none__"] } },
    });

    console.log(
      `[${d.key}] ${found.length} active finding(s)` +
        (pruned.count ? `, ${pruned.count} pruned (resolved)` : ""),
    );
  }

  await prisma.$disconnect();
  console.log("detectors complete.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
