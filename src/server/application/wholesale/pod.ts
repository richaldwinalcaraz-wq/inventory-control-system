import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { SalesOrderReleaseNotFoundError } from "./gateCheck";

export interface RecordPodReturnParams {
  actorUserId: string;
  actorRole: RoleName;
  releaseId: string;
}

/** Internal 24h POD-return SLA clock — independent of the customer's own dispute window below. */
export async function recordPodReturn(prisma: PrismaClient, params: RecordPodReturnParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.pod.record.create" });
  const release = await prisma.salesOrderRelease.findUnique({ where: { id: params.releaseId } });
  if (!release) throw new SalesOrderReleaseNotFoundError(params.releaseId);
  return prisma.salesOrderRelease.update({ where: { id: release.id }, data: { podReturnedAt: new Date() } });
}

export interface RecordCustomerConfirmationParams {
  actorUserId: string;
  actorRole: RoleName;
  releaseId: string;
}

/**
 * 48h customer dispute window default (client-decisions-needed.md #4) —
 * genuinely separate from podReturnedAt above (business-process-design.md
 * sec.8.2 step 11's two clocks). No customer portal exists yet, so this is
 * recorded manually by staff in Phase 2 dev, standing in for a future
 * customer-facing confirmation flow.
 */
export async function recordCustomerConfirmation(prisma: PrismaClient, params: RecordCustomerConfirmationParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.pod.record.create" });
  const release = await prisma.salesOrderRelease.findUnique({ where: { id: params.releaseId } });
  if (!release) throw new SalesOrderReleaseNotFoundError(params.releaseId);
  return prisma.salesOrderRelease.update({ where: { id: release.id }, data: { customerConfirmedAt: new Date() } });
}

const POD_SLA_HOURS = 24;

/**
 * On-demand check (same precedent as exportDailyHash.ts — real BullMQ
 * scheduling is deferred, not wired up in Phase 1/2 dev). Finds every
 * POSTED release older than the 24h internal SLA with no podReturnedAt yet
 * and no already-open DiscrepancyCase, and opens one naming the release —
 * independent of whether the customer ever disputes anything.
 */
export async function checkOverduePodReturns(prisma: PrismaClient, params: { actorUserId: string }) {
  const cutoff = new Date(Date.now() - POD_SLA_HOURS * 60 * 60 * 1000);
  const overdue = await prisma.salesOrderRelease.findMany({
    where: { status: "POSTED", podReturnedAt: null, createdAt: { lt: cutoff } },
  });

  const opened = [];
  for (const release of overdue) {
    const existingCase = await prisma.discrepancyCase.findFirst({ where: { referenceType: "SalesOrderRelease", referenceId: release.id } });
    if (existingCase) continue;
    const created = await prisma.discrepancyCase.create({
      data: {
        referenceType: "SalesOrderRelease",
        referenceId: release.id,
        openedBy: params.actorUserId,
        notes: `POD not returned within the ${POD_SLA_HOURS}h internal SLA (release posted ${release.createdAt.toISOString()}).`,
      },
    });
    opened.push(created);
  }
  return opened;
}
