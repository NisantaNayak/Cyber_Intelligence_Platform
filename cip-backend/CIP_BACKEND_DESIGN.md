# Cyber Intelligence Platform (CIP) — Backend Design

> **Status:** Design baseline
> **Owner:** Principal Cyber Security Engineer
> **Scope:** Universal Data Model, Snowflake normalization, Postgres serving layer, local implementation plan

---

## 1. Goal

A Cyber Intelligence Platform that provides **search, cross-domain pivot, and drill-through triage** across multiple security domains — Asset, Identity, Network, Vulnerability, Incident, Risk — where each domain may have many sources.

**Use Case 1 — Federated search:** a search returns results across *all* domains first (with counts), then the analyst clicks through for detail.

**Use Case 2 — Identity → Asset → Vulnerability pivot:** searching a user surfaces that user's associated assets and any vulnerabilities on those assets, in one investigation view.

---

## 2. Architecture & Responsibility Split

| Layer | Job | Tech |
|---|---|---|
| **Snowflake** | Land raw → normalize/type → resolve entities → build golden records, edges, search docs (UDM-shaped). **All tables and transformation live here.** | Snowflake + dbt + Streams/Tasks/Dynamic Tables |
| **Loader** | Incremental, idempotent copy of Snowflake `PUBLISH` layer → Postgres | Scheduled job (watermark-based) |
| **Postgres** | Serve federated search, entity detail, graph pivot. **No transformation.** | PostgreSQL + Prisma |
| **API** | Three primitives: `search.query`, `entity.get`, `pivot.expand` | Fastify + tRPC + SuperJSON |
| **Cache / Auth** | Hot query caching; JWT auth | ioredis (Redis) + Okta (OIDC/JWKS) |

**Principle:** the Snowflake `PUBLISH` schema is a **1:1 contract** with the Postgres receiving tables. The loader carries no logic.

---

## 3. Design Philosophy

The CIP data model uses a **graph-aware relational pattern** with **source-agnostic extensibility**:

- **Domain golden tables** (`dim_*`) — deduplicated, source-prioritized records, one per domain.
- **Global node spine** (`node_ref`) — a single addressable identity for every entity across all domains, so edges and search point at one thing and cross-domain traversal is one query.
- **Edge table** (`rel_edge`) — typed, directional, time-bounded relationships. Powers all pivot/drill-through.
- **Source detail** (`source_detail`) — JSONB per-source full-fidelity records; no DDL change to add a source.
- **Source registry** (`dim_source`) — config-driven field mapping, display layout, survivorship priority.
- **Attribute catalog** (`attribute_catalog`) — governance contract for JSONB keys (type, PII class, indexed).
- **Search doc** (`search_doc`) — denormalized tsvector-based federated search projection.

### Key principle: config-driven source onboarding

Adding a new source is **config-driven for storage and display**:
1. Row in `dim_source` (field mapping + display config + priority).
2. A Snowflake `STG` model + entries in `MATCH_RULES` / `SOURCE_PRIORITY`.

> **Caveat (important):** onboarding is *not* zero-code for **correlation**. Entity-resolution match-key mapping and survivorship are per-source and must be defined. Onboarding is zero-code for *display*, config-driven for *survivorship*, and source-specific for *identity resolution*.

---

## 4. Logical Data Model (technology-agnostic)

**Entities**

| Logical entity | Meaning | Key |
|---|---|---|
| **Node** | Any addressable thing across any domain (the spine) | node_id |
| **Asset / User / Vulnerability / Network / Incident / Risk** | Domain golden records | domain PK, 1:1 to a Node |
| **Source Observation** | One raw record from one source about one node | (source_system, source_native_id) |
| **Crosswalk** | Maps Source Observation → canonical domain record | composite |
| **Edge** | Typed, directional, time-bounded relationship between two Nodes | edge_id |
| **Source Registry** | Config describing each source | source_system |
| **Attribute Catalog** | Governance contract for JSONB attributes | (domain, source, attr_key) |
| **Search Doc** | Denormalized searchable projection of a Node | node_id |

**Relationships**

- Node `1 — 0..1` each domain golden record (by `entity_type`).
- Node `1 — 0..*` Source Observation (many sources resolve into one node).
- Node `1 — 0..*` Edge as source; `1 — 0..*` as destination (self-referencing M:N → powers pivot).
- Source Registry `1 — 0..*` Source Observation; governs Attribute Catalog entries.
- Node `1 — 1` Search Doc.

**Use-case mapping**

- **UC1:** query `Search Doc` → group by `entity_type` → counts + top hits → click-through.
- **UC2:** resolve User Node → traverse `Edge[USES/OWNS]` → Asset Nodes → traverse `Edge[HAS_FINDING]` → Vuln Nodes.

### ER Diagram

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
    }
    DIM_USER {
        uuid user_id PK_FK
        text email
        text upn
        uuid manager_id
        bool mfa_enabled
    }
    DIM_VULN {
        uuid vuln_id PK_FK
        text cve_id
        numeric cvss_base
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
        jsonb field_mapping
        jsonb display_config
        int priority
    }
    ATTRIBUTE_CATALOG {
        text domain PK
        text source_system PK
        text attribute_key PK
        text data_type
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

## 5. Snowflake — Physical Model (Medallion + Publish)

Four schemas. Tables shown for the **Asset domain** (4 sources); the pattern repeats per domain.

### `RAW` — landing (already exists)
```
RAW.CROWDSTRIKE_HOSTS   RAW.FORESCOUT_DEVICES   RAW.QUALYS_ASSETS
RAW.CMDB_CI             RAW.OKTA_USERS          RAW.QUALYS_VULN_FINDINGS
```
Append-only, untouched.

### `STG` — normalized per source (identical conformed shape per domain)
```
STG.ASSET__CROWDSTRIKE  STG.ASSET__FORESCOUT  STG.ASSET__QUALYS  STG.ASSET__CMDB
STG.USER__OKTA          STG.VULN__QUALYS
```
Typed columns + computed `match_keys` (normalized hostname/MAC/serial/IP) + `source_system`, `source_native_id`, `loaded_at`, `_hash`.

### `INT` — entity resolution & survivorship
```
INT.ASSET_XREF        -- (source_system, source_native_id) -> canonical asset_id (stable UUID)
INT.USER_XREF
INT.VULN_XREF
INT.MATCH_RULES       -- ranked deterministic rules (serial > mac > host+domain > ip+window)
INT.SOURCE_PRIORITY   -- per-field survivorship winner per source
INT.UNRESOLVED_QUEUE  -- records matching nothing -> review
```
Canonical UUIDs are **minted once and never regenerated** across runs.

### `PUBLISH` — UDM, mirrors Postgres 1:1
```
PUB.NODE_REF   PUB.DIM_ASSET   PUB.DIM_USER   PUB.DIM_VULN
PUB.SOURCE_DETAIL   PUB.REL_EDGE   PUB.DIM_SOURCE
PUB.ATTRIBUTE_CATALOG   PUB.SEARCH_DOC   PUB.LOAD_WATERMARK
```
Implement as **Dynamic Tables** (or dbt incremental + Streams/Tasks) with a target lag. The loader only ever reads `PUBLISH.*`.

---

## 6. Postgres — Physical Model & Setup Steps

Postgres is purely a serving target, but it still owns everything Snowflake physically cannot provide: receiving tables, tsvector search, GIN/trgm indexes, FK integrity, the load transaction, RBAC filtering, caching.

### 6.1 Extensions (one-time)
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

### 6.2 Receiving tables (mirror Snowflake `PUBLISH` 1:1)
```sql
CREATE TABLE node_ref (
  node_id      UUID PRIMARY KEY,
  entity_type  TEXT NOT NULL,            -- ASSET|USER|VULN|NETWORK|INCIDENT|RISK
  domain_pk    UUID NOT NULL,
  display_name TEXT NOT NULL,
  criticality  INT  NOT NULL DEFAULT 0,
  data_scope   TEXT,
  UNIQUE (entity_type, domain_pk)
);

CREATE TABLE dim_asset (
  asset_id    UUID PRIMARY KEY REFERENCES node_ref(node_id),
  hostname    VARCHAR(255), ip_address INET, mac_address MACADDR,
  device_type VARCHAR(100), owner_dept TEXT, exposure TEXT,
  first_seen  TIMESTAMPTZ, last_seen TIMESTAMPTZ
);

CREATE TABLE dim_user (
  user_id     UUID PRIMARY KEY REFERENCES node_ref(node_id),
  email TEXT, upn TEXT, employee_type TEXT, manager_id UUID, mfa_enabled BOOL
);

CREATE TABLE dim_vuln (
  vuln_id     UUID PRIMARY KEY REFERENCES node_ref(node_id),
  cve_id TEXT, cvss_base NUMERIC, severity TEXT, exploit_available BOOL, kev BOOL
);

CREATE TABLE source_detail (
  obs_id        UUID PRIMARY KEY,
  node_id       UUID REFERENCES node_ref(node_id),
  source_system TEXT NOT NULL, source_native_id TEXT NOT NULL,
  raw_data      JSONB NOT NULL, loaded_at TIMESTAMPTZ NOT NULL,
  UNIQUE (source_system, source_native_id)
);

CREATE TABLE rel_edge (
  edge_id    UUID PRIMARY KEY,
  src_node   UUID NOT NULL REFERENCES node_ref(node_id),
  dst_node   UUID NOT NULL REFERENCES node_ref(node_id),
  edge_type  TEXT NOT NULL,             -- OWNS|USES|HAS_FINDING|CONNECTS_ON|AFFECTS|DERIVED_FROM
  confidence NUMERIC DEFAULT 1.0, source_system TEXT,
  valid_from TIMESTAMPTZ NOT NULL, valid_to TIMESTAMPTZ,
  UNIQUE (src_node, dst_node, edge_type, source_system)
);

CREATE TABLE dim_source (
  source_system  TEXT PRIMARY KEY, domain TEXT,
  field_mapping  JSONB, display_config JSONB, priority INT
);

CREATE TABLE attribute_catalog (
  domain TEXT, source_system TEXT, attribute_key TEXT,
  data_type TEXT, pii_class TEXT, indexed BOOL,
  PRIMARY KEY (domain, source_system, attribute_key)
);

CREATE TABLE search_doc (
  node_id     UUID PRIMARY KEY REFERENCES node_ref(node_id),
  entity_type TEXT NOT NULL, display_name TEXT,
  body        TEXT, data_scope TEXT,
  ts          TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(body,''))) STORED
);

CREATE TABLE load_state (
  table_name TEXT PRIMARY KEY,
  watermark  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.3 Indexes (serving-tuned, Postgres-only concern)
```sql
CREATE INDEX idx_search_ts       ON search_doc USING GIN (ts);
CREATE INDEX idx_search_trgm     ON search_doc USING GIN (display_name gin_trgm_ops);
CREATE INDEX idx_edge_src        ON rel_edge (src_node, edge_type);
CREATE INDEX idx_edge_dst        ON rel_edge (dst_node, edge_type);
CREATE INDEX idx_srcdetail_node  ON source_detail (node_id);
CREATE INDEX idx_srcdetail_raw   ON source_detail USING GIN (raw_data);
CREATE INDEX idx_asset_host_trgm ON dim_asset USING GIN (hostname gin_trgm_ops);
```

### 6.4 Postgres-only constructs

| Construct | Why not Snowflake | Decision |
|---|---|---|
| `search_doc.ts` (tsvector) | Postgres-only type | Snowflake ships `body TEXT`; `ts` is a generated column — loader never touches it |
| GIN / trgm / btree indexes | No Snowflake equivalent | Defined in Postgres migration, tuned to query patterns |
| FK constraints (`node_ref` spine) | Snowflake doesn't enforce FKs | Enforced in Postgres so a bad publish fails the load, not the pivots |

### 6.5 Load procedure (idempotent, per cycle, single transaction)
1. `COPY` each changed `PUBLISH.*` slice into `<table>_staging`.
2. `INSERT ... ON CONFLICT (pk) DO UPDATE` from staging into the live table.
3. FK-safe order: `node_ref` → `dim_*` → `source_detail` → `rel_edge` → `search_doc`; full-refresh `dim_source` + `attribute_catalog`.
4. Expire stale temporal edges: `valid_to = now()` where absent from the new batch.
5. Advance `load_state.watermark` and `COMMIT` in the same transaction (replays are no-ops).
6. `ANALYZE` (and `VACUUM` on high churn) touched tables.
7. For very large dimensions, use load-into-new-partition-and-swap instead of in-place upsert.

### 6.6 Access path (Postgres owns)
- **RBAC:** filter every query on `data_scope`; fold it into the Redis cache key; optionally Postgres RLS as defense-in-depth.
- **Caching:** Redis in front of search/pivot, keyed by `hash(query + filters + data_scope)`, short TTL.
- **PII masking:** driven by `attribute_catalog.pii_class` at the service layer.
- **Ops:** connection pooling (PgBouncer/Prisma), read replicas for search fan-out, version-controlled migrations applied before any loader run expecting a new shape, monitoring (load duration, row-delta reconciliation vs Snowflake, index bloat, slow-query log).

---

## 7. Service Architecture

```
Okta (JWT/OIDC)
   |  Bearer token
   v
Fastify -- auth plugin (verify Okta JWKS, extract scopes/groups)
   |
   v
tRPC router (SuperJSON)
   |-- search.query   (UC1)
   |-- entity.get     (drill-through detail)
   |-- pivot.expand   (UC2 + all triage)
   v
Service layer -- RBAC/data-scope enforcement -- Redis (ioredis) cache
   |
   v
Repository layer (Prisma)
   |
   v
PostgreSQL (UDM)  <-- loader <-- Snowflake PUBLISH (dbt: resolve + golden + edges)
```

- tRPC routers: validation + auth context only.
- All business logic in the service layer.
- Prisma confined to the repository layer (keeps an OpenSearch migration to one layer).
- RBAC enforced in the service layer and in every cache key.

---

## 8. Local Implementation Plan

No Snowflake locally — simulate the `PUBLISH` layer with fixtures; keep the loader interface identical to production.

1. **Infra:** `docker-compose` → Postgres 16 + Redis. Enable `pg_trgm`, `btree_gin`.
2. **Fixtures (`/seed`):** representative rows per source mimicking `STG.ASSET__*`, `STG.USER__OKTA`, `STG.VULN__QUALYS`. Include deliberate cross-source duplicates (same host in CrowdStrike + Qualys + CMDB).
3. **Prisma schema:** model the §6.2 tables; `prisma migrate`.
4. **Local "Snowflake" transform (`scripts/transform.ts`):** the only place logic lives — normalize → apply `MATCH_RULES`/`SOURCE_PRIORITY` config → mint stable `node_id`s → produce golden `dim_*`, `rel_edge`, `source_detail`, `search_doc`. Output schema **identical to PUBLISH**.
5. **Loader (`scripts/load.ts`):** read transform output → upsert in the §6.5 FK-safe order. Same code path as prod.
6. **API:** Fastify + tRPC + SuperJSON; Okta JWKS (mock JWT issuer locally). Implement `search.query`, `entity.get`, `pivot.expand` with Redis caching.
7. **Validate end-to-end:** seed a user owning two assets, one asset with a KEV vuln + an open incident → search the user → assert one investigation view returns Identity + correlated Assets + Vuln rollup.

**Build order:** infra → fixtures → schema → transform (resolution) → loader → UC1 → UC2 → caching/RBAC → hardening.

> **Highest-risk component:** the entity-resolution transform. Build its duplicate/conflict test corpus before adding more sources.

---

## 9. Open Items / Next Designs

- Entity-resolution detailed design: match-key normalization, ranked deterministic rules, survivorship via `dim_source` priority, unresolved-bucket handling.
- `pivot.expand` recursive query against `rel_edge` (depth-bounded).
- Full Prisma schema file for the receiving tables.
- OpenSearch migration path behind the `SearchService` interface (for >50M docs / advanced relevance).
