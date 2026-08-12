import type { Prisma, RoleName } from "@prisma/client";

const WINDOW_DAYS = 7;

/**
 * Serializes same-requester adjustment submissions/approvals so the G-21
 * rolling-total computation below can't race — two submissions by the SAME
 * requester within the same second could otherwise each read a stale total
 * and both land in a lower tier than their true combined total requires.
 * Lazily-upserted-then-FOR-UPDATE, same pattern as document_sequence
 * (documentNumber.ts). Deliberately scoped per-requester, not global — G-21
 * only cares about one person's rolling total, so unrelated requesters'
 * submissions must never serialize against each other.
 */
export async function lockAdjustmentVelocity(tx: Prisma.TransactionClient, requesterId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO adjustment_velocity_lock (requester_id) VALUES (${requesterId})
    ON CONFLICT (requester_id) DO NOTHING
  `;
  await tx.$queryRaw`SELECT requester_id FROM adjustment_velocity_lock WHERE requester_id = ${requesterId} FOR UPDATE`;
}

/**
 * G-21: the sum is over ABSOLUTE value, not signed net — A-9 exists
 * specifically because offsetting +/- adjustments that net near zero are a
 * known concealment pattern; a signed sum would silently reopen exactly
 * that loophole. Only non-VOID, non-REJECTED requests count — a rejected
 * or voided request never became a real adjustment and shouldn't inflate
 * the requester's velocity. Caller must hold lockAdjustmentVelocity first.
 */
export async function computeRollingAdjustmentTotal(tx: Prisma.TransactionClient, requesterId: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await tx.adjustmentRequest.findMany({
    where: { requestedBy: requesterId, createdAt: { gte: since }, status: { notIn: ["VOID", "REJECTED"] } },
    select: { value: true },
  });
  return rows.reduce((sum, r) => sum + Math.abs(Number(r.value)), 0);
}

/**
 * The one piece of G-21 that can't be lazy: run this right after a NEW
 * request is created (which can only ever push the rolling total up, never
 * down), and pull back any same-requester sibling that's APPROVED-but-not-
 * yet-POSTED whose already-granted tier no longer matches what the new,
 * higher total requires. Everything else about G-21 stays lazy (recomputed
 * fresh at each request's own approval attempt) — this is the only active
 * write needed.
 */
export async function downgradeInsufficientApprovedSiblings(
  tx: Prisma.TransactionClient,
  params: { requesterId: string; excludeRequestId: string; requiredTier: RoleName },
): Promise<string[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const siblings = await tx.adjustmentRequest.findMany({
    where: { requestedBy: params.requesterId, id: { not: params.excludeRequestId }, status: "APPROVED", createdAt: { gte: since } },
  });

  const downgradedIds: string[] = [];
  for (const sibling of siblings) {
    // Rolling total only grows from a new submission, so a plain
    // inequality is enough to detect "insufficient" — no role-ranking
    // table needed (see AdjustmentRequest.approvalTier's schema comment).
    if (sibling.approvalTier !== params.requiredTier) {
      await tx.adjustmentRequest.update({ where: { id: sibling.id }, data: { status: "PENDING_APPROVAL", approvalTier: null } });
      await tx.auditLog.create({
        data: {
          actorId: params.requesterId,
          action: "adjustment.approval.downgraded",
          entityType: "AdjustmentRequest",
          entityId: sibling.id,
          afterState: {
            reason: "G-21: a new submission raised the requester's rolling 7-day total; the prior approval tier is no longer sufficient.",
            requiredTier: params.requiredTier,
            previousTier: sibling.approvalTier,
          },
        },
      });
      downgradedIds.push(sibling.id);
    }
  }
  return downgradedIds;
}
