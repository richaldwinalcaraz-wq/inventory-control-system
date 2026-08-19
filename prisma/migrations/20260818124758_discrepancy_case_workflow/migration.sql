-- DropIndex
DROP INDEX "adjustment_request_product_variant_id_warehouse_location_id_cre";

-- DropIndex
DROP INDEX "adjustment_request_requested_by_created_at_idx";

-- AlterTable
ALTER TABLE "discrepancy_case" ADD COLUMN     "assigned_to" TEXT,
ADD COLUMN     "resolution" TEXT;
