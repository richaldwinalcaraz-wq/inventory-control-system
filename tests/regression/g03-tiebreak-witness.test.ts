// G-03 — The Supervisor's tie-break count is final, unwitnessed, and
// statistically unmonitored.
// SYSTEM RULE (BR-026): a tie-break count requires a witnessed second
// recording by another on-duty employee.
// DETECTION: rolling per-Supervisor tie-break bias ratio (resolves toward
// the lower count >60% of the time over 20 tie-breaks) — NOT IMPLEMENTED.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { draftReceivingReport } from "../../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount, submitTieBreakCount, WitnessRequiredError } from "../../src/server/application/receiving/counting";
import { getUserByRole, getIloBranch, getSeedVariant, cleanupReceivingReports } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdRrIds: string[] = [];

async function draftWithDisagreeingCounts() {
  const branch = await getIloBranch(prisma);
  const variant = await getSeedVariant(prisma);
  const receiver = await getUserByRole(prisma, "warehouse_receiver");
  const checker = await getUserByRole(prisma, "warehouse_checker");

  const rr = await draftReceivingReport(prisma, {
    actorUserId: receiver.id,
    actorRole: "WAREHOUSE_RECEIVER",
    branchId: branch.id,
    supplierId: "seed-supplier-01",
    drNumber: `DR-G03-${Date.now()}`,
    poReference: `PO-G03-${Date.now()}`,
    lines: [{ productVariantId: variant.id, expectedQty: 10, unitCost: 50 }],
  });
  createdRrIds.push(rr.id);

  await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });
  await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: variant.id, countedQty: 8 }] }); // deliberately disagrees

  return { rr, variant };
}

describe("G-03: tie-break witness", () => {
  it("[rule] a tie-break count without a witness is rejected", async () => {
    const { rr, variant } = await draftWithDisagreeingCounts();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");

    await expect(
      submitTieBreakCount(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", witnessedBy: "", lines: [{ productVariantId: variant.id, countedQty: 9 }] }),
    ).rejects.toThrow(WitnessRequiredError);
  });

  // CountsDoNotDisagreeError's own check is unreachable via the real API: the
  // instant the receiver/checker counts agree, submitCheckerCount itself
  // synchronously advances the RR out of DRAFT (to PENDING_INSPECTION) in
  // the same call — so by the time any caller could attempt a tie-break,
  // submitTieBreakCount's earlier `rr.status !== "DRAFT"` guard has already
  // fired first. Confirmed directly: a tie-break attempt on an agreed RR
  // throws InvalidReceivingReportStateError, not CountsDoNotDisagreeError —
  // a stronger, earlier guard makes this specific defensive check dead code,
  // not a control gap.
  it("[rule] a tie-break attempt is blocked once the RR has already advanced past DRAFT (agreement already resolved it)", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const receiver = await getUserByRole(prisma, "warehouse_receiver");
    const checker = await getUserByRole(prisma, "warehouse_checker");
    const rr = await draftReceivingReport(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      branchId: branch.id,
      supplierId: "seed-supplier-01",
      drNumber: `DR-G03-agree-${Date.now()}`,
      poReference: `PO-G03-agree-${Date.now()}`,
      lines: [{ productVariantId: variant.id, expectedQty: 10, unitCost: 50 }],
    });
    createdRrIds.push(rr.id);
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });
    await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: variant.id, countedQty: 10 }] });

    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const witness = await getUserByRole(prisma, "encoder"); // any other on-duty staff member
    await expect(
      submitTieBreakCount(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", witnessedBy: witness.id, lines: [{ productVariantId: variant.id, countedQty: 10 }] }),
    ).rejects.toThrow(/PENDING_INSPECTION/);
  });

  it("[rule] a witnessed tie-break resolves the RR and records who witnessed it", async () => {
    const { rr, variant } = await draftWithDisagreeingCounts();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const witness = await getUserByRole(prisma, "encoder");

    const slip = await submitTieBreakCount(prisma, {
      rrId: rr.id,
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      witnessedBy: witness.id,
      lines: [{ productVariantId: variant.id, countedQty: 9 }],
    });
    expect(slip.witnessedBy).toBe(witness.id);

    const updated = await prisma.receivingReport.findUniqueOrThrow({ where: { id: rr.id } });
    expect(updated.status).toBe("PENDING_INSPECTION");
  });

  it("[GAP] DETECTION: no rolling per-Supervisor tie-break bias ratio exists", () => {
    throw new Error(
      "[GAP] G-03 DETECTION: no computation anywhere in src/server/application tracks, per Supervisor, whether " +
        "their tie-break resolutions trend toward the lower of the two original counts more than 60% of the time " +
        "over a rolling 20 tie-breaks — a Supervisor consistently skimming via tie-break resolution is currently undetectable.",
    );
  });
});

afterAll(async () => {
  await cleanupReceivingReports(prisma, createdRrIds);
  await prisma.$disconnect();
});
