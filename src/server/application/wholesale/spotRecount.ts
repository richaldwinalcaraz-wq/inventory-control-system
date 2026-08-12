import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { assertEligibleSpotRecountWitness } from "../../domain/wholesale/spotRecount";
import { SalesOrderNotFoundError, InvalidSalesOrderStateError } from "./order";

export class SpotRecountNotRequiredError extends Error {}
export class SpotRecountAlreadySubmittedError extends Error {}

export interface SubmitSpotRecountParams {
  actorUserId: string;
  actorRole: RoleName;
  salesOrderId: string;
  lines: Array<{ productVariantId: string; countedQty: number }>;
}

/**
 * G-10's independent spot-recount, submitted as a blind CountSlip (role
 * SPOT_RECOUNT) once authorizeSalesOrderRelease has rolled the flag on this
 * order (see application/wholesale/authorizeRelease.ts — the roll happens
 * there, on first attempt, and is idempotent). The witness must be
 * eligible under the day-and-branch-scoped SoD rule, not just "not the
 * requester of this one order."
 */
export async function submitSpotRecount(prisma: PrismaClient, params: SubmitSpotRecountParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.spot-recount.create" });

  const order = await prisma.salesOrder.findUnique({ where: { id: params.salesOrderId } });
  if (!order) throw new SalesOrderNotFoundError(params.salesOrderId);
  if (order.status !== "CHECKED") {
    throw new InvalidSalesOrderStateError(`Cannot submit a spot recount for a sales order that is ${order.status} — it must be CHECKED.`);
  }
  if (!order.spotRecountRequired) {
    throw new SpotRecountNotRequiredError(`Sales order ${order.id} was not flagged for a spot recount.`);
  }

  const existing = await prisma.countSlip.findFirst({
    where: { referenceType: "SalesOrder", referenceId: order.id, role: "SPOT_RECOUNT" },
  });
  if (existing) {
    throw new SpotRecountAlreadySubmittedError(`A spot recount has already been submitted for sales order ${order.id}.`);
  }

  return prisma.$transaction(async (tx) => {
    await assertEligibleSpotRecountWitness(tx, { branchId: order.branchId, candidateUserId: params.actorUserId });

    return tx.countSlip.create({
      data: {
        referenceType: "SalesOrder",
        referenceId: order.id,
        role: "SPOT_RECOUNT",
        countedBy: params.actorUserId,
        lines: { create: params.lines.map((l) => ({ productVariantId: l.productVariantId, countedQty: l.countedQty })) },
      },
      include: { lines: true },
    });
  });
}
