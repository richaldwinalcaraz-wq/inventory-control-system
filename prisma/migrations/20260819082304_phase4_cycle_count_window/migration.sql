-- CreateEnum
CREATE TYPE "CycleCountWindowStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "cycle_count_window" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "declared_by" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "status" "CycleCountWindowStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,

    CONSTRAINT "cycle_count_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_count_window_lock" (
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "cycle_count_window_lock_pkey" PRIMARY KEY ("branch_id")
);
