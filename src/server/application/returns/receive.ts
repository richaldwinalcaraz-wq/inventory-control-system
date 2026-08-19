import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class ReturnAuthorizationNotFoundError extends Error {}
export class InvalidReturnAuthorizationStateError extends Error {}
export class ReturnAuthorizationExpiredError extends Error {}

export interface RecordGoodsReceivedParams {
  actorUserId: string;
  actorRole: RoleName;
  raId: string;
}

/**
 * RA-2 — physical arrival into the Returns Area, logged by the Receiver.
 * Atomic claim (status = ISSUED AND not yet expired) in one statement, same
 * shape as postAdjustment's APPROVED -> PENDING_POSTING claim, so a race
 * between two concurrent receive attempts — or a receive landing after the
 * RA's 7-day window lapsed — can't both silently succeed or silently
 * bypass the expiry.
 */
export async function recordGoodsReceived(prisma: PrismaClient, params: RecordGoodsReceivedParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "returns.receive.create" });

  return prisma.$transaction(async (tx) => {
    const claim = await tx.returnAuthorization.updateMany({
      where: { id: params.raId, status: "ISSUED", expiresAt: { gt: new Date() } },
      data: { status: "GOODS_RECEIVED" },
    });

    if (claim.count === 0) {
      const ra = await tx.returnAuthorization.findUnique({ where: { id: params.raId } });
      if (!ra) throw new ReturnAuthorizationNotFoundError(params.raId);
      if (ra.status !== "ISSUED") {
        throw new InvalidReturnAuthorizationStateError(`Cannot receive goods for an RA that is ${ra.status} — it must be ISSUED.`);
      }
      throw new ReturnAuthorizationExpiredError(`This RA expired at ${ra.expiresAt.toISOString()} — issue a new one.`);
    }

    return tx.returnAuthorization.findUniqueOrThrow({ where: { id: params.raId } });
  });
}
