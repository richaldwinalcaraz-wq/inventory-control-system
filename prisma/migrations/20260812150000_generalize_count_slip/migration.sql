-- Phase 2 sec.2: generalize count_slip from a hard FK on receiving_report_id
-- to a generic (reference_type, reference_id) pair, matching gate_log_entry
-- / transaction_evidence / discrepancy_case's existing polymorphic pattern.
-- Wholesale's blind checker recount and Adjustment's blind recount reuse
-- this same table rather than each getting their own copy of the blind-
-- count mechanism.
--
-- Hand-written (not `prisma migrate dev`) because this database already has
-- hand-written triggers / the UTC timezone fix / a partial unique index
-- that migrate dev's drift detection doesn't know about — see the header
-- comment in schema.prisma.

-- 1. Add the new enum values. Postgres requires ADD VALUE to not be used in
--    the same transaction it's added in, which is fine here — this
--    migration doesn't insert any rows using them.
ALTER TYPE "CountSlipRole" ADD VALUE IF NOT EXISTS 'WHOLESALE_CHECK';
ALTER TYPE "CountSlipRole" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_RECOUNT';
ALTER TYPE "CountSlipRole" ADD VALUE IF NOT EXISTS 'SPOT_RECOUNT';

-- 2. Add the new generic columns, nullable for now so the backfill below
--    can populate them before we enforce NOT NULL.
ALTER TABLE "count_slip" ADD COLUMN "reference_type" TEXT;
ALTER TABLE "count_slip" ADD COLUMN "reference_id" TEXT;

-- 3. Backfill every existing row as a ReceivingReport reference — the only
--    kind of count slip that has ever existed before this migration.
UPDATE "count_slip" SET "reference_type" = 'ReceivingReport', "reference_id" = "receiving_report_id";

-- 4. Now safe to enforce NOT NULL.
ALTER TABLE "count_slip" ALTER COLUMN "reference_type" SET NOT NULL;
ALTER TABLE "count_slip" ALTER COLUMN "reference_id" SET NOT NULL;

-- 5. Drop the old FK column — this also drops its FK constraint automatically.
ALTER TABLE "count_slip" DROP COLUMN "receiving_report_id";

-- 6. Hard DB-level "one slip per role per reference" guarantee — closes a
--    latent Phase 1 gap where this was only an application-layer check.
ALTER TABLE "count_slip" ADD CONSTRAINT "count_slip_reference_type_reference_id_role_key" UNIQUE ("reference_type", "reference_id", "role");

-- 7. Lookup index for the common query shape (find all slips for one reference).
CREATE INDEX "count_slip_reference_type_reference_id_idx" ON "count_slip" ("reference_type", "reference_id");
