import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { validatePostingDate } from "../../domain/period/validatePostingDate";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { AdjustmentRequestNotFoundError, InvalidAdjustmentStateError } from "./request";
import { computePostedDisposalQty } from "../../domain/disposal/disposalLock";

export class NotReadyForAdjustmentPostingError extends Error {}
export class DamageReportNotYetDisposedError extends Error {}

export interface PostAdjustmentParams {
  actorUserId: string;
  actorRole: RoleName;
  adjustmentRequestId: string;
  branchCode: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
  postingDate?: Date;
  supervisorApproval?: { approvedBy: string; approvedByRole: RoleName };
}

/**
 * BPD sec.10 step 7. A-7: once POSTED, an adjustment is permanently
 * immutable — the only way to undo it is a fresh, separately-approved
 * adjustment, never an edit. Same atomic-claim pattern as
 * encodeReceivingReport: the APPROVED -> PENDING_POSTING claim only
 * happens inside the same transaction as the actual posting work, so a
 * failed attempt (missing period validation, negative stock, etc.) never
 * leaves the request stuck mid-flight.
 */
export async function postAdjustment(prisma: PrismaClient, params: PostAdjustmentParams) {
  const req = await prisma.adjustmentRequest.findUnique({ where: { id: params.adjustmentRequestId } });
  if (!req) throw new AdjustmentRequestNotFoundError(params.adjustmentRequestId);
  if (req.status !== "APPROVED") {
    throw new InvalidAdjustmentStateError(`Cannot post an adjustment that is ${req.status} — it must be APPROVED.`);
  }

  await assertPermission(prisma, { role: params.actorRole, action: "adjustment.post.create" });

  // ADJ_03 retirement: never posts a second stock movement for the same
  // physical event — the linked DamageReport's own DisposalCertificate
  // already moved the stock via DAMAGE_OUT. Re-checked here (not just
  // trusted from request time) because request time only requires the
  // link to exist, not that disposal has actually finished yet.
  //
  // Deliberately checks POSTED certificate quantity directly (same shared
  // computePostedDisposalQty finalize.ts uses) rather than trusting
  // DamageReport.status === DISPOSED alone — see that file's comment for
  // why status can't be trusted here.
  if (req.reasonCode === "ADJ_03") {
    if (!req.damageReportId) {
      throw new DamageReportNotYetDisposedError("ADJ_03 requires a linked DamageReport — this request has none.");
    }
    const report = await prisma.damageReport.findUnique({ where: { id: req.damageReportId } });
    if (!report) {
      throw new DamageReportNotYetDisposedError(`ADJ_03's linked DamageReport ${req.damageReportId} was not found.`);
    }
    const postedQty = await computePostedDisposalQty(prisma, { damageReportId: report.id });
    if (postedQty < Number(report.quantity)) {
      throw new DamageReportNotYetDisposedError(
        `Cannot post ADJ_03 — its linked DamageReport must have POSTED DisposalCertificate(s) covering its full quantity first (posted ${postedQty}/${report.quantity.toString()}).`,
      );
    }
  }

  const postingDate = params.postingDate ?? new Date();
  await validatePostingDate(prisma, { branchId: req.branchId, postingDate, supervisorApproval: params.supervisorApproval }); // A-6

  return prisma.$transaction(async (tx) => {
    const claim = await tx.adjustmentRequest.updateMany({
      where: { id: req.id, status: "APPROVED" },
      data: { status: "PENDING_POSTING", postedBy: params.actorUserId },
    });
    if (claim.count === 0) {
      throw new NotReadyForAdjustmentPostingError(
        `Adjustment ${req.id} is no longer APPROVED — it was likely already claimed by a concurrent post attempt.`,
      );
    }

    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `adjustment.post:${req.id}` });

    const docNumber = await issueDocumentNumber(tx, {
      branchId: req.branchId,
      branchCode: params.branchCode,
      documentType: "ADJ",
      referenceId: req.id,
    });

    // ADJ_03: administrative closure only — the DamageReport's
    // DisposalCertificate already posted the real DAMAGE_OUT movement, so
    // no second postLedgerEntryInTx call happens here.
    let ledger = null;
    if (req.reasonCode !== "ADJ_03") {
      const requestPayload = { adjustmentRequestId: req.id, quantityDelta: req.quantityDelta.toString() };
      const ledgerResult = await postLedgerEntryInTx(tx, {
        idempotency: {
          documentType: "ADJ",
          documentNumber: docNumber.fullNumber,
          branchCode: params.branchCode,
          requestPayloadHash: createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex"),
        },
        branchId: req.branchId,
        productVariantId: req.productVariantId,
        warehouseLocationId: req.warehouseLocationId,
        quantityDeltaBase: req.quantityDelta.toString(),
        movementType: Number(req.quantityDelta) >= 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        unitCostAtMovement: req.unitCostAtRequest.toString(),
        referenceType: "AdjustmentRequest",
        referenceId: req.id,
        documentNumber: docNumber.fullNumber,
        reasonCode: req.reasonCode,
        performedBy: params.actorUserId,
        approvedBy: req.approvedBy ?? undefined,
      });
      ledger = ledgerResult.ledger;
    }

    const posted = await tx.adjustmentRequest.update({
      where: { id: req.id },
      data: { status: "POSTED", documentNumberId: docNumber.id },
    });

    return { adjustmentRequest: posted, documentNumber: docNumber.fullNumber, ledger };
  });
}
