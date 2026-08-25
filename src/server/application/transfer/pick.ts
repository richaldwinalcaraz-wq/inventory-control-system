import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { InterBranchTransferNotFoundError, InvalidInterBranchTransferStateError } from "./request";

export class TransferCountSlipAlreadySubmittedError extends Error {}

export interface RecordTransferPickParams {
  actorUserId: string;
  actorRole: RoleName;
  transferId: string;
  pickedQty: number;
}

/**
 * SENDING_APPROVED -> PICKING ("picked, awaiting blind check" — same
 * post-action-awaiting-next-step naming style as Receiving's
 * PENDING_INSPECTION). Visible pick count via CountSlip role TRANSFER_PICK
 * — mirrors wholesale's pickSalesOrder (visible), not Receiving's mutual-
 * blind pattern; the blind control here is the later TRANSFER_CHECK.
 */
export async function recordTransferPick(prisma: PrismaClient, params: RecordTransferPickParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.pick.create" });

  const transfer = await prisma.interBranchTransfer.findUnique({ where: { id: params.transferId } });
  if (!transfer) throw new InterBranchTransferNotFoundError(params.transferId);
  if (transfer.status !== "SENDING_APPROVED") {
    throw new InvalidInterBranchTransferStateError(`Cannot pick a transfer that is ${transfer.status} — it must be SENDING_APPROVED.`);
  }

  const existing = await prisma.countSlip.findFirst({
    where: { referenceType: "InterBranchTransfer", referenceId: transfer.id, role: "TRANSFER_PICK" },
  });
  if (existing) throw new TransferCountSlipAlreadySubmittedError("A pick has already been recorded for this transfer.");

  return prisma.$transaction(async (tx) => {
    await tx.countSlip.create({
      data: {
        referenceType: "InterBranchTransfer",
        referenceId: transfer.id,
        role: "TRANSFER_PICK",
        countedBy: params.actorUserId,
        lines: { create: [{ productVariantId: transfer.productVariantId, countedQty: params.pickedQty }] },
      },
    });

    return tx.interBranchTransfer.update({ where: { id: transfer.id }, data: { status: "PICKING" } });
  });
}
