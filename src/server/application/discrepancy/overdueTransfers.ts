import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveBranchManager } from "./aging";

const TRANSIT_OVERDUE_DAYS = 3;

/**
 * BPD sec.15.3 — on-demand, same checkOverduePodReturns/
 * checkQuarantineDisposalAging precedent (no BullMQ scheduling exists).
 * "Since dispatch" is read off the outbound GateLogEntry's loggedAt (the
 * actual physical gate-crossing timestamp) rather than a separate
 * dispatchedAt column — InterBranchTransfer already links to it via
 * gateLogEntryOutId, so no redundant field is needed. Assigned to the
 * SENDING branch's manager (BR-090: transit-stage issues are theirs).
 */
export async function checkOverdueTransfers(prisma: PrismaClient, params: { actorUserId: string; actorRole: RoleName }) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.overdue-check.create" });

  const cutoff = new Date(Date.now() - TRANSIT_OVERDUE_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.interBranchTransfer.findMany({
    where: { status: { in: ["IN_TRANSIT", "ARRIVED_PENDING_COUNT"] }, gateLogEntryOutId: { not: null } },
  });

  const opened = [];
  for (const transfer of candidates) {
    const gateLog = await prisma.gateLogEntry.findUnique({ where: { id: transfer.gateLogEntryOutId! } });
    if (!gateLog || gateLog.loggedAt >= cutoff) continue;

    const existing = await prisma.discrepancyCase.findFirst({
      where: { referenceType: "InterBranchTransfer", referenceId: transfer.id, status: "OPEN" },
    });
    if (existing) continue;

    const assignedTo = await resolveBranchManager(prisma, transfer.fromBranchId);
    opened.push(
      await prisma.discrepancyCase.create({
        data: {
          referenceType: "InterBranchTransfer",
          referenceId: transfer.id,
          openedBy: params.actorUserId,
          assignedTo,
          notes: `Transfer ${transfer.id} has been ${transfer.status} for over ${TRANSIT_OVERDUE_DAYS} days since dispatch (${gateLog.loggedAt.toISOString()}) — overdue, requires sending-branch follow-up.`,
        },
      }),
    );
  }

  return opened;
}
