import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { InterBranchTransferNotFoundError, InvalidInterBranchTransferStateError } from "./request";
import { TransferCountSlipAlreadySubmittedError } from "./pick";

export class TransferCheckerMustNotBePickerError extends Error {}

export interface RecordTransferCheckParams {
  actorUserId: string;
  actorRole: RoleName;
  transferId: string;
  checkedQty: number;
}

/**
 * PICKING -> STAGED. Blind recount via CountSlip role TRANSFER_CHECK — the
 * checker never sees pickedQty (the HTTP route serving the checker's view
 * must omit it, same discipline as wholesale's checkSalesOrder), and must
 * not be the same person who picked (SoD). checkedQty, not requestedQty,
 * is what dispatch.ts actually posts — a shortfall found here just means
 * less is dispatched, not an auto-adjustment.
 */
export async function recordTransferCheck(prisma: PrismaClient, params: RecordTransferCheckParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.check.create" });

  const transfer = await prisma.interBranchTransfer.findUnique({ where: { id: params.transferId } });
  if (!transfer) throw new InterBranchTransferNotFoundError(params.transferId);
  if (transfer.status !== "PICKING") {
    throw new InvalidInterBranchTransferStateError(`Cannot check a transfer that is ${transfer.status} — it must be PICKING.`);
  }

  const pickSlip = await prisma.countSlip.findFirstOrThrow({
    where: { referenceType: "InterBranchTransfer", referenceId: transfer.id, role: "TRANSFER_PICK" },
  });
  if (pickSlip.countedBy === params.actorUserId) {
    throw new TransferCheckerMustNotBePickerError("The checker must not be the same person who picked this transfer (SoD).");
  }

  const existing = await prisma.countSlip.findFirst({
    where: { referenceType: "InterBranchTransfer", referenceId: transfer.id, role: "TRANSFER_CHECK" },
  });
  if (existing) throw new TransferCountSlipAlreadySubmittedError("A check has already been recorded for this transfer.");

  return prisma.$transaction(async (tx) => {
    await tx.countSlip.create({
      data: {
        referenceType: "InterBranchTransfer",
        referenceId: transfer.id,
        role: "TRANSFER_CHECK",
        countedBy: params.actorUserId,
        lines: { create: [{ productVariantId: transfer.productVariantId, countedQty: params.checkedQty }] },
      },
    });

    return tx.interBranchTransfer.update({ where: { id: transfer.id }, data: { status: "STAGED", checkedQty: params.checkedQty } });
  });
}
