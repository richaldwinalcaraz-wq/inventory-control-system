import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { reservationsStillActive } from "../../domain/wholesale/reservation";
import { SalesOrderNotFoundError, InvalidSalesOrderStateError } from "./order";

export class ReservationExpiredError extends Error {}

export interface PickSalesOrderParams {
  actorUserId: string;
  actorRole: RoleName;
  salesOrderId: string;
  lines: Array<{ salesOrderLineId: string; pickedQty: number }>;
}

/**
 * RESERVED -> STAGED. The picker's count goes directly on
 * SalesOrderLine.pickedQty — visible, not blind (business-process-design.md
 * sec.8.2 models one shared physical Picking List, not an independently-
 * blind slip; only the Checker's later recount is blind).
 *
 * Re-validates the reservation is still active at THIS transition, not only
 * at original reservation time — an order whose reservation quietly expired
 * mid-backlog must not proceed into picking (see domain/wholesale/
 * reservation.ts's reservationsStillActive for the race this closes).
 */
export async function pickSalesOrder(prisma: PrismaClient, params: PickSalesOrderParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.order.pick.create" });

  const order = await prisma.salesOrder.findUnique({ where: { id: params.salesOrderId }, include: { lines: true } });
  if (!order) throw new SalesOrderNotFoundError(params.salesOrderId);
  if (order.status !== "RESERVED") {
    throw new InvalidSalesOrderStateError(`Cannot pick a sales order that is ${order.status} — it must be RESERVED.`);
  }

  return prisma.$transaction(async (tx) => {
    const stillActive = await reservationsStillActive(tx, { referenceType: "SalesOrder", referenceId: order.id });
    if (!stillActive) {
      throw new ReservationExpiredError(
        `The reservation(s) for sales order ${order.id} have expired — re-reserve before picking can proceed.`,
      );
    }

    for (const line of params.lines) {
      await tx.salesOrderLine.update({ where: { id: line.salesOrderLineId }, data: { pickedQty: line.pickedQty } });
    }

    return tx.salesOrder.update({
      where: { id: order.id },
      data: { status: "STAGED", pickedBy: params.actorUserId, pickedAt: new Date() },
    });
  });
}
