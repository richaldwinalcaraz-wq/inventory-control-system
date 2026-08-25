import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { startOfDayManila } from "../../domain/time/businessDate";

export interface GenerateDailyExceptionReportParams {
  actorRole: RoleName;
  businessDate: Date;
}

interface UnaccountedFormsGap {
  branchId: string;
  branchCode: string;
  documentType: string;
  missingSequenceNos: number[];
}

interface LateEncodingCandidate {
  receivingReportId: string;
  drNumber: string;
  gateLoggedAt: string;
  encodingStartedAt: string;
}

/**
 * G-28 — Owner/Auditor only, BPD sec.14.5. Aggregates every category BPD's
 * table names, all as live queries against existing data (no new tables
 * beyond DailyExceptionReportDelivery, which just records that this ran).
 *
 * Two categories are honest proxies, not the literal thing BPD describes,
 * because the underlying fields don't exist and adding them is out of this
 * phase's scope (documented in the Phase 4 plan sec.6, same posture as the
 * Form Accountability Sheet gap):
 *  - unaccountedFormsProxy: DocumentBookletRegistry has no per-serial
 *    used/voided/returned tracking — this reports gaps in issued
 *    sequenceNo within ACTIVE booklets instead. Snapshot as-of-now, not
 *    reconstructable for a past businessDate.
 *  - lateEncodingsProxy: no encoding-deadline field exists anywhere (BPD's
 *    C-10 "same-day encoding" has no SLA timestamp to check against). This
 *    compares GateLogEntry.loggedAt (physical arrival) to
 *    ReceivingReport.createdAt (encoding started) as the closest available
 *    real signal for "encoded on a different day than goods arrived."
 */
export async function generateDailyExceptionReport(prisma: PrismaClient, params: GenerateDailyExceptionReportParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.daily-exception.view" });

  const startOfDay = startOfDayManila(params.businessDate);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const dateRange = { gte: startOfDay, lt: endOfDay };

  const [adjustments, countVariances, blockedNegativeStock, emergencyElevations, openDiscrepancyCases, receivingReports] = await Promise.all([
    prisma.adjustmentRequest.findMany({ where: { createdAt: dateRange } }),
    prisma.cycleCountRecord.findMany({ where: { status: "VARIANCE_CONFIRMED", createdAt: dateRange } }),
    prisma.auditLog.findMany({ where: { action: "ledger.negative_stock_blocked", createdAt: dateRange } }),
    prisma.emergencyElevation.findMany({ where: { grantedAt: dateRange } }),
    prisma.discrepancyCase.findMany({ where: { status: "OPEN" } }),
    prisma.receivingReport.findMany({
      where: { gateLogEntryId: { not: null }, createdAt: dateRange },
      select: { id: true, drNumber: true, createdAt: true, gateLogEntryId: true },
    }),
  ]);

  const overdueTransfers = openDiscrepancyCases.filter((c) => c.referenceType === "InterBranchTransfer");
  const overduePods = openDiscrepancyCases.filter((c) => c.referenceType === "SalesOrderRelease");

  const gateLogEntryIds = receivingReports.map((r) => r.gateLogEntryId).filter((id): id is string => id !== null);
  const gateLogEntries = await prisma.gateLogEntry.findMany({ where: { id: { in: gateLogEntryIds } }, select: { id: true, loggedAt: true } });
  const gateLogById = new Map(gateLogEntries.map((g) => [g.id, g.loggedAt]));

  const lateEncodingsProxy: LateEncodingCandidate[] = [];
  for (const rr of receivingReports) {
    const gateLoggedAt = rr.gateLogEntryId ? gateLogById.get(rr.gateLogEntryId) : undefined;
    if (!gateLoggedAt) continue;
    const sameDay = gateLoggedAt.getUTCFullYear() === rr.createdAt.getUTCFullYear() && gateLoggedAt.getUTCMonth() === rr.createdAt.getUTCMonth() && gateLoggedAt.getUTCDate() === rr.createdAt.getUTCDate();
    if (!sameDay) {
      lateEncodingsProxy.push({ receivingReportId: rr.id, drNumber: rr.drNumber, gateLoggedAt: gateLoggedAt.toISOString(), encodingStartedAt: rr.createdAt.toISOString() });
    }
  }

  const activeBooklets = await prisma.documentBookletRegistry.findMany({
    where: { status: "ACTIVE" },
    include: { branch: { select: { code: true } } },
  });

  const unaccountedFormsProxy: UnaccountedFormsGap[] = [];
  for (const booklet of activeBooklets) {
    const issued = await prisma.documentNumber.findMany({
      where: { branchId: booklet.branchId, documentType: booklet.documentType, sequenceNo: { gte: booklet.rangeStart, lte: booklet.rangeEnd } },
      select: { sequenceNo: true },
    });
    const issuedSet = new Set(issued.map((i) => i.sequenceNo));
    const missing: number[] = [];
    for (let seq = booklet.rangeStart; seq <= booklet.rangeEnd; seq++) {
      if (!issuedSet.has(seq)) missing.push(seq);
    }
    if (missing.length > 0) {
      unaccountedFormsProxy.push({ branchId: booklet.branchId, branchCode: booklet.branch.code, documentType: booklet.documentType, missingSequenceNos: missing });
    }
  }

  return {
    businessDate: startOfDay.toISOString().slice(0, 10),
    adjustments,
    countVariances,
    blockedNegativeStockAttempts: blockedNegativeStock,
    lateEncodingsProxy,
    unaccountedFormsProxy,
    overdueTransfers,
    openDiscrepancyCases,
    overduePods,
    emergencyElevations,
  };
}

export type DailyExceptionReport = Awaited<ReturnType<typeof generateDailyExceptionReport>>;
