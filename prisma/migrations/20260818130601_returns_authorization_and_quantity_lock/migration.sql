-- CreateEnum
CREATE TYPE "ReturnReasonCode" AS ENUM ('WRONG_ITEM', 'WRONG_SIZE_GAUGE', 'DAMAGED_ON_DELIVERY', 'DEFECTIVE', 'OVER_DELIVERED', 'CUSTOMER_CANCELLED', 'UNSOLD_STOCK_RETURN');

-- CreateEnum
CREATE TYPE "ReturnIdentityVerification" AS ENUM ('PHYSICAL_RECEIPT', 'MATCHED_IDENTITY', 'NONE');

-- CreateEnum
CREATE TYPE "ReturnGrade" AS ENUM ('SELLABLE', 'REPACKABLE', 'DAMAGED', 'NOT_OURS');

-- CreateEnum
CREATE TYPE "ReturnAuthorizationStatus" AS ENUM ('ISSUED', 'GOODS_RECEIVED', 'GRADING_DISPUTED', 'GRADED', 'REJECTED_NOT_OURS', 'VOID', 'EXPIRED');

-- CreateTable
CREATE TABLE "return_authorization" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "original_sale_type" TEXT NOT NULL,
    "original_sale_line_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "requested_qty" DECIMAL(18,4) NOT NULL,
    "reason_code" "ReturnReasonCode" NOT NULL,
    "identity_verification" "ReturnIdentityVerification" NOT NULL,
    "is_high_risk" BOOLEAN NOT NULL DEFAULT false,
    "verified_id_name" TEXT,
    "verified_id_contact" TEXT,
    "issued_by" TEXT NOT NULL,
    "status" "ReturnAuthorizationStatus" NOT NULL DEFAULT 'ISSUED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "final_grade" "ReturnGrade",
    "final_grade_decided_by" TEXT,
    "final_grade_decided_at" TIMESTAMP(3),
    "document_number_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_authorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_quantity_lock" (
    "original_sale_type" TEXT NOT NULL,
    "original_sale_line_id" TEXT NOT NULL,

    CONSTRAINT "return_quantity_lock_pkey" PRIMARY KEY ("original_sale_type","original_sale_line_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_authorization_document_number_id_key" ON "return_authorization"("document_number_id");

-- CreateIndex
CREATE INDEX "return_authorization_original_sale_type_original_sale_line__idx" ON "return_authorization"("original_sale_type", "original_sale_line_id");

-- AddForeignKey
ALTER TABLE "return_authorization" ADD CONSTRAINT "return_authorization_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_authorization" ADD CONSTRAINT "return_authorization_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_authorization" ADD CONSTRAINT "return_authorization_document_number_id_fkey" FOREIGN KEY ("document_number_id") REFERENCES "document_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;
