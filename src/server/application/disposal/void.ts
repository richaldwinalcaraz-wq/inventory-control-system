import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { DisposalCertificateNotFoundError } from "./destroy";

export class CannotVoidPostedDisposalCertificateError extends Error {}
export class VoidReasonRequiredError extends Error {}

export interface VoidDisposalCertificateParams {
  actorUserId: string;
  actorRole: RoleName;
  dcId: string;
  reason: string;
}

/** DC-Void — pre-POSTED only. Once posted, DAMAGE_OUT has already moved stock; undoing it is a fresh, separately-approved adjustment, never a void. */
export async function voidDisposalCertificate(prisma: PrismaClient, params: VoidDisposalCertificateParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.void.create" });

  const reason = params.reason?.trim();
  if (!reason) throw new VoidReasonRequiredError("A void reason is required.");

  return prisma.$transaction(async (tx) => {
    const claim = await tx.disposalCertificate.updateMany({
      where: { id: params.dcId, status: { in: ["DRAFT", "FOR_DISPOSAL"] } },
      data: { status: "VOID", voidReason: reason },
    });
    if (claim.count === 0) {
      const cert = await tx.disposalCertificate.findUnique({ where: { id: params.dcId } });
      if (!cert) throw new DisposalCertificateNotFoundError(params.dcId);
      throw new CannotVoidPostedDisposalCertificateError(`Cannot void a certificate that is ${cert.status} — only a DRAFT or FOR_DISPOSAL certificate can be voided.`);
    }
    return tx.disposalCertificate.findUniqueOrThrow({ where: { id: params.dcId } });
  });
}
