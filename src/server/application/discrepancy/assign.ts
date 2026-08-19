import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class DiscrepancyCaseNotFoundError extends Error {}
export class InvalidDiscrepancyCaseStateError extends Error {}
export class AssigneeRequiredError extends Error {}

export interface AssignDiscrepancyCaseParams {
  actorRole: RoleName;
  caseId: string;
  assignedTo: string;
}

/**
 * Branch Manager or above assigns an owner to an open DiscrepancyCase —
 * the only place assignedTo is ever set. Re-assignment while still OPEN is
 * allowed; only closeDiscrepancyCase is a one-way transition.
 */
export async function assignDiscrepancyCase(prisma: PrismaClient, params: AssignDiscrepancyCaseParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "discrepancy.assign.create" });

  const found = await prisma.discrepancyCase.findUnique({ where: { id: params.caseId } });
  if (!found) throw new DiscrepancyCaseNotFoundError(params.caseId);
  if (found.status !== "OPEN") {
    throw new InvalidDiscrepancyCaseStateError(`Cannot assign a case that is ${found.status} — it must be OPEN.`);
  }

  const assignedTo = params.assignedTo?.trim();
  if (!assignedTo) {
    throw new AssigneeRequiredError("assignedTo must be a non-empty user id.");
  }

  return prisma.discrepancyCase.update({
    where: { id: found.id },
    data: { assignedTo },
  });
}
