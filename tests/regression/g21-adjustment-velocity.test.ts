// G-21 — Adjustment value can be structured across multiple lines to stay
// under approval thresholds.
// SYSTEM RULE: approval routing is based on the requester's rolling 7-day
// CUMULATIVE adjustment value (absolute sum), not each request in
// isolation — and an already-APPROVED sibling is automatically downgraded
// back to PENDING_APPROVAL the moment a new submission raises the total
// past what its granted tier covers.
// DETECTION: the live rolling-total computation is never exposed as a
// standing report.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry } from "../../src/server/domain/ledger/postLedgerEntry";
import { requestAdjustment } from "../../src/server/application/adjustment/request";
import { investigateAdjustment } from "../../src/server/application/adjustment/investigate";
import { approveAdjustment, WrongAdjustmentApproverRoleError } from "../../src/server/application/adjustment/approve";
import { buildExportTable, UnknownReportIdError } from "../../src/server/application/reporting/export/registry";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin, createEphemeralUser } from "./helpers/receiving";

const prisma = new PrismaClient();

describe("G-21: adjustment velocity (structuring across multiple requests)", () => {
  it("[rule] two under-threshold requests by the same requester, summing above threshold, downgrade the already-approved first request back to PENDING_APPROVAL", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    // A fresh throwaway requester, not the shared seeded "encoder" account —
    // adjustment history is permanent (never deleted), so reusing a fixed
    // shared user here would accumulate rolling-total history across every
    // past and future run of this suite and eventually push these fixed
    // ₱6,000/₱12,000 assertions past the Branch-Manager tier on their own.
    const encoder = await createEphemeralUser(prisma, { branchId: branch.id, role: "ENCODER", label: "g21-requester" });
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    // Establish a ₱6/unit cost basis at this location so each 1000-unit
    // shortage below values at exactly ₱6,000 — comfortably under the
    // ₱10,000 Branch-Manager tier on its own, but ₱12,000 combined.
    await postLedgerEntry(prisma, {
      idempotency: { documentType: "G21SETUP", documentNumber: `G21-SETUP-${Date.now()}`, branchCode: branch.code, requestPayloadHash: `hash-${Date.now()}` },
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      quantityDeltaBase: 5000,
      movementType: "ADJUSTMENT_IN",
      unitCostAtMovement: 6,
      referenceType: "RegressionTestG21",
      referenceId: `g21-setup-${Date.now()}`,
      documentNumber: `G21-SETUP-DOC-${Date.now()}`,
      performedBy: encoder.id,
    });

    // Request 1: ₱6,000 shortage.
    const req1 = await requestAdjustment(prisma, {
      actorUserId: encoder.id,
      actorRole: "ENCODER",
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      reasonCode: "ADJ_01",
      quantityDelta: -1000,
      reconciliationNotes: "G-21 test: first shortage, recount confirmed missing 1000 units.",
    });
    await investigateAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: req1.id, outcome: "PROCEED", investigationNotes: "Investigated, proceeding to approval." });
    const { session: s1, pinToken: p1 } = await createSessionAndPin(prisma, branchManager.id);
    const approved1 = await approveAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: req1.id, outcome: "APPROVE", session: s1, pinTokenId: p1.id });
    expect(approved1.status).toBe("APPROVED");
    expect(approved1.approvalTier).toBe("BRANCH_MANAGER");

    // Request 2: another ₱6,000 shortage, same requester, same 7-day window.
    // Combined rolling total is now ₱12,000 — crosses into the Owner tier.
    const req2 = await requestAdjustment(prisma, {
      actorUserId: encoder.id,
      actorRole: "ENCODER",
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      reasonCode: "ADJ_01",
      quantityDelta: -1000,
      reconciliationNotes: "G-21 test: second shortage, same requester, same week.",
    });

    // The FIRST request, already APPROVED at the Branch-Manager tier, must
    // have been pulled back — its granted tier no longer covers the
    // requester's new, higher combined total.
    const req1Refreshed = await prisma.adjustmentRequest.findUniqueOrThrow({ where: { id: req1.id } });
    expect(req1Refreshed.status).toBe("PENDING_APPROVAL");
    expect(req1Refreshed.approvalTier).toBeNull();

    const downgradeLog = await prisma.auditLog.findFirst({ where: { action: "adjustment.approval.downgraded", entityId: req1.id } });
    expect(downgradeLog).not.toBeNull();

    // Branch Manager can no longer approve EITHER request now — both must
    // go through Owner given the combined ₱12,000 total.
    const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, branchManager.id);
    await expect(
      approveAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: req1.id, outcome: "APPROVE", session: s2, pinTokenId: p2.id }),
    ).rejects.toThrow(WrongAdjustmentApproverRoleError);

    await investigateAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: req2.id, outcome: "PROCEED", investigationNotes: "Investigated." });
  });

  it("[GAP] DETECTION: no standing Adjustment Velocity by Requester report exists", async () => {
    try {
      await buildExportTable(prisma, { reportId: "adjustment-velocity", actorRole: "OWNER" });
      throw new Error("[GAP] G-21 FAILED TO STAY A GAP: an 'adjustment-velocity' report now exists in the export registry — this test should be replaced with a real detection test.");
    } catch (err) {
      if (err instanceof UnknownReportIdError) {
        throw new Error(
          "[GAP] G-21 DETECTION: no 'adjustment-velocity' (or equivalent) report is registered in " +
            "src/server/application/reporting/export/registry.ts — the rolling 7-day per-requester total that " +
            "drives approval routing is computed live at each transaction but never exposed as a queryable, " +
            "standing Auditor report.",
        );
      }
      throw err;
    }
  });
});
