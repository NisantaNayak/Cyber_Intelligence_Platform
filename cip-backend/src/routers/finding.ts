// Cross-domain detector findings (UC: exploitable conditions).
// Read-only surface over the `finding` table produced by the detector
// engine in @cip/db. RBAC: every row filtered by data_scope, same as
// federated search; scope is part of the cache key.
import { z } from "zod";
import { createHash } from "node:crypto";
import { router, protectedProcedure } from "../trpc.js";
import { prisma, Prisma } from "../lib/db.js";
import { cached } from "../lib/redis.js";

const SEVERITY = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

type FindingItem = {
  findingId: string;
  ruleKey: string;
  severity: string;
  title: string;
  primaryNode: string;
  primaryName: string | null;
  primaryType: string | null;
  relatedNodes: string[];
  evidence: unknown;
  firstSeen: string;
  lastSeen: string;
};

export const findingRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        ruleKey: z.string().optional(),
        severity: z.enum(SEVERITY).optional(),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const scope = ctx.auth.dataScope;
      const key =
        "finding:" +
        createHash("sha1")
          .update(`${scope}|${input.ruleKey ?? ""}|${input.severity ?? ""}|${input.limit}`)
          .digest("hex");

      return cached(key, 30, async () => {
        const scopeCond = Prisma.sql`(${scope} = '*' OR f.data_scope = ${scope})`;
        const ruleCond = input.ruleKey
          ? Prisma.sql`f.rule_key = ${input.ruleKey}`
          : Prisma.sql`TRUE`;

        const listWhere = Prisma.join(
          [
            scopeCond,
            ruleCond,
            input.severity ? Prisma.sql`f.severity = ${input.severity}` : Prisma.sql`TRUE`,
          ],
          " AND ",
        );

        const rows = await prisma.$queryRaw<FindingItem[]>`
          SELECT f.finding_id          AS "findingId",
                 f.rule_key            AS "ruleKey",
                 f.severity            AS "severity",
                 f.title               AS "title",
                 f.primary_node        AS "primaryNode",
                 n.display_name        AS "primaryName",
                 n.entity_type         AS "primaryType",
                 f.related_nodes       AS "relatedNodes",
                 f.evidence            AS "evidence",
                 f.first_seen          AS "firstSeen",
                 f.last_seen           AS "lastSeen"
          FROM finding f
          LEFT JOIN node_ref n ON n.node_id = f.primary_node
          WHERE ${listWhere}
          ORDER BY CASE f.severity
                     WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                     WHEN 'MEDIUM'   THEN 2 ELSE 3 END,
                   f.last_seen DESC
          LIMIT ${input.limit}
        `;

        const counts = await prisma.$queryRaw<{ severity: string; n: number }[]>`
          SELECT f.severity AS "severity", COUNT(*)::int AS "n"
          FROM finding f
          WHERE ${Prisma.join([scopeCond, ruleCond], " AND ")}
          GROUP BY f.severity
        `;

        const bySeverity = Object.fromEntries(SEVERITY.map((s) => [s, 0])) as Record<
          (typeof SEVERITY)[number],
          number
        >;
        let total = 0;
        for (const c of counts) {
          if (c.severity in bySeverity) bySeverity[c.severity as (typeof SEVERITY)[number]] = c.n;
          total += c.n;
        }

        return {
          total,
          bySeverity,
          items: rows.map((r) => ({
            ...r,
            firstSeen: new Date(r.firstSeen).toISOString(),
            lastSeen: new Date(r.lastSeen).toISOString(),
          })),
        };
      });
    }),
});
