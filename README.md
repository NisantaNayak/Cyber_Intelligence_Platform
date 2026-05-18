# Cyber Intelligence Platform (CIP)

A federated cyber-intelligence platform that unifies assets, identities,
vulnerabilities, network, incidents, and risk into one queryable graph —
then surfaces **exploitable conditions** across those domains.

Monorepo with three projects:

| Project | Stack | Role |
|---|---|---|
| [`cip-database`](cip-database/) | Prisma · PostgreSQL · Redis | Schema, migrations, ETL/seed pipeline, detector engine. Published as `@cip/db`. |
| [`cip-backend`](cip-backend/) | Fastify · tRPC · TypeScript | API: federated search, entity drill-through, graph pivot, analytics, findings. |
| [`cip-frontend`](cip-frontend/) | React · Vite · tRPC client | Investigation Console + Exploitable Conditions panel. |

`cip-backend` consumes the database layer as a package via
`"@cip/db": "file:../cip-database"`; `cip-frontend` gets end-to-end types
by vendoring the backend's tRPC router (`npm run sync:api-types`).

## Features

- **Federated cross-domain search** — one query across all six domains
  (full-text + trigram fuzzy). MAC addresses are searchable in any notation
  (dash / colon / hex).
- **Entity drill-through** — golden record + per-source raw observations +
  relationship summary, all RBAC-scoped.
- **Pivot graph** — depth-bounded traversal of the relationship spine
  (`OWNS`, `HAS_FINDING`, `CONNECTS_ON`, `AFFECTS`, `DERIVED_FROM`).
- **Asset analytics** — distribution by type / exposure / dept / source
  coverage.
- **Detector engine** — declarative cross-domain rules materialized into a
  `finding` table. Ships with the **toxic-triad** rule: an internet-facing
  asset with an exploitable (KEV / known-exploit) vulnerability owned by a
  user without MFA. Surfaced in the **Exploitable Conditions** console.

## Prerequisites

- Node.js 20+ (22/24 fine)
- Docker (for Postgres + Redis)

## Running locally

Order matters: the database package must be installed and built **before**
the backend, because `cip-backend` imports the generated Prisma client from
`@cip/db` (`file:../cip-database`). Use three terminals for the dev servers.

> Prereqs: Docker Desktop **running**, Node.js 20+, and the three projects'
> ports free (5173 / 4000 / 5544 / 6380).

### Step 1 — Database (`cip-database`)

```sh
cd cip-database

# 1a. Env file (DATABASE_URL must match docker-compose)
cp .env.example .env

# 1b. Install deps. The `prepare` script auto-runs `prisma generate && tsc`,
#     producing dist/ and the Prisma client that cip-backend consumes.
npm install

# 1c. Start Postgres (:5544) + Redis (:6380) in Docker
npm run db:up

# 1d. Apply schema migrations (use deploy — migrations already exist)
npx prisma migrate deploy

# 1e. Postgres-only DDL Prisma can't express (tsvector / GIN / trigram)
npm run db:postsetup

# 1f. Populate demo data: generate → transform → load → detect
npm run seed
```

Wait for Docker to report Postgres healthy before step 1d (the
`db:up` compose has a healthcheck; re-run 1d if it raced).

### Step 2 — Backend (`cip-backend`)

Create `cip-backend/.env` (this file is git-ignored — it does **not** ship
in the repo, so you must create it):

```ini
DATABASE_URL="postgresql://cip:cip@localhost:5544/cip?schema=public"
REDIS_URL="redis://localhost:6380"
PORT=4000
AUTH_MODE=mock                  # mock | okta
MOCK_BEARER_TOKEN=dev-token
MOCK_DATA_SCOPE=*
CORS_ORIGIN=http://localhost:5173
```

```sh
cd cip-backend
npm install                     # resolves @cip/db from ../cip-database
npm run dev                     # API on http://localhost:4000 (tsx watch)
```

Verify: `curl http://localhost:4000/health` → `{"ok":true,...}`.

### Step 3 — Frontend (`cip-frontend`)

The backend's tRPC types are already vendored
(`src/api-types.d.ts` is committed), so the UI runs standalone.

```sh
cd cip-frontend
npm install
npm run dev                     # UI on http://localhost:5173
```

Open http://localhost:5173. Under `AUTH_MODE=mock` the client sends
`Authorization: Bearer dev-token` automatically.

### Refreshing after changes

| You changed… | Run |
|---|---|
| `cip-database` schema | `cd cip-database && npx prisma migrate dev --name <change> && npm run build` |
| Detectors / schema, want fresh data | `cd cip-database && npm run seed` (re-runs the pipeline incl. `detect`) |
| `cip-database` source (no schema change) | `cd cip-database && npm run build` (so the backend picks up new dist) |
| Backend tRPC routers | auto-reloads (`tsx watch`); then `npm run build:api-types` + `cd ../cip-frontend && npm run sync:api-types` for FE types |
| Backend `.env` | restart `npm run dev` |

Quick API/DB sanity check any time: `cd cip-backend && npm run smoke`.

### Stopping

```sh
cd cip-database && npm run db:down   # stops/removes Postgres + Redis containers
```
Add `-v` semantics: data persists in the `cip_pgdata` volume; remove it
manually if you want a clean slate, then re-run Step 1d–1f.

## Ports

| Service | URL |
|---|---|
| Frontend (Vite) | http://localhost:5173 |
| Backend API | http://localhost:4000 (`/trpc`, `/health`) |
| PostgreSQL | localhost:5544 |
| Redis | localhost:6380 |

## Data pipeline

`npm run seed` in `cip-database` runs the full pipeline; re-run it after
changing the schema or detectors:

```
generate   → synthetic source fixtures (seed/*.json)
transform  → entity resolution + graph build (build/publish/*.json)
load       → write nodes / edges / search docs to Postgres
detect     → run the detector engine → finding table
```

Add a detector by appending to `DETECTORS` in
[`cip-database/src/scripts/detectors.ts`](cip-database/src/scripts/detectors.ts).

## Security

- **Auth** — `AUTH_MODE=mock` accepts a local bearer token (constant-time
  compared); `AUTH_MODE=okta` verifies JWTs via JWKS (RS256-pinned,
  issuer/audience checked). A valid token without a `data_scope` claim
  **fails closed** (sees nothing) rather than defaulting to unrestricted.
- **RBAC** — every query is filtered by `data_scope`; scope is part of the
  cache key.
- **CORS** — restricted to `CORS_ORIGIN` (no arbitrary-origin reflection).
- **Known issue** — `cip-database` depends on `xlsx` (SheetJS), which has
  unpatched advisories on the npm-published build. It is only used by the
  optional spreadsheet-ingest scripts and is **not** reachable from the
  running API. Avoid ingesting untrusted `.xlsx` files.

## Development notes

- Changing `cip-database` (schema/detectors) requires `npm run build` there
  (or `prisma generate`) so `cip-backend` picks up the new client/types.
- Changing backend routers: run `npm run build:api-types` in `cip-backend`,
  then `npm run sync:api-types` in `cip-frontend` for end-to-end types.
- `npm run smoke` in `cip-backend` is a quick API/DB sanity check.
