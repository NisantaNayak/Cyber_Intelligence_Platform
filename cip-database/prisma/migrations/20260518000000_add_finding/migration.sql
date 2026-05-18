-- CreateTable
CREATE TABLE "finding" (
    "finding_id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "primary_node" TEXT NOT NULL,
    "related_nodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB NOT NULL,
    "data_scope" TEXT NOT NULL DEFAULT '*',
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_pkey" PRIMARY KEY ("finding_id")
);

-- CreateIndex
CREATE INDEX "finding_rule_key_idx" ON "finding"("rule_key");

-- CreateIndex
CREATE INDEX "finding_primary_node_idx" ON "finding"("primary_node");

-- CreateIndex
CREATE INDEX "finding_severity_idx" ON "finding"("severity");
