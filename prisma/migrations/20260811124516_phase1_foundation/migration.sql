-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('OWNER', 'BRANCH_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_RECEIVER', 'WAREHOUSE_PICKER', 'WAREHOUSE_CHECKER', 'ENCODER', 'CASHIER', 'SALES_REP', 'AUDITOR', 'SECURITY_GUARD', 'SYSTEM_ADMINISTRATOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('CREATE', 'APPROVE', 'VIEW', 'NONE');

-- CreateEnum
CREATE TYPE "WarehouseZone" AS ENUM ('RECEIVING', 'STORAGE', 'PICKING', 'RELEASE', 'QUARANTINE', 'RETURNS');

-- CreateEnum
CREATE TYPE "CycleCountClass" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "ConversionRateStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIVING', 'OPENING_BALANCE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'SALE_OUT', 'RETURN_IN', 'RETURN_OUT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "BookletStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GateDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ReceivingReportStatus" AS ENUM ('DRAFT', 'PENDING_INSPECTION', 'QUARANTINE', 'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'PENDING_ENCODING', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "CountSlipRole" AS ENUM ('RECEIVER', 'CHECKER', 'TIEBREAK');

-- CreateEnum
CREATE TYPE "CaptureMethod" AS ENUM ('LIVE_CAMERA_STREAM', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscrepancyCaseStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "pin_hash" TEXT,
    "role" "RoleName" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "deactivated_at" TIMESTAMP(3),
    "deactivated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_role" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" TEXT NOT NULL,

    CONSTRAINT "user_branch_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "id" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "action" TEXT NOT NULL,
    "effect" "PermissionEffect" NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_pin_token" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_for_action" TEXT,

    CONSTRAINT "transaction_pin_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_elevation" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "granted_to" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "from_role" "RoleName" NOT NULL,
    "to_role" "RoleName" NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "emergency_elevation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_of_measure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "unit_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_location" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "zone" "WarehouseZone" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "warehouse_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" TEXT,
    "base_unit_id" TEXT NOT NULL,
    "cycle_count_class" "CycleCountClass" NOT NULL DEFAULT 'C',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_rate_version" (
    "id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "from_unit_id" TEXT NOT NULL,
    "to_unit_id" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "status" "ConversionRateStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "proposed_by" TEXT NOT NULL,
    "verified_by_user_1" TEXT,
    "verified_by_user_2" TEXT,
    "effective_from" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_rate_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" BIGSERIAL NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "warehouse_location_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL DEFAULT '',
    "quantity_delta_base" DECIMAL(18,4) NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "unit_cost_at_movement" DECIMAL(18,4) NOT NULL,
    "conversion_rate_version_id" TEXT,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "reason_code" TEXT,
    "performed_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "reversed_by_ledger_id" BIGINT,
    "idempotency_key_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence_no" BIGINT NOT NULL,
    "prev_hash" CHAR(64) NOT NULL,
    "row_hash" CHAR(64) NOT NULL,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_hash_export" (
    "id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "last_sequence_no" BIGINT NOT NULL,
    "terminal_hash" CHAR(64) NOT NULL,
    "exported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipients" TEXT NOT NULL,

    CONSTRAINT "ledger_hash_export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balance" (
    "id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "warehouse_location_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL DEFAULT '',
    "quantity_on_hand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_threshold" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT,
    "transaction_type" TEXT NOT NULL,
    "min_value" DECIMAL(18,2) NOT NULL,
    "max_value" DECIMAL(18,2),
    "required_approver_role" "RoleName" NOT NULL,
    "is_placeholder" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_threshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_booklet_registry" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "range_start" INTEGER NOT NULL,
    "range_end" INTEGER NOT NULL,
    "registered_by" TEXT NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "BookletStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "document_booklet_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequence" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "current_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_number" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "full_number" TEXT NOT NULL,
    "reference_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_number_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "branch_code" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "request_payload_hash" TEXT NOT NULL,
    "result_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_log_entry" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "direction" "GateDirection" NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "vehicle_plate" TEXT,
    "driver_name" TEXT,
    "logged_by" TEXT NOT NULL,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_log_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_report" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "dr_number" TEXT NOT NULL,
    "po_reference" TEXT,
    "status" "ReceivingReportStatus" NOT NULL DEFAULT 'DRAFT',
    "gate_log_entry_id" TEXT,
    "received_by" TEXT NOT NULL,
    "verified_by" TEXT,
    "approved_by" TEXT,
    "encoded_by" TEXT,
    "document_number_id" TEXT,
    "supplier_callback_confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receiving_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_report_line" (
    "id" TEXT NOT NULL,
    "receiving_report_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "expected_qty" DECIMAL(18,4),
    "final_qty" DECIMAL(18,4),
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "line_status" TEXT NOT NULL DEFAULT 'OK',

    CONSTRAINT "receiving_report_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_slip" (
    "id" TEXT NOT NULL,
    "receiving_report_id" TEXT NOT NULL,
    "role" "CountSlipRole" NOT NULL,
    "counted_by" TEXT NOT NULL,
    "witnessed_by" TEXT,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "count_slip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_slip_line" (
    "id" TEXT NOT NULL,
    "count_slip_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "counted_qty" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "count_slip_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_evidence" (
    "id" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "capture_method" "CaptureMethod" NOT NULL,
    "captured_by" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discrepancy_case" (
    "id" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "opened_by" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DiscrepancyCaseStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "closed_by" TEXT,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "discrepancy_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_code_key" ON "branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_role_user_id_branch_id_role_key" ON "user_branch_role"("user_id", "branch_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_role_action_key" ON "role_permission"("role", "action");

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measure_code_key" ON "unit_of_measure"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_branch_id_code_key" ON "warehouse"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_location_warehouse_id_code_key" ON "warehouse_location"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_sku_key" ON "product_variant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "stock_ledger_idempotency_key_id_key" ON "stock_ledger"("idempotency_key_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_ledger_sequence_no_key" ON "stock_ledger"("sequence_no");

-- CreateIndex
CREATE INDEX "stock_ledger_branch_id_product_variant_id_warehouse_locatio_idx" ON "stock_ledger"("branch_id", "product_variant_id", "warehouse_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_hash_export_business_date_key" ON "ledger_hash_export"("business_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balance_product_variant_id_warehouse_location_id_batc_key" ON "stock_balance"("product_variant_id", "warehouse_location_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "period_branch_id_period_start_period_end_key" ON "period"("branch_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequence_branch_id_document_type_year_key" ON "document_sequence"("branch_id", "document_type", "year");

-- CreateIndex
CREATE UNIQUE INDEX "document_number_full_number_key" ON "document_number"("full_number");

-- CreateIndex
CREATE UNIQUE INDEX "document_number_branch_id_document_type_year_sequence_no_key" ON "document_number"("branch_id", "document_type", "year", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_document_type_document_number_branch_code_key" ON "idempotency_key"("document_type", "document_number", "branch_code");

-- CreateIndex
CREATE UNIQUE INDEX "receiving_report_document_number_id_key" ON "receiving_report"("document_number_id");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_role" ADD CONSTRAINT "user_branch_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_role" ADD CONSTRAINT "user_branch_role_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_pin_token" ADD CONSTRAINT "transaction_pin_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_location" ADD CONSTRAINT "warehouse_location_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "unit_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_rate_version" ADD CONSTRAINT "conversion_rate_version_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_rate_version" ADD CONSTRAINT "conversion_rate_version_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "unit_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_rate_version" ADD CONSTRAINT "conversion_rate_version_to_unit_id_fkey" FOREIGN KEY ("to_unit_id") REFERENCES "unit_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_conversion_rate_version_id_fkey" FOREIGN KEY ("conversion_rate_version_id") REFERENCES "conversion_rate_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_idempotency_key_id_fkey" FOREIGN KEY ("idempotency_key_id") REFERENCES "idempotency_key"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_reversed_by_ledger_id_fkey" FOREIGN KEY ("reversed_by_ledger_id") REFERENCES "stock_ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_threshold" ADD CONSTRAINT "approval_threshold_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_booklet_registry" ADD CONSTRAINT "document_booklet_registry_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequence" ADD CONSTRAINT "document_sequence_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_number" ADD CONSTRAINT "document_number_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_log_entry" ADD CONSTRAINT "gate_log_entry_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_report" ADD CONSTRAINT "receiving_report_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_report" ADD CONSTRAINT "receiving_report_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_report" ADD CONSTRAINT "receiving_report_document_number_id_fkey" FOREIGN KEY ("document_number_id") REFERENCES "document_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_report_line" ADD CONSTRAINT "receiving_report_line_receiving_report_id_fkey" FOREIGN KEY ("receiving_report_id") REFERENCES "receiving_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_report_line" ADD CONSTRAINT "receiving_report_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_slip" ADD CONSTRAINT "count_slip_receiving_report_id_fkey" FOREIGN KEY ("receiving_report_id") REFERENCES "receiving_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_slip_line" ADD CONSTRAINT "count_slip_line_count_slip_id_fkey" FOREIGN KEY ("count_slip_id") REFERENCES "count_slip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_slip_line" ADD CONSTRAINT "count_slip_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
