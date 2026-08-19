import type { Prisma, PrismaClient, ReturnGrade, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveRequiredApprover } from "../../domain/approval/resolveRequiredApprover";
import { ReturnAuthorizationNotFoundError, InvalidReturnAuthorizationStateError } from "./receive";
import { resolveOriginalLine, type OriginalSaleType } from "./authorize";

export class GradingEvidenceRequiredError extends Error {}
export class GraderCannotBeIssuerError extends Error {}
export class GraderMustDifferFromFirstGraderError extends Error {}
export class GradingAlreadySubmittedError extends Error {}
export class BothReturnCountsRequiredError extends Error {}

// The tier a RETURN_GRADING threshold must resolve ABOVE to require a
// second, independent grading — below/at this tier, a single grader
// suffices. Mirrors investigateAdjustment's own pattern of deriving a
// boolean gate from a threshold role comparison (its requiresAuditor
// check), rather than a hardcoded quantity/value cutoff.
const SINGLE_GRADING_SUFFICIENT_TIER: RoleName = "WAREHOUSE_SUPERVISOR";

export interface SubmitReturnGradingParams {
  actorUserId: string;
  actorRole: RoleName;
  raId: string;
  grade: ReturnGrade;
  notes?: string;
  evidencePhotos: Array<{ storageKey: string; captureMethod: "LIVE_CAMERA_STREAM" | "OTHER" }>;
}

export interface SubmitReturnGradingResult {
  gradingId: string;
  graderSeq: number;
  raStatus: string;
  secondGradingRequired: boolean;
  disputed: boolean;
}

/**
 * RA-5/RA-6. Grader 2's request never receives grader 1's figure back —
 * that's an API-response-shaping discipline, not enforced by this
 * function's return value (it never includes the other grader's data in
 * the first place). The @@unique([returnAuthorizationId, graderSeq])
 * constraint is what actually stops two grader-1 (or two grader-2) rows
 * landing under a race — this function's own read-then-create is not
 * itself a lock, matching the plan's explicit call that this is a
 * blind-view discipline, not a concurrency problem.
 */
export async function submitReturnGrading(prisma: PrismaClient, params: SubmitReturnGradingParams): Promise<SubmitReturnGradingResult> {
  await assertPermission(prisma, { role: params.actorRole, action: "returns.grade.create" });

  if (params.grade !== "SELLABLE" && (params.evidencePhotos.length === 0 || params.evidencePhotos.some((p) => p.captureMethod !== "LIVE_CAMERA_STREAM"))) {
    throw new GradingEvidenceRequiredError("At least one live-captured photo is required for any grade other than SELLABLE.");
  }

  return prisma.$transaction(async (tx) => {
    const ra = await tx.returnAuthorization.findUnique({ where: { id: params.raId } });
    if (!ra) throw new ReturnAuthorizationNotFoundError(params.raId);
    if (ra.status !== "GOODS_RECEIVED") {
      throw new InvalidReturnAuthorizationStateError(`Cannot grade an RA that is ${ra.status} — it must be GOODS_RECEIVED.`);
    }

    // Goods must have been through the blind double-count first. A count
    // mismatch does NOT block grading here — Step 3 already opened a
    // DiscrepancyCase for it, and there's no dedicated Returns tie-break
    // role (unlike Receiving) to ever resolve the mismatch itself, so
    // hard-blocking on agreement would be a permanent dead end. The
    // checker's (second, confirmatory) count stands as authoritative;
    // the DiscrepancyCase is the audit trail, not a gate.
    const countSlips = await tx.countSlip.findMany({ where: { referenceType: "ReturnAuthorization", referenceId: ra.id } });
    if (!countSlips.some((s) => s.role === "RETURN_RECEIVE") || !countSlips.some((s) => s.role === "RETURN_CHECK")) {
      throw new BothReturnCountsRequiredError("Both the receiver and checker blind counts must be on file before grading.");
    }

    const originalLine = await resolveOriginalLine(tx, ra.originalSaleType as OriginalSaleType, ra.originalSaleLineId);
    const estimatedValue = Number(ra.requestedQty) * originalLine.unitPrice;
    const threshold = await resolveRequiredApprover(tx, { branchId: ra.branchId, transactionType: "RETURN_GRADING", value: estimatedValue });
    const secondGradingRequired = threshold.requiredApproverRole !== SINGLE_GRADING_SUFFICIENT_TIER;

    const existingGradings = await tx.returnGrading.findMany({ where: { returnAuthorizationId: ra.id }, orderBy: { graderSeq: "asc" } });

    if (existingGradings.length >= 2) {
      throw new GradingAlreadySubmittedError("Both gradings have already been submitted for this RA.");
    }

    if (existingGradings.length === 0) {
      // Grader 1. R-2: the RA issuer cannot be the sole/first inspector
      // for an above-threshold return — this matters even when a second
      // grading will also happen, since an unchallenged first impression
      // still biases the outcome if the second grader simply agrees.
      if (secondGradingRequired && params.actorUserId === ra.issuedBy) {
        throw new GraderCannotBeIssuerError("The RA issuer cannot be the first inspector for an above-threshold return (R-2).");
      }

      const grading = await tx.returnGrading.create({
        data: { returnAuthorizationId: ra.id, graderSeq: 1, gradedBy: params.actorUserId, grade: params.grade, notes: params.notes },
      });
      await storeGradingEvidence(tx, grading.id, params);

      if (!secondGradingRequired) {
        const updated = await tx.returnAuthorization.update({ where: { id: ra.id }, data: { status: "GRADED" } });
        return { gradingId: grading.id, graderSeq: 1, raStatus: updated.status, secondGradingRequired: false, disputed: false };
      }

      return { gradingId: grading.id, graderSeq: 1, raStatus: ra.status, secondGradingRequired: true, disputed: false };
    }

    // Grader 2 — blind: never reads grader 1's grade into this response.
    const first = existingGradings[0]!;
    if (params.actorUserId === first.gradedBy) {
      throw new GraderMustDifferFromFirstGraderError("The second grader must not be the same person as the first grader.");
    }

    const second = await tx.returnGrading.create({
      data: { returnAuthorizationId: ra.id, graderSeq: 2, gradedBy: params.actorUserId, grade: params.grade, notes: params.notes },
    });
    await storeGradingEvidence(tx, second.id, params);

    if (first.grade === second.grade) {
      const updated = await tx.returnAuthorization.update({ where: { id: ra.id }, data: { status: "GRADED" } });
      return { gradingId: second.id, graderSeq: 2, raStatus: updated.status, secondGradingRequired: true, disputed: false };
    }

    const disputed = await tx.returnAuthorization.update({ where: { id: ra.id }, data: { status: "GRADING_DISPUTED" } });
    return { gradingId: second.id, graderSeq: 2, raStatus: disputed.status, secondGradingRequired: true, disputed: true };
  });
}

export class GradingIncompleteError extends Error {}

/**
 * The accepted grade for a RA in status GRADED: finalGrade when the two
 * graders disagreed and a Branch Manager resolved it, otherwise the
 * single grading (or either of the two agreeing gradings) — never a raw
 * grader submission read directly when the two disagree and no
 * resolution has been recorded yet. Used by post.ts (RA-8).
 */
export async function resolveAcceptedGrade(
  tx: Prisma.TransactionClient,
  ra: { id: string; finalGrade: ReturnGrade | null },
): Promise<ReturnGrade> {
  if (ra.finalGrade) return ra.finalGrade;

  const gradings = await tx.returnGrading.findMany({ where: { returnAuthorizationId: ra.id } });
  if (gradings.length === 0) {
    throw new GradingIncompleteError(`RA ${ra.id} has no gradings on file.`);
  }
  const grade = gradings[0]!.grade;
  if (gradings.some((g) => g.grade !== grade)) {
    throw new GradingIncompleteError(`RA ${ra.id}'s gradings disagree and no finalGrade has been recorded — resolve the dispute first.`);
  }
  return grade;
}

async function storeGradingEvidence(tx: Prisma.TransactionClient, gradingId: string, params: SubmitReturnGradingParams) {
  for (const photo of params.evidencePhotos) {
    await tx.transactionEvidence.create({
      data: {
        referenceType: "ReturnGrading",
        referenceId: gradingId,
        storageKey: photo.storageKey,
        captureMethod: photo.captureMethod,
        capturedBy: params.actorUserId,
      },
    });
  }
}
