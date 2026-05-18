// Filterable, paginated raw asset list backing the Asset Analytics table.
// Filters mirror the chart dimensions so a chart click cross-filters the
// table. RBAC-scoped via node_ref.data_scope.
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { Prisma, prisma } from "../lib/db.js";

export const assetRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        deviceType: z.string().optional(),
        exposure: z.string().optional(),
        ownerDept: z.string().optional(),
        sourceCount: z.number().int().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const scope = ctx.auth.dataScope;
      const { page, pageSize } = input;

      // sourceCount filter -> resolve to candidate node ids first
      let idFilter: string[] | undefined;
      if (input.sourceCount != null) {
        const rows = await prisma.$queryRaw<{ node_id: string }[]>`
          SELECT sd.node_id
          FROM source_detail sd JOIN node_ref n ON n.node_id = sd.node_id
          WHERE n.entity_type = 'ASSET'
            AND (${scope} = '*' OR n.data_scope = ${scope})
          GROUP BY sd.node_id
          HAVING COUNT(DISTINCT sd.source_system) = ${input.sourceCount}`;
        idFilter = rows.map((r) => r.node_id);
        if (idFilter.length === 0)
          return { rows: [], total: 0, page, pageSize, pages: 0 };
      }

      const where: any = {};
      if (scope !== "*") where.node = { dataScope: scope };
      if (input.deviceType) where.deviceType = input.deviceType;
      if (input.exposure) where.exposure = input.exposure;
      if (input.ownerDept)
        where.ownerDept =
          input.ownerDept === "Unassigned"
            ? { in: ["", "Unassigned"] }
            : input.ownerDept;
      if (idFilter) where.assetId = { in: idFilter };

      const [total, assets] = await Promise.all([
        prisma.dimAsset.count({ where }),
        prisma.dimAsset.findMany({
          where,
          orderBy: { hostname: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      const ids = assets.map((a) => a.assetId);
      const sc = ids.length
        ? await prisma.$queryRaw<{ node_id: string; k: number }[]>`
            SELECT node_id, COUNT(DISTINCT source_system)::int AS k
            FROM source_detail
            WHERE node_id IN (${Prisma.join(ids)})
            GROUP BY node_id`
        : [];
      const scMap = new Map(sc.map((r) => [r.node_id, r.k]));

      return {
        total,
        page,
        pageSize,
        pages: Math.ceil(total / pageSize),
        rows: assets.map((a) => ({
          assetId: a.assetId,
          hostname: a.hostname,
          ip: a.ipAddress,
          mac: a.macAddress,
          deviceType: a.deviceType,
          ownerDept: a.ownerDept || "Unassigned",
          exposure: a.exposure,
          lastSeen: a.lastSeen,
          sourceCount: scMap.get(a.assetId) ?? 0,
        })),
      };
    }),
});
