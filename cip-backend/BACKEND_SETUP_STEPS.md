# Backend Setup — Step-by-Step Queries (Snowflake & Postgres)

> A copy-paste runbook. **Part A** = run in **Snowflake** (build the UDM and
> publish it). **Part B** = run in **Postgres** (serving layer). **Part C** =
> move data Snowflake → Postgres.
>
> Convention: Snowflake builds everything; the Snowflake `PUBLISH` schema is a
> **1:1 contract** with the Postgres tables. The Asset domain (4 sources) is
> fully worked out; USER / VULN / NETWORK / INCIDENT / RISK follow the **same
> shape** — repeat the pattern.
>
> Local note: the repo reproduces Part A with `src/scripts/transform.ts` and
> Part B with Prisma migrations + `postMigrate.ts`. The raw SQL below is what
> those scripts are equivalent to, so you can run the real thing in Snowflake.

---

# PART A — SNOWFLAKE

## A1. Database & schemas (run once)

```sql
CREATE DATABASE IF NOT EXISTS CIP;
USE DATABASE CIP;

CREATE SCHEMA IF NOT EXISTS RAW;      -- landing (untouched)
CREATE SCHEMA IF NOT EXISTS STG;      -- normalized per source
CREATE SCHEMA IF NOT EXISTS INT;      -- entity resolution + survivorship
CREATE SCHEMA IF NOT EXISTS PUBLISH;  -- UDM, mirrors Postgres 1:1

CREATE WAREHOUSE IF NOT EXISTS CIP_WH
  WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE;
USE WAREHOUSE CIP_WH;
```

## A2. RAW landing tables (one per source)

Land source data as-is. Use `VARIANT` for schema-on-read, or typed columns if
you control ingestion. Example (repeat per source):

```sql
CREATE TABLE IF NOT EXISTS RAW.CROWDSTRIKE_HOSTS   (payload VARIANT, loaded_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RAW.CMDB_CI             (payload VARIANT, loaded_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RAW.QUALYS_ASSETS       (payload VARIANT, loaded_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RAW.FORESCOUT_DEVICES   (payload VARIANT, loaded_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RAW.OKTA_USERS          (payload VARIANT, loaded_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RAW.QUALYS_VULN_FINDINGS(payload VARIANT, loaded_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RAW.NETWORK_INVENTORY   (payload VARIANT, loaded_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RAW.SERVICENOW_INCIDENTS(payload VARIANT, loaded_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RAW.RISK_REGISTER       (payload VARIANT, loaded_at TIMESTAMP_NTZ);
```

(Loading into RAW is your existing ingestion — Snowpipe / COPY INTO / connector.)

## A3. STG — normalize per source + compute match keys

One conformed shape per domain. **Run one per asset source** (CrowdStrike
shown; CMDB / Qualys / Forescout differ only in the field paths):

```sql
CREATE OR REPLACE TABLE STG.ASSET__CROWDSTRIKE AS
SELECT
  'CROWDSTRIKE'                                   AS source_system,
  payload:device_id::string                       AS source_native_id,
  payload:hostname::string                        AS hostname,
  payload:local_ip::string                        AS ip_address,
  payload:mac::string                             AS mac_address,
  payload:serial_number::string                   AS serial,
  payload:os_version::string                      AS os_version,
  payload:last_seen::timestamp_ntz                AS last_seen,
  -- match keys (normalized) --
  UPPER(TRIM(payload:serial_number::string))                              AS mk_serial,
  LOWER(REGEXP_REPLACE(payload:mac::string,'[^A-Fa-f0-9]',''))            AS mk_mac,
  LOWER(SPLIT_PART(payload:hostname::string,'.',1))                       AS mk_host,
  payload                                          AS raw_data,
  loaded_at
FROM RAW.CROWDSTRIKE_HOSTS;
```

```sql
-- CMDB: also carries ownership + department + environment
CREATE OR REPLACE TABLE STG.ASSET__CMDB AS
SELECT
  'CMDB'                                          AS source_system,
  payload:ci_id::string                           AS source_native_id,
  payload:name::string                            AS hostname,
  payload:ip::string                              AS ip_address,
  payload:mac_address::string                     AS mac_address,
  payload:serial::string                          AS serial,
  payload:ci_class::string                        AS device_type,
  payload:owned_by::string                        AS owned_by,
  payload:department::string                      AS owner_dept,
  payload:environment::string                     AS exposure,
  UPPER(TRIM(payload:serial::string))                                    AS mk_serial,
  LOWER(REGEXP_REPLACE(payload:mac_address::string,'[^A-Fa-f0-9]',''))    AS mk_mac,
  LOWER(SPLIT_PART(payload:name::string,'.',1))                          AS mk_host,
  payload                                          AS raw_data,
  loaded_at
FROM RAW.CMDB_CI;
-- Repeat for STG.ASSET__QUALYS and STG.ASSET__FORESCOUT (same columns, source paths)
```

```sql
-- USER (Okta)
CREATE OR REPLACE TABLE STG.USER__OKTA AS
SELECT 'OKTA' AS source_system,
       payload:okta_id::string  AS source_native_id,
       payload:login::string    AS upn,
       payload:email::string    AS email,
       payload:firstName::string||' '||payload:lastName::string AS display_name,
       payload:userType::string AS employee_type,
       payload:mfa_enrolled::boolean AS mfa_enabled,
       LOWER(SPLIT_PART(payload:login::string,'@',1)) AS mk_login,
       payload AS raw_data, loaded_at
FROM RAW.OKTA_USERS;

-- VULN (Qualys findings) — note asset linkage via serial
CREATE OR REPLACE TABLE STG.VULN__QUALYS AS
SELECT 'QUALYS_VULN' AS source_system,
       payload:finding_id::string AS source_native_id,
       payload:cve::string        AS cve_id,
       payload:cvss_base::float   AS cvss_base,
       payload:severity::string   AS severity,
       payload:kev::boolean       AS kev,
       payload:exploit_available::boolean AS exploit_available,
       UPPER(TRIM(payload:asset_serial::string)) AS mk_serial,  -- links to asset
       payload AS raw_data, loaded_at
FROM RAW.QUALYS_VULN_FINDINGS;
```

## A4. INT — config + entity resolution + survivorship

### A4a. Match-rule / survivorship config (run once, edit as you onboard sources)

```sql
CREATE TABLE IF NOT EXISTS INT.SOURCE_PRIORITY (
  domain string, source_system string, priority int);

MERGE INTO INT.SOURCE_PRIORITY t
USING (SELECT * FROM VALUES
  ('ASSET','CMDB',4),('ASSET','CROWDSTRIKE',3),
  ('ASSET','QUALYS',2),('ASSET','FORESCOUT',1),
  ('USER','OKTA',5)
  AS s(domain,source_system,priority)) s
ON t.domain=s.domain AND t.source_system=s.source_system
WHEN NOT MATCHED THEN INSERT VALUES (s.domain,s.source_system,s.priority);
```

### A4b. Resolve assets → stable canonical id

Pragmatic, deterministic warehouse approach: the canonical key is the
strongest available match key (serial → mac → host); the canonical UUID is a
stable hash of it (idempotent across runs — never regenerated).

```sql
CREATE OR REPLACE TABLE INT.ASSET_OBS AS
SELECT * FROM (
  SELECT source_system,source_native_id,hostname,ip_address,mac_address,
         serial, NULL AS device_type, NULL AS owned_by, NULL AS owner_dept,
         NULL AS exposure, os_version, last_seen, mk_serial,mk_mac,mk_host,
         raw_data,loaded_at
  FROM STG.ASSET__CROWDSTRIKE
  UNION ALL
  SELECT source_system,source_native_id,hostname,ip_address,mac_address,
         serial,device_type,owned_by,owner_dept,exposure,
         NULL AS os_version,NULL AS last_seen,mk_serial,mk_mac,mk_host,
         raw_data,loaded_at
  FROM STG.ASSET__CMDB
  -- UNION ALL  STG.ASSET__QUALYS , STG.ASSET__FORESCOUT  (align columns)
);

-- canonical key = first non-null of serial/mac/host ; canonical id = hash(key)
CREATE OR REPLACE TABLE INT.ASSET_XREF AS
SELECT
  source_system, source_native_id,
  COALESCE(mk_serial, mk_mac, mk_host)                       AS canon_key,
  MD5('asset:'||COALESCE(mk_serial, mk_mac, mk_host))        AS asset_id
FROM INT.ASSET_OBS
WHERE COALESCE(mk_serial, mk_mac, mk_host) IS NOT NULL;
```

### A4c. Survivorship (per-field winner by source priority)

```sql
CREATE OR REPLACE TABLE INT.ASSET_GOLDEN AS
WITH joined AS (
  SELECT x.asset_id, o.*, p.priority
  FROM INT.ASSET_OBS o
  JOIN INT.ASSET_XREF x
    ON x.source_system=o.source_system AND x.source_native_id=o.source_native_id
  JOIN INT.SOURCE_PRIORITY p
    ON p.domain='ASSET' AND p.source_system=o.source_system
),
ranked AS (  -- highest priority non-null value per field
  SELECT asset_id,
    FIRST_VALUE(hostname)    IGNORE NULLS OVER w AS hostname,
    FIRST_VALUE(ip_address)  IGNORE NULLS OVER w AS ip_address,
    FIRST_VALUE(mac_address) IGNORE NULLS OVER w AS mac_address,
    FIRST_VALUE(device_type) IGNORE NULLS OVER w AS device_type,
    FIRST_VALUE(owner_dept)  IGNORE NULLS OVER w AS owner_dept,
    FIRST_VALUE(exposure)    IGNORE NULLS OVER w AS exposure,
    FIRST_VALUE(last_seen)   IGNORE NULLS OVER w AS last_seen
  FROM joined
  WINDOW w AS (PARTITION BY asset_id ORDER BY priority DESC)
)
SELECT DISTINCT asset_id, LOWER(SPLIT_PART(hostname,'.',1)) AS hostname,
       ip_address, mac_address, device_type, owner_dept, exposure, last_seen
FROM ranked;
```

(USER / VULN: same pattern — `INT.USER_XREF` keyed by `mk_login`,
`INT.VULN_XREF` keyed by `cve_id`.)

## A5. PUBLISH — assemble the UDM (mirrors Postgres 1:1)

```sql
-- 5.1 NODE_REF (the spine; one row per entity, every domain)
CREATE OR REPLACE TABLE PUBLISH.NODE_REF AS
SELECT asset_id AS node_id,'ASSET' AS entity_type, asset_id AS domain_pk,
       hostname AS display_name, 50 AS criticality, '*' AS data_scope
FROM INT.ASSET_GOLDEN
UNION ALL
SELECT MD5('user:'||mk_login), 'USER', MD5('user:'||mk_login),
       MAX(display_name), 40, '*'
FROM STG.USER__OKTA GROUP BY mk_login
UNION ALL
SELECT MD5('vuln:'||cve_id), 'VULN', MD5('vuln:'||cve_id), cve_id,
       IFF(MAX(kev::int)=1,95,ROUND(MAX(cvss_base)*10)), '*'
FROM STG.VULN__QUALYS GROUP BY cve_id;
-- ... UNION ALL NETWORK / INCIDENT / RISK (same shape)

-- 5.2 DIM_ASSET / DIM_USER / DIM_VULN (golden detail)
CREATE OR REPLACE TABLE PUBLISH.DIM_ASSET AS
SELECT asset_id, hostname, ip_address, mac_address, device_type,
       owner_dept, exposure, NULL AS first_seen, last_seen
FROM INT.ASSET_GOLDEN;

CREATE OR REPLACE TABLE PUBLISH.DIM_USER AS
SELECT MD5('user:'||mk_login) AS user_id, MAX(email) email, MAX(upn) upn,
       MAX(employee_type) employee_type, NULL manager_id,
       BOOLOR_AGG(mfa_enabled) mfa_enabled
FROM STG.USER__OKTA GROUP BY mk_login;

CREATE OR REPLACE TABLE PUBLISH.DIM_VULN AS
SELECT MD5('vuln:'||cve_id) AS vuln_id, cve_id, MAX(cvss_base) cvss_base,
       MAX(severity) severity, BOOLOR_AGG(exploit_available) exploit_available,
       BOOLOR_AGG(kev) kev
FROM STG.VULN__QUALYS GROUP BY cve_id;

-- 5.3 SOURCE_DETAIL (raw per-source fidelity, JSONB)
CREATE OR REPLACE TABLE PUBLISH.SOURCE_DETAIL AS
SELECT MD5(o.source_system||':'||o.source_native_id) AS obs_id,
       x.asset_id AS node_id, o.source_system, o.source_native_id,
       o.raw_data, o.loaded_at
FROM INT.ASSET_OBS o
JOIN INT.ASSET_XREF x USING (source_system,source_native_id)
UNION ALL
SELECT MD5('OKTA:'||source_native_id), MD5('user:'||mk_login),'OKTA',
       source_native_id, raw_data, loaded_at FROM STG.USER__OKTA
UNION ALL
SELECT MD5('QUALYS_VULN:'||source_native_id), MD5('vuln:'||cve_id),
       'QUALYS_VULN', source_native_id, raw_data, loaded_at FROM STG.VULN__QUALYS;

-- 5.4 REL_EDGE (typed graph) — derive cross-domain links
CREATE OR REPLACE TABLE PUBLISH.REL_EDGE AS
-- USER --OWNS--> ASSET   (CMDB owned_by -> user login local-part)
SELECT MD5(u.user_id||a.asset_id||'OWNS') edge_id, u.user_id src_node,
       a.asset_id dst_node,'OWNS' edge_type, 0.9 confidence,'CMDB' source_system,
       CURRENT_TIMESTAMP valid_from, NULL valid_to
FROM STG.ASSET__CMDB c
JOIN INT.ASSET_XREF x ON x.source_system='CMDB' AND x.source_native_id=c.source_native_id
JOIN PUBLISH.DIM_ASSET a ON a.asset_id=x.asset_id
JOIN PUBLISH.DIM_USER  u ON u.upn ILIKE c.owned_by||'@%'
WHERE c.owned_by IS NOT NULL
UNION ALL
-- ASSET --HAS_FINDING--> VULN  (Qualys finding serial -> asset, cve -> vuln)
SELECT MD5(x.asset_id||MD5('vuln:'||v.cve_id)||'HAS_FINDING'), x.asset_id,
       MD5('vuln:'||v.cve_id),'HAS_FINDING',1.0,'QUALYS',CURRENT_TIMESTAMP,NULL
FROM STG.VULN__QUALYS v
JOIN INT.ASSET_XREF x ON x.canon_key = v.mk_serial;
-- ... UNION ALL  CONNECTS_ON / AFFECTS / DERIVED_FROM (same idea)

-- 5.5 SEARCH_DOC (federated search projection; body only — Postgres builds ts)
CREATE OR REPLACE TABLE PUBLISH.SEARCH_DOC AS
SELECT n.node_id, n.entity_type, n.display_name,
       n.display_name||' '||COALESCE(a.hostname,'')||' '||COALESCE(a.ip_address,'')
       ||' '||COALESCE(u.upn,'')||' '||COALESCE(SPLIT_PART(u.upn,'@',1),'')
       ||' '||COALESCE(v.cve_id,'') AS body,
       '*' AS data_scope
FROM PUBLISH.NODE_REF n
LEFT JOIN PUBLISH.DIM_ASSET a ON a.asset_id=n.node_id
LEFT JOIN PUBLISH.DIM_USER  u ON u.user_id =n.node_id
LEFT JOIN PUBLISH.DIM_VULN  v ON v.vuln_id =n.node_id;

-- 5.6 Config tables
CREATE OR REPLACE TABLE PUBLISH.DIM_SOURCE AS
SELECT * FROM VALUES
 ('CROWDSTRIKE','ASSET',OBJECT_CONSTRUCT('tab','EDR'),3),
 ('CMDB','ASSET',OBJECT_CONSTRUCT('tab','CMDB'),4),
 ('QUALYS','ASSET',OBJECT_CONSTRUCT('tab','Vuln Scan'),2),
 ('FORESCOUT','ASSET',OBJECT_CONSTRUCT('tab','NAC'),1),
 ('OKTA','USER',OBJECT_CONSTRUCT('tab','IAM'),5)
 AS t(source_system,domain,display_config,priority);

CREATE OR REPLACE TABLE PUBLISH.ATTRIBUTE_CATALOG AS
SELECT * FROM VALUES
 ('ASSET','CMDB','owned_by','string','internal',FALSE),
 ('USER','OKTA','email','string','pii',TRUE)
 AS t(domain,source_system,attribute_key,data_type,pii_class,indexed);
```

> **Production tip:** make A3–A5 **Snowflake Dynamic Tables**
> (`CREATE DYNAMIC TABLE ... TARGET_LAG='15 minutes' WAREHOUSE=CIP_WH AS <select>`)
> so the whole RAW→PUBLISH pipeline refreshes automatically.

---

# PART B — POSTGRES

Run these on the serving database. (Locally: `npx prisma migrate dev` then
`npm run db:postsetup` execute the equivalents — this is the raw SQL.)

## B1. Extensions (run once)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

## B2. Tables (mirror Snowflake PUBLISH)

```sql
CREATE TABLE node_ref (
  node_id      uuid PRIMARY KEY,
  entity_type  text NOT NULL,
  domain_pk    uuid NOT NULL,
  display_name text NOT NULL,
  criticality  int  NOT NULL DEFAULT 0,
  data_scope   text NOT NULL DEFAULT '*',
  UNIQUE (entity_type, domain_pk)
);
CREATE TABLE dim_asset (
  asset_id uuid PRIMARY KEY REFERENCES node_ref(node_id),
  hostname text, ip_address text, mac_address text, device_type text,
  owner_dept text, exposure text, first_seen timestamptz, last_seen timestamptz
);
CREATE TABLE dim_user (
  user_id uuid PRIMARY KEY REFERENCES node_ref(node_id),
  email text, upn text, employee_type text, manager_id uuid, mfa_enabled boolean
);
CREATE TABLE dim_vuln (
  vuln_id uuid PRIMARY KEY REFERENCES node_ref(node_id),
  cve_id text, cvss_base double precision, severity text,
  exploit_available boolean, kev boolean
);
CREATE TABLE source_detail (
  obs_id uuid PRIMARY KEY,
  node_id uuid REFERENCES node_ref(node_id),
  source_system text NOT NULL, source_native_id text NOT NULL,
  raw_data jsonb NOT NULL, loaded_at timestamptz NOT NULL,
  UNIQUE (source_system, source_native_id)
);
CREATE TABLE rel_edge (
  edge_id uuid PRIMARY KEY,
  src_node uuid NOT NULL REFERENCES node_ref(node_id),
  dst_node uuid NOT NULL REFERENCES node_ref(node_id),
  edge_type text NOT NULL, confidence double precision DEFAULT 1.0,
  source_system text, valid_from timestamptz NOT NULL, valid_to timestamptz,
  UNIQUE (src_node, dst_node, edge_type, source_system)
);
CREATE TABLE dim_source (
  source_system text PRIMARY KEY, domain text,
  field_mapping jsonb, display_config jsonb, priority int
);
CREATE TABLE attribute_catalog (
  domain text, source_system text, attribute_key text,
  data_type text, pii_class text, indexed boolean DEFAULT false,
  PRIMARY KEY (domain, source_system, attribute_key)
);
CREATE TABLE search_doc (
  node_id uuid PRIMARY KEY REFERENCES node_ref(node_id),
  entity_type text NOT NULL, display_name text, body text,
  data_scope text NOT NULL DEFAULT '*'
);
CREATE TABLE load_state (
  table_name text PRIMARY KEY, watermark text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

## B3. Postgres-only constructs (tsvector + indexes)

```sql
ALTER TABLE search_doc
  ADD COLUMN ts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(body,''))) STORED;

CREATE INDEX idx_search_ts        ON search_doc  USING GIN (ts);
CREATE INDEX idx_search_trgm      ON search_doc  USING GIN (display_name gin_trgm_ops);
CREATE INDEX idx_srcdetail_raw    ON source_detail USING GIN (raw_data);
CREATE INDEX idx_srcdetail_node   ON source_detail (node_id);
CREATE INDEX idx_asset_host_trgm  ON dim_asset   USING GIN (hostname gin_trgm_ops);
CREATE INDEX idx_edge_src         ON rel_edge (src_node, edge_type);
CREATE INDEX idx_edge_dst         ON rel_edge (dst_node, edge_type);
```

---

# PART C — LOAD: Snowflake → Postgres

The loader does, per cycle, in **FK-safe order** and **one transaction**:

**Order:** `node_ref` → `dim_asset`/`dim_user`/`dim_vuln` → `source_detail`
→ `rel_edge` → `dim_source`/`attribute_catalog` → `search_doc` → bump
`load_state`.

### C1. Snowflake side — unload each PUBLISH table

```sql
CREATE STAGE IF NOT EXISTS PUBLISH.EXPORT FILE_FORMAT=(TYPE=CSV COMPRESSION=GZIP);

COPY INTO @PUBLISH.EXPORT/node_ref/      FROM PUBLISH.NODE_REF      HEADER=TRUE OVERWRITE=TRUE;
COPY INTO @PUBLISH.EXPORT/dim_asset/     FROM PUBLISH.DIM_ASSET     HEADER=TRUE OVERWRITE=TRUE;
COPY INTO @PUBLISH.EXPORT/dim_user/      FROM PUBLISH.DIM_USER      HEADER=TRUE OVERWRITE=TRUE;
COPY INTO @PUBLISH.EXPORT/dim_vuln/      FROM PUBLISH.DIM_VULN      HEADER=TRUE OVERWRITE=TRUE;
COPY INTO @PUBLISH.EXPORT/source_detail/ FROM PUBLISH.SOURCE_DETAIL HEADER=TRUE OVERWRITE=TRUE;
COPY INTO @PUBLISH.EXPORT/rel_edge/      FROM PUBLISH.REL_EDGE      HEADER=TRUE OVERWRITE=TRUE;
COPY INTO @PUBLISH.EXPORT/dim_source/    FROM PUBLISH.DIM_SOURCE    HEADER=TRUE OVERWRITE=TRUE;
COPY INTO @PUBLISH.EXPORT/attr_catalog/  FROM PUBLISH.ATTRIBUTE_CATALOG HEADER=TRUE OVERWRITE=TRUE;
COPY INTO @PUBLISH.EXPORT/search_doc/    FROM PUBLISH.SEARCH_DOC    HEADER=TRUE OVERWRITE=TRUE;
-- then GET @PUBLISH.EXPORT ... to a landing dir (or read the stage from the loader)
```

### C2. Postgres side — stage + upsert (per table, FK-safe order)

```sql
BEGIN;

CREATE TEMP TABLE node_ref_stg (LIKE node_ref INCLUDING DEFAULTS);
\copy node_ref_stg FROM 'node_ref.csv' WITH (FORMAT csv, HEADER true);
INSERT INTO node_ref SELECT * FROM node_ref_stg
  ON CONFLICT (node_id) DO UPDATE SET
    entity_type=EXCLUDED.entity_type, domain_pk=EXCLUDED.domain_pk,
    display_name=EXCLUDED.display_name, criticality=EXCLUDED.criticality,
    data_scope=EXCLUDED.data_scope;

-- repeat the staging + ON CONFLICT upsert for dim_asset, dim_user, dim_vuln,
-- source_detail, rel_edge, dim_source, attribute_catalog, search_doc
-- (search_doc.ts is GENERATED — never inserted)

-- expire temporal edges no longer present
UPDATE rel_edge e SET valid_to = now()
WHERE valid_to IS NULL
  AND NOT EXISTS (SELECT 1 FROM rel_edge_stg s WHERE s.edge_id = e.edge_id);

INSERT INTO load_state(table_name,watermark) VALUES ('ALL', now()::text)
  ON CONFLICT (table_name) DO UPDATE SET watermark=EXCLUDED.watermark, updated_at=now();

COMMIT;

ANALYZE;   -- keep the planner using GIN/trgm indexes
```

> The repo's `npm run load` ([src/scripts/load.ts](src/scripts/load.ts)) does
> exactly C2 (chunked `createMany` instead of `\copy`, idempotent
> full-refresh) — use it as the reference implementation; swap the JSON
> fixtures for the Snowflake stage in production.

---

# Quick checklist

| # | Where | What |
|---|---|---|
| 1 | Snowflake | A1 schemas + A2 RAW tables (once) |
| 2 | Snowflake | A3 STG normalize per source |
| 3 | Snowflake | A4 INT config + resolution + survivorship |
| 4 | Snowflake | A5 PUBLISH assemble UDM (prefer Dynamic Tables) |
| 5 | Postgres | B1 extensions (once) |
| 6 | Postgres | B2 tables (once) |
| 7 | Postgres | B3 tsvector + indexes (once) |
| 8 | Both | C1 unload + C2 staged upsert (every cycle) |

After step 8, validate with: `SELECT entity_type, count(*) FROM node_ref GROUP BY 1;`
and the API smoke test (`npm run smoke`).
