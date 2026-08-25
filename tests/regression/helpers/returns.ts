// Shared fixtures/pipeline-driver for the Customer Return lifecycle (G-15,
// G-16, G-17). Not a finding itself.
import type { PrismaClient, RoleName } from "@prisma/client";
import { postLedgerEntry } from "../../../src/server/domain/ledger/postLedgerEntry";
import { draftRetailSale } from "../../../src/server/application/retail/draft";
import { postRetailSale } from "../../../src/server/application/retail/post";
import { issueReturnAuthorization } from "../../../src/server/application/returns/authorize";
import { recordGoodsReceived } from "../../../src/server/application/returns/receive";
import { submitReturnReceiveCount, submitReturnCheckCount } from "../../../src/server/application/returns/count";
import { getUserByRole, createSessionAndPin } from "./receiving";

/** Stocks the COUNTER location and drafts+posts a retail sale line, returning a line eligible for a return. */
export async function createPostedRetailSaleLine(
  prisma: PrismaClient,
  params: { branchId: string; branchCode: string; variantId: string; qty: number },
) {
  const cashier = await getUserByRole(prisma, "cashier");
  const counter = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "COUNTER", warehouse: { branchId: params.branchId } } });
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await postLedgerEntry(prisma, {
    idempotency: { documentType: "RETSETUP", documentNumber: `RET-SETUP-${tag}`, branchCode: params.branchCode, requestPayloadHash: `hash-${tag}` },
    branchId: params.branchId,
    productVariantId: params.variantId,
    warehouseLocationId: counter.id,
    quantityDeltaBase: params.qty * 2,
    movementType: "ADJUSTMENT_IN",
    unitCostAtMovement: 50,
    referenceType: "RegressionTestReturns",
    referenceId: `ret-setup-${tag}`,
    documentNumber: `RET-SETUP-DOC-${tag}`,
    performedBy: cashier.id,
  });

  const sale = await draftRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", branchId: params.branchId, lines: [{ productVariantId: params.variantId, quantity: params.qty }] });
  const { session, pinToken } = await createSessionAndPin(prisma, cashier.id);
  const posted = await postRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", retailSaleId: sale.id, branchCode: params.branchCode, session, pinTokenId: pinToken.id });
  const line = await prisma.retailSaleLine.findFirstOrThrow({ where: { retailSaleId: posted.retailSale.id } });
  return { line, unitPrice: Number(line.unitPrice), retailSaleId: posted.retailSale.id };
}

/** Issues an RA against a posted retail sale line and drives it through goods-received + matched blind double-count, leaving it GOODS_RECEIVED (ready for grading). */
export async function issueAndReceiveReturn(
  prisma: PrismaClient,
  params: {
    branchId: string;
    branchCode: string;
    originalSaleLineId: string;
    requestedQty: number;
    issuerUserId: string;
    issuerRole: RoleName;
    identityVerification?: "PHYSICAL_RECEIPT" | "MATCHED_IDENTITY" | "NONE";
  },
) {
  const { session, pinToken } = await createSessionAndPin(prisma, params.issuerUserId);
  const { returnAuthorization } = await issueReturnAuthorization(prisma, {
    actorUserId: params.issuerUserId,
    actorRole: params.issuerRole,
    branchId: params.branchId,
    branchCode: params.branchCode,
    session,
    pinTokenId: pinToken.id,
    originalSaleType: "RetailSale",
    originalSaleLineId: params.originalSaleLineId,
    requestedQty: params.requestedQty,
    reasonCode: "WRONG_ITEM",
    identityVerification: params.identityVerification ?? "PHYSICAL_RECEIPT",
  });

  const receiver = await getUserByRole(prisma, "warehouse_receiver");
  const checker = await getUserByRole(prisma, "warehouse_checker");
  await recordGoodsReceived(prisma, { actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", raId: returnAuthorization.id });
  await submitReturnReceiveCount(prisma, { actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", raId: returnAuthorization.id, countedQty: params.requestedQty });
  await submitReturnCheckCount(prisma, { actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", raId: returnAuthorization.id, countedQty: params.requestedQty });

  return returnAuthorization;
}
