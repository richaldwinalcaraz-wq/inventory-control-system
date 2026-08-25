import type { CycleCountWindow, PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

/**
 * Pure scan, no RBAC check — the two callers below are both already
 * permission-gated for their own action (window close, or the standalone
 * violation-check), so this shared logic doesn't re-check.
 *
 * Only two entry points (draftReceivingReport, pickSalesOrder) are
 * hard-blocked by assertBranchMovementAllowed — every other stock-
 * affecting pipeline (adjustment posting, disposal posting, returns
 * posting, wholesale release posting, retail sale posting, and any future
 * inter-branch transfer) has no exception mechanism at all, so ANY of
 * their StockLedger movements landing inside a window's span is
 * inherently worth surfacing, not just the narrow race at the declare/
 * close boundary the block itself tolerates (Phase 4 plan sec.2.3).
 *
 * SalesOrderRelease ledger rows reference the release, not the original
 * SalesOrder a PICKING_LIST exception was granted against — resolved with
 * one extra hop so a legitimately exception-covered pick isn't
 * false-flagged once it reaches release/post.
 */
export async function scanCountWindowViolations(
  prisma: PrismaClient,
  params: { window: CycleCountWindow; actorUserId: string },
) {
  const { window } = params;
  const windowEnd = window.endedAt ?? new Date();

  const [ledgerRows, consumedExceptions] = await Promise.all([
    prisma.stockLedger.findMany({
      where: { branchId: window.branchId, createdAt: { gte: window.startedAt, lte: windowEnd } },
    }),
    prisma.cycleCountWindowException.findMany({
      where: { cycleCountWindowId: window.id, consumedAt: { not: null } },
    }),
  ]);

  const releaseIds = [...new Set(ledgerRows.filter((r) => r.referenceType === "SalesOrderRelease").map((r) => r.referenceId))];
  const releases = releaseIds.length
    ? await prisma.salesOrderRelease.findMany({ where: { id: { in: releaseIds } }, select: { id: true, salesOrderId: true } })
    : [];
  const releaseToOrder = new Map(releases.map((r) => [r.id, r.salesOrderId]));

  const consumedReferenceIds = new Set(
    consumedExceptions.map((e) => e.consumedForReferenceId).filter((id): id is string => Boolean(id)),
  );

  const opened = [];
  for (const row of ledgerRows) {
    const effectiveReferenceId = row.referenceType === "SalesOrderRelease" ? releaseToOrder.get(row.referenceId) : row.referenceId;
    if (effectiveReferenceId && consumedReferenceIds.has(effectiveReferenceId)) continue;

    const compositeReferenceId = `${window.id}:${row.id.toString()}`;
    const existing = await prisma.discrepancyCase.findFirst({
      where: { referenceType: "CycleCountWindow", referenceId: compositeReferenceId, status: "OPEN" },
    });
    if (existing) continue;

    opened.push(
      await prisma.discrepancyCase.create({
        data: {
          referenceType: "CycleCountWindow",
          referenceId: compositeReferenceId,
          openedBy: params.actorUserId,
          notes: `Movement posted during active cycle count window ${window.id} (branch ${window.branchId}): StockLedger row ${row.id.toString()}, movementType ${row.movementType}, referenceType ${row.referenceType}/${row.referenceId}, at ${row.createdAt.toISOString()} — no matching exception was consumed.`,
        },
      }),
    );
  }

  return { scanned: ledgerRows.length, violations: opened.length, cases: opened };
}

export interface CheckCountWindowViolationsParams {
  actorUserId: string;
  actorRole: RoleName;
  cycleCountWindowId: string;
}

/** Standalone, independently-callable entry point for a later Auditor re-review — same scan closeCycleCountWindow runs inline. */
export async function checkCountWindowViolations(prisma: PrismaClient, params: CheckCountWindowViolationsParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.window.violation-check.create" });

  const window = await prisma.cycleCountWindow.findUniqueOrThrow({ where: { id: params.cycleCountWindowId } });
  return scanCountWindowViolations(prisma, { window, actorUserId: params.actorUserId });
}
