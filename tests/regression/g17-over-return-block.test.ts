// G-17 — Return quantity must be hard-blocked from ever exceeding the
// original line's quantity, GLOBALLY across every branch — not just
// within the branch that originally sold it. A customer routing repeat
// returns of the same invoice line through different branches must not be
// able to double- or triple-return past what was actually sold.
// SYSTEM RULE: issueReturnAuthorization locks a per-original-line mutex
// row and computes remaining returnable qty across ALL ReturnAuthorization
// rows against that line (any branch), rejecting anything that would push
// the cumulative total past the original quantity.
// DETECTION: a rejected over-return attempt isn't logged anywhere
// reviewable — confirmed by reading authorize.ts directly: it throws and
// nothing else.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { issueReturnAuthorization, ExceedsRemainingReturnableQtyError } from "../../src/server/application/returns/authorize";
import { computeRemainingReturnableQty } from "../../src/server/domain/returns/returnQuantity";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin } from "./helpers/receiving";
import { createPostedRetailSaleLine } from "./helpers/returns";

const prisma = new PrismaClient();

describe("G-17: over-return hard block, enforced globally across branches", () => {
  it("[rule] a full-quantity return exhausts the line, and any further return attempt — even from a DIFFERENT branch — is blocked", async () => {
    const branch = await getIloBranch(prisma);
    const cebBranch = await prisma.branch.findUniqueOrThrow({ where: { code: "CEB" } });
    const variant = await getSeedVariant(prisma);
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const qty = 5;

    const { line } = await createPostedRetailSaleLine(prisma, { branchId: branch.id, branchCode: branch.code, variantId: variant.id, qty });

    const { session: s1, pinToken: p1 } = await createSessionAndPin(prisma, branchManager.id);
    const first = await issueReturnAuthorization(prisma, {
      actorUserId: branchManager.id,
      actorRole: "BRANCH_MANAGER",
      branchId: branch.id,
      branchCode: branch.code,
      session: s1,
      pinTokenId: p1.id,
      originalSaleType: "RetailSale",
      originalSaleLineId: line.id,
      requestedQty: qty,
      reasonCode: "WRONG_ITEM",
      identityVerification: "PHYSICAL_RECEIPT",
    });
    expect(Number(first.returnAuthorization.requestedQty)).toBe(qty);

    // Same line, a different branch, even a single extra unit — must still
    // be blocked. The lock/remaining-qty computation is per-line, not
    // per-(line, branch).
    const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, branchManager.id);
    await expect(
      issueReturnAuthorization(prisma, {
        actorUserId: branchManager.id,
        actorRole: "BRANCH_MANAGER",
        branchId: cebBranch.id,
        branchCode: cebBranch.code,
        session: s2,
        pinTokenId: p2.id,
        originalSaleType: "RetailSale",
        originalSaleLineId: line.id,
        requestedQty: 1,
        reasonCode: "WRONG_ITEM",
        identityVerification: "PHYSICAL_RECEIPT",
      }),
    ).rejects.toThrow(ExceedsRemainingReturnableQtyError);
  });

  it("[rule] computeRemainingReturnableQty reflects partial consumption correctly", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const qty = 10;

    const { line } = await createPostedRetailSaleLine(prisma, { branchId: branch.id, branchCode: branch.code, variantId: variant.id, qty });

    const { session, pinToken } = await createSessionAndPin(prisma, branchManager.id);
    await issueReturnAuthorization(prisma, {
      actorUserId: branchManager.id,
      actorRole: "BRANCH_MANAGER",
      branchId: branch.id,
      branchCode: branch.code,
      session,
      pinTokenId: pinToken.id,
      originalSaleType: "RetailSale",
      originalSaleLineId: line.id,
      requestedQty: 4,
      reasonCode: "WRONG_ITEM",
      identityVerification: "PHYSICAL_RECEIPT",
    });

    const remaining = await prisma.$transaction((tx) =>
      computeRemainingReturnableQty(tx, { originalSaleType: "RetailSale", originalSaleLineId: line.id, originalLineQty: qty }),
    );
    expect(remaining).toBe(6);
  });

  it("[GAP] DETECTION: a rejected over-return attempt is never logged anywhere reviewable", () => {
    const authorizePath = fileURLToPath(new URL("../../src/server/application/returns/authorize.ts", import.meta.url));
    const source = readFileSync(authorizePath, "utf-8");
    if (/auditLog|AuditLog/.test(source)) {
      throw new Error("[GAP] G-17 FAILED TO STAY A GAP: authorize.ts now references AuditLog — replace this test with a real detection test.");
    }
    throw new Error(
      "[GAP] G-17 DETECTION: src/server/application/returns/authorize.ts throws ExceedsRemainingReturnableQtyError " +
        "and nothing else — a rejected over-return attempt (a real signal of return fraud or a broken client) is " +
        "never written to AuditLog or any report, invisible to the Auditor.",
    );
  });
});
