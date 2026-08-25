// G-26 — A reconciliation reviewer must not be reviewing their own work:
// someone who personally moved a product's stock that day is too close to
// it to independently verify the bin-card count for that same product.
// SYSTEM RULE: isEligibleReconciliationReviewer checks PER-PRODUCT-PER-DAY
// (not per-branch-day) — a candidate who touched a DIFFERENT product at the
// same branch on the same day is still eligible for THIS product's line.
// Ineligibility is not a hard block: reviewReconciliationLine still accepts
// the review, but routes the line to the Auditor (routedToAuditor) and
// excludes it from "clean close." A binCardQty/systemExpectedClosingQty
// mismatch routes to the Auditor too, regardless of reviewer eligibility.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry } from "../../src/server/domain/ledger/postLedgerEntry";
import { reviewReconciliationLine, BinCardNotYetCapturedError, LineAlreadyReviewedError } from "../../src/server/application/reconciliation/reviewLine";
import { getIloBranch, getSeedVariant, getUserByRole, createEphemeralUser } from "./helpers/receiving";
import { uniqueBusinessDate, createReconciliationLine } from "./helpers/reconciliation";

const prisma = new PrismaClient();

/**
 * Posts a real ledger row (today, never backdated) for (branchId,
 * productVariantId, performedBy), then attaches a DailyReconciliationLine
 * to a shared TODAY DailyReconciliation so isEligibleReconciliationReviewer's
 * [startOfDay, +24h) window genuinely contains it. Deliberately does NOT
 * mutate StockLedger.createdAt after the fact — that column is part of
 * G-27's hash chain, and rewriting it post-hoc desyncs the row's stored
 * row_hash from its actual content, corrupting the chain for every
 * subsequent row (this is exactly what an earlier draft of this file did,
 * and it broke G-27's verifyChain for the rest of the suite).
 */
async function createTodayReconciliation(branchId: string) {
  const auditor = await getUserByRole(prisma, "auditor");
  return prisma.dailyReconciliation.upsert({
    where: { branchId_businessDate: { branchId, businessDate: new Date() } },
    update: {},
    create: { branchId, businessDate: new Date(), preparedBy: auditor.id },
  });
}

async function addLine(dailyReconciliationId: string, branchId: string, productVariantId: string, systemExpectedClosingQty: number, binCardQty: number) {
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId } } });
  return prisma.dailyReconciliationLine.create({
    data: {
      dailyReconciliationId,
      productVariantId,
      warehouseLocationId: location.id,
      openingQty: 0,
      stockInQty: systemExpectedClosingQty,
      stockOutQty: 0,
      systemExpectedClosingQty,
      binCardQty,
      variance: binCardQty - systemExpectedClosingQty,
      matched: binCardQty === systemExpectedClosingQty,
    },
  });
}

async function markUserActiveOnProduct(branchId: string, branchCode: string, productVariantId: string, performedById: string) {
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId } } });
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await postLedgerEntry(prisma, {
    idempotency: { documentType: "G26SETUP", documentNumber: `G26-SETUP-${tag}`, branchCode, requestPayloadHash: `hash-${tag}` },
    branchId,
    productVariantId,
    warehouseLocationId: location.id,
    quantityDeltaBase: 1,
    movementType: "ADJUSTMENT_IN",
    unitCostAtMovement: 1,
    referenceType: "RegressionTestG26",
    referenceId: `g26-setup-${tag}`,
    documentNumber: `G26-SETUP-DOC-${tag}`,
    performedBy: performedById,
  });
}

describe("G-26: reconciliation reviewer eligibility (per-product-per-day)", () => {
  it("[rule] a reviewer who never touched this product's ledger that day is eligible — review succeeds, not routed to the Auditor", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const reviewer = await createEphemeralUser(prisma, { branchId: branch.id, role: "WAREHOUSE_CHECKER", label: "g26-eligible-reviewer" });

    const { line } = await createReconciliationLine(prisma, { branchId: branch.id, variantId: variant.id, systemExpectedClosingQty: 100, businessDate: uniqueBusinessDate() });
    await prisma.dailyReconciliationLine.update({ where: { id: line.id }, data: { binCardQty: 100, variance: 0, matched: true } });

    const reviewed = await reviewReconciliationLine(prisma, { actorUserId: reviewer.id, actorRole: "WAREHOUSE_CHECKER", lineId: line.id });
    expect(reviewed.reviewerEligible).toBe(true);
    expect(reviewed.routedToAuditor).toBe(false);

    const openCase = await prisma.discrepancyCase.findFirst({ where: { referenceType: "DailyReconciliationLine", referenceId: line.id, status: "OPEN" } });
    expect(openCase).toBeNull();
  });

  it("[rule] a reviewer who DID touch this exact product's ledger at this branch today is ineligible — review still succeeds but routes to the Auditor; touching a DIFFERENT product the same day/branch does NOT disqualify (per-product-per-day, not per-branch-day)", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const otherVariant = await prisma.productVariant.findFirstOrThrow({ where: { sku: { not: variant.sku } } });
    const ineligibleReviewer = await createEphemeralUser(prisma, { branchId: branch.id, role: "WAREHOUSE_CHECKER", label: "g26-ineligible-reviewer" });
    const eligibleReviewer = await createEphemeralUser(prisma, { branchId: branch.id, role: "WAREHOUSE_CHECKER", label: "g26-other-product-reviewer" });

    await markUserActiveOnProduct(branch.id, branch.code, variant.id, ineligibleReviewer.id);
    // Touches a DIFFERENT product at the same branch/day — must not
    // disqualify eligibleReviewer for THIS product's line below.
    await markUserActiveOnProduct(branch.id, branch.code, otherVariant.id, eligibleReviewer.id);

    const reconciliation = await createTodayReconciliation(branch.id);
    const ineligibleLine = await addLine(reconciliation.id, branch.id, variant.id, 100, 100);
    const eligibleLine = await addLine(reconciliation.id, branch.id, variant.id, 50, 50);

    const ineligibleReview = await reviewReconciliationLine(prisma, { actorUserId: ineligibleReviewer.id, actorRole: "WAREHOUSE_CHECKER", lineId: ineligibleLine.id });
    expect(ineligibleReview.reviewerEligible).toBe(false);
    expect(ineligibleReview.routedToAuditor).toBe(true);
    const openCase = await prisma.discrepancyCase.findFirst({ where: { referenceType: "DailyReconciliationLine", referenceId: ineligibleLine.id, status: "OPEN" } });
    expect(openCase).not.toBeNull();

    const eligibleReview = await reviewReconciliationLine(prisma, { actorUserId: eligibleReviewer.id, actorRole: "WAREHOUSE_CHECKER", lineId: eligibleLine.id });
    expect(eligibleReview.reviewerEligible).toBe(true);
    expect(eligibleReview.routedToAuditor).toBe(false);
  });

  it("[rule] a binCardQty/systemExpectedClosingQty mismatch routes to the Auditor regardless of reviewer eligibility", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const reviewer = await createEphemeralUser(prisma, { branchId: branch.id, role: "WAREHOUSE_CHECKER", label: "g26-mismatch-reviewer" });

    const { line } = await createReconciliationLine(prisma, { branchId: branch.id, variantId: variant.id, systemExpectedClosingQty: 100 });
    await prisma.dailyReconciliationLine.update({ where: { id: line.id }, data: { binCardQty: 90, variance: -10, matched: false } });

    const reviewed = await reviewReconciliationLine(prisma, { actorUserId: reviewer.id, actorRole: "WAREHOUSE_CHECKER", lineId: line.id });
    expect(reviewed.reviewerEligible).toBe(true);
    expect(reviewed.routedToAuditor).toBe(true);
  });

  it("[rule] a line with no bin-card count yet cannot be reviewed, and a line already reviewed cannot be reviewed twice", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const reviewer = await createEphemeralUser(prisma, { branchId: branch.id, role: "WAREHOUSE_CHECKER", label: "g26-notyet-reviewer" });

    const { line: uncaptured } = await createReconciliationLine(prisma, { branchId: branch.id, variantId: variant.id, systemExpectedClosingQty: 100 });
    await expect(
      reviewReconciliationLine(prisma, { actorUserId: reviewer.id, actorRole: "WAREHOUSE_CHECKER", lineId: uncaptured.id }),
    ).rejects.toThrow(BinCardNotYetCapturedError);

    const { line: captured } = await createReconciliationLine(prisma, { branchId: branch.id, variantId: variant.id, systemExpectedClosingQty: 100 });
    await prisma.dailyReconciliationLine.update({ where: { id: captured.id }, data: { binCardQty: 100, variance: 0, matched: true } });
    await reviewReconciliationLine(prisma, { actorUserId: reviewer.id, actorRole: "WAREHOUSE_CHECKER", lineId: captured.id });

    await expect(
      reviewReconciliationLine(prisma, { actorUserId: reviewer.id, actorRole: "WAREHOUSE_CHECKER", lineId: captured.id }),
    ).rejects.toThrow(LineAlreadyReviewedError);
  });
});
