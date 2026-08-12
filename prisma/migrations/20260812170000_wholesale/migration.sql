-- Phase 2: Wholesale release — Customer/SalesOrder stand-ins, reservations
-- (with a dedicated write-skew lock), the picker/checker/spot-recount
-- pipeline, and partial-delivery-capable releases with a hard gate
-- weight/seal precondition on posting.
--
-- Hand-written (not `prisma migrate dev`) for the same reason as every
-- other migration this phase — see schema.prisma's header comment.

ALTER TABLE "product" ADD COLUMN "unit_weight_kg" DECIMAL(10,3);

CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "credit_limit" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'RESERVED', 'PICKING', 'STAGED', 'CHECKED', 'PENDING_RELEASE_APPROVAL', 'RELEASED_PARTIAL', 'RELEASED', 'VOID');

CREATE TABLE "sales_order" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "sales_rep_id" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_delivery_date" DATE,
    "confirmed_by" TEXT,
    "picked_by" TEXT,
    "picked_at" TIMESTAMP(3),
    "checked_by" TEXT,
    "checked_at" TIMESTAMP(3),
    "spot_recount_required" BOOLEAN NOT NULL DEFAULT false,
    "spot_recount_rolled_at" TIMESTAMP(3),
    "authorized_by" TEXT,
    "authorized_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sales_order_line" (
    "id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "ordered_qty" DECIMAL(18,4) NOT NULL,
    "picked_qty" DECIMAL(18,4),
    "checked_qty" DECIMAL(18,4),
    "released_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sales_order_line_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "stock_reservation" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_reservation_branch_id_product_variant_id_status_idx" ON "stock_reservation" ("branch_id", "product_variant_id", "status");
CREATE INDEX "stock_reservation_reference_type_reference_id_idx" ON "stock_reservation" ("reference_type", "reference_id");

ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_reservation_lock" (
    "product_variant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "stock_reservation_lock_pkey" PRIMARY KEY ("product_variant_id", "branch_id")
);

CREATE TYPE "SalesOrderReleaseStatus" AS ENUM ('PENDING_GATE_CHECK', 'RELEASED', 'POSTED', 'VOID');

CREATE TABLE "sales_order_release" (
    "id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "seal_number" TEXT,
    "expected_weight_min_kg" DECIMAL(10,3),
    "expected_weight_max_kg" DECIMAL(10,3),
    "actual_weight_kg" DECIMAL(10,3),
    "weight_check_passed" BOOLEAN,
    "seal_verified_intact" BOOLEAN,
    "gate_log_entry_out_id" TEXT,
    "document_number_id" TEXT,
    "released_by" TEXT,
    "pod_returned_at" TIMESTAMP(3),
    "customer_confirmed_at" TIMESTAMP(3),
    "status" "SalesOrderReleaseStatus" NOT NULL DEFAULT 'PENDING_GATE_CHECK',
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_order_release_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_order_release_document_number_id_key" ON "sales_order_release" ("document_number_id");

ALTER TABLE "sales_order_release" ADD CONSTRAINT "sales_order_release_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_release" ADD CONSTRAINT "sales_order_release_document_number_id_fkey" FOREIGN KEY ("document_number_id") REFERENCES "document_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "sales_order_release_line" (
    "id" TEXT NOT NULL,
    "sales_order_release_id" TEXT NOT NULL,
    "sales_order_line_id" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "sales_order_release_line_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_order_release_line" ADD CONSTRAINT "sales_order_release_line_sales_order_release_id_fkey" FOREIGN KEY ("sales_order_release_id") REFERENCES "sales_order_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_release_line" ADD CONSTRAINT "sales_order_release_line_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
