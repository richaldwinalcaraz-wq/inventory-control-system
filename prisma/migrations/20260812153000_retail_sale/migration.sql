-- Phase 2: Retail sale — adds a COUNTER warehouse zone (closing the
-- untracked-counter-stock gap named in business-process-design.md sec.8.1)
-- and the retail_sale / retail_sale_line tables.
--
-- Hand-written (not `prisma migrate dev`) for the same reason as every
-- other migration since the CountSlip generalization — see schema.prisma's
-- header comment.

ALTER TYPE "WarehouseZone" ADD VALUE IF NOT EXISTS 'COUNTER';

CREATE TYPE "RetailSaleStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

CREATE TABLE "retail_sale" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "cashier_id" TEXT NOT NULL,
    "status" "RetailSaleStatus" NOT NULL DEFAULT 'DRAFT',
    "document_number_id" TEXT,
    "gate_log_entry_id" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retail_sale_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retail_sale_document_number_id_key" ON "retail_sale" ("document_number_id");

ALTER TABLE "retail_sale" ADD CONSTRAINT "retail_sale_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retail_sale" ADD CONSTRAINT "retail_sale_document_number_id_fkey" FOREIGN KEY ("document_number_id") REFERENCES "document_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "retail_sale_line" (
    "id" TEXT NOT NULL,
    "retail_sale_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "retail_sale_line_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "retail_sale_line" ADD CONSTRAINT "retail_sale_line_retail_sale_id_fkey" FOREIGN KEY ("retail_sale_id") REFERENCES "retail_sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retail_sale_line" ADD CONSTRAINT "retail_sale_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
