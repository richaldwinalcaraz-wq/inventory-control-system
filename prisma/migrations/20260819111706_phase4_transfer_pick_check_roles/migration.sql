-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CountSlipRole" ADD VALUE 'TRANSFER_PICK';
ALTER TYPE "CountSlipRole" ADD VALUE 'TRANSFER_CHECK';
ALTER TYPE "CountSlipRole" ADD VALUE 'TRANSFER_RECEIVE';
ALTER TYPE "CountSlipRole" ADD VALUE 'TRANSFER_RECEIVE_CHECK';

-- AlterTable
ALTER TABLE "inter_branch_transfer" ADD COLUMN     "checked_qty" DECIMAL(18,4);
