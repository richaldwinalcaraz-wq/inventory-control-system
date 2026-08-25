-- CreateTable
CREATE TABLE "cycle_count_window_exception" (
    "id" TEXT NOT NULL,
    "cycle_count_window_id" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_for_reference_id" TEXT,

    CONSTRAINT "cycle_count_window_exception_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "cycle_count_window_exception" ADD CONSTRAINT "cycle_count_window_exception_cycle_count_window_id_fkey" FOREIGN KEY ("cycle_count_window_id") REFERENCES "cycle_count_window"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
