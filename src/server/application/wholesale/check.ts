import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { SalesOrderNotFoundError, InvalidSalesOrderStateError } from "./order";

export class CheckerMustNotBePickerError extends Error {}
export class CountSlipAlreadySubmittedForOrderError extends Error {}

export interface CheckSalesOrderParams {
  actorUserId: string;
  actorRole: RoleName;
  salesOrderId: string;
  lines: Array<{ productVariantId: string; countedQty: number }>;
}

/**
 * STAGED -> CHECKED. Blind recount via the generalized CountSlip (role
 * WHOLESALE_CHECK) — the checker never sees pickedQty (the HTTP route
 * serving the checker's view must omit it from its response, matching how
 * Receiving's checker route already omits the receiver's figures), and the
 * recount is compared against the ORDER's own ordered quantities, never
 * against what the picker wrote down. checkedQty is what actually governs
 * how much can be released — a discrepancy from orderedQty here just means
 * less (or more, capped at ordered) is available to release, it is not an
 * auto-adjustment.
 */
export async function checkSalesOrder(prisma: PrismaClient, params: CheckSalesOrderParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.order.check.create" });

  const order = await prisma.salesOrder.findUnique({ where: { id: params.salesOrderId }, include: { lines: true } });
  if (!order) throw new SalesOrderNotFoundError(params.salesOrderId);
  if (order.status !== "STAGED") {
    throw new InvalidSalesOrderStateError(`Cannot check a sales order that is ${order.status} — it must be STAGED.`);
  }
  if (order.pickedBy === params.actorUserId) {
    throw new CheckerMustNotBePickerError("The checker must not be the same person who picked this order (SoD).");
  }

  const existingSlip = await prisma.countSlip.findFirst({
    where: { referenceType: "SalesOrder", referenceId: order.id, role: "WHOLESALE_CHECK" },
  });
  if (existingSlip) {
    throw new CountSlipAlreadySubmittedForOrderError(`A wholesale check has already been submitted for sales order ${order.id}.`);
  }

  const countedByVariant = new Map(params.lines.map((l) => [l.productVariantId, l.countedQty]));

  return prisma.$transaction(async (tx) => {
    await tx.countSlip.create({
      data: {
        referenceType: "SalesOrder",
        referenceId: order.id,
        role: "WHOLESALE_CHECK",
        countedBy: params.actorUserId,
        lines: { create: params.lines.map((l) => ({ productVariantId: l.productVariantId, countedQty: l.countedQty })) },
      },
    });

    for (const line of order.lines) {
      const countedQty = countedByVariant.get(line.productVariantId) ?? 0;
      await tx.salesOrderLine.update({ where: { id: line.id }, data: { checkedQty: countedQty } });
    }

    return tx.salesOrder.update({
      where: { id: order.id },
      data: { status: "CHECKED", checkedBy: params.actorUserId, checkedAt: new Date() },
    });
  });
}
