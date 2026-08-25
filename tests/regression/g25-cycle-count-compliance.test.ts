// G-25 — A cycle count schedule that keeps getting missed must eventually
// force an independent (Auditor) recount, not just quietly slip further
// and further behind.
// SYSTEM RULE: checkCycleCountCompliance flags any CycleCountSchedule past
// its nextDueAt as MISSED, incrementing consecutiveMisses; at 2 consecutive
// misses it sets forcedAuditorRecount=true and opens a DiscrepancyCase
// assigned to the Owner. Idempotent — a second run never re-flags an
// already-MISSED schedule.
// DETECTION: getCycleCountComplianceKpi (the compliance report) surfaces
// the same underlying schedule data per branch.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { checkCycleCountCompliance } from "../../src/server/application/cycleCount/compliance";
import { getCycleCountComplianceKpi } from "../../src/server/application/reporting/cycleCountCompliance";
import { getIloBranch, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

async function upsertSchedule(branchId: string, productVariantId: string, consecutiveMisses: number) {
  return prisma.cycleCountSchedule.upsert({
    where: { branchId_productVariantId: { branchId, productVariantId } },
    update: { consecutiveMisses, status: "ON_SCHEDULE", forcedAuditorRecount: false, nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    create: { branchId, productVariantId, cycleCountClass: "A", consecutiveMisses, status: "ON_SCHEDULE", nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
}

describe("G-25: cycle count compliance / missed-count escalation", () => {
  it("[rule] a first miss (0 -> 1 consecutive) is flagged MISSED but does NOT force an Auditor recount", async () => {
    const branch = await getIloBranch(prisma);
    const auditor = await getUserByRole(prisma, "auditor");
    const variant = await prisma.productVariant.findFirstOrThrow({ skip: 0, orderBy: { sku: "asc" } });
    const schedule = await upsertSchedule(branch.id, variant.id, 0);

    await checkCycleCountCompliance(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });

    const refreshed = await prisma.cycleCountSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(refreshed.consecutiveMisses).toBe(1);
    expect(refreshed.status).toBe("MISSED");
    expect(refreshed.forcedAuditorRecount).toBe(false);

    const openCase = await prisma.discrepancyCase.findFirst({ where: { referenceType: "CycleCountSchedule", referenceId: schedule.id, status: "OPEN" } });
    expect(openCase).toBeNull();
  });

  it("[rule] a second consecutive miss (1 -> 2) forces an Auditor recount and opens a DiscrepancyCase assigned to the Owner", async () => {
    const branch = await getIloBranch(prisma);
    const auditor = await getUserByRole(prisma, "auditor");
    const owner = await getUserByRole(prisma, "owner");
    const variant = await prisma.productVariant.findFirstOrThrow({ skip: 1, orderBy: { sku: "asc" } });
    const schedule = await upsertSchedule(branch.id, variant.id, 1);

    await checkCycleCountCompliance(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    // Queried directly rather than via this call's own returned `cases` —
    // on a repeated run of this file against the same permanent DB, the
    // case may already have been opened (and left OPEN) by an earlier run;
    // checkCycleCountCompliance correctly skips re-opening it (idempotent),
    // so it wouldn't appear in a fresh call's own `cases` array even though
    // it's still the correct, currently-open case for this schedule.
    const thisOne = await prisma.discrepancyCase.findFirst({ where: { referenceType: "CycleCountSchedule", referenceId: schedule.id, status: "OPEN" } });
    expect(thisOne).not.toBeNull();
    expect(thisOne?.assignedTo).toBe(owner.id);

    const refreshed = await prisma.cycleCountSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(refreshed.consecutiveMisses).toBe(2);
    expect(refreshed.forcedAuditorRecount).toBe(true);

    // Idempotent: re-running must not re-flag an already-MISSED schedule
    // (no second case, consecutiveMisses unchanged).
    const secondRun = await checkCycleCountCompliance(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    expect(secondRun.cases.find((c) => c.referenceId === schedule.id)).toBeUndefined();
    const stillRefreshed = await prisma.cycleCountSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(stillRefreshed.consecutiveMisses).toBe(2);
  });

  it("[rule] getCycleCountComplianceKpi surfaces per-branch compliance data reflecting the schedules above", async () => {
    const branch = await getIloBranch(prisma);
    const rows = await getCycleCountComplianceKpi(prisma, { actorRole: "OWNER" });
    const row = rows.find((r) => r.branchId === branch.id);
    expect(row).toBeDefined();
    expect(row!.overall.total).toBeGreaterThan(0);
    expect(row!.overall.compliancePercent).toBeGreaterThanOrEqual(0);
    expect(row!.overall.compliancePercent).toBeLessThanOrEqual(100);
  });
});
