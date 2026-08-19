import type { Prisma, PrismaClient, ReturnIdentityVerification, ReturnReasonCode, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveRequiredApprover } from "../../domain/approval/resolveRequiredApprover";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { lockReturnQuantityRow, computeRemainingReturnableQty } from "../../domain/returns/returnQuantity";

export class OriginalSaleLineNotFoundError extends Error {}
export class OriginalSaleNotEligibleForReturnError extends Error {}
export class InvalidReturnQuantityError extends Error {}
export class ExceedsRemainingReturnableQtyError extends Error {}
export class WrongReturnApproverRoleError extends Error {}

const RA_EXPIRY_DAYS = 7;

export type OriginalSaleType = "RetailSale" | "SalesOrder";

export interface IssueReturnAuthorizationParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string; // branch handling the return — may differ from the original sale's branch
  branchCode: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
  originalSaleType: OriginalSaleType;
  originalSaleLineId: string;
  requestedQty: number;
  reasonCode: ReturnReasonCode;
  identityVerification: ReturnIdentityVerification;
  verifiedIdName?: string;
  verifiedIdContact?: string;
}

export interface OriginalLine {
  productVariantId: string;
  unitPrice: number;
  eligibleQty: number; // what was actually delivered — quantity for RetailSale, releasedQty for SalesOrder
}

/**
 * Returns only make sense against goods actually handed to the customer —
 * a RetailSale line only once the sale itself is POSTED (handover +
 * ledger posting happen together in Phase 2, no separate "handed over"
 * state), a SalesOrder line only up to whatever has actually been
 * released so far (releasedQty), not the full order quantity.
 */
export async function resolveOriginalLine(
  tx: Prisma.TransactionClient,
  originalSaleType: OriginalSaleType,
  originalSaleLineId: string,
): Promise<OriginalLine> {
  if (originalSaleType === "RetailSale") {
    const line = await tx.retailSaleLine.findUnique({
      where: { id: originalSaleLineId },
      include: { retailSale: { select: { status: true } } },
    });
    if (!line) throw new OriginalSaleLineNotFoundError(originalSaleLineId);
    if (line.retailSale.status !== "POSTED") {
      throw new OriginalSaleNotEligibleForReturnError("Cannot issue a return against a retail sale line that isn't POSTED — nothing was handed over.");
    }
    return { productVariantId: line.productVariantId, unitPrice: Number(line.unitPrice), eligibleQty: Number(line.quantity) };
  }

  if (originalSaleType === "SalesOrder") {
    const line = await tx.salesOrderLine.findUnique({ where: { id: originalSaleLineId } });
    if (!line) throw new OriginalSaleLineNotFoundError(originalSaleLineId);
    if (Number(line.releasedQty) <= 0) {
      throw new OriginalSaleNotEligibleForReturnError("Cannot issue a return against a sales order line with nothing released yet.");
    }
    return { productVariantId: line.productVariantId, unitPrice: Number(line.unitPrice), eligibleQty: Number(line.releasedQty) };
  }

  throw new OriginalSaleNotEligibleForReturnError(`Unrecognized originalSaleType "${originalSaleType}".`);
}

/**
 * RA-1. Cross-referenced against the actual sale/order line (never a
 * caller-supplied product/qty) so approval routing and the quantity lock
 * can't be gamed. isHighRisk/transactionType are derived from
 * identityVerification, never client-supplied. This is the RA's only gate
 * — there's no separate later "approve" step for issuance the way
 * Adjustments has request->approve, so the issuer must already meet the
 * required approval tier and provide a fresh PIN (G-30), same as
 * approveReceivingReport.
 */
export async function issueReturnAuthorization(prisma: PrismaClient, params: IssueReturnAuthorizationParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "returns.authorize.create" });

  if (!Number.isFinite(params.requestedQty) || params.requestedQty <= 0) {
    throw new InvalidReturnQuantityError("requestedQty must be a positive number.");
  }

  return prisma.$transaction(async (tx) => {
    const originalLine = await resolveOriginalLine(tx, params.originalSaleType, params.originalSaleLineId);

    await lockReturnQuantityRow(tx, { originalSaleType: params.originalSaleType, originalSaleLineId: params.originalSaleLineId });
    const remaining = await computeRemainingReturnableQty(tx, {
      originalSaleType: params.originalSaleType,
      originalSaleLineId: params.originalSaleLineId,
      originalLineQty: originalLine.eligibleQty,
    });
    if (remaining < params.requestedQty) {
      throw new ExceedsRemainingReturnableQtyError(
        `Requested ${params.requestedQty} exceeds the ${remaining} still returnable against this line (G-17).`,
      );
    }

    const isHighRisk = params.identityVerification === "NONE";
    const transactionType = isHighRisk ? "RETURN_NO_DOCUMENT" : "RETURN";
    // Estimate only — the real financial event is the RETURN_IN ledger
    // posting at grading time, valued at the then-current unit cost
    // (never a live-recomputed figure frozen here). This is purely an
    // input to threshold routing.
    const estimatedValue = params.requestedQty * originalLine.unitPrice;

    const threshold = await resolveRequiredApprover(tx, { branchId: params.branchId, transactionType, value: estimatedValue });
    if (threshold.requiredApproverRole !== params.actorRole) {
      throw new WrongReturnApproverRoleError(
        `This return (≈₱${estimatedValue.toFixed(2)}, ${transactionType}) requires ${threshold.requiredApproverRole} approval, not ${params.actorRole}.`,
      );
    }

    await requirePostingAuthorization(tx, {
      session: params.session,
      pinTokenId: params.pinTokenId,
      action: `returns.authorize:${params.originalSaleLineId}`,
    });

    const docNumber = await issueDocumentNumber(tx, {
      branchId: params.branchId,
      branchCode: params.branchCode,
      documentType: "RA",
    });

    const ra = await tx.returnAuthorization.create({
      data: {
        branchId: params.branchId,
        originalSaleType: params.originalSaleType,
        originalSaleLineId: params.originalSaleLineId,
        productVariantId: originalLine.productVariantId,
        requestedQty: params.requestedQty,
        reasonCode: params.reasonCode,
        identityVerification: params.identityVerification,
        isHighRisk,
        verifiedIdName: params.verifiedIdName,
        verifiedIdContact: params.verifiedIdContact,
        issuedBy: params.actorUserId,
        expiresAt: new Date(Date.now() + RA_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        documentNumberId: docNumber.id,
      },
    });

    return { returnAuthorization: ra, documentNumber: docNumber.fullNumber };
  });
}
