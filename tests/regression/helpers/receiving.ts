// Shared fixtures/pipeline-driver for G-01 through G-05, which all operate
// on the same ReceivingReport lifecycle. Not a finding itself.
import type { PrismaClient, RoleName } from "@prisma/client";
import { issuePinToken } from "../../../src/server/domain/session/pinToken";
import { draftReceivingReport } from "../../../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount } from "../../../src/server/application/receiving/counting";
import { submitInspection } from "../../../src/server/application/receiving/inspection";
import { prepareReceivingReport, verifyReceivingReport } from "../../../src/server/application/receiving/verification";
import { approveReceivingReport } from "../../../src/server/application/receiving/approval";

export const SEED_SUPPLIER_ID = "seed-supplier-01";
export const SEED_SKU = "PEBAG-10X12-PACK100";
export const DEV_PIN = "1234";

export async function getUserByRole(prisma: PrismaClient, roleUsername: string) {
  return prisma.user.findUniqueOrThrow({ where: { username: roleUsername } });
}

/**
 * Creates a throwaway user for tests whose assertions depend on
 * per-user cumulative history (e.g. G-21/G-23's rolling adjustment-value
 * window) — the seeded role accounts (getUserByRole) are shared and
 * permanent, so reusing them as the actor in a history-sensitive test
 * would accumulate real state across every past and future suite run and
 * eventually push the tier math past what the test expects. Never
 * cleaned up afterward: rows this user becomes performedBy/requestedBy
 * on (StockLedger, AdjustmentRequest) are permanent history themselves.
 */
export async function createEphemeralUser(prisma: PrismaClient, params: { branchId: string | null; role: RoleName; label: string }) {
  const suffix = `${params.label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      branchId: params.branchId,
      fullName: `Regression Test ${params.label}`,
      username: `test-${suffix}`,
      email: `test-${suffix}@regression.test`,
      passwordHash: "unused-regression-test-hash",
      role: params.role,
      status: "ACTIVE",
    },
  });
}

export async function getIloBranch(prisma: PrismaClient) {
  return prisma.branch.findUniqueOrThrow({ where: { code: "ILO" } });
}

export async function getSeedVariant(prisma: PrismaClient, sku: string = SEED_SKU) {
  return prisma.productVariant.findUniqueOrThrow({ where: { sku } });
}

export async function createSessionAndPin(prisma: PrismaClient, userId: string, pin: string = DEV_PIN) {
  const session = await prisma.session.create({
    data: { userId, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) },
  });
  const pinToken = await issuePinToken(prisma, { userId, sessionId: session.id, pin });
  return { session, pinToken };
}

/** Drafts a fresh RR (one line, low value — stays in the Branch Manager approval tier) and advances it through matched receiver/checker counts + inspection PASS + prepare + verify, leaving it PENDING_APPROVAL. */
export async function draftAndPrepareForApproval(prisma: PrismaClient, params: { branchId: string; variantId: string; unitCost?: number; qty?: number }) {
  const receiver = await getUserByRole(prisma, "warehouse_receiver");
  const checker = await getUserByRole(prisma, "warehouse_checker");
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
  const qty = params.qty ?? 10;
  const unitCost = params.unitCost ?? 50;

  const rr = await draftReceivingReport(prisma, {
    actorUserId: receiver.id,
    actorRole: "WAREHOUSE_RECEIVER",
    branchId: params.branchId,
    supplierId: SEED_SUPPLIER_ID,
    drNumber: `DR-VERIFY-${Date.now()}`,
    poReference: `PO-VERIFY-${Date.now()}`, // avoids tripping G-04's callback gate for tests unrelated to G-04
    lines: [{ productVariantId: params.variantId, expectedQty: qty, unitCost }],
  });

  await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: params.variantId, countedQty: qty }] });
  await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: params.variantId, countedQty: qty }] });
  await submitInspection(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", outcome: "PASS" });
  await prepareReceivingReport(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER" });
  await verifyReceivingReport(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR" });

  return rr;
}

/** FK-ordered teardown for RRs created by these helpers. Never touches StockLedger (permanent, hash-chained — see G-27) or StockBalance (harmless residual, shared cache). */
export async function cleanupReceivingReports(prisma: PrismaClient, rrIds: string[]) {
  if (rrIds.length === 0) return;
  await prisma.transactionEvidence.deleteMany({ where: { referenceType: "ReceivingReport", referenceId: { in: rrIds } } });
  const slips = await prisma.countSlip.findMany({ where: { referenceType: "ReceivingReport", referenceId: { in: rrIds } }, select: { id: true } });
  await prisma.countSlipLine.deleteMany({ where: { countSlipId: { in: slips.map((s) => s.id) } } });
  await prisma.countSlip.deleteMany({ where: { referenceType: "ReceivingReport", referenceId: { in: rrIds } } });
  await prisma.receivingReportLine.deleteMany({ where: { receivingReportId: { in: rrIds } } });
  await prisma.receivingReport.deleteMany({ where: { id: { in: rrIds } } });
}

/** Continues from draftAndPrepareForApproval through approveReceivingReport, leaving the RR APPROVED. */
export async function advanceToApproved(prisma: PrismaClient, rrId: string) {
  const branchManager = await getUserByRole(prisma, "branch_manager");
  const { session, pinToken } = await createSessionAndPin(prisma, branchManager.id);
  return approveReceivingReport(prisma, {
    rrId,
    actorUserId: branchManager.id,
    actorRole: "BRANCH_MANAGER",
    session,
    pinTokenId: pinToken.id,
  });
}
