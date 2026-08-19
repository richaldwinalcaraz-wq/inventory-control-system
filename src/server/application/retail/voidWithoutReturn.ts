import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requestAdjustment } from "../adjustment/request";
import { RetailSaleNotFoundError, InvalidRetailSaleStateError } from "./draft";

export class VoidWithoutReturnReasonRequiredError extends Error {}

export interface RequestRetailSaleVoidWithoutReturnParams {
  actorUserId: string;
  actorRole: RoleName;
  retailSaleId: string;
  reason: string;
}

/**
 * G-12 closure, no-goods-returned path. A POSTED sale's own SALE_OUT
 * ledger entry is never touched here — reversing it would misrepresent
 * that the goods came back, which they didn't. Instead the sale is
 * administratively voided (no revenue), and the resulting stock loss is
 * separately raised as an ADJ_01 request per line — going through the
 * ordinary investigation/approval/posting pipeline (reusing requestAdjustment
 * rather than duplicating its velocity-lock/A-8/G-21 logic), so the write-off
 * itself gets independently reviewed rather than being a byproduct of the
 * void. AdjustmentRequest has no RetailSale FK, so the cross-reference lives
 * in reconciliationNotes — matches what the schema actually has today.
 */
export async function requestRetailSaleVoidWithoutReturn(prisma: PrismaClient, params: RequestRetailSaleVoidWithoutReturnParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "retail.sale.void-without-return.create" });

  const reason = params.reason?.trim();
  if (!reason) throw new VoidWithoutReturnReasonRequiredError("A reason is required to void a posted sale without goods being returned.");

  const sale = await prisma.retailSale.findUnique({ where: { id: params.retailSaleId }, include: { lines: true } });
  if (!sale) throw new RetailSaleNotFoundError(params.retailSaleId);
  if (sale.status !== "POSTED") {
    throw new InvalidRetailSaleStateError(
      `Cannot void-without-return a sale that is ${sale.status} — it must be POSTED (a DRAFT sale can simply be voided outright).`,
    );
  }

  const counterLocation = await prisma.warehouseLocation.findFirstOrThrow({
    where: { zone: "COUNTER", warehouse: { branchId: sale.branchId } },
  });

  const voided = await prisma.retailSale.update({ where: { id: sale.id }, data: { status: "VOID", voidReason: reason } });

  const adjustmentRequests = [];
  for (const line of sale.lines) {
    adjustmentRequests.push(
      await requestAdjustment(prisma, {
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        branchId: sale.branchId,
        productVariantId: line.productVariantId,
        warehouseLocationId: counterLocation.id,
        reasonCode: "ADJ_01",
        quantityDelta: -Number(line.quantity),
        reconciliationNotes: `G-12: void-without-return of posted RetailSale ${sale.id} (${reason}) — goods handed over, not physically returned.`,
      }),
    );
  }

  return { retailSale: voided, adjustmentRequests };
}
