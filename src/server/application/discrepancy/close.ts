import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { DiscrepancyCaseNotFoundError, InvalidDiscrepancyCaseStateError } from "./assign";

export class CaseNotAssignedError extends Error {}
export class ResolutionRequiredError extends Error {}

export interface CloseDiscrepancyCaseParams {
  actorUserId: string;
  actorRole: RoleName;
  caseId: string;
  resolution: string;
}

/**
 * Formal close of an investigation (five-phase-plan requirement: a
 * mismatch never becomes a quiet one-line correction). Hard-rejects unless
 * the case already has an assigned owner and gets a non-empty, trimmed
 * resolution — mirrors reconciliationNotes' non-empty-before-submit
 * pattern in adjustment/request.ts.
 */
export async function closeDiscrepancyCase(prisma: PrismaClient, params: CloseDiscrepancyCaseParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "discrepancy.close.create" });

  const found = await prisma.discrepancyCase.findUnique({ where: { id: params.caseId } });
  if (!found) throw new DiscrepancyCaseNotFoundError(params.caseId);
  if (found.status !== "OPEN") {
    throw new InvalidDiscrepancyCaseStateError(`Cannot close a case that is ${found.status} — it must be OPEN.`);
  }
  if (!found.assignedTo) {
    throw new CaseNotAssignedError("A DiscrepancyCase must have an assigned owner before it can be closed.");
  }

  const resolution = params.resolution?.trim();
  if (!resolution) {
    throw new ResolutionRequiredError("A non-empty resolution is required to close a DiscrepancyCase.");
  }

  return prisma.discrepancyCase.update({
    where: { id: found.id },
    data: { status: "CLOSED", resolution, closedBy: params.actorUserId, closedAt: new Date() },
  });
}
