import type { PrismaClient, RoleName, CycleCountScheduleStatus, CycleCountClass } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

interface ComplianceBucket {
  total: number;
  onSchedule: number;
  due: number;
  overdue: number;
  missed: number;
  compliancePercent: number;
}

export interface CycleCountComplianceRow {
  branchId: string;
  branchCode: string;
  branchName: string;
  overall: ComplianceBucket;
  byClass: Record<CycleCountClass, ComplianceBucket>;
}

function emptyBucket(): ComplianceBucket {
  return { total: 0, onSchedule: 0, due: 0, overdue: 0, missed: 0, compliancePercent: 0 };
}

function tally(bucket: ComplianceBucket, status: CycleCountScheduleStatus) {
  bucket.total += 1;
  if (status === "ON_SCHEDULE") bucket.onSchedule += 1;
  else if (status === "DUE") bucket.due += 1;
  else if (status === "OVERDUE") bucket.overdue += 1;
  else if (status === "MISSED") bucket.missed += 1;
}

function finalize(bucket: ComplianceBucket) {
  bucket.compliancePercent = bucket.total === 0 ? 100 : Math.round((bucket.onSchedule / bucket.total) * 10000) / 100;
}

/**
 * G-25 KPI, live query over CycleCountSchedule — "compliant" means currently
 * ON_SCHEDULE. DUE/OVERDUE are reserved enum states no current writer sets
 * (only generateCycleCountSchedule → ON_SCHEDULE and
 * checkCycleCountCompliance → MISSED are wired), so those buckets are
 * structurally present for forward-compatibility but will read 0 until a
 * finer-grained status writer exists.
 */
export async function getCycleCountComplianceKpi(prisma: PrismaClient, params: { actorRole: RoleName }): Promise<CycleCountComplianceRow[]> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.cycle-count-compliance.view" });

  const schedules = await prisma.cycleCountSchedule.findMany({
    select: { status: true, cycleCountClass: true, branch: { select: { id: true, code: true, name: true } } },
  });

  const byBranch = new Map<string, CycleCountComplianceRow>();

  for (const s of schedules) {
    let row = byBranch.get(s.branch.id);
    if (!row) {
      row = {
        branchId: s.branch.id,
        branchCode: s.branch.code,
        branchName: s.branch.name,
        overall: emptyBucket(),
        byClass: { A: emptyBucket(), B: emptyBucket(), C: emptyBucket() },
      };
      byBranch.set(s.branch.id, row);
    }
    tally(row.overall, s.status);
    tally(row.byClass[s.cycleCountClass], s.status);
  }

  for (const row of byBranch.values()) {
    finalize(row.overall);
    finalize(row.byClass.A);
    finalize(row.byClass.B);
    finalize(row.byClass.C);
  }

  return Array.from(byBranch.values()).sort((a, b) => a.branchCode.localeCompare(b.branchCode));
}
