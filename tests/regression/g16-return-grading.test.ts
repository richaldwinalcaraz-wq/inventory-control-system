// G-16 — Grading a return must be a blind, independently-verified
// judgment above a materiality threshold — not a single inspector's
// unchallenged call, and not the RA issuer grading their own return.
// SYSTEM RULE: below RETURN_GRADING's ₱5,000 tier a single grading
// suffices; above it, two independent gradings are required (grader ≠
// issuer for grader 1 when a second grading is required, grader 2 ≠
// grader 1), agreement finalizes GRADED, disagreement opens
// GRADING_DISPUTED for a Branch Manager to resolve.
// DETECTION: no per-Supervisor grading-agreement-rate report exists.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { submitReturnGrading, GraderCannotBeIssuerError, GraderMustDifferFromFirstGraderError } from "../../src/server/application/returns/grade";
import { resolveGradingDisagreement } from "../../src/server/application/returns/resolveDisagreement";
import { buildExportTable, UnknownReportIdError } from "../../src/server/application/reporting/export/registry";
import { getIloBranch, getSeedVariant, getUserByRole } from "./helpers/receiving";
import { createPostedRetailSaleLine, issueAndReceiveReturn } from "./helpers/returns";

const prisma = new PrismaClient();

describe("G-16: blind two-grader return grading", () => {
  it("[rule] below the ₱5,000 grading tier, a single grading is sufficient and finalizes GRADED", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const qty = Math.max(1, Math.floor(1000 / Number(variant.sellingPrice)));

    const { line } = await createPostedRetailSaleLine(prisma, { branchId: branch.id, branchCode: branch.code, variantId: variant.id, qty });
    const ra = await issueAndReceiveReturn(prisma, {
      branchId: branch.id,
      branchCode: branch.code,
      originalSaleLineId: line.id,
      requestedQty: qty,
      issuerUserId: branchManager.id,
      issuerRole: "BRANCH_MANAGER",
    });

    const result = await submitReturnGrading(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      raId: ra.id,
      grade: "SELLABLE",
      evidencePhotos: [],
    });
    expect(result.secondGradingRequired).toBe(false);
    expect(result.raStatus).toBe("GRADED");
  });

  it("[rule] above the ₱5,000 grading tier, the RA issuer cannot be the first grader", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const qty = Math.max(1, Math.ceil(6000 / Number(variant.sellingPrice)));

    const { line } = await createPostedRetailSaleLine(prisma, { branchId: branch.id, branchCode: branch.code, variantId: variant.id, qty });
    const ra = await issueAndReceiveReturn(prisma, {
      branchId: branch.id,
      branchCode: branch.code,
      originalSaleLineId: line.id,
      requestedQty: qty,
      issuerUserId: branchManager.id,
      issuerRole: "BRANCH_MANAGER",
    });

    // No single RBAC role holds both returns.authorize.create (issuer) and
    // returns.grade.create (grader) — the userId===issuedBy check this
    // proves is independent of role. actorRole here stands in for a real
    // multi-role grant (UserBranchRole) a real Branch Manager could hold;
    // these domain/application functions trust the passed actorRole the
    // same way every other test in this suite does — role authenticity is
    // the API-route layer's job, not exercised at this level.
    await expect(
      submitReturnGrading(prisma, { actorUserId: branchManager.id, actorRole: "WAREHOUSE_SUPERVISOR", raId: ra.id, grade: "SELLABLE", evidencePhotos: [] }),
    ).rejects.toThrow(GraderCannotBeIssuerError);
  });

  it("[rule] above the ₱5,000 tier, the second grader cannot be the same person as the first — agreement finalizes GRADED, disagreement opens GRADING_DISPUTED, and a Branch Manager resolves it", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const checker = await getUserByRole(prisma, "warehouse_checker");
    const qty = Math.max(1, Math.ceil(6000 / Number(variant.sellingPrice)));

    const { line } = await createPostedRetailSaleLine(prisma, { branchId: branch.id, branchCode: branch.code, variantId: variant.id, qty });
    const ra = await issueAndReceiveReturn(prisma, {
      branchId: branch.id,
      branchCode: branch.code,
      originalSaleLineId: line.id,
      requestedQty: qty,
      issuerUserId: branchManager.id,
      issuerRole: "BRANCH_MANAGER",
    });

    const first = await submitReturnGrading(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", raId: ra.id, grade: "SELLABLE", evidencePhotos: [] });
    expect(first.secondGradingRequired).toBe(true);

    await expect(
      submitReturnGrading(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", raId: ra.id, grade: "SELLABLE", evidencePhotos: [] }),
    ).rejects.toThrow(GraderMustDifferFromFirstGraderError);

    const second = await submitReturnGrading(prisma, {
      actorUserId: checker.id,
      actorRole: "WAREHOUSE_CHECKER",
      raId: ra.id,
      grade: "DAMAGED",
      evidencePhotos: [{ storageKey: `g16-evidence-${Date.now()}`, captureMethod: "LIVE_CAMERA_STREAM" }],
    });
    expect(second.disputed).toBe(true);
    expect(second.raStatus).toBe("GRADING_DISPUTED");

    const resolved = await resolveGradingDisagreement(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", raId: ra.id, finalGrade: "DAMAGED" });
    expect(resolved.status).toBe("GRADED");
    expect(resolved.finalGrade).toBe("DAMAGED");
  });

  it("[GAP] DETECTION: no per-Supervisor grading-agreement-rate report exists", async () => {
    try {
      await buildExportTable(prisma, { reportId: "grading-agreement-rate", actorRole: "OWNER" });
      throw new Error("[GAP] G-16 FAILED TO STAY A GAP: a grading-agreement-rate report now exists in the export registry — replace this test with a real detection test.");
    } catch (err) {
      if (err instanceof UnknownReportIdError) {
        throw new Error(
          "[GAP] G-16 DETECTION: no per-Supervisor grading-agreement-rate (or similar pattern) report is registered " +
            "in src/server/application/reporting/export/registry.ts — ReturnGrading rows are recorded per-grader " +
            "but never aggregated to surface a grader who is suspiciously always the sole/first grader or rarely disagrees.",
        );
      }
      throw err;
    }
  });
});
