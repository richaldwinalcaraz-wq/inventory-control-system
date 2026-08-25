// G-08 — Stock movement must freeze at a branch while a cycle count is in
// progress there, or the count is meaningless (counting a moving target).
// SYSTEM RULE: assertBranchMovementAllowed hard-blocks the two call sites
// wired to it (draftReceivingReport, pickSalesOrder) while the branch has
// an ACTIVE CycleCountWindow, unless a named-reason, single-use Supervisor
// exception token is supplied.
// DETECTION: scanCountWindowViolations (run when the window closes) catches
// ANY stock-ledger movement posted during the window with no consumed
// exception — including movement types that aren't hard-blocked at all
// (e.g. an adjustment), opening a DiscrepancyCase per offending row.
//
// Deliberately uses the CEB branch, not ILO — every other finding file in
// this suite uses ILO for receiving/wholesale-picking, and leaving an
// ACTIVE window there would hard-block every one of those other files'
// draftReceivingReport/pickSalesOrder calls for the rest of the suite run.
// CEB is otherwise untouched by this regression suite.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { declareCycleCountWindow, closeCycleCountWindow, grantWindowException } from "../../src/server/application/cycleCount/window";
import { assertBranchMovementAllowed, BranchLockedForCycleCountError, InvalidOrExpiredCycleCountWindowExceptionError } from "../../src/server/domain/cycleCount/branchLock";
import { draftReceivingReport } from "../../src/server/application/receiving/draft";
import { postLedgerEntry } from "../../src/server/domain/ledger/postLedgerEntry";
import { SEED_SUPPLIER_ID, SEED_SKU, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

async function getCebBranch() {
  return prisma.branch.findUniqueOrThrow({ where: { code: "CEB" } });
}

describe("G-08: branch-wide movement freeze during an active cycle count window", () => {
  it("[rule] draftReceivingReport is blocked while the branch has an active window, unless a valid single-use exception token is supplied", async () => {
    const branch = await getCebBranch();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const receiver = await getUserByRole(prisma, "warehouse_receiver");
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: SEED_SKU } });

    const window = await declareCycleCountWindow(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", branchId: branch.id });

    await expect(
      draftReceivingReport(prisma, {
        actorUserId: receiver.id,
        actorRole: "WAREHOUSE_RECEIVER",
        branchId: branch.id,
        supplierId: SEED_SUPPLIER_ID,
        drNumber: `DR-G08-BLOCKED-${Date.now()}`,
        lines: [{ productVariantId: variant.id, expectedQty: 5, unitCost: 50 }],
      }),
    ).rejects.toThrow(BranchLockedForCycleCountError);

    const exception = await grantWindowException(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      cycleCountWindowId: window.id,
      reason: "G-08 test: urgent perishable delivery, Supervisor-approved exception.",
      documentType: "RECEIVING_REPORT",
    });

    const rr = await draftReceivingReport(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      branchId: branch.id,
      supplierId: SEED_SUPPLIER_ID,
      drNumber: `DR-G08-EXCEPTED-${Date.now()}`,
      lines: [{ productVariantId: variant.id, expectedQty: 5, unitCost: 50 }],
      cycleCountExceptionTokenId: exception.id,
    });
    expect(rr.status).toBe("DRAFT");

    // Single-use: the SAME token cannot excuse a second draft.
    await expect(
      draftReceivingReport(prisma, {
        actorUserId: receiver.id,
        actorRole: "WAREHOUSE_RECEIVER",
        branchId: branch.id,
        supplierId: SEED_SUPPLIER_ID,
        drNumber: `DR-G08-REUSE-${Date.now()}`,
        lines: [{ productVariantId: variant.id, expectedQty: 5, unitCost: 50 }],
        cycleCountExceptionTokenId: exception.id,
      }),
    ).rejects.toThrow(InvalidOrExpiredCycleCountWindowExceptionError);

    await closeCycleCountWindow(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", cycleCountWindowId: window.id });
  });

  it("[rule] the same freeze applies to the PICKING_LIST document type — not just RECEIVING_REPORT — via the shared domain gate", async () => {
    const branch = await getCebBranch();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");

    const window = await declareCycleCountWindow(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", branchId: branch.id });

    await expect(
      prisma.$transaction((tx) => assertBranchMovementAllowed(tx, { branchId: branch.id, documentType: "PICKING_LIST" })),
    ).rejects.toThrow(BranchLockedForCycleCountError);

    await closeCycleCountWindow(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", cycleCountWindowId: window.id });
  });

  it("[rule] a movement type NOT wired to the hard gate (e.g. an adjustment) is NOT blocked during the window, but is flagged as a violation when the window closes", async () => {
    const branch = await getCebBranch();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const owner = await getUserByRole(prisma, "owner");
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: SEED_SKU } });
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    const window = await declareCycleCountWindow(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", branchId: branch.id });

    const tag = `${Date.now()}`;
    const posted = await postLedgerEntry(prisma, {
      idempotency: { documentType: "G08TEST", documentNumber: `G08-VIOLATION-${tag}`, branchCode: branch.code, requestPayloadHash: `hash-${tag}` },
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      quantityDeltaBase: 10,
      movementType: "ADJUSTMENT_IN",
      unitCostAtMovement: 1,
      referenceType: "RegressionTestG08",
      referenceId: `g08-violation-${tag}`,
      documentNumber: `G08-VIOLATION-DOC-${tag}`,
      performedBy: owner.id,
    });
    expect(posted.noop).toBe(false);

    const { violations } = await closeCycleCountWindow(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", cycleCountWindowId: window.id });
    const flagged = violations.cases.find((c) => c.referenceId === `${window.id}:${posted.ledger.id}`);
    expect(flagged).toBeDefined();
  });
});
