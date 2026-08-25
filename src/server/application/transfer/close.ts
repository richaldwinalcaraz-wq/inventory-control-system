import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { resolveBranchManager } from "../discrepancy/aging";
import { InterBranchTransferNotFoundError, InvalidInterBranchTransferStateError } from "./request";

export class ReceiveCountRequiredError extends Error {}
export class TransitEvidenceConfirmationRequiredError extends Error {}
export class DestinationStorageLocationNotFoundError extends Error {}
export class MissingDispatchLedgerRowError extends Error {}

export interface PostReceiveInterBranchTransferParams {
  actorUserId: string;
  actorRole: RoleName;
  transferId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * ARRIVED_PENDING_COUNT -> RECEIVED_CLOSED. Hard-blocks on missing transit
 * evidence exactly like DisposalCertificate DESTROY's evidence gate (Phase
 * 4 plan sec.4.2) — status alone can't reach this transition from
 * VARIANCE_DISPUTED, so a receive-count mismatch already blocks it before
 * this function is even reachable. Posts TRANSFER_IN for receivedQty (the
 * blind-counted arrival figure, never requestedQty/checkedQty), carrying
 * forward the SAME unit cost TRANSFER_OUT posted at dispatch — transferred
 * stock keeps its cost basis, it isn't re-priced at the new location.
 * Variance between what was dispatched (checkedQty) and what arrived
 * (receivedQty) opens a DiscrepancyCase owned by the SENDING branch
 * (BR-090), a separate concern from the receive/check pair's own
 * agreement check in receiveCount.ts.
 */
export async function postReceiveInterBranchTransfer(prisma: PrismaClient, params: PostReceiveInterBranchTransferParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.close.create" });

  const transfer = await prisma.interBranchTransfer.findUnique({ where: { id: params.transferId } });
  if (!transfer) throw new InterBranchTransferNotFoundError(params.transferId);
  if (transfer.status !== "ARRIVED_PENDING_COUNT") {
    throw new InvalidInterBranchTransferStateError(`Cannot close a transfer that is ${transfer.status} — it must be ARRIVED_PENDING_COUNT.`);
  }
  if (transfer.receivedQty === null) {
    throw new ReceiveCountRequiredError("The blind arrival count must be completed and agreed before closing.");
  }
  if (transfer.transitEvidenceRequired && !transfer.transitEvidenceConfirmedBy) {
    throw new TransitEvidenceConfirmationRequiredError("G-35: this transfer requires Auditor-confirmed transit evidence before it can close.");
  }

  const toBranch = await prisma.branch.findUniqueOrThrow({ where: { id: transfer.toBranchId } });
  const destStorage = await prisma.warehouseLocation.findFirst({
    where: { zone: "STORAGE", warehouse: { branchId: transfer.toBranchId } },
  });
  if (!destStorage) {
    throw new DestinationStorageLocationNotFoundError(`No STORAGE location registered for branch ${transfer.toBranchId}.`);
  }

  const dispatchLedgerRow = await prisma.stockLedger.findFirst({
    where: { referenceType: "InterBranchTransfer", referenceId: transfer.id, movementType: "TRANSFER_OUT" },
  });
  if (!dispatchLedgerRow) {
    throw new MissingDispatchLedgerRowError(`No TRANSFER_OUT ledger row found for transfer ${transfer.id} — cannot determine its cost basis.`);
  }

  const receivedQty = Number(transfer.receivedQty);
  const checkedQty = Number(transfer.checkedQty ?? 0);
  const hasVariance = receivedQty !== checkedQty;
  // Resolved before the transaction — resolveBranchManager takes a plain
  // PrismaClient, not a Prisma.TransactionClient.
  const assignedTo = hasVariance ? await resolveBranchManager(prisma, transfer.fromBranchId) : null;

  const sourceDocumentNumber = transfer.documentNumberId
    ? (await prisma.documentNumber.findUnique({ where: { id: transfer.documentNumberId } }))?.fullNumber
    : undefined;
  if (!sourceDocumentNumber) {
    throw new MissingDispatchLedgerRowError(`Transfer ${transfer.id} has no STN document number — it was never dispatched.`);
  }

  return prisma.$transaction(async (tx) => {
    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `transfer.close:${transfer.id}` });

    await postLedgerEntryInTx(tx, {
      idempotency: {
        documentType: "STN",
        documentNumber: `${sourceDocumentNumber}:IN`,
        branchCode: toBranch.code,
        requestPayloadHash: `transfer-in:${transfer.id}`,
      },
      branchId: transfer.toBranchId,
      productVariantId: transfer.productVariantId,
      warehouseLocationId: destStorage.id,
      quantityDeltaBase: receivedQty,
      movementType: "TRANSFER_IN",
      unitCostAtMovement: dispatchLedgerRow.unitCostAtMovement.toString(),
      referenceType: "InterBranchTransfer",
      referenceId: transfer.id,
      documentNumber: `${sourceDocumentNumber}:IN`,
      performedBy: params.actorUserId,
    });

    let discrepancyCaseId: string | null = null;
    if (hasVariance && assignedTo) {
      const dc = await tx.discrepancyCase.create({
        data: {
          referenceType: "InterBranchTransfer",
          referenceId: transfer.id,
          openedBy: params.actorUserId,
          assignedTo,
          notes: `Transit variance on transfer ${transfer.id}: dispatched ${checkedQty}, received ${receivedQty} (${receivedQty > checkedQty ? "excess" : "shortfall"} of ${Math.abs(receivedQty - checkedQty)}) — owned by the sending branch (BR-090).`,
        },
      });
      discrepancyCaseId = dc.id;
    }

    return tx.interBranchTransfer.update({
      where: { id: transfer.id },
      data: { status: "RECEIVED_CLOSED", discrepancyCaseId },
    });
  });
}
