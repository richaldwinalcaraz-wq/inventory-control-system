-- Phase 2: Adjustments — the most heavily controlled transaction type,
-- including G-21's rolling-7-day cumulative approval routing.
--
-- Hand-written (not `prisma migrate dev`) for the same reason as every
-- other migration this phase — see schema.prisma's header comment.

CREATE TYPE "AdjustmentReasonCode" AS ENUM ('ADJ_01', 'ADJ_02', 'ADJ_03', 'ADJ_04', 'ADJ_05', 'ADJ_06', 'ADJ_07', 'ADJ_08', 'ADJ_09', 'ADJ_10');

CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'PENDING_INVESTIGATION', 'PENDING_APPROVAL', 'APPROVED', 'PENDING_POSTING', 'POSTED', 'REJECTED', 'VOID');

CREATE TABLE "adjustment_request" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "warehouse_location_id" TEXT NOT NULL,
    "reason_code" "AdjustmentReasonCode" NOT NULL,
    "quantity_delta" DECIMAL(18,4) NOT NULL,
    "unit_cost_at_request" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "reconciliation_notes" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_by" TEXT NOT NULL,
    "investigated_by" TEXT,
    "investigation_notes" TEXT,
    "approved_by" TEXT,
    "approval_tier" "RoleName",
    "posted_by" TEXT,
    "document_number_id" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adjustment_request_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "adjustment_request_document_number_id_key" ON "adjustment_request" ("document_number_id");
CREATE INDEX "adjustment_request_requested_by_created_at_idx" ON "adjustment_request" ("requested_by", "created_at");
CREATE INDEX "adjustment_request_product_variant_id_warehouse_location_id_created_at_idx" ON "adjustment_request" ("product_variant_id", "warehouse_location_id", "created_at");

ALTER TABLE "adjustment_request" ADD CONSTRAINT "adjustment_request_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "adjustment_request" ADD CONSTRAINT "adjustment_request_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "adjustment_request" ADD CONSTRAINT "adjustment_request_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "adjustment_request" ADD CONSTRAINT "adjustment_request_document_number_id_fkey" FOREIGN KEY ("document_number_id") REFERENCES "document_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "adjustment_velocity_lock" (
    "requester_id" TEXT NOT NULL,

    CONSTRAINT "adjustment_velocity_lock_pkey" PRIMARY KEY ("requester_id")
);
