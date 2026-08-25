import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveBranchManager, resolveOwner, NoBranchManagerConfiguredError } from "./aging";
import { assignDiscrepancyCase } from "./assign";

/**
 * G-31, narrow scope: because this system routes approvals through ROLES
 * (resolveRequiredApprover returns a RoleName, not a specific user), the
 * one place a deactivated individual's own identity actually lingers is
 * DiscrepancyCase.assignedTo. Reassignment target is the deactivated
 * user's own home branch (User.branchId) — DiscrepancyCase itself is
 * polymorphic (referenceType/referenceId) with no branchId of its own, and
 * in normal operation a case is assigned to someone because of their role
 * at their own branch, so that's the correct branch to resolve a
 * replacement against. Falls back to the Owner if no Branch Manager is
 * configured there (covers both "the deactivated user WAS the Branch
 * Manager" and "they had no branch at all," e.g. a deactivated Auditor).
 * On-demand — same checkOverduePodReturns precedent, no BullMQ scheduling.
 */
export async function checkDeactivatedUserOpenItems(prisma: PrismaClient, params: { actorUserId: string; actorRole: RoleName }) {
  await assertPermission(prisma, { role: params.actorRole, action: "discrepancy.deactivated-users-check.create" });

  const deactivatedUsers = await prisma.user.findMany({ where: { status: "DEACTIVATED" } });

  const reassigned = [];
  for (const user of deactivatedUsers) {
    const openCases = await prisma.discrepancyCase.findMany({ where: { assignedTo: user.id, status: "OPEN" } });
    if (openCases.length === 0) continue;

    let newAssignee: string;
    try {
      if (!user.branchId) throw new NoBranchManagerConfiguredError(`Deactivated user ${user.id} has no branch.`);
      newAssignee = await resolveBranchManager(prisma, user.branchId);
      if (newAssignee === user.id) throw new NoBranchManagerConfiguredError(`Resolved manager is the deactivated user themself.`);
    } catch (err) {
      if (!(err instanceof NoBranchManagerConfiguredError)) throw err;
      newAssignee = await resolveOwner(prisma);
    }

    for (const c of openCases) {
      reassigned.push(await assignDiscrepancyCase(prisma, { actorRole: params.actorRole, caseId: c.id, assignedTo: newAssignee }));
    }
  }

  return reassigned;
}
