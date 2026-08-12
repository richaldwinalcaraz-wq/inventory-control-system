import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveRequiredApprover } from "../../domain/approval/resolveRequiredApprover";
import { AdjustmentRequestNotFoundError, InvalidAdjustmentStateError } from "./request";

export class InvestigatorCannotBeRequesterError extends Error {}
export class AuditorReviewRequiredError extends Error {}

export interface InvestigateAdjustmentParams {
  actorUserId: string;
  actorRole: RoleName;
  adjustmentRequestId: string;
  outcome: "PROCEED" | "RESOLVED_WITHOUT_ADJUSTMENT";
  investigationNotes: string;
}

/**
 * BPD sec.10 step 5. "Resolved without adjustment" is a real, named branch
 * of the process (most "missing" stock is misplaced, mis-encoded, or in
 * the Release Area) — it closes the request with no ledger change, never
 * silently disappearing (the cause stays on record via investigationNotes).
 *
 * A-4: adjustments that would resolve to the Owner approval tier require
 * an Auditor's investigation, not just a Branch Manager's — reuses the
 * same ADJUSTMENT threshold table the approval step consumes, evaluated
 * against this request's own frozen value (the rolling-window total is a
 * G-21 concern for approval routing, not investigation-tier routing).
 */
export async function investigateAdjustment(prisma: PrismaClient, params: InvestigateAdjustmentParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "adjustment.investigate.create" });

  const req = await prisma.adjustmentRequest.findUnique({ where: { id: params.adjustmentRequestId } });
  if (!req) throw new AdjustmentRequestNotFoundError(params.adjustmentRequestId);
  if (req.status !== "PENDING_INVESTIGATION") {
    throw new InvalidAdjustmentStateError(`Cannot investigate an adjustment that is ${req.status} — it must be PENDING_INVESTIGATION.`);
  }
  if (req.requestedBy === params.actorUserId) {
    throw new InvestigatorCannotBeRequesterError("The investigator must not be the requester (A-2/A-1).");
  }

  if (params.outcome === "RESOLVED_WITHOUT_ADJUSTMENT") {
    return prisma.adjustmentRequest.update({
      where: { id: req.id },
      data: { status: "REJECTED", investigatedBy: params.actorUserId, investigationNotes: params.investigationNotes },
    });
  }

  const threshold = await resolveRequiredApprover(prisma, { branchId: req.branchId, transactionType: "ADJUSTMENT", value: Number(req.value) });
  const requiresAuditor = req.reasonCode === "ADJ_10" || threshold.requiredApproverRole === "OWNER";
  if (requiresAuditor && params.actorRole !== "AUDITOR") {
    throw new AuditorReviewRequiredError(
      "This adjustment's value crosses the Owner approval threshold (or is a theft/loss claim) — it requires an Auditor's investigation, not just a Branch Manager's (A-4/A-5).",
    );
  }

  return prisma.adjustmentRequest.update({
    where: { id: req.id },
    data: { status: "PENDING_APPROVAL", investigatedBy: params.actorUserId, investigationNotes: params.investigationNotes },
  });
}
