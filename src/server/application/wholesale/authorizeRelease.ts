import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { rollSpotRecount } from "../../domain/wholesale/spotRecount";
import { SalesOrderNotFoundError, InvalidSalesOrderStateError } from "./order";

export class SpotRecountRequiredError extends Error {}

export interface AuthorizeSalesOrderReleaseParams {
  actorUserId: string;
  actorRole: RoleName;
  salesOrderId: string;
}

/**
 * CHECKED -> PENDING_RELEASE_APPROVAL. Rolls the G-10 spot-recount flag
 * exactly once (spotRecountRolledAt gates re-rolling on a retry) using the
 * order's checked value. If flagged and no spot recount has been submitted
 * yet, this call sets the flag as a side effect and then blocks — the
 * caller submits the recount via submitSpotRecount and calls this again to
 * actually finalize authorization. This keeps the roll idempotent without
 * a separate "roll" endpoint.
 */
export async function authorizeSalesOrderRelease(prisma: PrismaClient, params: AuthorizeSalesOrderReleaseParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.order.authorize-release.create" });

  const order = await prisma.salesOrder.findUnique({ where: { id: params.salesOrderId }, include: { lines: true } });
  if (!order) throw new SalesOrderNotFoundError(params.salesOrderId);
  if (order.status !== "CHECKED") {
    throw new InvalidSalesOrderStateError(`Cannot authorize release for a sales order that is ${order.status} — it must be CHECKED.`);
  }

  let spotRecountRequired = order.spotRecountRequired;
  if (!order.spotRecountRolledAt) {
    const orderValue = order.lines.reduce((sum, l) => sum + Number(l.checkedQty ?? 0) * Number(l.unitPrice), 0);
    spotRecountRequired = rollSpotRecount(orderValue);
    await prisma.salesOrder.update({
      where: { id: order.id },
      data: { spotRecountRequired, spotRecountRolledAt: new Date() },
    });
  }

  if (spotRecountRequired) {
    const spotSlip = await prisma.countSlip.findFirst({
      where: { referenceType: "SalesOrder", referenceId: order.id, role: "SPOT_RECOUNT" },
    });
    if (!spotSlip) {
      throw new SpotRecountRequiredError(
        `Sales order ${order.id} was randomly flagged for an independent spot recount (G-10) — submit it before release can be authorized.`,
      );
    }
  }

  return prisma.salesOrder.update({
    where: { id: order.id },
    data: { status: "PENDING_RELEASE_APPROVAL", authorizedBy: params.actorUserId, authorizedAt: new Date() },
  });
}
