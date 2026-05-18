// UC1 — Federated cross-domain search.
// One query across ALL domains via search_doc.ts (full-text) + trigram
// fallback for partial/typo matches. Results grouped by entity_type with
// counts so the UI shows "N Assets, M Users, ..." then the user drills in.
// RBAC: every row filtered by data_scope; scope is part of the cache key.
import { z } from "zod";
import { createHash } from "node:crypto";
import { router, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/db.js";
import { cached } from "../lib/redis.js";

type Hit = {
  node_id: string;
  entity_type: string;
  display_name: string;
  rank: number;
};

export const searchRouter = router({
  query: protectedProcedure
    .input(z.object({ q: z.string().min(1), perDomain: z.number().min(1).max(25).default(5) }))
    .query(async ({ input, ctx }) => {
      const scope = ctx.auth.dataScope;
      const key =
        "search:" +
        createHash("sha1").update(`${scope}|${input.perDomain}|${input.q}`).digest("hex");

      return cached(key, 30, async () => {
        const rows = await prisma.$queryRaw<Hit[]>`
          WITH q AS (SELECT websearch_to_tsquery('english', ${input.q}) AS tsq)
          SELECT node_id, entity_type, display_name,
                 GREATEST(
                   ts_rank(ts, (SELECT tsq FROM q)),
                   similarity(coalesce(display_name,''), ${input.q}),
                   CASE WHEN body ILIKE '%' || ${input.q} || '%' THEN 0.6 ELSE 0 END
                 )::float AS rank
          FROM search_doc, q
          WHERE (${scope} = '*' OR data_scope = ${scope})
            AND (ts @@ q.tsq
                 OR display_name % ${input.q}
                 OR body ILIKE '%' || ${input.q} || '%')
          ORDER BY rank DESC
          LIMIT 200
        `;

        // group by domain, cap per domain
        const byDomain: Record<string, Hit[]> = {};
        for (const r of rows) (byDomain[r.entity_type] ??= []).push(r);

        return {
          query: input.q,
          domains: Object.entries(byDomain).map(([entityType, hits]) => ({
            entityType,
            count: hits.length,
            top: hits.slice(0, input.perDomain).map((h) => ({
              nodeId: h.node_id,
              displayName: h.display_name,
              rank: Number(h.rank.toFixed(4)),
            })),
          })),
          total: rows.length,
        };
      });
    }),
});
