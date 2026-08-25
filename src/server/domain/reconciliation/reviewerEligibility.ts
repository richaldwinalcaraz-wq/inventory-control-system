import type { Prisma } from "@prisma/client";
import { startOfDayManila } from "../time/businessDate";

export interface ReconciliationReviewerEligibilityParams {
  branchId: string;
  productVariantId: string;
  businessDate: Date;
  candidateUserId: string;
}

/**
 * G-26: per-product-per-day, not per-branch-day like the closest precedent
 * (wholesale's assertEligibleSpotRecountWitness) — BPD's own wording is "did
 * not personally receive, release, or encode transactions for THAT PRODUCT
 * that day," so eligibility must be checked per line, not once for the
 * whole day's reconciliation. Queries StockLedger.performedBy directly —
 * every disqualifying action (RECEIVING, SALE_OUT, TRANSFER_*, RETURN_IN,
 * DAMAGE_OUT, ADJUSTMENT_*) already funnels through it, making it the
 * single, complete, already-existing source of truth (unlike wholesale's
 * narrower per-module-status-column check).
 *
 * Deliberately returns a boolean, not a throw — BPD explicitly allows
 * small-branch reality to force an ineligible reviewer; the caller routes
 * to the Auditor and excludes the line from "clean close" when this is
 * false, it never refuses the review outright.
 */
export async function isEligibleReconciliationReviewer(
  tx: Prisma.TransactionClient,
  params: ReconciliationReviewerEligibilityParams,
): Promise<boolean> {
  const startOfDay = startOfDayManila(params.businessDate);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const conflict = await tx.stockLedger.findFirst({
    where: {
      branchId: params.branchId,
      productVariantId: params.productVariantId,
      performedBy: params.candidateUserId,
      createdAt: { gte: startOfDay, lt: endOfDay },
    },
  });
  return !conflict;
}
