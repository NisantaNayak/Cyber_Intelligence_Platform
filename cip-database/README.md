# @cip/db

The CIP serving-layer database, split out of `cip-backend`.

Owns:

- **Schema** — `prisma/schema.prisma` (mirrors the Snowflake PUBLISH schema 1:1)
- **Migrations** — `prisma/migrations/`
- **Postgres-only DDL** — `src/scripts/postMigrate.ts` (tsvector / GIN / trgm)
- **ETL & seed pipeline** — `src/scripts/` (generate → transform → load, plus the xlsx ingest path)
- **Seed data** — `seed/*.json`, `data/*.xlsx`
- **Infra** — `docker-compose.yml` (Postgres only; Redis stays with `cip-backend`)

It also publishes the shared `PrismaClient` instance and Prisma types as the
`@cip/db` package, which `cip-backend` consumes.

## Setup

```sh
npm install
cp .env.example .env          # adjust DATABASE_URL if needed
npm run db:up                 # start Postgres
npm run prisma:migrate        # apply schema
npm run db:postsetup          # Postgres-only DDL
npm run seed                  # generate + transform + load demo data
```

## Consumed by cip-backend

`cip-backend` depends on this package via `"@cip/db": "file:../cip-database"`
and imports `{ prisma, Prisma }` from `@cip/db`. The build step runs
`prisma generate` then `tsc`, so installing the package produces a ready
client. Migrations and the `prisma` CLI live **only** here.

To publish to a private registry instead of the local `file:` path, run
`npm publish` here and change the dependency in `cip-backend/package.json`
to a version range.
