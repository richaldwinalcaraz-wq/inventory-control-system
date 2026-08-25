// G-05 — Voiding a Receiving Report has no independent verification that
// the goods weren't actually received.
// SYSTEM RULE (BR-016, amended): a post-handling void requires either a
// matching outbound gate-log entry, or Owner override — and the override
// always auto-opens a DiscrepancyCase, so it can never disappear silently.
// This is one of the findings where the SYSTEM RULE's own real-time
// DiscrepancyCase creation on override IS the detection — no separate
// monthly-batch mechanism needed for this specific half.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { draftReceivingReport } from "../../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount } from "../../src/server/application/receiving/counting";
import { submitInspection } from "../../src/server/application/receiving/inspection";
import { voidReceivingReport, CannotVoidPostedReportError, MatchingGateExitOrOwnerRequiredError } from "../../src/server/application/receiving/void";
import { encodeReceivingReport } from "../../src/server/application/receiving/encoding";
import { getUserByRole, getIloBranch, getSeedVariant, createSessionAndPin, draftAndPrepareForApproval, advanceToApproved, cleanupReceivingReports } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdRrIds: string[] = [];
const createdGateLogIds: string[] = [];

async function draftToPendingInspection() {
  const branch = await getIloBranch(prisma);
  const variant = await getSeedVariant(prisma);
  const receiver = await getUserByRole(prisma, "warehouse_receiver");
  const checker = await getUserByRole(prisma, "warehouse_checker");

  const rr = await draftReceivingReport(prisma, {
    actorUserId: receiver.id,
    actorRole: "WAREHOUSE_RECEIVER",
    branchId: branch.id,
    supplierId: "seed-supplier-01",
    drNumber: `DR-G05-${Date.now()}`,
    poReference: `PO-G05-${Date.now()}`,
    lines: [{ productVariantId: variant.id, expectedQty: 10, unitCost: 50 }],
  });
  createdRrIds.push(rr.id);
  await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });
  await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });
  await submitInspection(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", outcome: "PASS" });
  return { rr, branch };
}

describe("G-05: void post-handling", () => {
  it("[rule] a bare DRAFT (pre-handling) voids as a simple status change", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const receiver = await getUserByRole(prisma, "warehouse_receiver");
    const rr = await draftReceivingReport(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      branchId: branch.id,
      supplierId: "seed-supplier-01",
      drNumber: `DR-G05-draft-${Date.now()}`,
      poReference: `PO-G05-draft-${Date.now()}`,
      lines: [{ productVariantId: variant.id, expectedQty: 5, unitCost: 50 }],
    });
    createdRrIds.push(rr.id);

    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const voided = await voidReceivingReport(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", reason: "mistake before any counting" });
    expect(voided.status).toBe("VOID");
  });

  it("[rule] a post-handling void with no matching gate exit and a non-Owner actor is rejected", async () => {
    const { rr } = await draftToPendingInspection();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");

    await expect(
      voidReceivingReport(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", reason: "supplier says wrong branch" }),
    ).rejects.toThrow(MatchingGateExitOrOwnerRequiredError);
  });

  it("[rule] a post-handling void succeeds cleanly with a matching outbound gate log entry", async () => {
    const { rr, branch } = await draftToPendingInspection();
    const guard = await getUserByRole(prisma, "security_guard");
    const gateLog = await prisma.gateLogEntry.create({
      data: { branchId: branch.id, direction: "OUT", referenceType: "ReceivingReport", referenceId: rr.id, loggedBy: guard.id },
    });
    createdGateLogIds.push(gateLog.id);

    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const voided = await voidReceivingReport(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", reason: "verified return-to-supplier" });
    expect(voided.status).toBe("VOID");
  });

  it("[rule] an Owner override with no gate exit succeeds AND auto-opens a DiscrepancyCase — never silent", async () => {
    const { rr } = await draftToPendingInspection();
    const owner = await getUserByRole(prisma, "owner");

    const voided = await voidReceivingReport(prisma, { rrId: rr.id, actorUserId: owner.id, actorRole: "OWNER", reason: "owner override, no gate log available" });
    expect(voided.status).toBe("VOID");

    const openedCase = await prisma.discrepancyCase.findFirst({ where: { referenceType: "ReceivingReport", referenceId: rr.id } });
    expect(openedCase).not.toBeNull();
    expect(openedCase?.notes).toContain("Owner override");
  });

  it("[rule] a POSTED receiving report can never be voided", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const rr = await draftAndPrepareForApproval(prisma, { branchId: branch.id, variantId: variant.id });
    createdRrIds.push(rr.id);
    await advanceToApproved(prisma, rr.id);

    const encoder = await getUserByRole(prisma, "encoder");
    const { session, pinToken } = await createSessionAndPin(prisma, encoder.id);
    const posted = await encodeReceivingReport(prisma, {
      rrId: rr.id,
      actorUserId: encoder.id,
      actorRole: "ENCODER",
      branchCode: branch.code,
      session,
      pinTokenId: pinToken.id,
      evidencePhotos: [{ storageKey: "g05-posted-evidence.jpg", captureMethod: "LIVE_CAMERA_STREAM" }],
    });
    expect(posted.receivingReport.status).toBe("POSTED");

    const owner = await getUserByRole(prisma, "owner");
    await expect(
      voidReceivingReport(prisma, { rrId: rr.id, actorUserId: owner.id, actorRole: "OWNER", reason: "trying to void a posted RR" }),
    ).rejects.toThrow(CannotVoidPostedReportError);
  });
});

afterAll(async () => {
  await prisma.gateLogEntry.deleteMany({ where: { id: { in: createdGateLogIds } } });
  await prisma.discrepancyCase.deleteMany({ where: { referenceType: "ReceivingReport", referenceId: { in: createdRrIds } } });
  await prisma.transactionEvidence.deleteMany({ where: { referenceType: "ReceivingReport", referenceId: { in: createdRrIds } } });
  await cleanupReceivingReports(prisma, createdRrIds);
  await prisma.$disconnect();
});
