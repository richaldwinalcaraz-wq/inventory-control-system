-- CreateEnum
CREATE TYPE "CycleCountRecordStatus" AS ENUM ('COUNTING', 'TIEBREAK_PENDING', 'RECOUNT_PENDING', 'VARIANCE_CONFIRMED', 'CLOSED_CLEAN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CountSlipRole" ADD VALUE 'CYCLE_COUNT_PRIMARY';
ALTER TYPE "CountSlipRole" ADD VALUE 'CYCLE_COUNT_SECONDARY';
ALTER TYPE "CountSlipRole" ADD VALUE 'CYCLE_COUNT_RECOUNT';

-- AlterTable
ALTER TABLE "adjustment_request" ADD COLUMN     "cycle_count_record_id" TEXT;

-- AlterTable
ALTER TABLE "count_slip" ADD COLUMN     "collected_by" TEXT,
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "submission_method" TEXT;

-- CreateTable
CREATE TABLE "cycle_count_record" (
    "id" TEXT NOT NULL,
    "cycle_count_window_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "warehouse_location_id" TEXT NOT NULL,
    "cycle_count_class" "CycleCountClass" NOT NULL,
    "cycle_count_schedule_id" TEXT,
    "system_expected_qty" DECIMAL(18,4),
    "decisive_counted_qty" DECIMAL(18,4),
    "tolerance_exceeded" BOOLEAN,
    "status" "CycleCountRecordStatus" NOT NULL DEFAULT 'COUNTING',
    "discrepancy_case_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_count_record_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "adjustment_request" ADD CONSTRAINT "adjustment_request_cycle_count_record_id_fkey" FOREIGN KEY ("cycle_count_record_id") REFERENCES "cycle_count_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_record" ADD CONSTRAINT "cycle_count_record_cycle_count_window_id_fkey" FOREIGN KEY ("cycle_count_window_id") REFERENCES "cycle_count_window"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_record" ADD CONSTRAINT "cycle_count_record_cycle_count_schedule_id_fkey" FOREIGN KEY ("cycle_count_schedule_id") REFERENCES "cycle_count_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
