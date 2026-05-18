// Applies Postgres-only constructs that Prisma cannot express:
//   - pg_trgm / btree_gin extensions
//   - search_doc.ts  (GENERATED tsvector column)
//   - GIN / trigram indexes for federated + fuzzy search
// Idempotent: safe to run repeatedly.
import { prisma } from "../lib/db.js";

const stmts = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE EXTENSION IF NOT EXISTS btree_gin`,
  `ALTER TABLE search_doc
     ADD COLUMN IF NOT EXISTS ts tsvector
     GENERATED ALWAYS AS (to_tsvector('english', coalesce(body,''))) STORED`,
  `CREATE INDEX IF NOT EXISTS idx_search_ts       ON search_doc USING GIN (ts)`,
  `CREATE INDEX IF NOT EXISTS idx_search_trgm     ON search_doc USING GIN (display_name gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_search_body_trgm ON search_doc USING GIN (body gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_srcdetail_raw   ON source_detail USING GIN (raw_data)`,
  `CREATE INDEX IF NOT EXISTS idx_asset_host_trgm ON dim_asset USING GIN (hostname gin_trgm_ops)`,
];

async function main() {
  for (const s of stmts) {
    await prisma.$executeRawUnsafe(s);
    console.log("OK:", s.split("\n")[0].trim());
  }
  await prisma.$disconnect();
  console.log("postMigrate complete.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
