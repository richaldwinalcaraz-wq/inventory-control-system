// G-02 — "Blind" double counting has no physical enforcement mechanism.
// SYSTEM RULE (BR-025): Receiver/Checker counts on separate, independently
// submitted CountSlips — the Checker function never reads back the
// Receiver's figures, and the Checker cannot be the same person.
// DETECTION: track counter-pairs whose blind counts match 100% of the time
// over 15+ deliveries and flag as a collusion anomaly — NOT IMPLEMENTED.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { draftReceivingReport } from "../../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount, CheckerMustNotBeReceiverError, CountSlipAlreadySubmittedError } from "../../src/server/application/receiving/counting";
import { getUserByRole, getIloBranch, getSeedVariant, cleanupReceivingReports } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdRrIds: string[] = [];

async function draftFreshRr() {
  const branch = await getIloBranch(prisma);
  const variant = await getSeedVariant(prisma);
  const receiver = await getUserByRole(prisma, "warehouse_receiver");
  const rr = await draftReceivingReport(prisma, {
    actorUserId: receiver.id,
    actorRole: "WAREHOUSE_RECEIVER",
    branchId: branch.id,
    supplierId: "seed-supplier-01",
    drNumber: `DR-G02-${Date.now()}`,
    poReference: `PO-G02-${Date.now()}`,
    lines: [{ productVariantId: variant.id, expectedQty: 10, unitCost: 50 }],
  });
  createdRrIds.push(rr.id);
  return { rr, variant, receiver };
}

describe("G-02: blind double count", () => {
  it("[rule] the Checker cannot be the same person as the Receiver", async () => {
    const { rr, variant, receiver } = await draftFreshRr();
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });

    await expect(
      submitCheckerCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: variant.id, countedQty: 10 }] }),
    ).rejects.toThrow(CheckerMustNotBeReceiverError);
  });

  it("[rule] a second receiver-count submission on the same RR is rejected (each slip is a one-shot, not a shared editable column)", async () => {
    const { rr, variant, receiver } = await draftFreshRr();
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });

    await expect(
      submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: 999 }] }),
    ).rejects.toThrow(CountSlipAlreadySubmittedError);
  });

  it("[rule] the Checker's own submission function never returns the Receiver's figures — structurally blind, not just procedurally", async () => {
    const { rr, variant, receiver } = await draftFreshRr();
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });
    const checker = await getUserByRole(prisma, "warehouse_checker");

    const result = await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: variant.id, countedQty: 7 }] });

    // The only fields returned are the checker's own slip id and whether it
    // matched — no receiver quantity is ever surfaced through this call.
    expect(Object.keys(result).sort()).toEqual(["countSlip", "matched"]);
    expect(result.matched).toBe(false);
  });

  it("[rule] matching counts advance the RR to PENDING_INSPECTION", async () => {
    const { rr, variant, receiver } = await draftFreshRr();
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });
    const checker = await getUserByRole(prisma, "warehouse_checker");
    const result = await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });
    expect(result.matched).toBe(true);

    const updated = await prisma.receivingReport.findUniqueOrThrow({ where: { id: rr.id } });
    expect(updated.status).toBe("PENDING_INSPECTION");
  });

  it("[GAP] DETECTION: no counter-pair 100%-match collusion report exists", () => {
    throw new Error(
      "[GAP] G-02 DETECTION: no report tracking, per Receiver/Checker pair, how often their counts match exactly " +
        "over a rolling 90 days exists anywhere in src/server/application/reporting — a pair whose counts always " +
        "match (a strong coordination signal per the audit) is currently undetectable.",
    );
  });
});

afterAll(async () => {
  await cleanupReceivingReports(prisma, createdRrIds);
  await prisma.$disconnect();
});
