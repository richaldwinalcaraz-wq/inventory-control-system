import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class NoBranchManagerConfiguredError extends Error {}
export class NoOwnerConfiguredError extends Error {}

const QUARANTINE_DWELL_DAYS = 14;
const FOR_DISPOSAL_DWELL_DAYS = 30;

/**
 * Exported for reuse by Phase 4's InterBranchTransfer variance/ageing
 * escalation (BR-090: owned by the sending branch) — same "someone at this
 * branch, active, primary or granted via UserBranchRole" resolution every
 * branch-scoped auto-assignment in this codebase uses.
 */
export async function resolveBranchManager(prisma: PrismaClient, branchId: string): Promise<string> {
  const primary = await prisma.user.findFirst({ where: { branchId, role: "BRANCH_MANAGER", status: "ACTIVE" } });
  if (primary) return primary.id;

  const viaRole = await prisma.userBranchRole.findFirst({
    where: { branchId, role: "BRANCH_MANAGER", user: { status: "ACTIVE" } },
  });
  if (viaRole) return viaRole.userId;

  throw new NoBranchManagerConfiguredError(`No active Branch Manager found for branch ${branchId} — cannot auto-assign an aging escalation case.`);
}

/**
 * Mirrors resolveBranchManager's shape but branch-agnostic — Owner spans
 * every branch (User.branchId nullable for Owner/Auditor), used by G-25's
 * 2-consecutive-miss cycle-count escalation.
 */
export async function resolveOwner(prisma: PrismaClient): Promise<string> {
  const primary = await prisma.user.findFirst({ where: { role: "OWNER", status: "ACTIVE" } });
  if (primary) return primary.id;

  const viaRole = await prisma.userBranchRole.findFirst({ where: { role: "OWNER", user: { status: "ACTIVE" } } });
  if (viaRole) return viaRole.userId;

  throw new NoOwnerConfiguredError("No active Owner found — cannot auto-assign an aging escalation case.");
}

/**
 * G-09, on-demand — same precedent as checkOverduePodReturns: no BullMQ
 * scheduling infrastructure exists in this codebase, so this is called
 * from an Auditor/Branch-Manager route rather than a cron job. Flags any
 * DamageReport past the 14-day quarantine dwell not yet fully disposed,
 * and any DisposalCertificate past the 30-day FOR_DISPOSAL dwell still
 * undecided — auto-opening a DiscrepancyCase WITH assignedTo set at
 * creation (the one call site where that's correct — the five-phase-plan
 * names this exact "auto-escalate to a mandatory Branch-Manager physical
 * re-inspection" scenario). Idempotent: skips any reference that already
 * has an open DiscrepancyCase.
 *
 * Relies solely on DamageReport.status here, deliberately with no extra
 * "has any certificate" filter — an earlier version excluded any report
 * with a non-VOID certificate at all, which silently hid the exact
 * stalled-disposal case this check exists to catch (one certificate
 * posts, a second is left abandoned in DRAFT, covering only part of the
 * report). That's now safe because markDamageReportDisposedIfComplete
 * (finalize.ts) only marks a report DISPOSED once POSTED certificates
 * alone cover its full quantity — status is a trustworthy signal again.
 */
export async function checkQuarantineDisposalAging(prisma: PrismaClient, params: { actorUserId: string; actorRole: RoleName }) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.aging-check.create" });

  const quarantineCutoff = new Date(Date.now() - QUARANTINE_DWELL_DAYS * 24 * 60 * 60 * 1000);
  const forDisposalCutoff = new Date(Date.now() - FOR_DISPOSAL_DWELL_DAYS * 24 * 60 * 60 * 1000);

  const overdueReports = await prisma.damageReport.findMany({
    where: {
      status: { notIn: ["DISPOSED", "CLOSED"] },
      quarantineEnteredAt: { lt: quarantineCutoff },
    },
  });

  const overdueCertificates = await prisma.disposalCertificate.findMany({
    where: { status: "FOR_DISPOSAL", forDisposalEnteredAt: { lt: forDisposalCutoff } },
    include: { damageReport: { select: { branchId: true } } },
  });

  const opened = [];

  for (const report of overdueReports) {
    const existing = await prisma.discrepancyCase.findFirst({ where: { referenceType: "DamageReport", referenceId: report.id, status: "OPEN" } });
    if (existing) continue;
    const assignedTo = await resolveBranchManager(prisma, report.branchId);
    opened.push(
      await prisma.discrepancyCase.create({
        data: {
          referenceType: "DamageReport",
          referenceId: report.id,
          openedBy: params.actorUserId,
          assignedTo,
          notes: `Quarantined ${QUARANTINE_DWELL_DAYS}+ days with no disposition decided (entered quarantine ${report.quarantineEnteredAt.toISOString()}) — mandatory Branch Manager physical re-inspection required.`,
        },
      }),
    );
  }

  for (const cert of overdueCertificates) {
    const existing = await prisma.discrepancyCase.findFirst({ where: { referenceType: "DisposalCertificate", referenceId: cert.id, status: "OPEN" } });
    if (existing) continue;
    const assignedTo = await resolveBranchManager(prisma, cert.damageReport.branchId);
    opened.push(
      await prisma.discrepancyCase.create({
        data: {
          referenceType: "DisposalCertificate",
          referenceId: cert.id,
          openedBy: params.actorUserId,
          assignedTo,
          notes: `FOR_DISPOSAL for ${FOR_DISPOSAL_DWELL_DAYS}+ days without posting (entered FOR_DISPOSAL ${cert.forDisposalEnteredAt?.toISOString()}) — mandatory Branch Manager physical re-inspection required.`,
        },
      }),
    );
  }

  return opened;
}
