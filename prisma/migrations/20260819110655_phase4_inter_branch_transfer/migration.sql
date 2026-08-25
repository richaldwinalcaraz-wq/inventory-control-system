-- CreateEnum
CREATE TYPE "InterBranchTransferStatus" AS ENUM ('REQUESTED', 'SENDING_APPROVED', 'PICKING', 'STAGED', 'IN_TRANSIT', 'ARRIVED_PENDING_COUNT', 'RECEIVED_CLOSED', 'VARIANCE_DISPUTED', 'VOID');

-- CreateTable
CREATE TABLE "inter_branch_transfer" (
    "id" TEXT NOT NULL,
    "from_branch_id" TEXT NOT NULL,
    "to_branch_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "requested_qty" DECIMAL(18,4) NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sending_approved_by" TEXT,
    "sending_approved_at" TIMESTAMP(3),
    "status" "InterBranchTransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "gate_log_entry_out_id" TEXT,
    "document_number_id" TEXT,
    "received_qty" DECIMAL(18,4),
    "transit_evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "transit_evidence_confirmed_by" TEXT,
    "transit_evidence_confirmed_at" TIMESTAMP(3),
    "discrepancy_case_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inter_branch_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inter_branch_transfer_document_number_id_key" ON "inter_branch_transfer"("document_number_id");

-- AddForeignKey
ALTER TABLE "daily_reconciliation" ADD CONSTRAINT "daily_reconciliation_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_window" ADD CONSTRAINT "cycle_count_window_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_schedule" ADD CONSTRAINT "cycle_count_schedule_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_record" ADD CONSTRAINT "cycle_count_record_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_branch_transfer" ADD CONSTRAINT "inter_branch_transfer_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_branch_transfer" ADD CONSTRAINT "inter_branch_transfer_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_branch_transfer" ADD CONSTRAINT "inter_branch_transfer_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_branch_transfer" ADD CONSTRAINT "inter_branch_transfer_document_number_id_fkey" FOREIGN KEY ("document_number_id") REFERENCES "document_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;
