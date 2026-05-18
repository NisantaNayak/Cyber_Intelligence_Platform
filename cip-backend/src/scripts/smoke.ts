// End-to-end check against the loaded DB, calling the tRPC routers directly
// (no HTTP). Verifies UC1 (federated search) and UC2 (user -> asset -> vuln).
import { appRouter } from "../routers/index.js";
import { prisma } from "../lib/db.js";

async function main() {
  const caller = appRouter.createCaller({
    auth: { subject: "smoke", dataScope: "*" },
  });

  console.log("\n=== UC1: federated search 'jdoe' ===");
  const s = await caller.search.query({ q: "jdoe" });
  console.dir(s, { depth: 5 });

  const userHit = s.domains
    .find((d) => d.entityType === "USER")
    ?.top[0];
  if (!userHit) throw new Error("UC1 failed: no USER hit for 'jdoe'");

  console.log("\n=== UC1: federated search 'LAPTOP' (cross-domain) ===");
  console.dir(await caller.search.query({ q: "LAPTOP" }), { depth: 4 });

  console.log(`\n=== UC2: pivot from user ${userHit.displayName} (depth 2) ===`);
  const graph = await caller.pivot.expand({ nodeId: userHit.nodeId, depth: 2 });
  console.dir(graph.summary, { depth: 4 });
  for (const e of graph.edges) {
    const sn = graph.nodes.find((n) => n.nodeId === e.srcNode)?.displayName;
    const dn = graph.nodes.find((n) => n.nodeId === e.dstNode)?.displayName;
    console.log(`  ${sn} --${e.edgeType}--> ${dn}`);
  }
  const hasAsset = graph.nodes.some((n) => n.entityType === "ASSET");
  const hasVuln = graph.nodes.some((n) => n.entityType === "VULN");
  if (!hasAsset || !hasVuln)
    throw new Error("UC2 failed: expected ASSET and VULN reachable from user");

  console.log("\n=== Drill-through: entity.get on first asset ===");
  const asset = graph.nodes.find((n) => n.entityType === "ASSET")!;
  const detail = await caller.entity.get({ nodeId: asset.nodeId });
  console.log("golden:", detail.golden);
  console.log("source tabs:", detail.sourceTabs.map((t) => t.tab));
  console.log("relationships:", detail.relationships);

  console.log("\n✅ Smoke passed: UC1 + UC2 + drill-through all work.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ Smoke failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
