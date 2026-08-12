import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class SalesOrderNotFoundError extends Error {}
export class InvalidSalesOrderStateError extends Error {}
export class EmptySalesOrderError extends Error {}

export interface DraftSalesOrderParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  customerId: string;
  requestedDeliveryDate?: Date;
  lines: Array<{ productVariantId: string; orderedQty: number }>;
}

/**
 * Order intake. List price at draft time, same snapshot discipline as
 * Retail — Orders/CRM is explicitly a future module (business-process-
 * design.md sec.1.4), so this is the minimal internal stand-in Inventory
 * needs to drive reservation/pick/check/release, not a real quoting flow.
 */
export async function draftSalesOrder(prisma: PrismaClient, params: DraftSalesOrderParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.order.draft.create" });

  if (params.lines.length === 0) {
    throw new EmptySalesOrderError("A sales order needs at least one line.");
  }

  const variantIds = params.lines.map((l) => l.productVariantId);
  const variants = await prisma.productVariant.findMany({ where: { id: { in: variantIds } } });
  const priceByVariant = new Map(variants.map((v) => [v.id, v.sellingPrice]));

  return prisma.salesOrder.create({
    data: {
      branchId: params.branchId,
      customerId: params.customerId,
      salesRepId: params.actorUserId,
      requestedDeliveryDate: params.requestedDeliveryDate,
      status: "DRAFT",
      lines: {
        create: params.lines.map((l) => ({
          productVariantId: l.productVariantId,
          orderedQty: l.orderedQty,
          unitPrice: priceByVariant.get(l.productVariantId) ?? 0,
        })),
      },
    },
    include: { lines: true },
  });
}

export interface ConfirmSalesOrderParams {
  actorUserId: string;
  actorRole: RoleName;
  salesOrderId: string;
}

/** DRAFT -> CONFIRMED — order terms are settled; next step is reservation. */
export async function confirmSalesOrder(prisma: PrismaClient, params: ConfirmSalesOrderParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.order.confirm.create" });

  const order = await prisma.salesOrder.findUnique({ where: { id: params.salesOrderId } });
  if (!order) throw new SalesOrderNotFoundError(params.salesOrderId);
  if (order.status !== "DRAFT") {
    throw new InvalidSalesOrderStateError(`Cannot confirm a sales order that is ${order.status} — it must be DRAFT.`);
  }

  return prisma.salesOrder.update({ where: { id: order.id }, data: { status: "CONFIRMED", confirmedBy: params.actorUserId } });
}
