// G-12 — Voiding a sale must not become a backdoor around the fraud
// controls a real Customer Return or Adjustment would otherwise go
// through.
// SYSTEM RULE: a POSTED retail sale can never be simply voided — the only
// path is requestRetailSaleVoidWithoutReturn, which forces a full ADJ_01
// investigation/approval pipeline per line, not a silent reversal. A DRAFT
// sale (nothing posted yet) can be voided outright.
// DETECTION: no void-rate-by-Cashier report exists.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry } from "../../src/server/domain/ledger/postLedgerEntry";
import { draftRetailSale } from "../../src/server/application/retail/draft";
import { postRetailSale } from "../../src/server/application/retail/post";
import { voidRetailSale, CannotVoidPostedRetailSaleError } from "../../src/server/application/retail/void";
import { requestRetailSaleVoidWithoutReturn } from "../../src/server/application/retail/voidWithoutReturn";
import { buildExportTable, UnknownReportIdError } from "../../src/server/application/reporting/export/registry";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin } from "./helpers/receiving";

const prisma = new PrismaClient();

async function stockCounter(branchId: string, branchCode: string, variantId: string, qty: number, unitCost: number, cashierId: string) {
  const counter = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "COUNTER", warehouse: { branchId } } });
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await postLedgerEntry(prisma, {
    idempotency: { documentType: "G12SETUP", documentNumber: `G12-SETUP-${tag}`, branchCode, requestPayloadHash: `hash-${tag}` },
    branchId,
    productVariantId: variantId,
    warehouseLocationId: counter.id,
    quantityDeltaBase: qty,
    movementType: "ADJUSTMENT_IN",
    unitCostAtMovement: unitCost,
    referenceType: "RegressionTestG12",
    referenceId: `g12-setup-${tag}`,
    documentNumber: `G12-SETUP-DOC-${tag}`,
    performedBy: cashierId,
  });
}

describe("G-12: retail sale void control", () => {
  it("[rule] a DRAFT sale can be voided outright — nothing has posted yet", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const cashier = await getUserByRole(prisma, "cashier");

    const sale = await draftRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", branchId: branch.id, lines: [{ productVariantId: variant.id, quantity: 1 }] });
    const voided = await voidRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", retailSaleId: sale.id, reason: "Customer changed mind before payment." });
    expect(voided.status).toBe("VOID");
  });

  it("[rule] a POSTED sale cannot be simply voided — CannotVoidPostedRetailSaleError", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const cashier = await getUserByRole(prisma, "cashier");
    await stockCounter(branch.id, branch.code, variant.id, 10, 50, cashier.id);

    const sale = await draftRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", branchId: branch.id, lines: [{ productVariantId: variant.id, quantity: 1 }] });
    const { session, pinToken } = await createSessionAndPin(prisma, cashier.id);
    const posted = await postRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", retailSaleId: sale.id, branchCode: branch.code, session, pinTokenId: pinToken.id });

    await expect(
      voidRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", retailSaleId: posted.retailSale.id, reason: "Attempted post-hoc void." }),
    ).rejects.toThrow(CannotVoidPostedRetailSaleError);
  });

  it("[rule] closing out a POSTED sale without goods returned forces a full ADJ_01 request per line, not a silent reversal", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const cashier = await getUserByRole(prisma, "cashier");
    const branchManager = await getUserByRole(prisma, "branch_manager");
    await stockCounter(branch.id, branch.code, variant.id, 10, 50, cashier.id);

    const sale = await draftRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", branchId: branch.id, lines: [{ productVariantId: variant.id, quantity: 2 }] });
    const { session, pinToken } = await createSessionAndPin(prisma, cashier.id);
    const posted = await postRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", retailSaleId: sale.id, branchCode: branch.code, session, pinTokenId: pinToken.id });

    const result = await requestRetailSaleVoidWithoutReturn(prisma, {
      actorUserId: branchManager.id,
      actorRole: "BRANCH_MANAGER",
      retailSaleId: posted.retailSale.id,
      reason: "Customer disputed charge, goods never physically returned.",
    });
    expect(result.retailSale.status).toBe("VOID");
    expect(result.adjustmentRequests).toHaveLength(1);
    expect(result.adjustmentRequests[0]!.status).toBe("PENDING_INVESTIGATION");
    expect(result.adjustmentRequests[0]!.quantityDelta.toString()).toBe("-2");
  });

  it("[GAP] DETECTION: no void-rate-by-Cashier report exists", async () => {
    try {
      await buildExportTable(prisma, { reportId: "void-rate-by-cashier", actorRole: "OWNER" });
      throw new Error("[GAP] G-12 FAILED TO STAY A GAP: a void-rate-by-cashier report now exists in the export registry — this test should be replaced with a real detection test.");
    } catch (err) {
      if (err instanceof UnknownReportIdError) {
        throw new Error(
          "[GAP] G-12 DETECTION: no void-rate-by-Cashier (or similar pattern) report is registered in " +
            "src/server/application/reporting/export/registry.ts — voidReason is recorded per-sale but never " +
            "aggregated to surface a cashier with a disproportionate void rate.",
        );
      }
      throw err;
    }
  });
});
