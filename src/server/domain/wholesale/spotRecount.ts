import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { startOfDayManila } from "../time/businessDate";

export class NoEligibleSpotRecountWitnessError extends Error {}

// Placeholders pending client confirmation, same status as every other
// peso/rate default in this codebase (see ApprovalThreshold.isPlaceholder).
const MATERIALITY_THRESHOLD_PESOS = 20000;
const SPOT_RECOUNT_RATE_PERCENT = 20; // flat rate among eligible releases — deliberately not a weighted formula, see Phase 2 plan sec.6

/**
 * G-10: unscheduled, no-advance-notice, genuinely random selection among
 * orders that cross a materiality threshold. crypto.randomInt, never
 * Math.random() — the flag must be unpredictable, not derivable in advance.
 * Orders below the threshold are never flagged.
 */
export function rollSpotRecount(orderValue: number): boolean {
  if (orderValue < MATERIALITY_THRESHOLD_PESOS) return false;
  return randomInt(100) < SPOT_RECOUNT_RATE_PERCENT;
}

/**
 * Day-and-branch-scoped SoD eligibility: a spot-recount witness must have
 * no role in picking, checking, or authorizing ANY sales order at this
 * branch on the current business date — not just this one order, matching
 * business-process-design.md's actual wording ("someone with no role in
 * that day's picking/checking/authorization at that branch").
 */
export async function assertEligibleSpotRecountWitness(
  tx: Prisma.TransactionClient,
  params: { branchId: string; candidateUserId: string; now?: Date },
): Promise<void> {
  const now = params.now ?? new Date();
  const startOfDay = startOfDayManila(now);

  const conflict = await tx.salesOrder.findFirst({
    where: {
      branchId: params.branchId,
      OR: [
        { pickedBy: params.candidateUserId, pickedAt: { gte: startOfDay } },
        { checkedBy: params.candidateUserId, checkedAt: { gte: startOfDay } },
        { authorizedBy: params.candidateUserId, authorizedAt: { gte: startOfDay } },
      ],
    },
  });
  if (conflict) {
    throw new NoEligibleSpotRecountWitnessError(
      `User ${params.candidateUserId} picked, checked, or authorized a sales order at this branch today — not eligible to perform the spot recount (SoD, day-and-branch-scoped).`,
    );
  }
}
