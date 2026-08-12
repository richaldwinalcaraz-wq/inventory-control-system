import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { AdjustmentRequestNotFoundError, InvalidAdjustmentStateError } from "./request";

export class CannotVoidPostedAdjustmentError extends Error {}

export interface VoidAdjustmentParams {
  actorUserId: string;
  actorRole: RoleName;
  adjustmentRequestId: string;
  reason: string;
}

/** A-7: a POSTED adjustment is permanently immutable — never voidable, only reversible via a fresh, separately-approved adjustment. */
export async function voidAdjustment(prisma: PrismaClient, params: VoidAdjustmentParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "adjustment.void.create" });

  const req = await prisma.adjustmentRequest.findUnique({ where: { id: params.adjustmentRequestId } });
  if (!req) throw new AdjustmentRequestNotFoundError(params.adjustmentRequestId);
  if (req.status === "POSTED") {
    throw new CannotVoidPostedAdjustmentError("A posted adjustment cannot be voided — reverse it with a new, separately-approved adjustment (A-7).");
  }
  if (req.status === "VOID") {
    throw new InvalidAdjustmentStateError("This adjustment is already void.");
  }

  return prisma.adjustmentRequest.update({ where: { id: req.id }, data: { status: "VOID", voidReason: params.reason } });
}
