// Shared fixtures/pipeline-driver for the wholesale order lifecycle (G-10,
// G-11, G-14). Not a finding itself.
import type { PrismaClient } from "@prisma/client";
import { draftSalesOrder, confirmSalesOrder } from "../../../src/server/application/wholesale/order";
import { reserveSalesOrder } from "../../../src/server/application/wholesale/reserve";
import { pickSalesOrder } from "../../../src/server/application/wholesale/pick";
import { checkSalesOrder } from "../../../src/server/application/wholesale/check";
import { authorizeSalesOrderRelease } from "../../../src/server/application/wholesale/authorizeRelease";
import { getUserByRole, getIloBranch, getSeedVariant } from "./receiving";

export const SEED_CUSTOMER_ID = "seed-customer-wholesale-01";

export async function getSeedCustomer(prisma: PrismaClient) {
  return prisma.customer.findFirstOrThrow({});
}

/** Drafts a fresh order and drives it through confirm -> reserve -> pick -> check, leaving it CHECKED. */
export async function draftToChecked(prisma: PrismaClient, params: { branchId: string; variantId: string; qty?: number }) {
  const qty = params.qty ?? 5;
  const salesRep = await getUserByRole(prisma, "sales_rep");
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
  const picker = await getUserByRole(prisma, "warehouse_picker");
  const checker = await getUserByRole(prisma, "warehouse_checker");
  const customer = await getSeedCustomer(prisma);

  const order = await draftSalesOrder(prisma, {
    actorUserId: salesRep.id,
    actorRole: "SALES_REP",
    branchId: params.branchId,
    customerId: customer.id,
    lines: [{ productVariantId: params.variantId, orderedQty: qty }],
  });
  await confirmSalesOrder(prisma, { salesOrderId: order.id, actorUserId: salesRep.id, actorRole: "SALES_REP" });
  await reserveSalesOrder(prisma, { salesOrderId: order.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR" });
  const line = order.lines[0]!;
  await pickSalesOrder(prisma, { salesOrderId: order.id, actorUserId: picker.id, actorRole: "WAREHOUSE_PICKER", lines: [{ salesOrderLineId: line.id, pickedQty: qty }] });
  const checked = await checkSalesOrder(prisma, { salesOrderId: order.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: params.variantId, countedQty: qty }] });

  return { order: checked, lineId: line.id };
}

/**
 * Continues from draftToChecked through authorizeSalesOrderRelease,
 * leaving the order PENDING_RELEASE_APPROVAL — the state
 * createSalesOrderRelease requires. Order value at this qty/seed price
 * stays under G-10's ₱20,000 spot-recount materiality threshold, so this
 * never hits that gate.
 */
export async function draftToPendingReleaseApproval(prisma: PrismaClient, params: { branchId: string; variantId: string; qty?: number }) {
  const { order, lineId } = await draftToChecked(prisma, params);
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
  const authorized = await authorizeSalesOrderRelease(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", salesOrderId: order.id });
  return { order: authorized, lineId };
}
