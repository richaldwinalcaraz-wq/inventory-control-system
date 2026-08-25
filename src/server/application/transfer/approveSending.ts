import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { resolveRequiredApprover } from "../../domain/approval/resolveRequiredApprover";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { computeTransitEvidenceRequired } from "../../domain/multibranch/transitEvidence";
import { InterBranchTransferNotFoundError, InvalidInterBranchTransferStateError } from "./request";

export class SourceStorageLocationNotFoundError extends Error {}
export class WrongTransferApproverRoleError extends Error {}

export interface ApproveInterBranchTransferSendingParams {
  actorUserId: string;
  actorRole: RoleName;
  transferId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * Sending-branch approval — MB-4's other half, value-tiered via
 * resolveRequiredApprover(transactionType: "TRANSFER_OUT"), deliberately
 * NOT the same RBAC-only gate wholesale release uses, because BPD places
 * the transit-loss risk on the sending branch (BR-089/BR-090), the same
 * reasoning ApprovalThreshold already applies to Receiving/Adjustment/
 * Return/Disposal (Phase 4 plan sec.4.2). Requires a fresh PIN token, same
 * as every other value-tiered approval action (G-30) — this isn't itself a
 * ledger posting, but it is an approval decision.
 *
 * transitEvidenceRequired is computed and frozen here, at the decision
 * point — never recomputed later even if cost changes, same pattern as
 * AdjustmentRequest.value.
 */
export async function approveInterBranchTransferSending(prisma: PrismaClient, params: ApproveInterBranchTransferSendingParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.approve-sending.create" });

  const transfer = await prisma.interBranchTransfer.findUnique({ where: { id: params.transferId } });
  if (!transfer) throw new InterBranchTransferNotFoundError(params.transferId);
  if (transfer.status !== "REQUESTED") {
    throw new InvalidInterBranchTransferStateError(`Cannot approve sending for a transfer that is ${transfer.status} — it must be REQUESTED.`);
  }

  const sourceStorage = await prisma.warehouseLocation.findFirst({
    where: { zone: "STORAGE", warehouse: { branchId: transfer.fromBranchId } },
  });
  if (!sourceStorage) {
    throw new SourceStorageLocationNotFoundError(`No STORAGE location registered for branch ${transfer.fromBranchId}.`);
  }

  return prisma.$transaction(async (tx) => {
    const unitCost = await getCurrentUnitCost(tx, { productVariantId: transfer.productVariantId, warehouseLocationId: sourceStorage.id });
    const value = Number(transfer.requestedQty) * Number(unitCost);

    const threshold = await resolveRequiredApprover(tx, { branchId: transfer.fromBranchId, transactionType: "TRANSFER_OUT", value });
    if (threshold.requiredApproverRole !== params.actorRole) {
      throw new WrongTransferApproverRoleError(
        `This transfer (value=₱${value.toFixed(2)}) requires ${threshold.requiredApproverRole} approval, not ${params.actorRole}.`,
      );
    }

    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `transfer.approve-sending:${transfer.id}` });

    const transitEvidenceRequired = computeTransitEvidenceRequired(value);

    return tx.interBranchTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "SENDING_APPROVED",
        sendingApprovedBy: params.actorUserId,
        sendingApprovedAt: new Date(),
        transitEvidenceRequired,
      },
    });
  });
}
