import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { startOfDayManila } from "../../domain/time/businessDate";

export interface StockMovementLine {
  movementType: string;
  referenceType: string;
  documentCount: number;
  totalQuantity: string;
}

export interface DailyStockMovementSummary {
  branchId: string;
  businessDate: string;
  lines: StockMovementLine[];
  totalIn: string;
  totalOut: string;
}

/** BPD sec.14.5 "Daily Stock Movement Summary" — everything in and out today, by document. */
export async function getDailyStockMovementSummary(
  prisma: PrismaClient,
  params: { actorRole: RoleName; branchId: string; businessDate: Date },
): Promise<DailyStockMovementSummary> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.daily-stock-movement.view" });

  const startOfDay = startOfDayManila(params.businessDate);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const movements = await prisma.stockLedger.findMany({
    where: { branchId: params.branchId, createdAt: { gte: startOfDay, lt: endOfDay } },
    select: { movementType: true, referenceType: true, referenceId: true, quantityDeltaBase: true },
  });

  const byKey = new Map<string, { movementType: string; referenceType: string; documentIds: Set<string>; totalQuantity: number }>();
  let totalIn = 0;
  let totalOut = 0;

  for (const m of movements) {
    const qty = Number(m.quantityDeltaBase);
    if (qty >= 0) totalIn += qty;
    else totalOut += qty;

    const key = `${m.movementType}:${m.referenceType}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { movementType: m.movementType, referenceType: m.referenceType, documentIds: new Set(), totalQuantity: 0 };
      byKey.set(key, bucket);
    }
    bucket.documentIds.add(m.referenceId);
    bucket.totalQuantity += qty;
  }

  const lines: StockMovementLine[] = Array.from(byKey.values())
    .map((b) => ({ movementType: b.movementType, referenceType: b.referenceType, documentCount: b.documentIds.size, totalQuantity: b.totalQuantity.toString() }))
    .sort((a, b) => a.movementType.localeCompare(b.movementType) || a.referenceType.localeCompare(b.referenceType));

  return {
    branchId: params.branchId,
    businessDate: startOfDay.toISOString().slice(0, 10),
    lines,
    totalIn: totalIn.toString(),
    totalOut: totalOut.toString(),
  };
}
