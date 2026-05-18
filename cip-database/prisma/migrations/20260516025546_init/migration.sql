-- CreateTable
CREATE TABLE "node_ref" (
    "node_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "domain_pk" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "criticality" INTEGER NOT NULL DEFAULT 0,
    "data_scope" TEXT NOT NULL DEFAULT '*',

    CONSTRAINT "node_ref_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "dim_asset" (
    "asset_id" TEXT NOT NULL,
    "hostname" TEXT,
    "ip_address" TEXT,
    "mac_address" TEXT,
    "device_type" TEXT,
    "owner_dept" TEXT,
    "exposure" TEXT,
    "first_seen" TIMESTAMP(3),
    "last_seen" TIMESTAMP(3),

    CONSTRAINT "dim_asset_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "dim_user" (
    "user_id" TEXT NOT NULL,
    "email" TEXT,
    "upn" TEXT,
    "employee_type" TEXT,
    "manager_id" TEXT,
    "mfa_enabled" BOOLEAN,

    CONSTRAINT "dim_user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "dim_vuln" (
    "vuln_id" TEXT NOT NULL,
    "cve_id" TEXT,
    "cvss_base" DOUBLE PRECISION,
    "severity" TEXT,
    "exploit_available" BOOLEAN,
    "kev" BOOLEAN,

    CONSTRAINT "dim_vuln_pkey" PRIMARY KEY ("vuln_id")
);

-- CreateTable
CREATE TABLE "source_detail" (
    "obs_id" TEXT NOT NULL,
    "node_id" TEXT,
    "source_system" TEXT NOT NULL,
    "source_native_id" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "loaded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_detail_pkey" PRIMARY KEY ("obs_id")
);

-- CreateTable
CREATE TABLE "rel_edge" (
    "edge_id" TEXT NOT NULL,
    "src_node" TEXT NOT NULL,
    "dst_node" TEXT NOT NULL,
    "edge_type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source_system" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),

    CONSTRAINT "rel_edge_pkey" PRIMARY KEY ("edge_id")
);

-- CreateTable
CREATE TABLE "dim_source" (
    "source_system" TEXT NOT NULL,
    "domain" TEXT,
    "field_mapping" JSONB,
    "display_config" JSONB,
    "priority" INTEGER,

    CONSTRAINT "dim_source_pkey" PRIMARY KEY ("source_system")
);

-- CreateTable
CREATE TABLE "attribute_catalog" (
    "domain" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "attribute_key" TEXT NOT NULL,
    "data_type" TEXT,
    "pii_class" TEXT,
    "indexed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "attribute_catalog_pkey" PRIMARY KEY ("domain","source_system","attribute_key")
);

-- CreateTable
CREATE TABLE "search_doc" (
    "node_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "display_name" TEXT,
    "body" TEXT,
    "data_scope" TEXT NOT NULL DEFAULT '*',

    CONSTRAINT "search_doc_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "load_state" (
    "table_name" TEXT NOT NULL,
    "watermark" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_state_pkey" PRIMARY KEY ("table_name")
);

-- CreateIndex
CREATE INDEX "node_ref_entity_type_idx" ON "node_ref"("entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "node_ref_entity_type_domain_pk_key" ON "node_ref"("entity_type", "domain_pk");

-- CreateIndex
CREATE INDEX "dim_asset_hostname_idx" ON "dim_asset"("hostname");

-- CreateIndex
CREATE INDEX "dim_user_email_idx" ON "dim_user"("email");

-- CreateIndex
CREATE INDEX "dim_vuln_cve_id_idx" ON "dim_vuln"("cve_id");

-- CreateIndex
CREATE INDEX "source_detail_node_id_idx" ON "source_detail"("node_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_detail_source_system_source_native_id_key" ON "source_detail"("source_system", "source_native_id");

-- CreateIndex
CREATE INDEX "rel_edge_src_node_edge_type_idx" ON "rel_edge"("src_node", "edge_type");

-- CreateIndex
CREATE INDEX "rel_edge_dst_node_edge_type_idx" ON "rel_edge"("dst_node", "edge_type");

-- CreateIndex
CREATE UNIQUE INDEX "rel_edge_src_node_dst_node_edge_type_source_system_key" ON "rel_edge"("src_node", "dst_node", "edge_type", "source_system");

-- AddForeignKey
ALTER TABLE "dim_asset" ADD CONSTRAINT "dim_asset_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "node_ref"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dim_user" ADD CONSTRAINT "dim_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "node_ref"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dim_vuln" ADD CONSTRAINT "dim_vuln_vuln_id_fkey" FOREIGN KEY ("vuln_id") REFERENCES "node_ref"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_detail" ADD CONSTRAINT "source_detail_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "node_ref"("node_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rel_edge" ADD CONSTRAINT "rel_edge_src_node_fkey" FOREIGN KEY ("src_node") REFERENCES "node_ref"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rel_edge" ADD CONSTRAINT "rel_edge_dst_node_fkey" FOREIGN KEY ("dst_node") REFERENCES "node_ref"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_doc" ADD CONSTRAINT "search_doc_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "node_ref"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;
