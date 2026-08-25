import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

const WINDOW_DAYS = 90;

export interface DamageVsShrinkageRow {
  branchId: string;
  productVariantId: string;
  warehouseLocationId: string;
  damageCount: number;
  adjCount: number;
  adjValue: number;
  disproportionate: boolean;
}

/**
 * G-20 report, extracted from the damage-vs-shrinkage page (Phase 3) so the
 * same query is reusable by the Phase 4 uniform export endpoint instead of
 * being duplicated — behavior identical to what the page computed inline
 * before this extraction, including the "damageCount/adjCount < 0.5" flag.
 */
export async function getDamageVsShrinkageReport(prisma: PrismaClient, params: { actorRole: RoleName }): Promise<DamageVsShrinkageRow[]> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.damage-vs-shrinkage.view" });

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [damageReports, shortageAdjustments] = await Promise.all([
    prisma.damageReport.findMany({
      where: { reportedAt: { gte: windowStart } },
      select: { branchId: true, productVariantId: true, warehouseLocationId: true, quantity: true },
    }),
    prisma.adjustmentRequest.findMany({
      where: { reasonCode: "ADJ_01", status: "POSTED", createdAt: { gte: windowStart } },
      select: { branchId: true, productVariantId: true, warehouseLocationId: true, value: true },
    }),
  ]);

  const byKey = new Map<string, DamageVsShrinkageRow>();
  const keyOf = (b: string, p: string, w: string) => `${b}:${p}:${w}`;

  for (const d of damageReports) {
    const key = keyOf(d.branchId, d.productVariantId, d.warehouseLocationId);
    const row = byKey.get(key) ?? { branchId: d.branchId, productVariantId: d.productVariantId, warehouseLocationId: d.warehouseLocationId, damageCount: 0, adjCount: 0, adjValue: 0, disproportionate: false };
    row.damageCount += 1;
    byKey.set(key, row);
  }
  for (const a of shortageAdjustments) {
    const key = keyOf(a.branchId, a.productVariantId, a.warehouseLocationId);
    const row = byKey.get(key) ?? { branchId: a.branchId, productVariantId: a.productVariantId, warehouseLocationId: a.warehouseLocationId, damageCount: 0, adjCount: 0, adjValue: 0, disproportionate: false };
    row.adjCount += 1;
    row.adjValue += Number(a.value);
    byKey.set(key, row);
  }

  return [...byKey.values()]
    .filter((r) => r.adjCount > 0)
    .map((r) => ({ ...r, disproportionate: r.damageCount === 0 || r.damageCount / r.adjCount < 0.5 }))
    .sort((a, b) => b.adjValue - a.adjValue);
}
