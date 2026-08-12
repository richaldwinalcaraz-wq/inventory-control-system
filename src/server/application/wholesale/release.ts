import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { SalesOrderNotFoundError, InvalidSalesOrderStateError } from "./order";

export class MissingUnitWeightError extends Error {}
export class ExceedsAvailableToReleaseError extends Error {}
export class EmptyReleaseError extends Error {}

const WEIGHT_TOLERANCE_FRACTION = 0.05; // ±5% band around the computed expected weight

export interface CreateSalesOrderReleaseParams {
  actorUserId: string;
  actorRole: RoleName;
  salesOrderId: string;
  lines: Array<{ salesOrderLineId: string; qty: number }>;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * Creates one release covering a subset of each line's checked-and-not-yet-
 * released quantity — this is what makes partial delivery (architecture.md
 * sec.7.2) work without per-location tracking. Physically stages the claimed
 * quantity from STORAGE into the canonical RELEASE zone via a paired
 * TRANSFER_OUT/TRANSFER_IN posted right here (not deferred to the final
 * post step) — this is also what gives the RELEASE zone a real cost basis
 * for getCurrentUnitCost() when the release itself posts SALE_OUT later;
 * without a prior inbound movement at that exact location, that lookup
 * would otherwise always fail for a location goods were never received
 * into. Claims releasedQty against each line immediately (not only once
 * this release eventually posts), so two concurrent partial releases can
 * never both claim the same checked stock.
 */
export async function createSalesOrderRelease(prisma: PrismaClient, params: CreateSalesOrderReleaseParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.release.create" });

  if (params.lines.length === 0) {
    throw new EmptyReleaseError("A release needs at least one line.");
  }

  const order = await prisma.salesOrder.findUnique({ where: { id: params.salesOrderId }, include: { lines: true } });
  if (!order) throw new SalesOrderNotFoundError(params.salesOrderId);
  if (order.status !== "PENDING_RELEASE_APPROVAL" && order.status !== "RELEASED_PARTIAL") {
    throw new InvalidSalesOrderStateError(
      `Cannot create a release for a sales order that is ${order.status} — it must be PENDING_RELEASE_APPROVAL or RELEASED_PARTIAL.`,
    );
  }

  const lineById = new Map(order.lines.map((l) => [l.id, l]));
  let totalWeightKg = 0;
  for (const req of params.lines) {
    const line = lineById.get(req.salesOrderLineId);
    if (!line) throw new SalesOrderNotFoundError(`Sales order line ${req.salesOrderLineId} not found on order ${order.id}.`);
    const remaining = Number(line.checkedQty ?? 0) - Number(line.releasedQty);
    if (req.qty <= 0 || req.qty > remaining) {
      throw new ExceedsAvailableToReleaseError(
        `Requested release qty ${req.qty} for line ${line.id} exceeds the remaining checked-and-unreleased quantity (${remaining}).`,
      );
    }
  }

  const productByVariantId = new Map(
    (
      await prisma.productVariant.findMany({
        where: { id: { in: params.lines.map((l) => lineById.get(l.salesOrderLineId)!.productVariantId) } },
        include: { product: { select: { unitWeightKg: true } } },
      })
    ).map((v) => [v.id, v.product]),
  );
  for (const req of params.lines) {
    const line = lineById.get(req.salesOrderLineId)!;
    const product = productByVariantId.get(line.productVariantId);
    if (!product || product.unitWeightKg === null || product.unitWeightKg === undefined) {
      throw new MissingUnitWeightError(
        `Product for variant ${line.productVariantId} has no unitWeightKg configured — required for the gate weight check before this release can be created.`,
      );
    }
    totalWeightKg += Number(product.unitWeightKg) * req.qty;
  }

  const releaseId = randomUUID();
  const stagingRef = `release-stage-${releaseId}`;

  return prisma.$transaction(async (tx) => {
    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `wholesale.release.create:${releaseId}` });

    const storageLocation = await tx.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: order.branchId } } });
    const releaseLocation = await tx.warehouseLocation.findFirstOrThrow({ where: { zone: "RELEASE", warehouse: { branchId: order.branchId } } });

    for (const req of params.lines) {
      const line = lineById.get(req.salesOrderLineId)!;
      const unitCost = await getCurrentUnitCost(tx, { productVariantId: line.productVariantId, warehouseLocationId: storageLocation.id });

      const outPayload = { releaseId, direction: "OUT", productVariantId: line.productVariantId, qty: req.qty };
      await postLedgerEntryInTx(tx, {
        idempotency: {
          documentType: "XFER",
          documentNumber: `${stagingRef}:${line.id}:OUT`,
          branchCode: order.branchId,
          requestPayloadHash: createHash("sha256").update(JSON.stringify(outPayload)).digest("hex"),
        },
        branchId: order.branchId,
        productVariantId: line.productVariantId,
        warehouseLocationId: storageLocation.id,
        quantityDeltaBase: -req.qty,
        movementType: "TRANSFER_OUT",
        unitCostAtMovement: unitCost,
        referenceType: "SalesOrderRelease",
        referenceId: releaseId,
        documentNumber: stagingRef,
        performedBy: params.actorUserId,
      });

      const inPayload = { releaseId, direction: "IN", productVariantId: line.productVariantId, qty: req.qty };
      await postLedgerEntryInTx(tx, {
        idempotency: {
          documentType: "XFER",
          documentNumber: `${stagingRef}:${line.id}:IN`,
          branchCode: order.branchId,
          requestPayloadHash: createHash("sha256").update(JSON.stringify(inPayload)).digest("hex"),
        },
        branchId: order.branchId,
        productVariantId: line.productVariantId,
        warehouseLocationId: releaseLocation.id,
        quantityDeltaBase: req.qty,
        movementType: "TRANSFER_IN",
        unitCostAtMovement: unitCost,
        referenceType: "SalesOrderRelease",
        referenceId: releaseId,
        documentNumber: stagingRef,
        performedBy: params.actorUserId,
      });

      await tx.salesOrderLine.update({ where: { id: line.id }, data: { releasedQty: { increment: req.qty } } });
    }

    const release = await tx.salesOrderRelease.create({
      data: {
        id: releaseId,
        salesOrderId: order.id,
        expectedWeightMinKg: totalWeightKg * (1 - WEIGHT_TOLERANCE_FRACTION),
        expectedWeightMaxKg: totalWeightKg * (1 + WEIGHT_TOLERANCE_FRACTION),
        status: "PENDING_GATE_CHECK",
        lines: { create: params.lines.map((l) => ({ salesOrderLineId: l.salesOrderLineId, qty: l.qty })) },
      },
      include: { lines: true },
    });

    const refreshedLines = await tx.salesOrderLine.findMany({ where: { salesOrderId: order.id } });
    const fullyReleased = refreshedLines.every((l) => Number(l.releasedQty) >= Number(l.checkedQty ?? 0));
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { status: fullyReleased ? "RELEASED" : "RELEASED_PARTIAL" },
    });

    return release;
  });
}
