# Cyber Intelligence Platform — Technical Documentation

> **Audience:** engineers and architects operating or extending the CIP.
> **Scope:** the *as-built* system — backend infrastructure, Snowflake &
> Postgres table structures, ER model, architecture, tech stack, API, UI,
> and operations.
> **Related docs:** [CIP_BACKEND_DESIGN.md](CIP_BACKEND_DESIGN.md) (design
> rationale), [QUICKSTART.md](QUICKSTART.md) (run steps).

---

## 1. Overview

The Cyber Intelligence Platform is a multi-domain security data platform that
provides **federated search, cross-domain pivot, and drill-through triage**
over six security domains: **Asset, Identity (User), Vulnerability, Network,
Incident, Risk**. Each domain may be fed by multiple sources; the platform
resolves duplicates into golden records and links everything through a typed
graph.

**Core use cases**

- **UC1 — Federated search:** one query returns hits grouped by domain with
  counts; the analyst drills in.
- **UC2 — Identity → Asset → Vulnerability pivot:** searching a user surfaces
  their assets and the vulnerabilities/incidents on those assets in one
  investigation view.

**Design principle:** every entity is a node on a global spine (`node_ref`),
every cross-domain link is a typed edge (`rel_edge`); search and pivot are each
one reusable query. Heavy normalization/entity-resolution happens in
**Snowflake**; **Postgres** is a pure serving layer.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Source of record | **Snowflake** | RAW→STG→INT→PUBLISH; all transformation/resolution |
| Serving database | **PostgreSQL 16** | receives the Snowflake PUBLISH snapshot; serves search/pivot |
| ORM / migrations | **Prisma 6** | typed data access, schema migrations |
| Cache | **Redis 7** via **ioredis** | cache-aside on search & stats; scope-aware keys |
| HTTP server | **Fastify 5** | + `@fastify/cors` |
| API layer | **tRPC 11** | end-to-end typed; `superjson` transformer |
| AuthN | **Okta** (OIDC/JWKS) via **jose** | mock-token mode for local dev |
| Validation | **zod** | all procedure inputs |
| Frontend | **React 18 + Vite 6 + TypeScript** | typed tRPC client (imports `AppRouter`) |
| Runtime | **Node 20+** (built on Node 24), **tsx** | TS executed directly, watch mode |
| Local infra | **Docker Compose** | Postgres + Redis |

---

## 3. Architecture

```
┌──────────────┐  ELT (dbt / Streams / Dynamic Tables)
│  SNOWFLAKE   │  RAW ─▶ STG ─▶ INT (entity resolution) ─▶ PUBLISH (UDM)
└──────┬───────┘
       │  watermarked, idempotent snapshot load
       ▼
┌──────────────┐   ┌─────────┐
│  POSTGRES    │◀──│ Loader  │  COPY/createMany, FK-safe, atomic full-refresh
│ (serving UDM)│   └─────────┘
└──────┬───────┘
       │  Prisma (repository layer)
       ▼
┌──────────────┐   ┌─────────┐
│ Service layer│◀─▶│  Redis  │  cache-aside (scope-keyed)
│ (RBAC, logic)│   └─────────┘
└──────┬───────┘
       ▼
┌──────────────┐   Okta JWKS / mock bearer
│ tRPC routers │◀── Fastify auth context
└──────┬───────┘
       ▼
┌──────────────┐
│ React + Vite │  typed tRPC client (AppRouter)
│   (web/)     │  KPI dashboard · Investigation Console · Asset Analytics
└──────────────┘
```

**Responsibility split**

| Concern | Owner |
|---|---|
| Normalization, entity resolution, survivorship | Snowflake (dbt) |
| Snapshot transport | Loader (watermarked, idempotent) |
| Federated search, pivot, detail, KPIs | Postgres + tRPC service layer |
| tsvector / GIN-trgm indexes, FK integrity | Postgres only |
| RBAC (data-scope), caching, pooling | Service layer |
| Presentation, drill-through, cross-filtering | React UI |

The Snowflake **PUBLISH** schema is a **1:1 contract** with the Postgres
receiving tables — the loader carries no business logic.

---

## 4. Data Flow

1. **Snowflake** lands raw source data (`RAW`), normalizes per source (`STG`),
   resolves entities and applies survivorship (`INT`), and publishes
   UDM-shaped tables (`PUBLISH`).
2. **Loader** reads changed `PUBLISH.*` slices (watermark), full-refresh
   upserts into Postgres in FK-safe order, advances the watermark atomically.
3. **API** serves three primitives plus analytics from Postgres, RBAC-scoped,
   Redis-cached.
4. **UI** calls the typed tRPC client.

> **Local mode:** Snowflake cannot run locally, so `src/scripts/generate.ts`
> emits Snowflake **STG-shaped fixtures** into `seed/`, and
> `src/scripts/transform.ts` is the local stand-in for the Snowflake
> **INT→PUBLISH** dbt models (real entity resolution + survivorship). The
> loader and API are the **same code as production**.

---

## 5. Snowflake Table Structure (Medallion + Publish)

Four schemas. Asset-domain tables shown; the pattern repeats per domain.

### 5.1 `RAW` — landing (append-only, untouched)
```
RAW.CROWDSTRIKE_HOSTS     RAW.FORESCOUT_DEVICES   RAW.QUALYS_ASSETS
RAW.CMDB_CI               RAW.OKTA_USERS          RAW.QUALYS_VULN_FINDINGS
RAW.NETWORK_INVENTORY     RAW.SERVICENOW_INCIDENTS RAW.RISK_REGISTER
```

### 5.2 `STG` — normalized per source (identical conformed shape per domain)
```
STG.ASSET__CROWDSTRIKE  STG.ASSET__FORESCOUT  STG.ASSET__QUALYS  STG.ASSET__CMDB
STG.USER__OKTA          STG.VULN__QUALYS
STG.NETWORK__INVENTORY  STG.INCIDENT__SERVICENOW  STG.RISK__REGISTER
```
Each row: typed columns + computed `match_keys` (normalized hostname/MAC/
serial/IP) + `source_system`, `source_native_id`, `loaded_at`, `_hash`.

### 5.3 `INT` — entity resolution & survivorship
```
INT.ASSET_XREF      -- (source_system, source_native_id) -> stable canonical UUID
INT.USER_XREF
INT.VULN_XREF
INT.MATCH_RULES     -- ranked deterministic rules (serial > mac > host+domain > ip+window)
INT.SOURCE_PRIORITY -- per-field survivorship winner per source
INT.UNRESOLVED_QUEUE-- records matching nothing -> review
```
Canonical UUIDs are minted once and **never regenerated** across runs.

### 5.4 `PUBLISH` — UDM, mirrors Postgres 1:1
```
PUB.NODE_REF   PUB.DIM_ASSET   PUB.DIM_USER   PUB.DIM_VULN
PUB.SOURCE_DETAIL   PUB.REL_EDGE   PUB.DIM_SOURCE
PUB.ATTRIBUTE_CATALOG   PUB.SEARCH_DOC   PUB.LOAD_WATERMARK
```
Implement as Snowflake **Dynamic Tables** (or dbt incremental + Streams/Tasks)
with a target lag; the loader only ever reads `PUBLISH.*`.

---

## 6. Postgres Table Structure (Serving Layer)

Receiving tables mirror Snowflake `PUBLISH`. Prisma model → table mapping:

| Prisma model | Table | Purpose |
|---|---|---|
| `NodeRef` | `node_ref` | global node spine (one row per entity, any domain) |
| `DimAsset` | `dim_asset` | golden asset record |
| `DimUser` | `dim_user` | golden identity record |
| `DimVuln` | `dim_vuln` | golden vulnerability record |
| `SourceDetail` | `source_detail` | raw per-source observation (JSONB), full fidelity |
| `RelEdge` | `rel_edge` | typed, temporal, directional relationships |
| `DimSource` | `dim_source` | source registry (display/priority config) |
| `AttributeCatalog` | `attribute_catalog` | JSONB governance contract |
| `SearchDoc` | `search_doc` | denormalized search projection (`ts` tsvector) |
| `LoadState` | `load_state` | loader watermark |

### 6.1 Key DDL highlights

```sql
node_ref(node_id PK, entity_type, domain_pk, display_name,
         criticality INT, data_scope, UNIQUE(entity_type, domain_pk))

dim_asset(asset_id PK→node_ref, hostname, ip_address, mac_address,
          device_type, owner_dept, exposure, first_seen, last_seen)
dim_user(user_id PK→node_ref, email, upn, employee_type, manager_id, mfa_enabled)
dim_vuln(vuln_id PK→node_ref, cve_id, cvss_base, severity,
         exploit_available, kev)

source_detail(obs_id PK, node_id→node_ref, source_system, source_native_id,
              raw_data JSONB, loaded_at, UNIQUE(source_system,source_native_id))

rel_edge(edge_id PK, src_node→node_ref, dst_node→node_ref, edge_type,
         confidence, source_system, valid_from, valid_to,
         UNIQUE(src_node,dst_node,edge_type,source_system))

search_doc(node_id PK→node_ref, entity_type, display_name, body,
           data_scope, ts tsvector GENERATED ALWAYS AS
           to_tsvector('english', coalesce(body,'')) STORED)
```

### 6.2 Postgres-only constructs (`src/scripts/postMigrate.ts`)
```
EXTENSION pg_trgm, btree_gin
search_doc.ts                 GENERATED tsvector column
idx_search_ts        GIN(ts)            -- full-text (UC1)
idx_search_trgm      GIN(display_name gin_trgm_ops)  -- fuzzy/partial
idx_srcdetail_raw    GIN(raw_data)
idx_asset_host_trgm  GIN(hostname gin_trgm_ops)
idx_edge_src/dst     btree(src/dst, edge_type)       -- pivot traversal
```

### 6.3 Edge types (the graph vocabulary)
```
USER  ──OWNS────────▶ ASSET
ASSET ──HAS_FINDING──▶ VULN
ASSET ──CONNECTS_ON──▶ NETWORK
INCIDENT ──AFFECTS───▶ ASSET
RISK  ──DERIVED_FROM─▶ VULN
```

### 6.4 Source systems registered (`dim_source`)
```
ASSET:   CROWDSTRIKE, CMDB, QUALYS, FORESCOUT
USER:    OKTA
VULN:    QUALYS_VULN
NETWORK: NETWORK_INVENTORY
INCIDENT:SERVICENOW
RISK:    RISK_REGISTER
```

---

## 7. ER Diagram

```mermaid
erDiagram
    NODE_REF ||--o| DIM_ASSET : "type=ASSET"
    NODE_REF ||--o| DIM_USER : "type=USER"
    NODE_REF ||--o| DIM_VULN : "type=VULN"
    NODE_REF ||--o{ SOURCE_DETAIL : "resolved from"
    NODE_REF ||--o{ REL_EDGE : "src_node"
    NODE_REF ||--o{ REL_EDGE : "dst_node"
    NODE_REF ||--|| SEARCH_DOC : "projected to"
    DIM_SOURCE ||--o{ SOURCE_DETAIL : "governs"

    NODE_REF {
        uuid node_id PK
        text entity_type
        uuid domain_pk
        text display_name
        int  criticality
        text data_scope
    }
    DIM_ASSET {
        uuid asset_id PK_FK
        text hostname
        inet ip_address
        macaddr mac_address
        text device_type
        text owner_dept
        text exposure
    }
    DIM_USER {
        uuid user_id PK_FK
        text email
        text upn
        text employee_type
        bool mfa_enabled
    }
    DIM_VULN {
        uuid vuln_id PK_FK
        text cve_id
        numeric cvss_base
        text severity
        bool kev
    }
    SOURCE_DETAIL {
        uuid obs_id PK
        uuid node_id FK
        text source_system
        text source_native_id
        jsonb raw_data
        timestamptz loaded_at
    }
    REL_EDGE {
        uuid edge_id PK
        uuid src_node FK
        uuid dst_node FK
        text edge_type
        numeric confidence
        timestamptz valid_from
        timestamptz valid_to
    }
    DIM_SOURCE {
        text source_system PK
        text domain
        jsonb display_config
        int priority
    }
    ATTRIBUTE_CATALOG {
        text domain PK
        text source_system PK
        text attribute_key PK
        text pii_class
        bool indexed
    }
    SEARCH_DOC {
        uuid node_id PK_FK
        text entity_type
        text display_name
        text body
        text data_scope
        tsvector ts
    }
```

---

## 8. Entity Resolution

Runs in Snowflake `INT` (locally: `src/scripts/transform.ts`).

1. **Normalize match keys** — lowercase host (strip domain), canonicalize MAC,
   uppercase serial, primary IP.
2. **Deterministic clustering** — union-find over shared keys
   (serial → mac → hostname), ranked by `MATCH_RULES`.
3. **Survivorship** — per-field winner by `SOURCE_PRIORITY`
   (e.g. CMDB > CrowdStrike > Qualys > Forescout for assets).
4. **Stable canonical IDs** — UUIDv5-style hash of the strongest key;
   re-runs are idempotent and stable.
5. **Unresolved bucket** — non-matching records queued for review, never
   dropped.

Local demonstration: 2400 asset observations across 4 sources resolve to
1000 golden assets (source-coverage distribution visible in Asset Analytics).

---

## 9. API Reference (tRPC)

Base: `POST/GET http://localhost:4000/trpc/<procedure>`
Transport: SuperJSON — GET input envelope is `?input={"json":{...}}`.
Auth: `Authorization: Bearer <token>` (mock: `dev-token`). All procedures are
`protectedProcedure` and RBAC-scoped by `data_scope`.

| Procedure | Input | Returns |
|---|---|---|
| `search.query` | `{ q: string, perDomain?: number }` | hits grouped by `entityType` with counts + ranked top hits (UC1). Full-text + trigram; Redis-cached 30s |
| `entity.get` | `{ nodeId: string }` | node, golden record, per-source tabs (driven by `dim_source.display_config`), in/out relationship summary |
| `pivot.expand` | `{ nodeId, depth?: 1-3, edgeTypes?: string[] }` | depth-bounded subgraph `{ nodes, edges, summary }` (UC2); scope-trimmed |
| `stats.overview` | – | domain totals, assets-by-type, vulns-by-severity, KEV total, MFA posture, edges, sources. Cached 30s |
| `stats.assets` | – | asset posture (total/vulnerable/incident-impacted/clean) + chart datasets (byType/byExposure/byDept/bySourceCoverage) |
| `asset.list` | `{ deviceType?, exposure?, ownerDept?, sourceCount?, page?, pageSize? }` | paginated raw asset rows + `total`/`pages`; backs the cross-filtered table |

Router composition: `src/routers/index.ts` → `search`, `entity`, `pivot`,
`stats`, `asset`. Type exported as `AppRouter` and imported by the web client
for end-to-end type safety.

---

## 10. Frontend (web/)

Single-page React app; typed tRPC client (`web/src/trpc.ts` imports
`AppRouter`). Two views:

**Investigation Console**
- KPI dashboard band (7 cards): Assets (+by type), Identities (+MFA), Vulns
  (+severity, KEV flag), Network, Incidents, Risks, Correlation Coverage.
- Search starts **empty** (no auto-search); user-driven. Empty query is a
  no-op (no validation error); Search disabled when blank.
- 3 panels: federated **Results** (grouped by domain) → **Entity Detail**
  (golden record + source tabs + relationships) → **Pivot Graph** (clickable
  subgraph nodes for continuous pivot).

**Asset Analytics** (click the Total Assets KPI card)
- 4 posture stat boxes + 4 bar charts (type / exposure / department / source
  coverage).
- **Click-to-filter:** clicking a chart bar cross-filters a paginated **Raw
  Asset Records** table (server-side filter via `asset.list`); active filter
  chip with clear; pagination.

---

## 11. Local Infrastructure

`docker-compose.yml` services (non-default host ports to avoid clashes with a
host Postgres/Redis):

| Service | Container | Host port | Creds / URL |
|---|---|---|---|
| Postgres 16 | `cip-postgres` | **5544** → 5432 | `cip:cip@localhost:5544/cip` |
| Redis 7 | `cip-redis` | **6380** → 6379 | `redis://localhost:6380` |

`.env` keys: `DATABASE_URL`, `REDIS_URL`, `PORT` (4000), `AUTH_MODE`
(`mock`|`okta`), `OKTA_ISSUER`, `OKTA_AUDIENCE`, `MOCK_BEARER_TOKEN`,
`MOCK_DATA_SCOPE`.

API: `http://localhost:4000` · UI (Vite): `http://localhost:5173`.

---

## 12. Operations / Runbook

```bash
npm install
npm run db:up                                   # Postgres + Redis
npx prisma generate
npx prisma migrate dev --name init --skip-generate
npm run db:postsetup                            # extensions, tsvector, GIN idx
npm run seed                                    # generate -> transform -> load
npm run smoke                                   # UC1 + UC2 end-to-end check
npm run dev                                     # API :4000
cd web && npm install && npm run dev            # UI :5173
```

| Script | Action |
|---|---|
| `npm run generate` | write ~1000/domain STG-shaped fixtures (set `N` in `generate.ts`) |
| `npm run transform` | local Snowflake INT→PUBLISH (entity resolution) → `build/publish/` |
| `npm run load` | bulk FK-safe atomic full-refresh into Postgres |
| `npm run seed` | generate → transform → load |
| `npm run smoke` | in-process tRPC caller verifying UC1/UC2/drill-through |

**Re-seeding** is idempotent (deterministic IDs + full-refresh). After editing
`seed/*.json` or `generate.ts`, run `npm run seed`.

**Gotcha:** if a new tRPC procedure 404s, a stale `tsx watch` may hold port
4000 — `pkill -f "tsx watch"` then `npm run dev`.

---

## 13. Security & RBAC

- **AuthN:** Okta JWT verified via JWKS (`jose`), issuer/audience checked;
  `AUTH_MODE=mock` accepts `MOCK_BEARER_TOKEN` for local dev.
- **AuthZ:** every node carries `data_scope`; every query filters on it and it
  is part of every Redis cache key (no cross-scope cache bleed). `*` =
  unrestricted.
- **PII governance:** `attribute_catalog.pii_class` designates sensitive JSONB
  keys for masking at the service layer.
- **Lineage:** `source_detail` is immutable per-source truth; every golden
  value traces to its winning observation.

---

## 14. Scalability & Extensibility

- **New source:** add `seed/<domain>_<source>.json` + a normalizer/match-key
  mapping (prod: a Snowflake STG dbt model + `MATCH_RULES`/`SOURCE_PRIORITY`) +
  a `dim_source` row. **No schema, API, or UI change.**
- **New domain:** add nodes/edges via the `node_ref` spine + JSONB — three
  domains (Network/Incident/Risk) were added this way with zero schema change.
- **Volume:** `node_ref` partitionable by `entity_type`; loader uses chunked
  `createMany` in one transaction; search behind a `SearchService` boundary
  for a future OpenSearch swap; Redis cache-aside; read replicas for fan-out.
- **Temporal triage:** edges carry `valid_from`/`valid_to` → "as-of" queries.

---

## 15. Repository Layout

```
docker-compose.yml          Postgres + Redis (ports 5544 / 6380)
prisma/schema.prisma        serving tables (mirror Snowflake PUBLISH)
seed/                       generated STG-shaped fixtures (multi-source)
src/lib/                    env, db (Prisma), redis (cache-aside), auth
src/scripts/
  generate.ts               ~1000/domain fixture generator
  transform.ts              local Snowflake INT→PUBLISH (entity resolution)
  load.ts                   bulk idempotent PUBLISH → Postgres loader
  postMigrate.ts            Postgres-only constructs (tsvector, GIN/trgm)
  smoke.ts                  end-to-end UC1+UC2 verification
src/routers/                tRPC: search, entity, pivot, stats, asset
src/trpc.ts                 tRPC init, context, protectedProcedure (RBAC)
src/server.ts               Fastify + tRPC + SuperJSON + Okta-aware context
web/                        React + Vite UI (typed tRPC client)
  src/App.tsx               Console + Asset Analytics
  src/trpc.ts               typed client (imports AppRouter)
CIP_BACKEND_DESIGN.md       design rationale
QUICKSTART.md               run steps
TECHNICAL_DOCUMENTATION.md  this document
```

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **UDM** | Universal Data Model — node spine + typed golden tables + edges |
| **Node spine** | `node_ref`; one addressable identity per entity, any domain |
| **Golden record** | deduplicated, source-prioritized canonical entity (`dim_*`) |
| **Source observation** | raw per-source record (`source_detail`) |
| **Edge** | typed, directional, time-bounded relationship (`rel_edge`) |
| **Survivorship** | per-field rule choosing the winning source value |
| **Data scope** | RBAC partition key carried on every node |
| **Medallion** | Snowflake RAW → STG → INT → PUBLISH layering |
