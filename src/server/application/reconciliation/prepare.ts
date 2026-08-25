import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { startOfDayManila } from "../../domain/time/businessDate";

export class DailyReconciliationAlreadyPreparedError extends Error {}

export interface PrepareDailyReconciliationParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  businessDate: Date;
}

interface RawReconciliationRow {
  product_variant_id: string;
  warehouse_location_id: string;
  opening_qty: string;
  stock_in_qty: string;
  stock_out_qty: string;
}

/**
 * BPD sec.14.3 step 7 — the Encoder's system-side numbers, computed live
 * from StockLedger: opening = everything posted before the business date,
 * in/out = today's movements split by sign. Only product+location pairs
 * with at least one movement ON this business date are included — a
 * reconciliation is about what moved today, not a full stock listing.
 */
export async function prepareDailyReconciliation(prisma: PrismaClient, params: PrepareDailyReconciliationParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "reconciliation.prepare.create" });

  const startOfDay = startOfDayManila(params.businessDate);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const existing = await prisma.dailyReconciliation.findUnique({
    where: { branchId_businessDate: { branchId: params.branchId, businessDate: startOfDay } },
  });
  if (existing) {
    throw new DailyReconciliationAlreadyPreparedError(
      `A daily reconciliation for branch ${params.branchId} on ${startOfDay.toISOString().slice(0, 10)} already exists (${existing.id}).`,
    );
  }

  const rows = await prisma.$queryRaw<RawReconciliationRow[]>`
    SELECT
      product_variant_id,
      warehouse_location_id,
      COALESCE(SUM(CASE WHEN created_at < ${startOfDay} THEN quantity_delta_base ELSE 0 END), 0)::text AS opening_qty,
      COALESCE(SUM(CASE WHEN created_at >= ${startOfDay} AND created_at < ${endOfDay} AND quantity_delta_base > 0 THEN quantity_delta_base ELSE 0 END), 0)::text AS stock_in_qty,
      COALESCE(SUM(CASE WHEN created_at >= ${startOfDay} AND created_at < ${endOfDay} AND quantity_delta_base < 0 THEN -quantity_delta_base ELSE 0 END), 0)::text AS stock_out_qty
    FROM stock_ledger
    WHERE branch_id = ${params.branchId} AND created_at < ${endOfDay}
    GROUP BY product_variant_id, warehouse_location_id
    HAVING SUM(CASE WHEN created_at >= ${startOfDay} AND created_at < ${endOfDay} THEN 1 ELSE 0 END) > 0
  `;

  return prisma.dailyReconciliation.create({
    data: {
      branchId: params.branchId,
      businessDate: startOfDay,
      preparedBy: params.actorUserId,
      lines: {
        create: rows.map((r) => ({
          productVariantId: r.product_variant_id,
          warehouseLocationId: r.warehouse_location_id,
          openingQty: r.opening_qty,
          stockInQty: r.stock_in_qty,
          stockOutQty: r.stock_out_qty,
          systemExpectedClosingQty: (Number(r.opening_qty) + Number(r.stock_in_qty) - Number(r.stock_out_qty)).toString(),
        })),
      },
    },
    include: { lines: true },
  });
}
