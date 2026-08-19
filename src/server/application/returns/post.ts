import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { ReturnAuthorizationNotFoundError, InvalidReturnAuthorizationStateError } from "./receive";
import { resolveAcceptedGrade } from "./grade";

export class ReturnWarehouseLocationNotFoundError extends Error {}
export class AlreadyPostedError extends Error {}
export class NotReadyForReturnPostingError extends Error {}
export class ReturnMissingDocumentNumberError extends Error {}

export interface PostReturnGradingParams {
  actorUserId: string;
  actorRole: RoleName;
  branchCode: string;
  raId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * RA-8. Per the plan: SELLABLE/REPACKABLE restore stock (only now, never
 * at physical arrival), DAMAGED hands off to Damage & Disposal with no
 * ledger entry of its own, NOT_OURS is the one branch that gets its own
 * terminal RA status (REJECTED_NOT_OURS) — SELLABLE/REPACKABLE/DAMAGED all
 * stay GRADED, since the enum has no separate "posted" state for them.
 * Double-posting is prevented per-branch: the ledger's own idempotency key
 * for SELLABLE/REPACKABLE, an existence check against the DamageReport for
 * DAMAGED, and an atomic status claim for NOT_OURS (the one branch that
 * actually has a status to claim against).
 */
export async function postReturnGrading(prisma: PrismaClient, params: PostReturnGradingParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "returns.post.create" });

  return prisma.$transaction(async (tx) => {
    const ra = await tx.returnAuthorization.findUnique({ where: { id: params.raId } });
    if (!ra) throw new ReturnAuthorizationNotFoundError(params.raId);
    if (ra.status !== "GRADED") {
      throw new InvalidReturnAuthorizationStateError(`Cannot post an RA that is ${ra.status} — it must be GRADED.`);
    }

    const grade = await resolveAcceptedGrade(tx, ra);

    await requirePostingAuthorization(tx, {
      session: params.session,
      pinTokenId: params.pinTokenId,
      action: `returns.post:${ra.id}`,
    });

    if (grade === "NOT_OURS") {
      const claim = await tx.returnAuthorization.updateMany({
        where: { id: ra.id, status: "GRADED" },
        data: { status: "REJECTED_NOT_OURS" },
      });
      if (claim.count === 0) {
        throw new NotReadyForReturnPostingError(`RA ${ra.id} is no longer GRADED — it was likely already claimed by a concurrent post attempt.`);
      }
      return { returnAuthorization: await tx.returnAuthorization.findUniqueOrThrow({ where: { id: ra.id } }) };
    }

    // Accepted quantity: the checker's (confirmatory) count, capped at
    // RA.requestedQty — same cap count.ts already enforces, recomputed
    // here from the count slip rather than re-trusting a caller-supplied
    // figure.
    const checkSlip = await tx.countSlip.findFirst({
      where: { referenceType: "ReturnAuthorization", referenceId: ra.id, role: "RETURN_CHECK" },
      include: { lines: true },
    });
    const countedQty = Number(checkSlip?.lines[0]?.countedQty ?? 0);
    const postedQty = Math.min(countedQty, Number(ra.requestedQty));

    if (grade === "DAMAGED") {
      const existing = await tx.damageReport.findFirst({ where: { sourceReferenceType: "ReturnAuthorization", sourceReferenceId: ra.id } });
      if (existing) throw new AlreadyPostedError(`RA ${ra.id} has already been handed off to Damage & Disposal (${existing.id}).`);

      const damageReport = await tx.damageReport.create({
        data: {
          branchId: ra.branchId,
          productVariantId: ra.productVariantId,
          warehouseLocationId: await resolveReturnsLocationId(tx, ra.branchId),
          sourceType: "RETURN",
          sourceReferenceType: "ReturnAuthorization",
          sourceReferenceId: ra.id,
          quantity: postedQty,
          reportedBy: params.actorUserId,
          cause: `Customer return graded DAMAGED (RA ${ra.id}).`,
        },
      });
      return { returnAuthorization: ra, damageReport };
    }

    // SELLABLE / REPACKABLE — restore to STORAGE. Reuses the RA's own
    // document number (already issued at RA-1) rather than minting a
    // second one — this is the RA being posted, not a new document.
    const storageLocation = await tx.warehouseLocation.findFirst({ where: { zone: "STORAGE", warehouse: { branchId: ra.branchId } } });
    if (!storageLocation) throw new ReturnWarehouseLocationNotFoundError("No STORAGE location registered for this branch.");
    if (!ra.documentNumberId) throw new ReturnMissingDocumentNumberError(`RA ${ra.id} has no document number on file — this should be unreachable.`);
    const docNumber = await tx.documentNumber.findUniqueOrThrow({ where: { id: ra.documentNumberId } });

    const requestPayload = { raId: ra.id, postedQty };
    const unitCost = await getCurrentUnitCost(tx, { productVariantId: ra.productVariantId, warehouseLocationId: storageLocation.id });
    const ledgerResult = await postLedgerEntryInTx(tx, {
      idempotency: {
        documentType: "RA",
        documentNumber: `${docNumber.fullNumber}:POST`,
        branchCode: params.branchCode,
        requestPayloadHash: createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex"),
      },
      branchId: ra.branchId,
      productVariantId: ra.productVariantId,
      warehouseLocationId: storageLocation.id,
      quantityDeltaBase: postedQty,
      movementType: "RETURN_IN",
      unitCostAtMovement: unitCost,
      referenceType: "ReturnAuthorization",
      referenceId: ra.id,
      documentNumber: docNumber.fullNumber,
      reasonCode: grade,
      performedBy: params.actorUserId,
    });

    return { returnAuthorization: ra, documentNumber: docNumber.fullNumber, ledger: ledgerResult.ledger, postedQty };
  });
}

async function resolveReturnsLocationId(tx: Prisma.TransactionClient, branchId: string): Promise<string> {
  const loc = await tx.warehouseLocation.findFirst({ where: { zone: "RETURNS", warehouse: { branchId } } });
  if (!loc) {
    const storageLoc = await tx.warehouseLocation.findFirst({ where: { zone: "STORAGE", warehouse: { branchId } } });
    if (!storageLoc) throw new ReturnWarehouseLocationNotFoundError("No RETURNS or STORAGE location registered for this branch.");
    return storageLoc.id;
  }
  return loc.id;
}
