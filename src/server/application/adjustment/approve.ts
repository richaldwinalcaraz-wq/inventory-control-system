import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { resolveRequiredApprover } from "../../domain/approval/resolveRequiredApprover";
import { lockAdjustmentVelocity, computeRollingAdjustmentTotal } from "../../domain/adjustment/velocity";
import { AdjustmentRequestNotFoundError, InvalidAdjustmentStateError } from "./request";

export class RequesterCannotApproveOwnAdjustmentError extends Error {}
export class WrongAdjustmentApproverRoleError extends Error {}

export interface ApproveAdjustmentParams {
  actorUserId: string;
  actorRole: RoleName;
  adjustmentRequestId: string;
  outcome: "APPROVE" | "REJECT";
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * BPD sec.10 step 6, G-21's rolling-window routing. The required tier is
 * computed fresh here against the requester's CURRENT rolling 7-day total
 * (not a cached value from submission time — other activity may have
 * changed it since), and A-5 hard-overrides to OWNER for ADJ_10
 * (theft/confirmed loss) regardless of value. A-2: never the requester,
 * at any value.
 */
export async function approveAdjustment(prisma: PrismaClient, params: ApproveAdjustmentParams) {
  const req = await prisma.adjustmentRequest.findUnique({ where: { id: params.adjustmentRequestId } });
  if (!req) throw new AdjustmentRequestNotFoundError(params.adjustmentRequestId);
  if (req.status !== "PENDING_APPROVAL") {
    throw new InvalidAdjustmentStateError(`Cannot approve an adjustment that is ${req.status} — it must be PENDING_APPROVAL.`);
  }
  if (req.requestedBy === params.actorUserId) {
    throw new RequesterCannotApproveOwnAdjustmentError("The requester can never approve their own adjustment, at any value (A-2).");
  }

  await assertPermission(prisma, { role: params.actorRole, action: "adjustment.approve.create" });

  if (params.outcome === "REJECT") {
    return prisma.adjustmentRequest.update({ where: { id: req.id }, data: { status: "REJECTED" } });
  }

  return prisma.$transaction(async (tx) => {
    await lockAdjustmentVelocity(tx, req.requestedBy);

    const rollingTotal = await computeRollingAdjustmentTotal(tx, req.requestedBy);
    const threshold = await resolveRequiredApprover(tx, { branchId: req.branchId, transactionType: "ADJUSTMENT", value: rollingTotal });
    const requiredTier = req.reasonCode === "ADJ_10" ? "OWNER" : threshold.requiredApproverRole;

    if (params.actorRole !== requiredTier) {
      throw new WrongAdjustmentApproverRoleError(
        `This adjustment requires ${requiredTier} approval (requester's rolling 7-day adjustment total is ₱${rollingTotal.toFixed(2)}).`,
      );
    }

    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `adjustment.approve:${req.id}` });

    return tx.adjustmentRequest.update({
      where: { id: req.id },
      data: { status: "APPROVED", approvedBy: params.actorUserId, approvalTier: requiredTier },
    });
  });
}
