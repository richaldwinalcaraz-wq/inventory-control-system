-- CreateEnum
CREATE TYPE "DamageReportStatus" AS ENUM ('REPORTED', 'INVESTIGATED', 'DISPOSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisposalDisposition" AS ENUM ('DESTROY', 'SCRAP_SALE', 'RETURN_TO_SUPPLIER', 'SELL_AS_SECONDS');

-- CreateEnum
CREATE TYPE "DisposalCertificateStatus" AS ENUM ('DRAFT', 'FOR_DISPOSAL', 'POSTED', 'VOID');

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'DAMAGE_OUT';

-- AlterTable
ALTER TABLE "adjustment_request" ADD COLUMN     "damage_report_id" TEXT;

-- CreateTable
CREATE TABLE "return_grading" (
    "id" TEXT NOT NULL,
    "return_authorization_id" TEXT NOT NULL,
    "grader_seq" INTEGER NOT NULL,
    "graded_by" TEXT NOT NULL,
    "grade" "ReturnGrade" NOT NULL,
    "notes" TEXT,
    "graded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_grading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_report" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "warehouse_location_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_reference_type" TEXT,
    "source_reference_id" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reported_by" TEXT NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cause" TEXT NOT NULL,
    "status" "DamageReportStatus" NOT NULL DEFAULT 'REPORTED',
    "quarantine_entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_report_disposal_lock" (
    "damage_report_id" TEXT NOT NULL,

    CONSTRAINT "damage_report_disposal_lock_pkey" PRIMARY KEY ("damage_report_id")
);

-- CreateTable
CREATE TABLE "disposal_certificate" (
    "id" TEXT NOT NULL,
    "damage_report_id" TEXT NOT NULL,
    "disposition" "DisposalDisposition" NOT NULL,
    "decided_by" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "value_at_cost" DECIMAL(18,4) NOT NULL,
    "witness1_id" TEXT NOT NULL,
    "witness2_id" TEXT NOT NULL,
    "status" "DisposalCertificateStatus" NOT NULL DEFAULT 'DRAFT',
    "for_disposal_entered_at" TIMESTAMP(3),
    "document_number_id" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disposal_certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_buyer_benchmark" (
    "id" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "benchmark_rate_per_kg" DECIMAL(12,2) NOT NULL,
    "approved_by" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scrap_buyer_benchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_sale_record" (
    "id" TEXT NOT NULL,
    "disposal_certificate_id" TEXT NOT NULL,
    "buyer_id" TEXT,
    "buyer_name" TEXT NOT NULL,
    "price_per_kg" DECIMAL(12,2) NOT NULL,
    "weight_kg" DECIMAL(10,3) NOT NULL,
    "total_value" DECIMAL(18,4) NOT NULL,
    "quotes_on_file" JSONB,
    "scrap_buyer_benchmark_id" TEXT,
    "below_benchmark" BOOLEAN NOT NULL DEFAULT false,
    "owner_approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrap_sale_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_grading_return_authorization_id_grader_seq_key" ON "return_grading"("return_authorization_id", "grader_seq");

-- CreateIndex
CREATE UNIQUE INDEX "disposal_certificate_document_number_id_key" ON "disposal_certificate"("document_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "scrap_sale_record_disposal_certificate_id_key" ON "scrap_sale_record"("disposal_certificate_id");

-- AddForeignKey
ALTER TABLE "adjustment_request" ADD CONSTRAINT "adjustment_request_damage_report_id_fkey" FOREIGN KEY ("damage_report_id") REFERENCES "damage_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_grading" ADD CONSTRAINT "return_grading_return_authorization_id_fkey" FOREIGN KEY ("return_authorization_id") REFERENCES "return_authorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_report" ADD CONSTRAINT "damage_report_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_report" ADD CONSTRAINT "damage_report_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_report" ADD CONSTRAINT "damage_report_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposal_certificate" ADD CONSTRAINT "disposal_certificate_damage_report_id_fkey" FOREIGN KEY ("damage_report_id") REFERENCES "damage_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposal_certificate" ADD CONSTRAINT "disposal_certificate_document_number_id_fkey" FOREIGN KEY ("document_number_id") REFERENCES "document_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_sale_record" ADD CONSTRAINT "scrap_sale_record_disposal_certificate_id_fkey" FOREIGN KEY ("disposal_certificate_id") REFERENCES "disposal_certificate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
