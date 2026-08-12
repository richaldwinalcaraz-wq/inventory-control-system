import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { ReceivingReportNotFoundError, InvalidReceivingReportStateError } from "./draft";

export class CannotVoidPostedReportError extends Error {}
export class MatchingGateExitOrOwnerRequiredError extends Error {}

// PENDING_INSPECTION and beyond mean the goods have already been through
// two physical counts — real handling has happened by then. Only a bare
// DRAFT (before or during counting) is safely "pre-handling."
const PRE_HANDLING_STATUSES = new Set(["DRAFT"]);

export interface VoidReceivingReportParams {
  actorUserId: string;
  actorRole: RoleName;
  rrId: string;
  reason: string;
}

/**
 * Void, both paths (G-05). Pre-handling (before counting has meaningfully
 * progressed) is a simple status change by a Supervisor. Post-handling
 * requires either a matching outbound gate log entry (goods physically
 * left, e.g. returned to the supplier) or an Owner override — and the
 * override always opens a DiscrepancyCase automatically, so an
 * unsubstantiated post-handling void can never disappear silently.
 *
 * A POSTED report can never be voided — once it's in the ledger, the only
 * path is a proper reversal/adjustment transaction (Phase 2 scope), never
 * a void.
 */
export async function voidReceivingReport(prisma: PrismaClient, params: VoidReceivingReportParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.void.create" });

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status === "POSTED") {
    throw new CannotVoidPostedReportError("A posted receiving report cannot be voided — use a reversal transaction instead.");
  }
  if (rr.status === "VOID") {
    throw new InvalidReceivingReportStateError("This receiving report is already void.");
  }

  if (PRE_HANDLING_STATUSES.has(rr.status)) {
    return prisma.receivingReport.update({ where: { id: params.rrId }, data: { status: "VOID" } });
  }

  // Post-handling.
  const matchingGateExit = await prisma.gateLogEntry.findFirst({
    where: { direction: "OUT", referenceType: "ReceivingReport", referenceId: params.rrId },
  });

  if (matchingGateExit) {
    return prisma.receivingReport.update({ where: { id: params.rrId }, data: { status: "VOID" } });
  }

  if (params.actorRole !== "OWNER") {
    throw new MatchingGateExitOrOwnerRequiredError(
      "Voiding a receiving report after handling has begun requires either a matching outbound gate log entry or Owner approval.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const voided = await tx.receivingReport.update({ where: { id: params.rrId }, data: { status: "VOID" } });
    await tx.discrepancyCase.create({
      data: {
        referenceType: "ReceivingReport",
        referenceId: params.rrId,
        openedBy: params.actorUserId,
        notes: `Post-handling void without a matching outbound gate log entry — Owner override (G-05). Reason given: ${params.reason}`,
      },
    });
    return voided;
  });
}
