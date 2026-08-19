import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { markDamageReportDisposedIfComplete } from "../../domain/disposal/finalize";

export class DisposalCertificateNotFoundError extends Error {}
export class InvalidDisposalCertificateStateError extends Error {}
export class WrongDispositionError extends Error {}
export class DestructionEvidenceRequiredError extends Error {}
export class NotReadyForDisposalPostingError extends Error {}

export interface RecordDestructionEvidenceParams {
  actorUserId: string;
  actorRole: RoleName;
  dcId: string;
  evidencePhotos: Array<{ storageKey: string; captureMethod: "LIVE_CAMERA_STREAM" | "OTHER" }>;
}

/** DC-2 step 1: attaches the live-captured destroyed/unsellable-state evidence and moves DRAFT -> FOR_DISPOSAL. */
export async function recordDestructionEvidence(prisma: PrismaClient, params: RecordDestructionEvidenceParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.destroy.create" });

  if (params.evidencePhotos.length === 0 || params.evidencePhotos.some((p) => p.captureMethod !== "LIVE_CAMERA_STREAM")) {
    throw new DestructionEvidenceRequiredError("At least one live-captured photo showing the destroyed/unsellable state is required.");
  }

  return prisma.$transaction(async (tx) => {
    const cert = await tx.disposalCertificate.findUnique({ where: { id: params.dcId } });
    if (!cert) throw new DisposalCertificateNotFoundError(params.dcId);
    if (cert.disposition !== "DESTROY") throw new WrongDispositionError(`Certificate ${cert.id} is ${cert.disposition}, not DESTROY.`);
    if (cert.status !== "DRAFT") throw new InvalidDisposalCertificateStateError(`Cannot record evidence for a certificate that is ${cert.status} — it must be DRAFT.`);

    for (const photo of params.evidencePhotos) {
      await tx.transactionEvidence.create({
        data: {
          referenceType: "DisposalCertificate",
          referenceId: cert.id,
          storageKey: photo.storageKey,
          captureMethod: photo.captureMethod,
          capturedBy: params.actorUserId,
        },
      });
    }

    return tx.disposalCertificate.update({ where: { id: cert.id }, data: { status: "FOR_DISPOSAL", forDisposalEnteredAt: new Date() } });
  });
}

export interface PostDestroyCertificateParams {
  actorUserId: string;
  actorRole: RoleName;
  branchCode: string;
  dcId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * DC-2 step 2. Evidence is re-checked here, not just trusted from the
 * earlier step — a certificate whose evidence was somehow never attached
 * stays in FOR_DISPOSAL indefinitely (BR-062, verbatim). Posts DAMAGE_OUT.
 */
export async function postDestroyCertificate(prisma: PrismaClient, params: PostDestroyCertificateParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.destroy.create" });

  return prisma.$transaction(async (tx) => {
    const cert = await tx.disposalCertificate.findUnique({ where: { id: params.dcId }, include: { damageReport: true } });
    if (!cert) throw new DisposalCertificateNotFoundError(params.dcId);
    if (cert.disposition !== "DESTROY") throw new WrongDispositionError(`Certificate ${cert.id} is ${cert.disposition}, not DESTROY.`);
    if (cert.status !== "FOR_DISPOSAL") {
      throw new InvalidDisposalCertificateStateError(`Cannot post a certificate that is ${cert.status} — it must be FOR_DISPOSAL.`);
    }

    const evidence = await tx.transactionEvidence.findMany({ where: { referenceType: "DisposalCertificate", referenceId: cert.id } });
    if (evidence.length === 0) {
      throw new DestructionEvidenceRequiredError("A DESTROY certificate cannot be posted without an attached live-captured destruction photo.");
    }

    const claim = await tx.disposalCertificate.updateMany({ where: { id: cert.id, status: "FOR_DISPOSAL" }, data: { status: "POSTED" } });
    if (claim.count === 0) {
      throw new NotReadyForDisposalPostingError(`Certificate ${cert.id} is no longer FOR_DISPOSAL — likely claimed by a concurrent post attempt.`);
    }

    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `disposal.certificate.post:${cert.id}` });

    const docNumber = await issueDocumentNumber(tx, {
      branchId: cert.damageReport.branchId,
      branchCode: params.branchCode,
      documentType: "DC",
      referenceId: cert.id,
    });

    const unitCost = Number(cert.valueAtCost) / Number(cert.quantity);
    const requestPayload = { dcId: cert.id, qty: cert.quantity.toString() };
    const ledgerResult = await postLedgerEntryInTx(tx, {
      idempotency: {
        documentType: "DC",
        documentNumber: docNumber.fullNumber,
        branchCode: params.branchCode,
        requestPayloadHash: createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex"),
      },
      branchId: cert.damageReport.branchId,
      productVariantId: cert.damageReport.productVariantId,
      warehouseLocationId: cert.damageReport.warehouseLocationId,
      quantityDeltaBase: -Number(cert.quantity),
      movementType: "DAMAGE_OUT",
      unitCostAtMovement: unitCost,
      referenceType: "DisposalCertificate",
      referenceId: cert.id,
      documentNumber: docNumber.fullNumber,
      reasonCode: "DESTROY",
      performedBy: params.actorUserId,
    });

    const posted = await tx.disposalCertificate.update({ where: { id: cert.id }, data: { documentNumberId: docNumber.id } });
    await markDamageReportDisposedIfComplete(tx, cert.damageReportId);

    return { disposalCertificate: posted, documentNumber: docNumber.fullNumber, ledger: ledgerResult.ledger };
  });
}
