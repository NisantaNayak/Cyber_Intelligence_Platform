// UC2 — Pivot / drill-through. Depth-bounded graph traversal over rel_edge.
// One reusable primitive powers every triage path. Example:
//   expand(USER, depth=2)  ->  User --OWNS--> Assets --HAS_FINDING--> Vulns
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/db.js";

export const pivotRouter = router({
  expand: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        depth: z.number().min(1).max(3).default(2),
        edgeTypes: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const scope = ctx.auth.dataScope;
      const root = await prisma.nodeRef.findUnique({ where: { nodeId: input.nodeId } });
      if (!root || (scope !== "*" && root.dataScope !== scope))
        throw new TRPCError({ code: "NOT_FOUND", message: "Root node not found or out of scope" });

      const nodeIds = new Set<string>([root.nodeId]);
      const edges: any[] = [];
      const edgeFilter = input.edgeTypes ? { edgeType: { in: input.edgeTypes } } : {};
      let frontier = [root.nodeId];

      for (let hop = 0; hop < input.depth && frontier.length; hop++) {
        const found = await prisma.relEdge.findMany({
          where: {
            validTo: null,
            ...edgeFilter,
            OR: [{ srcNode: { in: frontier } }, { dstNode: { in: frontier } }],
          },
        });
        const next: string[] = [];
        for (const e of found) {
          edges.push({
            edgeId: e.edgeId, srcNode: e.srcNode, dstNode: e.dstNode,
            edgeType: e.edgeType, confidence: e.confidence, sourceSystem: e.sourceSystem,
          });
          for (const id of [e.srcNode, e.dstNode])
            if (!nodeIds.has(id)) { nodeIds.add(id); next.push(id); }
        }
        frontier = next;
      }

      const nodes = await prisma.nodeRef.findMany({
        where: {
          nodeId: { in: [...nodeIds] },
          ...(scope === "*" ? {} : { dataScope: scope }),
        },
      });

      // de-dup edges; drop edges whose endpoints fell out of scope
      const visible = new Set(nodes.map((n) => n.nodeId));
      const seen = new Set<string>();
      const cleanEdges = edges.filter(
        (e) =>
          visible.has(e.srcNode) &&
          visible.has(e.dstNode) &&
          !seen.has(e.edgeId) &&
          seen.add(e.edgeId),
      );

      return {
        root: input.nodeId,
        depth: input.depth,
        nodes: nodes.map((n) => ({
          nodeId: n.nodeId,
          entityType: n.entityType,
          displayName: n.displayName,
          criticality: n.criticality,
        })),
        edges: cleanEdges,
        summary: {
          nodeCount: nodes.length,
          edgeCount: cleanEdges.length,
          byType: nodes.reduce<Record<string, number>>((acc, n) => {
            acc[n.entityType] = (acc[n.entityType] ?? 0) + 1;
            return acc;
          }, {}),
        },
      };
    }),
});
