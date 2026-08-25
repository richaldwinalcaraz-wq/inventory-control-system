-- CreateEnum
CREATE TYPE "CycleCountScheduleStatus" AS ENUM ('ON_SCHEDULE', 'DUE', 'OVERDUE', 'MISSED');

-- CreateTable
CREATE TABLE "cycle_count_schedule" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "cycle_count_class" "CycleCountClass" NOT NULL,
    "last_counted_at" TIMESTAMP(3),
    "next_due_at" TIMESTAMP(3) NOT NULL,
    "consecutive_misses" INTEGER NOT NULL DEFAULT 0,
    "forced_auditor_recount" BOOLEAN NOT NULL DEFAULT false,
    "status" "CycleCountScheduleStatus" NOT NULL DEFAULT 'ON_SCHEDULE',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_count_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cycle_count_schedule_branch_id_product_variant_id_key" ON "cycle_count_schedule"("branch_id", "product_variant_id");
