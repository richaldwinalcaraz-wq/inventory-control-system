import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { ReturnAuthorizationNotFoundError } from "./receive";

export class CannotVoidReceivedReturnError extends Error {}

export interface VoidReturnAuthorizationParams {
  actorUserId: string;
  actorRole: RoleName;
  raId: string;
  reason: string;
}

/** RA-Void — pre-GOODS_RECEIVED only. Once goods physically arrive, voiding stops being a clean no-op. */
export async function voidReturnAuthorization(prisma: PrismaClient, params: VoidReturnAuthorizationParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "returns.void.create" });

  const reason = params.reason?.trim();
  if (!reason) throw new CannotVoidReceivedReturnError("A void reason is required.");

  return prisma.$transaction(async (tx) => {
    const claim = await tx.returnAuthorization.updateMany({
      where: { id: params.raId, status: "ISSUED" },
      data: { status: "VOID" },
    });
    if (claim.count === 0) {
      const ra = await tx.returnAuthorization.findUnique({ where: { id: params.raId } });
      if (!ra) throw new ReturnAuthorizationNotFoundError(params.raId);
      throw new CannotVoidReceivedReturnError(`Cannot void an RA that is ${ra.status} — only an ISSUED (not yet received) RA can be voided.`);
    }
    return tx.returnAuthorization.findUniqueOrThrow({ where: { id: params.raId } });
  });
}
