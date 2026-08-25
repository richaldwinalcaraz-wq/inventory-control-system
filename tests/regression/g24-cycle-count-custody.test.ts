// G-24 — A cycle count submitted by the same person who "collected" the
// physical count (rather than counting it themselves) is a custody gap a
// collusive counter could exploit to fabricate a count without ever
// physically touching the stock.
// SYSTEM RULE: submitPrimaryCount/submitSecondaryCount/submitTiebreakCount
// all reject collectedBy === the submitting actor (CollectorMustNotBeCounterError)
// — a custody field, when supplied, must name someone OTHER than the counter.
// GAP (per the audit finding's own scope): collectedBy/completedAt/
// submissionMethod are all OPTIONAL fields — a submission that supplies
// neither is still accepted outright. The finding calls for the custody
// chain to be genuinely enforced, not merely checked-when-present; this
// test proves the field is optional, not enforced.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { submitPrimaryCount, submitSecondaryCount, CollectorMustNotBeCounterError } from "../../src/server/application/cycleCount/submitCount";
import { getIloBranch, getSeedVariant, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

// zone varies per call — CycleCountRecord has a partial unique index on
// (productVariantId, warehouseLocationId) while a record is still open, so
// reusing the same (SEED_SKU, STORAGE) pair across tests in this file
// would collide on the second call.
async function createCountingRecord(branchId: string, variantId: string, zone: "QUARANTINE" | "RETURNS" | "COUNTER") {
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone, warehouse: { branchId } } });
  // A real CycleCountWindow row is only needed as this record's FK target
  // — submitCount.ts doesn't itself re-check window status, so it's
  // created directly, already CLOSED, rather than going through the full
  // declare/start pipeline (which would need an ACTIVE window on a branch
  // other test files don't touch).
  const window = await prisma.cycleCountWindow.create({
    data: { branchId, declaredBy: supervisor.id, status: "CLOSED", endedAt: new Date() },
  });
  const record = await prisma.cycleCountRecord.create({
    data: { cycleCountWindowId: window.id, branchId, productVariantId: variantId, warehouseLocationId: location.id, cycleCountClass: "A", status: "COUNTING" },
  });
  return record;
}

// The partial unique index only applies while a record is still "open"
// (COUNTING/TIEBREAK_PENDING/RECOUNT_PENDING) — closing it out after each
// test frees the (productVariantId, warehouseLocationId) pair for the next
// run of this same file, the same class of fix as G-11's unitWeightKg
// reset and G-21/G-23's ephemeral requesters.
async function closeRecord(recordId: string) {
  await prisma.cycleCountRecord.update({ where: { id: recordId }, data: { status: "CLOSED_CLEAN" } });
}

describe("G-24: cycle count custody field enforcement", () => {
  it("[rule] submitPrimaryCount rejects collectedBy === the submitting counter", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const counter = await getUserByRole(prisma, "warehouse_receiver");
    const record = await createCountingRecord(branch.id, variant.id, "QUARANTINE");

    await expect(
      submitPrimaryCount(prisma, { actorUserId: counter.id, actorRole: "WAREHOUSE_RECEIVER", cycleCountRecordId: record.id, countedQty: 50, collectedBy: counter.id }),
    ).rejects.toThrow(CollectorMustNotBeCounterError);
    await closeRecord(record.id);
  });

  it("[rule] submitSecondaryCount also rejects collectedBy === the submitting counter", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const primary = await getUserByRole(prisma, "warehouse_receiver");
    const secondary = await getUserByRole(prisma, "warehouse_checker");
    const record = await createCountingRecord(branch.id, variant.id, "RETURNS");

    await submitPrimaryCount(prisma, { actorUserId: primary.id, actorRole: "WAREHOUSE_RECEIVER", cycleCountRecordId: record.id, countedQty: 50 });

    await expect(
      submitSecondaryCount(prisma, { actorUserId: secondary.id, actorRole: "WAREHOUSE_CHECKER", cycleCountRecordId: record.id, countedQty: 50, collectedBy: secondary.id }),
    ).rejects.toThrow(CollectorMustNotBeCounterError);
    await closeRecord(record.id);
  });

  it("[GAP] custody fields (collectedBy/completedAt/submissionMethod) are optional — a submission supplying NEITHER is still accepted outright", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const counter = await getUserByRole(prisma, "warehouse_picker");
    const record = await createCountingRecord(branch.id, variant.id, "COUNTER");

    // No collectedBy, no completedAt, no submissionMethod at all — per the
    // audit finding, the custody chain should be genuinely enforced (e.g.
    // required whenever the counter isn't the one who physically collected
    // it), not merely rejected when it happens to name the counter.
    const submitted = await submitPrimaryCount(prisma, { actorUserId: counter.id, actorRole: "WAREHOUSE_PICKER", cycleCountRecordId: record.id, countedQty: 50 });
    if ((submitted as { collectedBy?: string | null }).collectedBy) {
      throw new Error("[GAP] G-24 FAILED TO STAY A GAP: a submission with no collectedBy was rejected or auto-populated — replace this test with a real rule test.");
    }
    await closeRecord(record.id);
    throw new Error(
      "[GAP] G-24 SYSTEM RULE: collectedBy/completedAt/submissionMethod are all optional on SubmitCycleCountParams — a " +
        "submission supplying none of them was accepted with no custody information recorded at all. The only actual " +
        "enforcement is 'collectedBy, if supplied, must not equal the counter' — there is no requirement that a " +
        "custody chain be declared in the first place.",
    );
  });
});
