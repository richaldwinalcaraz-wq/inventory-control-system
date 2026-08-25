-- CreateTable
CREATE TABLE "daily_reconciliation" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "prepared_by" TEXT NOT NULL,
    "prepared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_off_by" TEXT,
    "signed_off_at" TIMESTAMP(3),

    CONSTRAINT "daily_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reconciliation_line" (
    "id" TEXT NOT NULL,
    "daily_reconciliation_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "warehouse_location_id" TEXT NOT NULL,
    "opening_qty" DECIMAL(18,4) NOT NULL,
    "stock_in_qty" DECIMAL(18,4) NOT NULL,
    "stock_out_qty" DECIMAL(18,4) NOT NULL,
    "system_expected_closing_qty" DECIMAL(18,4) NOT NULL,
    "bin_card_qty" DECIMAL(18,4),
    "variance" DECIMAL(18,4),
    "matched" BOOLEAN,
    "reviewed_by" TEXT,
    "reviewer_eligible" BOOLEAN,
    "reviewed_at" TIMESTAMP(3),
    "routed_to_auditor" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "daily_reconciliation_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_reconciliation_branch_id_business_date_key" ON "daily_reconciliation"("branch_id", "business_date");

-- AddForeignKey
ALTER TABLE "daily_reconciliation_line" ADD CONSTRAINT "daily_reconciliation_line_daily_reconciliation_id_fkey" FOREIGN KEY ("daily_reconciliation_id") REFERENCES "daily_reconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
