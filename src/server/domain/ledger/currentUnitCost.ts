import type { Prisma } from "@prisma/client";

export class NoCostBasisError extends Error {}

/**
 * Approximates "current cost" for a stock-out posting as the unit cost of
 * the most recent inbound movement (RECEIVING or TRANSFER_IN) at this exact
 * product/location — a simple last-in-cost approximation, not a real moving
 * weighted-average engine (no such engine exists anywhere in this codebase
 * yet; StockLedger.unitCostAtMovement's "moving weighted average" comment
 * describes the column's intent, not a computation that's actually been
 * built). Building true weighted averaging is a legitimate future
 * refinement, not Phase 2 scope — Retail/Wholesale/Adjustment stock-outs
 * all use this same approximation via this one shared function.
 */
export async function getCurrentUnitCost(
  tx: Prisma.TransactionClient,
  params: { productVariantId: string; warehouseLocationId: string },
): Promise<string> {
  const rows = await tx.$queryRaw<{ unit_cost_at_movement: string }[]>`
    SELECT unit_cost_at_movement FROM stock_ledger
    WHERE product_variant_id = ${params.productVariantId}
      AND warehouse_location_id = ${params.warehouseLocationId}
      AND quantity_delta_base > 0
    ORDER BY sequence_no DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new NoCostBasisError(
      `No prior inbound movement found for product ${params.productVariantId} at location ${params.warehouseLocationId} — cannot determine a cost basis for this stock-out.`,
    );
  }
  return row.unit_cost_at_movement;
}
