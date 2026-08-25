import type { Prisma } from "@prisma/client";

export class BranchLockedForCycleCountError extends Error {}
export class InvalidOrExpiredCycleCountWindowExceptionError extends Error {}

/**
 * Lazy-upsert-then-FOR-UPDATE mutex row, same shape as
 * wholesale/reservation.ts's lockReservationRow — guarantees a contendable
 * row exists before two concurrent CycleCountWindow declarations for the
 * same branch can race.
 */
export async function lockCycleCountWindowRow(tx: Prisma.TransactionClient, params: { branchId: string }): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO cycle_count_window_lock (branch_id) VALUES (${params.branchId})
    ON CONFLICT (branch_id) DO NOTHING
  `;
  await tx.$queryRaw`
    SELECT branch_id FROM cycle_count_window_lock
    WHERE branch_id = ${params.branchId}
    FOR UPDATE
  `;
}

/**
 * G-08: blocks new Picking Lists and new Receiving postings branch-wide
 * while a CycleCountWindow is ACTIVE for that branch, unless a valid,
 * unconsumed, matching CycleCountWindowException token is supplied — in
 * which case it's atomically claimed (never reusable) and the caller may
 * proceed. A benign race at the exact declare/close boundary is tolerated
 * here (no lock) — it's caught after the fact by checkCountWindowViolations
 * (Phase 4 build-order step 7), which is the deliberate, documented
 * tradeoff explained in Phase 4 plan sec.2.3.
 *
 * Returns the id of the exception consumed, if any, so the caller can
 * backfill consumedForReferenceId once the new record's id exists.
 */
export async function assertBranchMovementAllowed(
  tx: Prisma.TransactionClient,
  params: { branchId: string; documentType: string; exceptionTokenId?: string },
): Promise<{ exceptionUsed: string | null }> {
  const activeWindow = await tx.cycleCountWindow.findFirst({ where: { branchId: params.branchId, status: "ACTIVE" } });
  if (!activeWindow) return { exceptionUsed: null };

  if (!params.exceptionTokenId) {
    throw new BranchLockedForCycleCountError(
      `Branch ${params.branchId} is under an active cycle count window (${activeWindow.id}) — new ${params.documentType} creation is blocked branch-wide until it closes, unless a Supervisor grants a named exception.`,
    );
  }

  const claim = await tx.cycleCountWindowException.updateMany({
    where: {
      id: params.exceptionTokenId,
      cycleCountWindowId: activeWindow.id,
      documentType: params.documentType,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });

  if (claim.count === 0) {
    throw new InvalidOrExpiredCycleCountWindowExceptionError(
      `Exception token ${params.exceptionTokenId} is invalid, already consumed, expired, or does not match this branch's active window/document type.`,
    );
  }

  return { exceptionUsed: params.exceptionTokenId };
}
