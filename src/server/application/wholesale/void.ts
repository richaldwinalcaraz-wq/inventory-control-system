import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { releaseReservations } from "../../domain/wholesale/reservation";
import { SalesOrderNotFoundError, InvalidSalesOrderStateError } from "./order";
import { SalesOrderReleaseNotFoundError, InvalidReleaseStateError } from "./gateCheck";

export class CannotVoidOrderWithReleasesError extends Error {}
export class CannotVoidPostedReleaseError extends Error {}

export interface VoidSalesOrderParams {
  actorUserId: string;
  actorRole: RoleName;
  salesOrderId: string;
  reason: string;
}

/**
 * Pre-handling void only — mirrors Receiving's PRE_HANDLING_STATUSES
 * pattern. Once any SalesOrderRelease exists (physical staging has begun),
 * each un-posted release must be voided individually first via
 * voidSalesOrderRelease (which reverses its staging transfer), then the
 * order. A POSTED release can never be undone by a void at all — that's a
 * reversal/return transaction, Phase 3 scope.
 */
export async function voidSalesOrder(prisma: PrismaClient, params: VoidSalesOrderParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.order.void.create" });

  const order = await prisma.salesOrder.findUnique({ where: { id: params.salesOrderId } });
  if (!order) throw new SalesOrderNotFoundError(params.salesOrderId);
  if (order.status === "VOID") {
    throw new InvalidSalesOrderStateError("This sales order is already void.");
  }

  const releaseCount = await prisma.salesOrderRelease.count({ where: { salesOrderId: order.id, status: { not: "VOID" } } });
  if (releaseCount > 0) {
    throw new CannotVoidOrderWithReleasesError(
      `Sales order ${order.id} has ${releaseCount} active release(s) — void each release individually before voiding the order.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    await releaseReservations(tx, { referenceType: "SalesOrder", referenceId: order.id, toStatus: "CANCELLED" });
    return tx.salesOrder.update({ where: { id: order.id }, data: { status: "VOID", voidReason: params.reason } });
  });
}

export interface VoidSalesOrderReleaseParams {
  actorUserId: string;
  actorRole: RoleName;
  releaseId: string;
  reason: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * A-7-style rule reused here: once POSTED, a release is permanently
 * immutable — never voidable. Voiding a not-yet-posted release reverses its
 * staging transfer (RELEASE -> STORAGE) and frees the claimed releasedQty
 * back onto each line, so the stock and the order's remaining-to-release
 * figures are both left exactly as if the release had never been created.
 */
export async function voidSalesOrderRelease(prisma: PrismaClient, params: VoidSalesOrderReleaseParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.release.void.create" });

  const release = await prisma.salesOrderRelease.findUnique({ where: { id: params.releaseId }, include: { lines: true, salesOrder: true } });
  if (!release) throw new SalesOrderReleaseNotFoundError(params.releaseId);
  if (release.status === "POSTED") {
    throw new CannotVoidPostedReleaseError("A posted release cannot be voided — physical stock has already left via a real ledger movement.");
  }
  if (release.status === "VOID") {
    throw new InvalidReleaseStateError("This release is already void.");
  }

  return prisma.$transaction(async (tx) => {
    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `wholesale.release.void:${release.id}` });

    const storageLocation = await tx.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: release.salesOrder.branchId } } });
    const releaseLocation = await tx.warehouseLocation.findFirstOrThrow({ where: { zone: "RELEASE", warehouse: { branchId: release.salesOrder.branchId } } });
    const reversalRef = `release-void-${release.id}`;

    for (const line of release.lines) {
      const salesOrderLine = await tx.salesOrderLine.findUniqueOrThrow({ where: { id: line.salesOrderLineId } });
      const unitCost = await getCurrentUnitCost(tx, { productVariantId: salesOrderLine.productVariantId, warehouseLocationId: releaseLocation.id });

      const outPayload = { releaseId: release.id, direction: "OUT", productVariantId: salesOrderLine.productVariantId, qty: line.qty.toString() };
      await postLedgerEntryInTx(tx, {
        idempotency: { documentType: "XFER", documentNumber: `${reversalRef}:${line.id}:OUT`, branchCode: release.salesOrder.branchId, requestPayloadHash: createHash("sha256").update(JSON.stringify(outPayload)).digest("hex") },
        branchId: release.salesOrder.branchId,
        productVariantId: salesOrderLine.productVariantId,
        warehouseLocationId: releaseLocation.id,
        quantityDeltaBase: `-${line.qty.toString()}`,
        movementType: "TRANSFER_OUT",
        unitCostAtMovement: unitCost,
        referenceType: "SalesOrderReleaseVoid",
        referenceId: release.id,
        documentNumber: reversalRef,
        performedBy: params.actorUserId,
      });

      const inPayload = { releaseId: release.id, direction: "IN", productVariantId: salesOrderLine.productVariantId, qty: line.qty.toString() };
      await postLedgerEntryInTx(tx, {
        idempotency: { documentType: "XFER", documentNumber: `${reversalRef}:${line.id}:IN`, branchCode: release.salesOrder.branchId, requestPayloadHash: createHash("sha256").update(JSON.stringify(inPayload)).digest("hex") },
        branchId: release.salesOrder.branchId,
        productVariantId: salesOrderLine.productVariantId,
        warehouseLocationId: storageLocation.id,
        quantityDeltaBase: line.qty.toString(),
        movementType: "TRANSFER_IN",
        unitCostAtMovement: unitCost,
        referenceType: "SalesOrderReleaseVoid",
        referenceId: release.id,
        documentNumber: reversalRef,
        performedBy: params.actorUserId,
      });

      await tx.salesOrderLine.update({ where: { id: salesOrderLine.id }, data: { releasedQty: { decrement: line.qty } } });
    }

    const voided = await tx.salesOrderRelease.update({ where: { id: release.id }, data: { status: "VOID", voidReason: params.reason } });

    const refreshedLines = await tx.salesOrderLine.findMany({ where: { salesOrderId: release.salesOrderId } });
    const anyReleased = refreshedLines.some((l) => Number(l.releasedQty) > 0);
    await tx.salesOrder.update({
      where: { id: release.salesOrderId },
      data: { status: anyReleased ? "RELEASED_PARTIAL" : "PENDING_RELEASE_APPROVAL" },
    });

    return voided;
  });
}
