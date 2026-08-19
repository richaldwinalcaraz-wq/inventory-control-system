import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { validatePostingDate } from "../../domain/period/validatePostingDate";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { ReceivingReportNotFoundError, InvalidReceivingReportStateError } from "./draft";

export class NotReadyForEncodingError extends Error {}
export class MissingFinalQuantitiesError extends Error {}
export class LivePhotoRequiredError extends Error {}

export interface EncodeReceivingReportParams {
  actorUserId: string;
  actorRole: RoleName;
  rrId: string;
  branchCode: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
  evidencePhotos: Array<{ storageKey: string; captureMethod: "LIVE_CAMERA_STREAM" | "OTHER" }>;
  postingDate?: Date;
  supervisorApproval?: { approvedBy: string; approvedByRole: RoleName };
}

/**
 * Step 10 — encoding to system. The RR becomes a real, permanent,
 * hash-chained set of stock movements here: this is the actual "posting"
 * moment the whole workflow has been building toward.
 *
 * Every validation that can be checked without mutating anything runs
 * first, against a plain read — so a rejected attempt (missing evidence,
 * unreconciled lines, a locked period) never touches the RR's status at
 * all. The APPROVED -> PENDING_ENCODING claim only happens once we're
 * inside the transaction that also does the actual posting, so a claim
 * can never succeed while the work after it fails: either the whole
 * thing commits together, or the RR is left exactly as it was.
 */
export async function encodeReceivingReport(prisma: PrismaClient, params: EncodeReceivingReportParams) {
  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId }, include: { lines: true } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status !== "APPROVED") {
    throw new InvalidReceivingReportStateError(`Cannot encode an RR that is ${rr.status} — it must be APPROVED.`);
  }

  await assertPermission(prisma, { role: params.actorRole, action: "receiving.encode.post" });

  if (rr.lines.some((l) => l.finalQty === null || l.finalQty === undefined)) {
    throw new MissingFinalQuantitiesError("Every line must have a reconciled final quantity before posting.");
  }
  if (
    params.evidencePhotos.length === 0 ||
    params.evidencePhotos.some((p) => p.captureMethod !== "LIVE_CAMERA_STREAM")
  ) {
    throw new LivePhotoRequiredError(
      "At least one live-captured photo (getUserMedia canvas capture, never a gallery upload) is required before posting.",
    );
  }

  const postingDate = params.postingDate ?? new Date();
  await validatePostingDate(prisma, {
    branchId: rr.branchId,
    postingDate,
    supervisorApproval: params.supervisorApproval,
  });

  return prisma.$transaction(async (tx) => {
    // Atomic claim, now inside the same transaction as the posting work:
    // if anything below fails and throws, this update rolls back with it,
    // so a failed attempt never leaves the RR stuck at PENDING_ENCODING.
    const claim = await tx.receivingReport.updateMany({
      where: { id: params.rrId, status: "APPROVED" },
      data: { status: "PENDING_ENCODING", encodedBy: params.actorUserId },
    });
    if (claim.count === 0) {
      throw new NotReadyForEncodingError(
        `Receiving report ${params.rrId} is no longer APPROVED — it was likely already claimed by a concurrent encode attempt.`,
      );
    }

    await requirePostingAuthorization(tx, {
      session: params.session,
      pinTokenId: params.pinTokenId,
      action: `receiving.encode:${params.rrId}`,
    });

    const docNumber = await issueDocumentNumber(tx, {
      branchId: rr.branchId,
      branchCode: params.branchCode,
      documentType: "RR",
      referenceId: rr.id,
    });

    const receivingLocation = await tx.warehouseLocation.findFirstOrThrow({
      where: { zone: "RECEIVING", warehouse: { branchId: rr.branchId } },
    });
    // Quarantined lines (Phase 1 inspection REJECT) never enter the
    // RECEIVING zone — they get a real StockBalance row in QUARANTINE
    // itself, so the fraud-audit doc's "quarantined stock counts as
    // on-hand" claim actually holds. Only looked up if this RR has any.
    const hasQuarantinedLines = rr.lines.some((l) => l.lineStatus === "QUARANTINED");
    const quarantineLocation = hasQuarantinedLines
      ? await tx.warehouseLocation.findFirstOrThrow({ where: { zone: "QUARANTINE", warehouse: { branchId: rr.branchId } } })
      : null;

    const ledgerRows = [];
    for (const line of rr.lines) {
      const destinationLocation = line.lineStatus === "QUARANTINED" ? quarantineLocation! : receivingLocation;
      const requestPayload = { rrId: rr.id, productVariantId: line.productVariantId, finalQty: line.finalQty!.toString() };
      const result = await postLedgerEntryInTx(tx, {
        idempotency: {
          documentType: "RR",
          documentNumber: `${docNumber.fullNumber}:${line.id}`,
          branchCode: params.branchCode,
          requestPayloadHash: createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex"),
        },
        branchId: rr.branchId,
        productVariantId: line.productVariantId,
        warehouseLocationId: destinationLocation.id,
        quantityDeltaBase: line.finalQty!.toString(),
        movementType: "RECEIVING",
        unitCostAtMovement: line.unitCost.toString(),
        referenceType: "ReceivingReport",
        referenceId: rr.id,
        documentNumber: docNumber.fullNumber,
        performedBy: params.actorUserId,
        approvedBy: rr.approvedBy ?? undefined,
      });
      ledgerRows.push(result);
    }

    for (const photo of params.evidencePhotos) {
      await tx.transactionEvidence.create({
        data: {
          referenceType: "ReceivingReport",
          referenceId: rr.id,
          storageKey: photo.storageKey,
          captureMethod: photo.captureMethod,
          capturedBy: params.actorUserId,
        },
      });
    }

    const posted = await tx.receivingReport.update({
      where: { id: rr.id },
      data: { status: "POSTED", documentNumberId: docNumber.id },
    });

    return { receivingReport: posted, documentNumber: docNumber.fullNumber, ledgerRows };
  });
}
