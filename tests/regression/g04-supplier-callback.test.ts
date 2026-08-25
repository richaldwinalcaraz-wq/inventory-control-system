// G-04 — No independent verification that a supplier delivery is genuine
// ("three-way match" is missing).
// SYSTEM RULE (BR-031, amended): a delivery with no matching PO, OR above
// the three-way-match threshold, cannot be approved without a logged,
// independent supplier callback.
// GAP (confirmed against the actual code): approval.ts only checks
// `!poReference && !supplierCallbackConfirmedAt` — a delivery WITH a PO is
// never gated on value, even far above any materiality threshold. Only the
// "no PO" half of BR-031 is implemented.
// DETECTION: monthly cross-reference against the AP/supplier-invoice
// register — NOT IMPLEMENTED (no such module exists in this codebase).
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { draftReceivingReport, confirmSupplierCallback } from "../../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount } from "../../src/server/application/receiving/counting";
import { submitInspection } from "../../src/server/application/receiving/inspection";
import { prepareReceivingReport, verifyReceivingReport } from "../../src/server/application/receiving/verification";
import { approveReceivingReport, SupplierCallbackRequiredError } from "../../src/server/application/receiving/approval";
import { getUserByRole, getIloBranch, getSeedVariant, createSessionAndPin, cleanupReceivingReports } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdRrIds: string[] = [];

async function draftAndVerify(params: { poReference?: string; unitCost: number; qty: number }) {
  const branch = await getIloBranch(prisma);
  const variant = await getSeedVariant(prisma);
  const receiver = await getUserByRole(prisma, "warehouse_receiver");
  const checker = await getUserByRole(prisma, "warehouse_checker");
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");

  const rr = await draftReceivingReport(prisma, {
    actorUserId: receiver.id,
    actorRole: "WAREHOUSE_RECEIVER",
    branchId: branch.id,
    supplierId: "seed-supplier-01",
    drNumber: `DR-G04-${Date.now()}`,
    poReference: params.poReference,
    lines: [{ productVariantId: variant.id, expectedQty: params.qty, unitCost: params.unitCost }],
  });
  createdRrIds.push(rr.id);

  await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: params.qty }] });
  await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: variant.id, countedQty: params.qty }] });
  await submitInspection(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", outcome: "PASS" });
  await prepareReceivingReport(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER" });
  await verifyReceivingReport(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR" });

  return rr;
}

describe("G-04: supplier callback", () => {
  it("[rule] a no-PO delivery cannot be approved without a confirmed callback", async () => {
    const rr = await draftAndVerify({ unitCost: 50, qty: 5 }); // no poReference, low value
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const { session, pinToken } = await createSessionAndPin(prisma, branchManager.id);

    await expect(
      approveReceivingReport(prisma, { rrId: rr.id, actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", session, pinTokenId: pinToken.id }),
    ).rejects.toThrow(SupplierCallbackRequiredError);
  });

  it("[rule] confirming the callback unblocks approval for the same no-PO delivery", async () => {
    const rr = await draftAndVerify({ unitCost: 50, qty: 5 });
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    await confirmSupplierCallback(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR" });

    const branchManager = await getUserByRole(prisma, "branch_manager");
    const { session, pinToken } = await createSessionAndPin(prisma, branchManager.id);
    const approved = await approveReceivingReport(prisma, { rrId: rr.id, actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", session, pinTokenId: pinToken.id });
    expect(approved.status).toBe("APPROVED");
  });

  it("[GAP] rule: a delivery WITH a PO, far above the three-way-match threshold, is approved with no callback at all", async () => {
    // ₱50,000 total — well above every threshold in this codebase (the
    // OWNER-tier RECEIVING approval band starts at ₱10,000.01) — yet a PO
    // reference alone silences BR-031's callback requirement entirely, per
    // the actual code in approval.ts: `if (!rr.poReference && ...)`.
    const rr = await draftAndVerify({ poReference: `PO-HIGHVALUE-${Date.now()}`, unitCost: 500, qty: 100 });
    const owner = await getUserByRole(prisma, "owner");
    const { session, pinToken } = await createSessionAndPin(prisma, owner.id);

    const approved = await approveReceivingReport(prisma, { rrId: rr.id, actorUserId: owner.id, actorRole: "OWNER", session, pinTokenId: pinToken.id });

    if (approved.status === "APPROVED") {
      throw new Error(
        "[GAP] G-04 SYSTEM RULE: a ₱50,000 delivery WITH a PO reference was approved with zero supplier callback " +
          "confirmation. BR-031 (amended) requires the callback for a missing PO OR a delivery above the three-way- " +
          "match threshold — approval.ts only implements the missing-PO half; presence of any PO, at any value, " +
          "bypasses the callback requirement entirely.",
      );
    }
  });

  it("[GAP] DETECTION: no monthly AP/supplier-invoice cross-reference exists", () => {
    throw new Error(
      "[GAP] G-04 DETECTION: no AP/supplier-invoice-register module exists anywhere in this codebase — a receipt " +
        "with no corresponding supplier invoice within 30 days (or vice versa) cannot currently be detected.",
    );
  });
});

afterAll(async () => {
  await cleanupReceivingReports(prisma, createdRrIds);
  await prisma.$disconnect();
});
