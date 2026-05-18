// Drill-through detail for a single node: golden record + per-source tabs
// (driven by dim_source.display_config) + a summary of connected edges so
// the UI can offer pivots.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/db.js";

export const entityRouter = router({
  get: protectedProcedure
    .input(z.object({ nodeId: z.string() }))
    .query(async ({ input, ctx }) => {
      const scope = ctx.auth.dataScope;
      const node = await prisma.nodeRef.findUnique({ where: { nodeId: input.nodeId } });
      if (!node || (scope !== "*" && node.dataScope !== scope))
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found or out of scope" });

      const golden =
        node.entityType === "ASSET"
          ? await prisma.dimAsset.findUnique({ where: { assetId: node.nodeId } })
          : node.entityType === "USER"
            ? await prisma.dimUser.findUnique({ where: { userId: node.nodeId } })
            : node.entityType === "VULN"
              ? await prisma.dimVuln.findUnique({ where: { vulnId: node.nodeId } })
              : null;

      const details = await prisma.sourceDetail.findMany({ where: { nodeId: node.nodeId } });
      const sources = await prisma.dimSource.findMany();
      const tabLabel = (s: string) =>
        (sources.find((x) => x.sourceSystem === s)?.displayConfig as any)?.tab ?? s;

      const [out, inc] = await Promise.all([
        prisma.relEdge.groupBy({ by: ["edgeType"], where: { srcNode: node.nodeId, validTo: null }, _count: true }),
        prisma.relEdge.groupBy({ by: ["edgeType"], where: { dstNode: node.nodeId, validTo: null }, _count: true }),
      ]);

      return {
        node: {
          nodeId: node.nodeId,
          entityType: node.entityType,
          displayName: node.displayName,
          criticality: node.criticality,
        },
        golden,
        sourceTabs: details.map((d) => ({
          tab: tabLabel(d.sourceSystem),
          sourceSystem: d.sourceSystem,
          sourceNativeId: d.sourceNativeId,
          loadedAt: d.loadedAt,
          raw: d.rawData,
        })),
        relationships: {
          outgoing: out.map((o) => ({ edgeType: o.edgeType, count: o._count })),
          incoming: inc.map((i) => ({ edgeType: i.edgeType, count: i._count })),
        },
      };
    }),
});
