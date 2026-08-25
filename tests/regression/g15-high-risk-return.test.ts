// G-15 — Returns without proof of purchase / unverified identity are a
// higher fraud-risk path and must be routed to a stricter approval tier —
// not treated the same as a normal, identity-verified return.
// SYSTEM RULE: issueReturnAuthorization derives isHighRisk/transactionType
// from identityVerification (never client-supplied), and
// RETURN_NO_DOCUMENT resolves to a stricter (lower) Owner cutover than
// ordinary RETURN.
// DETECTION: a high-risk return is never auto-routed to the Auditor via a
// DiscrepancyCase — nothing flags it for independent review beyond the
// stricter approval tier itself.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { issueReturnAuthorization, WrongReturnApproverRoleError } from "../../src/server/application/returns/authorize";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin } from "./helpers/receiving";
import { createPostedRetailSaleLine } from "./helpers/returns";

const prisma = new PrismaClient();

describe("G-15: high-risk (no-identity) return routing", () => {
  it("[rule] the same return value requires OWNER when identityVerification is NONE, but only BRANCH_MANAGER when identity is verified", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const owner = await getUserByRole(prisma, "owner");

    // qty chosen so value lands between RETURN_NO_DOCUMENT's ₱2,000 Owner
    // cutover and ordinary RETURN's ₱10,000 cutover — same value, two
    // different required approvers depending only on identityVerification.
    const qty = Math.max(1, Math.ceil(3000 / Number(variant.sellingPrice)));

    const { line: verifiedLine } = await createPostedRetailSaleLine(prisma, { branchId: branch.id, branchCode: branch.code, variantId: variant.id, qty });
    const { session: sV, pinToken: pV } = await createSessionAndPin(prisma, branchManager.id);
    const verifiedResult = await issueReturnAuthorization(prisma, {
      actorUserId: branchManager.id,
      actorRole: "BRANCH_MANAGER",
      branchId: branch.id,
      branchCode: branch.code,
      session: sV,
      pinTokenId: pV.id,
      originalSaleType: "RetailSale",
      originalSaleLineId: verifiedLine.id,
      requestedQty: qty,
      reasonCode: "WRONG_ITEM",
      identityVerification: "PHYSICAL_RECEIPT",
    });
    expect(verifiedResult.returnAuthorization.isHighRisk).toBe(false);

    const { line: noDocLine } = await createPostedRetailSaleLine(prisma, { branchId: branch.id, branchCode: branch.code, variantId: variant.id, qty });
    const { session: sB, pinToken: pB } = await createSessionAndPin(prisma, branchManager.id);
    await expect(
      issueReturnAuthorization(prisma, {
        actorUserId: branchManager.id,
        actorRole: "BRANCH_MANAGER",
        branchId: branch.id,
        branchCode: branch.code,
        session: sB,
        pinTokenId: pB.id,
        originalSaleType: "RetailSale",
        originalSaleLineId: noDocLine.id,
        requestedQty: qty,
        reasonCode: "WRONG_ITEM",
        identityVerification: "NONE",
      }),
    ).rejects.toThrow(WrongReturnApproverRoleError);

    const { session: sO, pinToken: pO } = await createSessionAndPin(prisma, owner.id);
    const noDocResult = await issueReturnAuthorization(prisma, {
      actorUserId: owner.id,
      actorRole: "OWNER",
      branchId: branch.id,
      branchCode: branch.code,
      session: sO,
      pinTokenId: pO.id,
      originalSaleType: "RetailSale",
      originalSaleLineId: noDocLine.id,
      requestedQty: qty,
      reasonCode: "WRONG_ITEM",
      identityVerification: "NONE",
    });
    expect(noDocResult.returnAuthorization.isHighRisk).toBe(true);
  });

  it("[GAP] DETECTION: a high-risk return is never auto-routed to the Auditor via a DiscrepancyCase", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const { line } = await createPostedRetailSaleLine(prisma, { branchId: branch.id, branchCode: branch.code, variantId: variant.id, qty: 1 });
    const { session, pinToken } = await createSessionAndPin(prisma, branchManager.id);

    // Low value, NONE identity — still under RETURN_NO_DOCUMENT's ₱2,000
    // tier1, so Branch Manager is the correct approver; isHighRisk is set
    // purely from identityVerification, independent of value.
    const result = await issueReturnAuthorization(prisma, {
      actorUserId: branchManager.id,
      actorRole: "BRANCH_MANAGER",
      branchId: branch.id,
      branchCode: branch.code,
      session,
      pinTokenId: pinToken.id,
      originalSaleType: "RetailSale",
      originalSaleLineId: line.id,
      requestedQty: 1,
      reasonCode: "WRONG_ITEM",
      identityVerification: "NONE",
    });
    expect(result.returnAuthorization.isHighRisk).toBe(true);

    const autoCase = await prisma.discrepancyCase.findFirst({ where: { referenceType: "ReturnAuthorization", referenceId: result.returnAuthorization.id } });
    if (autoCase) {
      throw new Error("[GAP] G-15 FAILED TO STAY A GAP: a DiscrepancyCase now auto-opens for a high-risk return — replace this test with a real detection test.");
    }
    throw new Error(
      "[GAP] G-15 DETECTION: issuing a high-risk (isHighRisk=true) ReturnAuthorization never opens a DiscrepancyCase " +
        "— the stricter Owner/lower-cutover approval tier is the only control; nothing separately routes the " +
        "transaction to the Auditor for independent review the way, e.g., G-26's reviewer-eligibility mismatch does.",
    );
  });
});
