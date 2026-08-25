import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

const DEFAULT_WINDOW_DAYS = 90;
const SLOW_STOCK_WINDOW_DAYS = 90;

export interface WeeklyTrendBucket {
  weekStart: string;
  damageCount: number;
  damageQuantity: string;
  returnCount: number;
  returnQuantity: string;
}

export interface SlowStockRow {
  productVariantId: string;
  sku: string;
  productName: string;
  quantityOnHand: string;
  lastOutboundAt: string | null;
}

export interface TrendReview {
  windowDays: number;
  weeklyTrend: WeeklyTrendBucket[];
  slowStock: SlowStockRow[];
}

function weekStartOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** BPD sec.14.6 "damage and return trend review" + "slow/dead stock review" — monthly rhythm. */
export async function getTrendReview(prisma: PrismaClient, params: { actorRole: RoleName; windowDays?: number }): Promise<TrendReview> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.trend-review.view" });

  const windowDays = params.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [damageReports, returns] = await Promise.all([
    prisma.damageReport.findMany({ where: { reportedAt: { gte: windowStart } }, select: { reportedAt: true, quantity: true } }),
    prisma.returnAuthorization.findMany({ where: { createdAt: { gte: windowStart } }, select: { createdAt: true, requestedQty: true } }),
  ]);

  const buckets = new Map<string, { damageCount: number; damageQuantity: number; returnCount: number; returnQuantity: number }>();
  for (const d of damageReports) {
    const key = weekStartOf(d.reportedAt);
    const b = buckets.get(key) ?? { damageCount: 0, damageQuantity: 0, returnCount: 0, returnQuantity: 0 };
    b.damageCount += 1;
    b.damageQuantity += Number(d.quantity);
    buckets.set(key, b);
  }
  for (const r of returns) {
    const key = weekStartOf(r.createdAt);
    const b = buckets.get(key) ?? { damageCount: 0, damageQuantity: 0, returnCount: 0, returnQuantity: 0 };
    b.returnCount += 1;
    b.returnQuantity += Number(r.requestedQty);
    buckets.set(key, b);
  }
  const weeklyTrend: WeeklyTrendBucket[] = Array.from(buckets.entries())
    .map(([weekStart, b]) => ({ weekStart, damageCount: b.damageCount, damageQuantity: b.damageQuantity.toString(), returnCount: b.returnCount, returnQuantity: b.returnQuantity.toString() }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Slow/dead stock: on hand somewhere, but no outbound (negative) ledger
  // movement anywhere in the trailing window.
  const slowWindowStart = new Date(Date.now() - SLOW_STOCK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const balances = await prisma.stockBalance.groupBy({
    by: ["productVariantId"],
    where: { quantityOnHand: { gt: 0 } },
    _sum: { quantityOnHand: true },
  });

  const recentOutbound = await prisma.stockLedger.findMany({
    where: { quantityDeltaBase: { lt: 0 }, createdAt: { gte: slowWindowStart } },
    select: { productVariantId: true },
    distinct: ["productVariantId"],
  });
  const recentlyMovedIds = new Set(recentOutbound.map((r) => r.productVariantId));

  const candidateIds = balances.map((b) => b.productVariantId).filter((id) => !recentlyMovedIds.has(id));
  const slowStock: SlowStockRow[] = [];
  if (candidateIds.length > 0) {
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, sku: true, product: { select: { name: true } } },
    });
    const lastOutbound = await prisma.stockLedger.groupBy({
      by: ["productVariantId"],
      where: { productVariantId: { in: candidateIds }, quantityDeltaBase: { lt: 0 } },
      _max: { createdAt: true },
    });
    const lastOutboundById = new Map(lastOutbound.map((l) => [l.productVariantId, l._max.createdAt]));
    const qtyById = new Map(balances.map((b) => [b.productVariantId, b._sum.quantityOnHand]));

    for (const v of variants) {
      slowStock.push({
        productVariantId: v.id,
        sku: v.sku,
        productName: v.product.name,
        quantityOnHand: (qtyById.get(v.id) ?? 0).toString(),
        lastOutboundAt: lastOutboundById.get(v.id)?.toISOString().slice(0, 10) ?? null,
      });
    }
    slowStock.sort((a, b) => a.sku.localeCompare(b.sku));
  }

  return { windowDays, weeklyTrend, slowStock };
}
