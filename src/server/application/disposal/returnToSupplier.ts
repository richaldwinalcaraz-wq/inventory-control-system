import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { markDamageReportDisposedIfComplete } from "../../domain/disposal/finalize";
import { DisposalCertificateNotFoundError, InvalidDisposalCertificateStateError, WrongDispositionError, NotReadyForDisposalPostingError } from "./destroy";

export interface PostReturnToSupplierCertificateParams {
  actorUserId: string;
  actorRole: RoleName;
  branchCode: string;
  dcId: string;
  vehiclePlate?: string;
  driverName?: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * DC-5. Built fresh — there is no existing shared "return to supplier"
 * function to hook into (G-05's mechanism is inline inside
 * voidReceivingReport, specific to voiding). Posts DAMAGE_OUT, then logs
 * the physical exit as an outbound GateLogEntry the same way G-05's inline
 * check does — this IS the physical-exit record, not a formality.
 */
export async function postReturnToSupplierCertificate(prisma: PrismaClient, params: PostReturnToSupplierCertificateParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.return-to-supplier.create" });

  return prisma.$transaction(async (tx) => {
    const cert = await tx.disposalCertificate.findUnique({ where: { id: params.dcId }, include: { damageReport: true } });
    if (!cert) throw new DisposalCertificateNotFoundError(params.dcId);
    if (cert.disposition !== "RETURN_TO_SUPPLIER") {
      throw new WrongDispositionError(`Certificate ${cert.id} is ${cert.disposition}, not RETURN_TO_SUPPLIER.`);
    }
    if (cert.status !== "DRAFT") {
      throw new InvalidDisposalCertificateStateError(`Cannot post a certificate that is ${cert.status} — it must be DRAFT.`);
    }

    const claim = await tx.disposalCertificate.updateMany({ where: { id: cert.id, status: "DRAFT" }, data: { status: "POSTED" } });
    if (claim.count === 0) {
      throw new NotReadyForDisposalPostingError(`Certificate ${cert.id} is no longer DRAFT — likely claimed by a concurrent post attempt.`);
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
      reasonCode: "RETURN_TO_SUPPLIER",
      performedBy: params.actorUserId,
    });

    await tx.gateLogEntry.create({
      data: {
        branchId: cert.damageReport.branchId,
        direction: "OUT",
        referenceType: "DisposalCertificate",
        referenceId: cert.id,
        vehiclePlate: params.vehiclePlate,
        driverName: params.driverName,
        loggedBy: params.actorUserId,
      },
    });

    const posted = await tx.disposalCertificate.update({ where: { id: cert.id }, data: { documentNumberId: docNumber.id } });
    await markDamageReportDisposedIfComplete(tx, cert.damageReportId);

    return { disposalCertificate: posted, documentNumber: docNumber.fullNumber, ledger: ledgerResult.ledger };
  });
}
