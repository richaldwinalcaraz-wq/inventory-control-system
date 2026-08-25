// G-23 — "Approval in writing" may be a forgeable signature with no
// corresponding authenticated system action.
// SYSTEM RULE (SOP-06 amended): adjustment approval requires an
// individually-authenticated system approval action (idle-lock + a fresh,
// single-use PIN token bound to this exact request), distinct from and in
// addition to any physical signature — a role match alone is not enough.
// DETECTION: this mechanism functions as its own detection — a posting
// cannot occur without it, and the consumed PIN token records exactly
// which action and requester it authenticated, an audit trail a forged or
// rubber-stamped physical signature alone could never produce.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry } from "../../src/server/domain/ledger/postLedgerEntry";
import { requestAdjustment } from "../../src/server/application/adjustment/request";
import { investigateAdjustment } from "../../src/server/application/adjustment/investigate";
import { approveAdjustment } from "../../src/server/application/adjustment/approve";
import { InvalidOrExpiredPinTokenError } from "../../src/server/domain/session/pinToken";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin, createEphemeralUser } from "./helpers/receiving";

const prisma = new PrismaClient();

async function buildPendingApprovalRequest() {
  const branch = await getIloBranch(prisma);
  const variant = await getSeedVariant(prisma);
  // A fresh throwaway requester per call, not a shared seeded account —
  // adjustment history is permanent, so a shared requester would slowly
  // accumulate rolling-total history across every run of this suite and
  // eventually push these approvals into the OWNER tier, masking the
  // PIN-token behavior these tests actually isolate (see G-21 for the
  // same reasoning at a faster accumulation rate).
  const requester = await createEphemeralUser(prisma, { branchId: branch.id, role: "WAREHOUSE_SUPERVISOR", label: "g23-requester" });
  const branchManager = await getUserByRole(prisma, "branch_manager");
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

  await postLedgerEntry(prisma, {
    idempotency: { documentType: "G23SETUP", documentNumber: `G23-SETUP-${Date.now()}`, branchCode: branch.code, requestPayloadHash: `hash-${Date.now()}` },
    branchId: branch.id,
    productVariantId: variant.id,
    warehouseLocationId: location.id,
    quantityDeltaBase: 1000,
    movementType: "ADJUSTMENT_IN",
    unitCostAtMovement: 1,
    referenceType: "RegressionTestG23",
    referenceId: `g23-setup-${Date.now()}`,
    documentNumber: `G23-SETUP-DOC-${Date.now()}`,
    performedBy: requester.id,
  });

  const req = await requestAdjustment(prisma, {
    actorUserId: requester.id,
    actorRole: "WAREHOUSE_SUPERVISOR",
    branchId: branch.id,
    productVariantId: variant.id,
    warehouseLocationId: location.id,
    reasonCode: "ADJ_01",
    quantityDelta: -100,
    reconciliationNotes: "G-23 test: recount confirmed missing 100 units.",
  });
  await investigateAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: req.id, outcome: "PROCEED", investigationNotes: "Investigated." });
  return { req, branchManager };
}

describe("G-23: adjustment approval requires a distinct system action", () => {
  it("[rule] a role-matched approver with NO pin token cannot approve — role membership alone is not the 'system action'", async () => {
    const { req, branchManager } = await buildPendingApprovalRequest();
    const session = await prisma.session.create({ data: { userId: branchManager.id, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });

    await expect(
      approveAdjustment(prisma, {
        actorUserId: branchManager.id,
        actorRole: "BRANCH_MANAGER",
        adjustmentRequestId: req.id,
        outcome: "APPROVE",
        session,
        pinTokenId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(InvalidOrExpiredPinTokenError);

    const stillPending = await prisma.adjustmentRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(stillPending.status).toBe("PENDING_APPROVAL");
  });

  it("[rule] a genuine system approval consumes a PIN token bound to this exact request — an individually-authenticated, auditable event distinct from any signature", async () => {
    const { req, branchManager } = await buildPendingApprovalRequest();
    const { session, pinToken } = await createSessionAndPin(prisma, branchManager.id);

    const approved = await approveAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: req.id, outcome: "APPROVE", session, pinTokenId: pinToken.id });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe(branchManager.id);

    const consumedToken = await prisma.transactionPinToken.findUniqueOrThrow({ where: { id: pinToken.id } });
    expect(consumedToken.consumedAt).not.toBeNull();
    expect(consumedToken.consumedForAction).toBe(`adjustment.approve:${req.id}`);
  });

  it("[rule] the same PIN token cannot authenticate a second, different approval — one system action per token, no reuse across documents", async () => {
    const { req: reqA, branchManager } = await buildPendingApprovalRequest();
    const { req: reqB } = await buildPendingApprovalRequest();
    const { session, pinToken } = await createSessionAndPin(prisma, branchManager.id);

    await approveAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: reqA.id, outcome: "APPROVE", session, pinTokenId: pinToken.id });

    await expect(
      approveAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: reqB.id, outcome: "APPROVE", session, pinTokenId: pinToken.id }),
    ).rejects.toThrow(InvalidOrExpiredPinTokenError);
  });
});
