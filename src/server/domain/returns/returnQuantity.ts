import type { Prisma } from "@prisma/client";

/**
 * Lazily-upserted-then-FOR-UPDATE mutex row keyed on the ORIGINAL SALE LINE
 * only — deliberately NOT branch-scoped (see ReturnQuantityLock in
 * schema.prisma). A return against the same invoice line can legitimately
 * be attempted from a different branch than the original sale; scoping
 * this lock to branch the way StockReservationLock scopes to
 * (productVariantId, branchId) would silently reopen the double-return
 * race G-17 exists to close. Every ReturnAuthorization-creating
 * transaction must call this before computing remaining returnable qty and
 * inserting.
 */
export async function lockReturnQuantityRow(
  tx: Prisma.TransactionClient,
  params: { originalSaleType: string; originalSaleLineId: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO return_quantity_lock (original_sale_type, original_sale_line_id) VALUES (${params.originalSaleType}, ${params.originalSaleLineId})
    ON CONFLICT (original_sale_type, original_sale_line_id) DO NOTHING
  `;
  await tx.$queryRaw`
    SELECT original_sale_type FROM return_quantity_lock
    WHERE original_sale_type = ${params.originalSaleType} AND original_sale_line_id = ${params.originalSaleLineId}
    FOR UPDATE
  `;
}

/**
 * remainingReturnableQty = originalLineQty − SUM(requestedQty across every
 * non-VOID, non-EXPIRED ReturnAuthorization against this line), computed
 * globally across all branches — not scoped to the branch handling the
 * current return, matching the amended G-17 rule (BPD: enforced as a hard
 * block across all branches). An ISSUED RA past its expiresAt is treated
 * as functionally expired here too, without requiring a scheduled job to
 * have first flipped its status column (same lazy-expiry precedent as
 * StockReservation). originalLineQty is supplied by the caller — this
 * table is deliberately polymorphic (originalSaleType/originalSaleLineId,
 * no FK) the same way CountSlip/DiscrepancyCase are, so it has no way to
 * look up the line's quantity itself. Caller must hold
 * lockReturnQuantityRow first.
 */
export async function computeRemainingReturnableQty(
  tx: Prisma.TransactionClient,
  params: { originalSaleType: string; originalSaleLineId: string; originalLineQty: number },
): Promise<number> {
  const rows = await tx.$queryRaw<{ sum: string | null }[]>`
    SELECT SUM(requested_qty)::text as sum FROM return_authorization
    WHERE original_sale_type = ${params.originalSaleType} AND original_sale_line_id = ${params.originalSaleLineId}
      AND status NOT IN ('VOID', 'EXPIRED')
      AND NOT (status = 'ISSUED' AND expires_at <= now())
  `;
  const alreadyReturned = Number(rows[0]?.sum ?? 0);

  return params.originalLineQty - alreadyReturned;
}
