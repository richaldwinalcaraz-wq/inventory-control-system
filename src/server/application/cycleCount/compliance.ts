import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveOwner } from "../discrepancy/aging";

const CONSECUTIVE_MISSES_FOR_ESCALATION = 2;

/**
 * G-25. On-demand — same checkOverduePodReturns/checkQuarantineDisposalAging
 * precedent. A schedule row past nextDueAt and not yet MISSED gets flagged;
 * once flagged, its own status excludes it from being re-flagged by a later
 * run of this same function (the actual recount, build-order step 6, is
 * what clears MISSED and reschedules nextDueAt) — that's what makes this
 * idempotent, not a separate "already processed" check.
 */
export async function checkCycleCountCompliance(prisma: PrismaClient, params: { actorUserId: string; actorRole: RoleName }) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.compliance.check.create" });

  const overdue = await prisma.cycleCountSchedule.findMany({
    where: { nextDueAt: { lt: new Date() }, status: { not: "MISSED" } },
  });

  const opened = [];
  for (const row of overdue) {
    const consecutiveMisses = row.consecutiveMisses + 1;
    const forcedAuditorRecount = consecutiveMisses >= CONSECUTIVE_MISSES_FOR_ESCALATION;

    const updated = await prisma.cycleCountSchedule.update({
      where: { id: row.id },
      data: { status: "MISSED", consecutiveMisses, forcedAuditorRecount },
    });

    if (forcedAuditorRecount) {
      const existing = await prisma.discrepancyCase.findFirst({
        where: { referenceType: "CycleCountSchedule", referenceId: updated.id, status: "OPEN" },
      });
      if (!existing) {
        const assignedTo = await resolveOwner(prisma);
        opened.push(
          await prisma.discrepancyCase.create({
            data: {
              referenceType: "CycleCountSchedule",
              referenceId: updated.id,
              openedBy: params.actorUserId,
              assignedTo,
              notes: `Cycle count missed ${consecutiveMisses} consecutive times (branch ${updated.branchId}, variant ${updated.productVariantId}) — forced Auditor-led surprise recount required.`,
            },
          }),
        );
      }
    }
  }

  return { flaggedMissed: overdue.length, escalatedToOwner: opened.length, cases: opened };
}
