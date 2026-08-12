import { randomUUID, createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session, WarehouseZone } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";

export class WarehouseLocationNotFoundError extends Error {}

export interface TransferIntraBranchParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  productVariantId: string;
  quantity: number;
  fromZone?: WarehouseZone;
  toZone?: WarehouseZone;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * Intra-branch stock relocation — its first and current use is replenishing
 * the COUNTER (sales-floor) location from STORAGE, closing the untracked-
 * counter-stock gap named in business-process-design.md sec.8.1. Never
 * crosses a Branch boundary, so this is deliberately NOT the same
 * mechanism as Phase 4's cross-branch transfer (no in-transit ownership
 * state, no receiving-branch confirmation, no gate pass) — just a paired
 * TRANSFER_OUT/TRANSFER_IN posted atomically, reusing movement types the
 * schema already had.
 */
export async function transferIntraBranch(prisma: PrismaClient, params: TransferIntraBranchParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.transfer.intra-branch.create" });

  const fromZone = params.fromZone ?? "STORAGE";
  const toZone = params.toZone ?? "COUNTER";

  const fromLocation = await prisma.warehouseLocation.findFirst({ where: { zone: fromZone, warehouse: { branchId: params.branchId } } });
  if (!fromLocation) throw new WarehouseLocationNotFoundError(`No ${fromZone} location registered for this branch.`);
  const toLocation = await prisma.warehouseLocation.findFirst({ where: { zone: toZone, warehouse: { branchId: params.branchId } } });
  if (!toLocation) throw new WarehouseLocationNotFoundError(`No ${toZone} location registered for this branch.`);

  const transferId = randomUUID();
  const documentNumber = `XFER-${transferId}`;

  return prisma.$transaction(async (tx) => {
    await requirePostingAuthorization(tx, {
      session: params.session,
      pinTokenId: params.pinTokenId,
      action: `inventory.transfer.intra-branch:${transferId}`,
    });

    const unitCost = await getCurrentUnitCost(tx, { productVariantId: params.productVariantId, warehouseLocationId: fromLocation.id });

    const outPayload = { transferId, direction: "OUT", productVariantId: params.productVariantId, quantity: params.quantity };
    const outResult = await postLedgerEntryInTx(tx, {
      idempotency: {
        documentType: "XFER",
        documentNumber: `${documentNumber}:OUT`,
        branchCode: params.branchId,
        requestPayloadHash: createHash("sha256").update(JSON.stringify(outPayload)).digest("hex"),
      },
      branchId: params.branchId,
      productVariantId: params.productVariantId,
      warehouseLocationId: fromLocation.id,
      quantityDeltaBase: -params.quantity,
      movementType: "TRANSFER_OUT",
      unitCostAtMovement: unitCost,
      referenceType: "IntraBranchTransfer",
      referenceId: transferId,
      documentNumber,
      performedBy: params.actorUserId,
    });

    const inPayload = { transferId, direction: "IN", productVariantId: params.productVariantId, quantity: params.quantity };
    const inResult = await postLedgerEntryInTx(tx, {
      idempotency: {
        documentType: "XFER",
        documentNumber: `${documentNumber}:IN`,
        branchCode: params.branchId,
        requestPayloadHash: createHash("sha256").update(JSON.stringify(inPayload)).digest("hex"),
      },
      branchId: params.branchId,
      productVariantId: params.productVariantId,
      warehouseLocationId: toLocation.id,
      quantityDeltaBase: params.quantity,
      movementType: "TRANSFER_IN",
      unitCostAtMovement: unitCost,
      referenceType: "IntraBranchTransfer",
      referenceId: transferId,
      documentNumber,
      performedBy: params.actorUserId,
    });

    return { transferId, out: outResult.ledger, in: inResult.ledger };
  });
}
