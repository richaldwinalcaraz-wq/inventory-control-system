import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveBranchManager } from "../discrepancy/aging";
import { InterBranchTransferNotFoundError, InvalidInterBranchTransferStateError } from "./request";

export class TransferReceiveCountAlreadySubmittedError extends Error {}
export class TransferReceiveCountMissingError extends Error {}
export class TransferReceiveCheckerMustNotBeReceiverError extends Error {}

export interface RecordTransferReceiveParams {
  actorUserId: string;
  actorRole: RoleName;
  transferId: string;
  countedQty: number;
}

/** IN_TRANSIT -> ARRIVED_PENDING_COUNT. First blind count on physical arrival at the destination branch. */
export async function recordTransferReceive(prisma: PrismaClient, params: RecordTransferReceiveParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.receive.create" });

  const transfer = await prisma.interBranchTransfer.findUnique({ where: { id: params.transferId } });
  if (!transfer) throw new InterBranchTransferNotFoundError(params.transferId);
  if (transfer.status !== "IN_TRANSIT") {
    throw new InvalidInterBranchTransferStateError(`Cannot receive a transfer that is ${transfer.status} — it must be IN_TRANSIT.`);
  }

  const existing = await prisma.countSlip.findFirst({
    where: { referenceType: "InterBranchTransfer", referenceId: transfer.id, role: "TRANSFER_RECEIVE" },
  });
  if (existing) throw new TransferReceiveCountAlreadySubmittedError("A receive count has already been submitted and is read-only.");

  return prisma.$transaction(async (tx) => {
    await tx.countSlip.create({
      data: {
        referenceType: "InterBranchTransfer",
        referenceId: transfer.id,
        role: "TRANSFER_RECEIVE",
        countedBy: params.actorUserId,
        lines: { create: [{ productVariantId: transfer.productVariantId, countedQty: params.countedQty }] },
      },
    });

    return tx.interBranchTransfer.update({ where: { id: transfer.id }, data: { status: "ARRIVED_PENDING_COUNT" } });
  });
}

export interface RecordTransferReceiveCheckParams {
  actorUserId: string;
  actorRole: RoleName;
  transferId: string;
  countedQty: number;
}

export interface RecordTransferReceiveCheckResult {
  countSlip: { id: string };
  matched: boolean;
}

/**
 * Second blind count — never reads back the receiver's figure, and the
 * checker cannot be the same person as the receiver, same shape as
 * Returns' submitReturnCheckCount (the closest precedent for a genuine
 * mutual-blind pair, unlike wholesale's visible-pick-then-blind-check).
 * On disagreement, opens a DiscrepancyCase (owned by the sending branch
 * per BR-090 — any transit-related discrepancy is theirs regardless of
 * which side's count is off) and moves the transfer to VARIANCE_DISPUTED,
 * blocking close.ts's status gate until someone resolves it. On agreement,
 * the decisive quantity is recorded as InterBranchTransfer.receivedQty —
 * a SEPARATE later check in close.ts compares this against checkedQty
 * (what was actually dispatched) for transit shrinkage, which is a
 * different question from "did the two counters agree."
 */
export async function recordTransferReceiveCheck(prisma: PrismaClient, params: RecordTransferReceiveCheckParams): Promise<RecordTransferReceiveCheckResult> {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.receive-check.create" });

  const transfer = await prisma.interBranchTransfer.findUnique({ where: { id: params.transferId } });
  if (!transfer) throw new InterBranchTransferNotFoundError(params.transferId);
  if (transfer.status !== "ARRIVED_PENDING_COUNT") {
    throw new InvalidInterBranchTransferStateError(`Cannot check-receive a transfer that is ${transfer.status} — it must be ARRIVED_PENDING_COUNT.`);
  }

  const receiveSlip = await prisma.countSlip.findFirst({
    where: { referenceType: "InterBranchTransfer", referenceId: transfer.id, role: "TRANSFER_RECEIVE" },
    include: { lines: true },
  });
  if (!receiveSlip) throw new TransferReceiveCountMissingError("The receive count must be submitted first.");
  if (receiveSlip.countedBy === params.actorUserId) {
    throw new TransferReceiveCheckerMustNotBeReceiverError("The checker must not be the same person as the receiver.");
  }
  const existingCheck = await prisma.countSlip.findFirst({
    where: { referenceType: "InterBranchTransfer", referenceId: transfer.id, role: "TRANSFER_RECEIVE_CHECK" },
  });
  if (existingCheck) throw new TransferReceiveCountAlreadySubmittedError("A receive-check count has already been submitted and is read-only.");

  const receiveQty = Number(receiveSlip.lines[0]?.countedQty ?? 0);
  const matched = receiveQty === params.countedQty;

  if (!matched) {
    // Resolved before the transaction — resolveBranchManager takes a plain
    // PrismaClient, not a Prisma.TransactionClient (it doesn't need
    // transactional consistency for a role lookup).
    const assignedTo = await resolveBranchManager(prisma, transfer.fromBranchId);

    return prisma.$transaction(async (tx) => {
      const checkSlip = await tx.countSlip.create({
        data: {
          referenceType: "InterBranchTransfer",
          referenceId: transfer.id,
          role: "TRANSFER_RECEIVE_CHECK",
          countedBy: params.actorUserId,
          lines: { create: [{ productVariantId: transfer.productVariantId, countedQty: params.countedQty }] },
        },
      });

      await tx.discrepancyCase.create({
        data: {
          referenceType: "InterBranchTransfer",
          referenceId: transfer.id,
          openedBy: params.actorUserId,
          assignedTo,
          notes: `Arrival count mismatch on transfer ${transfer.id}: receiver counted ${receiveQty}, checker counted ${params.countedQty} — requires reconciliation before the transfer can close (BR-090: owned by the sending branch).`,
        },
      });

      await tx.interBranchTransfer.update({ where: { id: transfer.id }, data: { status: "VARIANCE_DISPUTED" } });

      return { countSlip: { id: checkSlip.id }, matched: false };
    });
  }

  return prisma.$transaction(async (tx) => {
    const checkSlip = await tx.countSlip.create({
      data: {
        referenceType: "InterBranchTransfer",
        referenceId: transfer.id,
        role: "TRANSFER_RECEIVE_CHECK",
        countedBy: params.actorUserId,
        lines: { create: [{ productVariantId: transfer.productVariantId, countedQty: params.countedQty }] },
      },
    });

    await tx.interBranchTransfer.update({ where: { id: transfer.id }, data: { receivedQty: params.countedQty } });

    return { countSlip: { id: checkSlip.id }, matched: true };
  });
}
