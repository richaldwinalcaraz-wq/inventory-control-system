// G-09 — Damaged/quarantined stock left undecided indefinitely is a
// standing shrinkage risk that must eventually force a physical
// re-inspection, not sit in limbo forever.
// SYSTEM RULE / DETECTION (this finding is pure detection — there's no
// separate "rule" half to test): checkQuarantineDisposalAging flags any
// DamageReport past the 14-day quarantine dwell not yet DISPOSED/CLOSED,
// and any DisposalCertificate past the 30-day FOR_DISPOSAL dwell still
// undecided, auto-opening a DiscrepancyCase assigned to the Branch
// Manager. Idempotent — never duplicates an already-open case.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDamageReport } from "../../src/server/application/disposal/report";
import { createDisposalCertificate } from "../../src/server/application/disposal/createCertificate";
import { checkQuarantineDisposalAging } from "../../src/server/application/discrepancy/aging";
import { getIloBranch, getSeedVariant, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

describe("G-09: quarantine/disposal aging escalation", () => {
  it("[rule] a DamageReport past the 14-day quarantine dwell, still undisposed, opens a DiscrepancyCase assigned to the Branch Manager", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const auditor = await getUserByRole(prisma, "auditor");
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    const report = await createDamageReport(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      sourceType: "STORAGE",
      quantity: 3,
      cause: "G-09 test: found damaged during routine storage check.",
    });
    await prisma.damageReport.update({ where: { id: report.id }, data: { quarantineEnteredAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) } });

    const opened = await checkQuarantineDisposalAging(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    const thisOne = opened.find((c) => c.referenceType === "DamageReport" && c.referenceId === report.id);
    expect(thisOne).toBeDefined();
    expect(thisOne?.assignedTo).toBe(branchManager.id);

    // Idempotent: a second run must not duplicate the already-open case.
    const secondRun = await checkQuarantineDisposalAging(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    expect(secondRun.find((c) => c.referenceType === "DamageReport" && c.referenceId === report.id)).toBeUndefined();
  });

  it("[rule] a DisposalCertificate past the 30-day FOR_DISPOSAL dwell, still undecided, opens a DiscrepancyCase", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const auditor = await getUserByRole(prisma, "auditor");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    const report = await createDamageReport(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      sourceType: "STORAGE",
      quantity: 2,
      cause: "G-09 test: second report, headed to a stalled disposal certificate.",
    });

    const cert = await createDisposalCertificate(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      damageReportId: report.id,
      disposition: "DESTROY",
      quantity: 2,
      witness1Id: supervisor.id,
      witness2Id: auditor.id,
    });
    // Manually push it into FOR_DISPOSAL, backdated — recordDestructionEvidence
    // is the normal path but this test only needs the dwell clock, not the
    // full evidence pipeline (that's G-18's job).
    await prisma.disposalCertificate.update({
      where: { id: cert.id },
      data: { status: "FOR_DISPOSAL", forDisposalEnteredAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const opened = await checkQuarantineDisposalAging(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    const thisOne = opened.find((c) => c.referenceType === "DisposalCertificate" && c.referenceId === cert.id);
    expect(thisOne).toBeDefined();
  });

  it("[rule] a DamageReport still within the 14-day dwell is never flagged", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const auditor = await getUserByRole(prisma, "auditor");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    const report = await createDamageReport(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      sourceType: "STORAGE",
      quantity: 1,
      cause: "G-09 test: freshly reported, well within the dwell window.",
    });

    const opened = await checkQuarantineDisposalAging(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    expect(opened.find((c) => c.referenceType === "DamageReport" && c.referenceId === report.id)).toBeUndefined();
  });
});
