# CIP — Local Quickstart

A working local slice of the Cyber Intelligence Platform. Snowflake cannot run
locally, so `seed/*.json` simulates the Snowflake **STG** layer and
`src/scripts/transform.ts` is the local stand-in for the Snowflake
**INT → PUBLISH** dbt models (entity resolution + survivorship). Everything
downstream (loader, API) is the **same code path** you would run in production.

```
seed/*.json            (≈ Snowflake STG: raw per-source records)
   │   npm run transform   ← local stand-in for Snowflake INT→PUBLISH (dbt)
   ▼
build/publish/*.json   (≈ Snowflake PUBLISH: golden records + edges + search docs)
   │   npm run load        ← SAME loader as production
   ▼
Postgres (serving)  ──►  Fastify + tRPC API  ──►  UC1 search / UC2 pivot
```

## Prerequisites
- Docker Desktop, Node 20+ (built on Node 24).

## Steps (run in order, from the project root)

| # | Command | What it does |
|---|---|---|
| 1 | `npm install` | Install dependencies |
| 2 | `npm run db:up` | Start Postgres (`localhost:5544`) + Redis (`localhost:6380`) |
| 3 | `npx prisma generate` | Generate the Prisma client |
| 4 | `npx prisma migrate dev --name init --skip-generate` | Create the serving tables |
| 5 | `npm run db:postsetup` | Add Postgres-only bits: `pg_trgm`, `search_doc.ts` tsvector, GIN/trigram indexes |
| 6 | `npm run seed` | `transform` (entity resolution → `build/publish/`) **then** `load` (→ Postgres) |
| 7 | `npm run smoke` | End-to-end check: UC1 + UC2 + drill-through |
| 8 | `npm run dev` | Start the API on `http://localhost:4000` |

> Ports are `5544`/`6380` (not the defaults) because a host Postgres/Redis may
> already own `5432`/`6379`. Change them in `docker-compose.yml` + `.env` if needed.

Re-running step 6 is safe (idempotent upsert). After editing `seed/*.json`,
just `npm run seed` again.

## Try the API

Auth is in **mock mode** (`AUTH_MODE=mock` in `.env`) — no Okta tenant needed.
Send `Authorization: Bearer dev-token`. Switch to real Okta by setting
`AUTH_MODE=okta` + `OKTA_ISSUER`/`OKTA_AUDIENCE`.

```bash
# health
curl localhost:4000/health

# UC1 — federated cross-domain search (note the SuperJSON {"json":{...}} envelope on GET)
curl -H "Authorization: Bearer dev-token" \
  'localhost:4000/trpc/search.query?input=%7B%22json%22%3A%7B%22q%22%3A%22jdoe%22%7D%7D'

# unauthenticated -> 401
curl -i 'localhost:4000/trpc/search.query?input=%7B%22json%22%3A%7B%22q%22%3A%22jdoe%22%7D%7D'
```

`POST` calls (`entity.get`, `pivot.expand`) take a SuperJSON body
`{"json": { ... }}`. The smoke test (`src/scripts/smoke.ts`) shows all three
procedures called via the in-process tRPC caller — read it as usage examples.

## What the seed data demonstrates

- **Multi-source entity resolution:** `LAPTOP-JDOE-01` arrives from CrowdStrike,
  CMDB **and** Qualys; `WS-ASMITH-02` from Forescout + CMDB. **8 source
  observations → 3 golden assets** (resolved by serial/MAC/hostname).
- **Survivorship:** CMDB wins `owner_dept`/`device_type`, CrowdStrike/Qualys win
  OS fields (priority in `transform.ts` `ASSET_PRIORITY`).
- **UC1:** searching `jdoe` returns hits in **both ASSET and USER** domains.
- **UC2:** `pivot.expand` from the **John Doe** user node (depth 2) returns
  `User --OWNS--> Asset --HAS_FINDING--> Vulnerability` (incl. the KEV
  `CVE-2024-3094`).
- **Drill-through:** `entity.get` on the laptop shows golden record + per-source
  tabs (`EDR`, `CMDB`, `Vuln Scan`) driven by `dim_source.display_config`.

## Adding a new source (the extensibility payoff)

1. Add `seed/<domain>_<source>.json`.
2. Add a normalizer block + match-key mapping in `src/scripts/transform.ts`
   (in production: a Snowflake STG dbt model + `MATCH_RULES`/`SOURCE_PRIORITY`).
3. Add a `dim_source` row (display tab/priority) in `transform.ts`.
4. `npm run seed`. **No schema change, no API change, no UI change.**

## Project layout

```
docker-compose.yml      Postgres + Redis
prisma/schema.prisma    Serving tables (mirror Snowflake PUBLISH 1:1)
seed/                   Simulated Snowflake STG fixtures (multi-source)
src/lib/                env, db (Prisma), redis (cache-aside), auth (Okta/mock)
src/scripts/
  transform.ts          Local Snowflake INT→PUBLISH: entity resolution + survivorship
  load.ts               Idempotent PUBLISH → Postgres loader (prod-identical)
  postMigrate.ts        Postgres-only constructs (tsvector, GIN/trgm, extensions)
  smoke.ts              End-to-end UC1 + UC2 verification
src/routers/            tRPC: search (UC1), entity (drill-through), pivot (UC2)
src/server.ts           Fastify + tRPC + SuperJSON + Okta-aware context
```

See `CIP_BACKEND_DESIGN.md` for the full architecture and data model.
