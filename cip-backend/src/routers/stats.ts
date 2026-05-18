// Domain KPIs for the dashboard band. All counts are RBAC-scoped via
// node_ref.data_scope and cached briefly (scope is part of the cache key).
import { router, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/db.js";
import { cached } from "../lib/redis.js";

type Row = Record<string, any>;

export const statsRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const scope = ctx.auth.dataScope;

    return cached(`stats:${scope}`, 30, async () => {
      // node counts per domain (the spine, scope-filtered)
      const domains = await prisma.$queryRaw<Row[]>`
        SELECT entity_type, COUNT(*)::int AS count
        FROM node_ref
        WHERE (${scope} = '*' OR data_scope = ${scope})
        GROUP BY entity_type`;

      const assetsByType = await prisma.$queryRaw<Row[]>`
        SELECT COALESCE(a.device_type, 'Unknown') AS type, COUNT(*)::int AS count
        FROM dim_asset a JOIN node_ref n ON n.node_id = a.asset_id
        WHERE (${scope} = '*' OR n.data_scope = ${scope})
        GROUP BY 1 ORDER BY 2 DESC`;

      const vulnsBySeverity = await prisma.$queryRaw<Row[]>`
        SELECT COALESCE(v.severity, 'Unknown') AS severity,
               COUNT(*)::int AS count,
               SUM(CASE WHEN v.kev THEN 1 ELSE 0 END)::int AS kev
        FROM dim_vuln v JOIN node_ref n ON n.node_id = v.vuln_id
        WHERE (${scope} = '*' OR n.data_scope = ${scope})
        GROUP BY 1 ORDER BY 2 DESC`;

      const usersByMfa = await prisma.$queryRaw<Row[]>`
        SELECT COALESCE(u.mfa_enabled, false) AS mfa, COUNT(*)::int AS count
        FROM dim_user u JOIN node_ref n ON n.node_id = u.user_id
        WHERE (${scope} = '*' OR n.data_scope = ${scope})
        GROUP BY 1`;

      const [{ count: edges }] = await prisma.$queryRaw<Row[]>`
        SELECT COUNT(*)::int AS count FROM rel_edge WHERE valid_to IS NULL`;
      const [{ count: sources }] = await prisma.$queryRaw<Row[]>`
        SELECT COUNT(*)::int AS count FROM dim_source`;

      const totals: Record<string, number> = {};
      for (const d of domains) totals[d.entity_type] = d.count;

      return {
        totals, // { ASSET: n, USER: n, VULN: n, ... }
        assetsByType: assetsByType.map((r) => ({ type: r.type, count: r.count })),
        vulnsBySeverity: vulnsBySeverity.map((r) => ({
          severity: r.severity,
          count: r.count,
          kev: r.kev,
        })),
        kevTotal: vulnsBySeverity.reduce((s, r) => s + (r.kev ?? 0), 0),
        usersMfa: {
          enabled: usersByMfa.find((r) => r.mfa === true)?.count ?? 0,
          disabled: usersByMfa.find((r) => r.mfa === false)?.count ?? 0,
        },
        edges,
        sources,
      };
    });
  }),

  // Asset-domain analytics for the drill-down page.
  assets: protectedProcedure.query(async ({ ctx }) => {
    const scope = ctx.auth.dataScope;

    return cached(`stats:assets:${scope}`, 30, async () => {
      const byType = await prisma.$queryRaw<Row[]>`
        SELECT COALESCE(a.device_type,'Unknown') AS label, COUNT(*)::int AS value
        FROM dim_asset a JOIN node_ref n ON n.node_id = a.asset_id
        WHERE (${scope} = '*' OR n.data_scope = ${scope})
        GROUP BY 1 ORDER BY 2 DESC`;

      const byExposure = await prisma.$queryRaw<Row[]>`
        SELECT COALESCE(a.exposure,'Unknown') AS label, COUNT(*)::int AS value
        FROM dim_asset a JOIN node_ref n ON n.node_id = a.asset_id
        WHERE (${scope} = '*' OR n.data_scope = ${scope})
        GROUP BY 1 ORDER BY 2 DESC`;

      const byDept = await prisma.$queryRaw<Row[]>`
        SELECT COALESCE(NULLIF(a.owner_dept,''),'Unassigned') AS label, COUNT(*)::int AS value
        FROM dim_asset a JOIN node_ref n ON n.node_id = a.asset_id
        WHERE (${scope} = '*' OR n.data_scope = ${scope})
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`;

      // how many distinct sources observed each asset (dedup quality)
      const bySourceCoverage = await prisma.$queryRaw<Row[]>`
        WITH c AS (
          SELECT sd.node_id, COUNT(DISTINCT sd.source_system)::int AS k
          FROM source_detail sd JOIN node_ref n ON n.node_id = sd.node_id
          WHERE n.entity_type = 'ASSET' AND (${scope} = '*' OR n.data_scope = ${scope})
          GROUP BY 1
        )
        SELECT (k || ' source' || CASE WHEN k=1 THEN '' ELSE 's' END) AS label,
               COUNT(*)::int AS value
        FROM c GROUP BY k ORDER BY k`;

      const [{ value: vulnerable }] = await prisma.$queryRaw<Row[]>`
        SELECT COUNT(DISTINCT e.src_node)::int AS value
        FROM rel_edge e JOIN node_ref n ON n.node_id = e.src_node
        WHERE e.edge_type='HAS_FINDING' AND (${scope} = '*' OR n.data_scope = ${scope})`;
      const [{ value: incidentImpacted }] = await prisma.$queryRaw<Row[]>`
        SELECT COUNT(DISTINCT e.dst_node)::int AS value
        FROM rel_edge e JOIN node_ref n ON n.node_id = e.dst_node
        WHERE e.edge_type='AFFECTS' AND (${scope} = '*' OR n.data_scope = ${scope})`;
      const [{ value: total }] = await prisma.$queryRaw<Row[]>`
        SELECT COUNT(*)::int AS value FROM node_ref n WHERE n.entity_type='ASSET'
        AND (${scope} = '*' OR n.data_scope = ${scope})`;

      return {
        total,
        vulnerable,
        incidentImpacted,
        clean: total - vulnerable,
        charts: {
          byType: byType.map((r) => ({ label: r.label, value: r.value })),
          byExposure: byExposure.map((r) => ({ label: r.label, value: r.value })),
          byDept: byDept.map((r) => ({ label: r.label, value: r.value })),
          bySourceCoverage: bySourceCoverage.map((r) => ({ label: r.label, value: r.value })),
        },
      };
    });
  }),
});
