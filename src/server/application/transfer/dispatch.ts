import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { releaseReservations } from "../../domain/wholesale/reservation";
import { InterBranchTransferNotFoundError, InvalidInterBranchTransferStateError } from "./request";
import { SourceStorageLocationNotFoundError } from "./approveSending";

export interface DispatchInterBranchTransferParams {
  actorUserId: string;
  actorRole: RoleName;
  transferId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
  vehiclePlate?: string;
  driverName?: string;
}

/**
 * STAGED -> IN_TRANSIT. This is where stock actually leaves the source
 * branch's books (Phase 4 plan sec.4.1): posts TRANSFER_OUT for
 * checkedQty (never requestedQty), issues the STN document number only
 * after every precondition clears (so a blocked dispatch never burns a
 * booklet number, same discipline as wholesale's postSalesOrderRelease),
 * logs the outbound gate pass, and releases the source-branch reservation
 * to CONSUMED — its job (protecting the quantity from a concurrent sale)
 * is done once the stock is actually debited.
 */
export async function dispatchInterBranchTransfer(prisma: PrismaClient, params: DispatchInterBranchTransferParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.dispatch.create" });

  const transfer = await prisma.interBranchTransfer.findUnique({ where: { id: params.transferId } });
  if (!transfer) throw new InterBranchTransferNotFoundError(params.transferId);
  if (transfer.status !== "STAGED") {
    throw new InvalidInterBranchTransferStateError(`Cannot dispatch a transfer that is ${transfer.status} — it must be STAGED.`);
  }
  if (transfer.checkedQty === null) {
    throw new InvalidInterBranchTransferStateError("Transfer has no checked quantity recorded — the blind check must run before dispatch.");
  }

  const fromBranch = await prisma.branch.findUniqueOrThrow({ where: { id: transfer.fromBranchId } });
  const sourceStorage = await prisma.warehouseLocation.findFirst({
    where: { zone: "STORAGE", warehouse: { branchId: transfer.fromBranchId } },
  });
  if (!sourceStorage) {
    throw new SourceStorageLocationNotFoundError(`No STORAGE location registered for branch ${transfer.fromBranchId}.`);
  }

  return prisma.$transaction(async (tx) => {
    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `transfer.dispatch:${transfer.id}` });

    const gateLogEntry = await tx.gateLogEntry.create({
      data: {
        branchId: transfer.fromBranchId,
        direction: "OUT",
        referenceType: "InterBranchTransfer",
        referenceId: transfer.id,
        vehiclePlate: params.vehiclePlate,
        driverName: params.driverName,
        loggedBy: params.actorUserId,
      },
    });

    const unitCost = await getCurrentUnitCost(tx, { productVariantId: transfer.productVariantId, warehouseLocationId: sourceStorage.id });

    const documentNumber = await issueDocumentNumber(tx, {
      branchId: transfer.fromBranchId,
      branchCode: fromBranch.code,
      documentType: "STN",
      referenceId: transfer.id,
    });

    const checkedQty = Number(transfer.checkedQty);
    const payload = { transferId: transfer.id, checkedQty };
    await postLedgerEntryInTx(tx, {
      idempotency: {
        documentType: "STN",
        documentNumber: documentNumber.fullNumber,
        branchCode: fromBranch.code,
        requestPayloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      },
      branchId: transfer.fromBranchId,
      productVariantId: transfer.productVariantId,
      warehouseLocationId: sourceStorage.id,
      quantityDeltaBase: -checkedQty,
      movementType: "TRANSFER_OUT",
      unitCostAtMovement: unitCost,
      referenceType: "InterBranchTransfer",
      referenceId: transfer.id,
      documentNumber: documentNumber.fullNumber,
      performedBy: params.actorUserId,
    });

    await releaseReservations(tx, { referenceType: "InterBranchTransfer", referenceId: transfer.id, toStatus: "CONSUMED" });

    return tx.interBranchTransfer.update({
      where: { id: transfer.id },
      data: { status: "IN_TRANSIT", gateLogEntryOutId: gateLogEntry.id, documentNumberId: documentNumber.id },
    });
  });
}
