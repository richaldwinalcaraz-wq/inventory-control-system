import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { InterBranchTransferNotFoundError, InvalidInterBranchTransferStateError } from "./request";

export class TransitEvidenceNotRequiredError extends Error {}
export class NoTransitEvidenceOnFileError extends Error {}

export interface ConfirmTransitEvidenceParams {
  actorUserId: string;
  actorRole: RoleName;
  transferId: string;
}

/**
 * G-35 — AUDITOR only (RBAC-gated, not resolveRequiredApprover: this is a
 * boolean "is independent evidence present and consistent" judgment call,
 * not a value-tiered approver-role lookup, a deliberately different shape
 * from approveSending.ts's TRANSFER_OUT gate). Checks at least one
 * TransactionEvidence row exists for this transfer before allowing the
 * flag to be set — the Auditor's own review of what's actually attached is
 * the human control the system doesn't try to fully mechanize.
 */
export async function confirmTransitEvidence(prisma: PrismaClient, params: ConfirmTransitEvidenceParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.confirm-evidence.create" });

  const transfer = await prisma.interBranchTransfer.findUnique({ where: { id: params.transferId } });
  if (!transfer) throw new InterBranchTransferNotFoundError(params.transferId);
  if (transfer.status === "RECEIVED_CLOSED" || transfer.status === "VOID") {
    throw new InvalidInterBranchTransferStateError(`Cannot confirm transit evidence on a ${transfer.status} transfer.`);
  }
  if (!transfer.transitEvidenceRequired) {
    throw new TransitEvidenceNotRequiredError("This transfer is below the transit-evidence materiality threshold — nothing to confirm.");
  }

  const evidenceCount = await prisma.transactionEvidence.count({
    where: { referenceType: "InterBranchTransfer", referenceId: transfer.id },
  });
  if (evidenceCount === 0) {
    throw new NoTransitEvidenceOnFileError("No transit evidence (waybill or loading/unloading photos) is on file for this transfer yet.");
  }

  return prisma.interBranchTransfer.update({
    where: { id: transfer.id },
    data: { transitEvidenceConfirmedBy: params.actorUserId, transitEvidenceConfirmedAt: new Date() },
  });
}
