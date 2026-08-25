import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { reserveStock } from "../../domain/wholesale/reservation";

export class SameBranchTransferError extends Error {}
export class InvalidTransferQuantityError extends Error {}
export class InterBranchTransferNotFoundError extends Error {}
export class InvalidInterBranchTransferStateError extends Error {}

export interface RequestInterBranchTransferParams {
  actorUserId: string;
  actorRole: RoleName;
  fromBranchId: string;
  toBranchId: string;
  productVariantId: string;
  requestedQty: number;
}

/**
 * MB-4's receiving-branch approval IS this request — a Branch Manager
 * originating it at the destination branch, matching BPD's flow which
 * never shows a second, separate receiving-side approval step (Phase 4
 * plan sec.4.2). Reuses reserveStock (domain/wholesale/reservation.ts)
 * completely unmodified at the SOURCE branch, protecting the requested
 * quantity for the full REQUESTED -> ... -> IN_TRANSIT span from being
 * sold out from under the transfer by a concurrent retail/wholesale sale
 * at that branch — see Phase 4 plan sec.4.1 for why no destination-side
 * reservation is needed (in-transit stock is never reservable at either
 * branch simultaneously; it's debited from the source at TRANSFER_OUT and
 * not credited to the destination until TRANSFER_IN).
 *
 * The transfer row is created first, inside the same transaction, so its
 * own id can be used as reserveStock's referenceId — if the reservation
 * fails (insufficient ATP), the whole transaction rolls back together.
 */
export async function requestInterBranchTransfer(prisma: PrismaClient, params: RequestInterBranchTransferParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.transfer.request.create" });

  if (params.fromBranchId === params.toBranchId) {
    throw new SameBranchTransferError("A transfer must be between two different branches.");
  }
  if (params.requestedQty <= 0) {
    throw new InvalidTransferQuantityError("requestedQty must be positive.");
  }

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.interBranchTransfer.create({
      data: {
        fromBranchId: params.fromBranchId,
        toBranchId: params.toBranchId,
        productVariantId: params.productVariantId,
        requestedQty: params.requestedQty,
        requestedBy: params.actorUserId,
      },
    });

    await reserveStock(tx, {
      branchId: params.fromBranchId,
      productVariantId: params.productVariantId,
      referenceType: "InterBranchTransfer",
      referenceId: transfer.id,
      qty: params.requestedQty,
    });

    return transfer;
  });
}
