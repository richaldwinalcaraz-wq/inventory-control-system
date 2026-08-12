import type { PrismaClient } from "@prisma/client";
import { GENESIS_HASH, hashLedgerRow } from "./postLedgerEntry";

export interface ChainVerificationResult {
  valid: boolean;
  totalRows: number;
  brokenAtSequenceNo?: bigint;
  /** Only set when valid — the hash a LedgerHashExport for "today" should publish. */
  terminalHash: string | null;
}

/**
 * Recomputes the entire hash chain from sequenceNo=1 and compares every
 * stored rowHash against what the canonical hashing routine produces from
 * that row's own fields — the same routine the write path
 * (postLedgerEntry) uses, never a second forked copy of the hashing
 * logic. Any row edited outside the app is caught here, and this
 * identifies the exact sequenceNo where the chain first breaks.
 *
 * This is the Auditor-facing, on-demand verification the plan calls for
 * in Phase 1 (automated daily alerting is more natural once Phase 4's
 * reconciliation infrastructure exists, but this function has to exist
 * and be correct now).
 */
export async function verifyChain(prisma: PrismaClient): Promise<ChainVerificationResult> {
  const rows = await prisma.stockLedger.findMany({
    orderBy: { sequenceNo: "asc" },
    select: {
      sequenceNo: true,
      prevHash: true,
      rowHash: true,
      branchId: true,
      productVariantId: true,
      warehouseLocationId: true,
      batchId: true,
      quantityDeltaBase: true,
      movementType: true,
      unitCostAtMovement: true,
      conversionRateVersionId: true,
      referenceType: true,
      referenceId: true,
      documentNumber: true,
      reasonCode: true,
      performedBy: true,
      approvedBy: true,
      createdAt: true,
    },
  });

  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1n;
  for (const row of rows) {
    if (row.sequenceNo !== expectedSeq || row.prevHash !== expectedPrev) {
      return { valid: false, totalRows: rows.length, brokenAtSequenceNo: row.sequenceNo, terminalHash: null };
    }

    const recomputed = hashLedgerRow({
      branchId: row.branchId,
      productVariantId: row.productVariantId,
      warehouseLocationId: row.warehouseLocationId,
      batchId: row.batchId,
      quantityDeltaBase: row.quantityDeltaBase.toString(),
      movementType: row.movementType,
      unitCostAtMovement: row.unitCostAtMovement.toString(),
      conversionRateVersionId: row.conversionRateVersionId,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      documentNumber: row.documentNumber,
      reasonCode: row.reasonCode,
      performedBy: row.performedBy,
      approvedBy: row.approvedBy,
      sequenceNo: row.sequenceNo.toString(),
      createdAt: row.createdAt.toISOString(),
      prevHash: expectedPrev,
    });
    if (recomputed !== row.rowHash) {
      return { valid: false, totalRows: rows.length, brokenAtSequenceNo: row.sequenceNo, terminalHash: null };
    }

    expectedPrev = row.rowHash;
    expectedSeq += 1n;
  }

  return { valid: true, totalRows: rows.length, terminalHash: expectedPrev };
}
