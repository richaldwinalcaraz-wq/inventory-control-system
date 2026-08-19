import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { transferIntraBranch } from "../inventory/transfer";
import { markDamageReportDisposedIfComplete } from "../../domain/disposal/finalize";
import { DisposalCertificateNotFoundError, InvalidDisposalCertificateStateError, WrongDispositionError } from "./destroy";

export interface PostSellAsSecondsCertificateParams {
  actorUserId: string;
  actorRole: RoleName;
  dcId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * DC-4. Calls transferIntraBranch directly, unmodified (QUARANTINE ->
 * STORAGE) — no new movement type needed for this disposition. That
 * function owns its own top-level transaction and its own
 * requirePostingAuthorization call, so this wrapper does NOT also gate on
 * PIN itself (a PIN token is single-use — consuming it twice would fail
 * the second call); the transfer's own PIN check is the sole gate here.
 * The certificate's own status update happens in a SEPARATE transaction
 * immediately after the transfer succeeds — ordered this way
 * deliberately: if the status update somehow failed, the stock movement
 * (the real audit-relevant fact) is still correct and already
 * hash-chained, which is a safer failure mode than the reverse order
 * (certificate marked POSTED with no matching stock movement).
 */
export async function postSellAsSecondsCertificate(prisma: PrismaClient, params: PostSellAsSecondsCertificateParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.sell-as-seconds.create" });

  const cert = await prisma.disposalCertificate.findUnique({ where: { id: params.dcId }, include: { damageReport: true } });
  if (!cert) throw new DisposalCertificateNotFoundError(params.dcId);
  if (cert.disposition !== "SELL_AS_SECONDS") throw new WrongDispositionError(`Certificate ${cert.id} is ${cert.disposition}, not SELL_AS_SECONDS.`);

  const claim = await prisma.disposalCertificate.updateMany({ where: { id: cert.id, status: "DRAFT" }, data: { status: "FOR_DISPOSAL" } });
  if (claim.count === 0) {
    throw new InvalidDisposalCertificateStateError(`Cannot post a certificate that is ${cert.status} — it must be DRAFT.`);
  }

  const transfer = await transferIntraBranch(prisma, {
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    branchId: cert.damageReport.branchId,
    productVariantId: cert.damageReport.productVariantId,
    quantity: Number(cert.quantity),
    fromZone: "QUARANTINE",
    toZone: "STORAGE",
    session: params.session,
    pinTokenId: params.pinTokenId,
  });

  const posted = await prisma.$transaction(async (tx) => {
    const updated = await tx.disposalCertificate.update({ where: { id: cert.id }, data: { status: "POSTED" } });
    await markDamageReportDisposedIfComplete(tx, cert.damageReportId);
    return updated;
  });

  return { disposalCertificate: posted, transfer };
}
