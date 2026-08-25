import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { isEligibleReconciliationReviewer } from "../../domain/reconciliation/reviewerEligibility";
import { DailyReconciliationLineNotFoundError } from "./captureBinCard";

export class BinCardNotYetCapturedError extends Error {}
export class LineAlreadyReviewedError extends Error {}

export interface ReviewReconciliationLineParams {
  actorUserId: string;
  actorRole: RoleName;
  lineId: string;
}

/**
 * G-26 review — not a hard SoD block: an ineligible reviewer's review is
 * still accepted, but the line is excluded from "clean close" and routed
 * to the Auditor, exactly matching isEligibleReconciliationReviewer's own
 * contract. A mismatch (binCardQty != systemExpectedClosingQty) routes to
 * the Auditor too, for the same reason.
 */
export async function reviewReconciliationLine(prisma: PrismaClient, params: ReviewReconciliationLineParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "reconciliation.review.create" });

  const line = await prisma.dailyReconciliationLine.findUnique({
    where: { id: params.lineId },
    include: { dailyReconciliation: true },
  });
  if (!line) throw new DailyReconciliationLineNotFoundError(params.lineId);
  if (line.binCardQty === null) {
    throw new BinCardNotYetCapturedError("The bin-card count must be captured before this line can be reviewed.");
  }

  return prisma.$transaction(async (tx) => {
    const eligible = await isEligibleReconciliationReviewer(tx, {
      branchId: line.dailyReconciliation.branchId,
      productVariantId: line.productVariantId,
      businessDate: line.dailyReconciliation.businessDate,
      candidateUserId: params.actorUserId,
    });
    const routedToAuditor = line.matched !== true || !eligible;

    // Atomic claim + write in one step — reviewedBy: null in the WHERE
    // clause is what actually prevents a concurrent double-review.
    const claim = await tx.dailyReconciliationLine.updateMany({
      where: { id: line.id, reviewedBy: null },
      data: {
        reviewedBy: params.actorUserId,
        reviewerEligible: eligible,
        reviewedAt: new Date(),
        routedToAuditor,
      },
    });
    if (claim.count === 0) {
      throw new LineAlreadyReviewedError(`Line ${line.id} has already been reviewed.`);
    }

    const updated = await tx.dailyReconciliationLine.findUniqueOrThrow({ where: { id: line.id } });

    if (routedToAuditor) {
      const existingCase = await tx.discrepancyCase.findFirst({
        where: { referenceType: "DailyReconciliationLine", referenceId: line.id, status: "OPEN" },
      });
      if (!existingCase) {
        await tx.discrepancyCase.create({
          data: {
            referenceType: "DailyReconciliationLine",
            referenceId: line.id,
            openedBy: params.actorUserId,
            notes: !eligible
              ? `Reconciliation review routed to Auditor: reviewer was not eligible (touched this product's ledger today, G-26).`
              : `Reconciliation review routed to Auditor: bin-card count did not match system expected closing quantity (variance ${line.variance?.toString() ?? "unknown"}).`,
          },
        });
      }
    }

    return updated;
  });
}
