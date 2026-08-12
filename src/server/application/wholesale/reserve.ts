import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { reserveStock } from "../../domain/wholesale/reservation";
import { SalesOrderNotFoundError, InvalidSalesOrderStateError } from "./order";

export interface ReserveSalesOrderParams {
  actorUserId: string;
  actorRole: RoleName;
  salesOrderId: string;
}

/**
 * CONFIRMED -> RESERVED. Each line's ATP is checked and reserved inside one
 * transaction, per line, each taking the (variant, branch) lock first — see
 * domain/wholesale/reservation.ts for why the lock (not just a stock_balance
 * row lock) is required to close the write-skew gap between two concurrent
 * order confirmations.
 */
export async function reserveSalesOrder(prisma: PrismaClient, params: ReserveSalesOrderParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.order.reserve.create" });

  const order = await prisma.salesOrder.findUnique({ where: { id: params.salesOrderId }, include: { lines: true } });
  if (!order) throw new SalesOrderNotFoundError(params.salesOrderId);
  if (order.status !== "CONFIRMED") {
    throw new InvalidSalesOrderStateError(`Cannot reserve a sales order that is ${order.status} — it must be CONFIRMED.`);
  }

  return prisma.$transaction(async (tx) => {
    for (const line of order.lines) {
      await reserveStock(tx, {
        branchId: order.branchId,
        productVariantId: line.productVariantId,
        referenceType: "SalesOrder",
        referenceId: order.id,
        qty: Number(line.orderedQty),
      });
    }

    return tx.salesOrder.update({ where: { id: order.id }, data: { status: "RESERVED" } });
  });
}
