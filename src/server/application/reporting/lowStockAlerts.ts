import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export type LowStockStatus = "OUT_OF_STOCK" | "LOW_STOCK";

export interface LowStockAlertRow {
  branchId: string;
  branchCode: string;
  branchName: string;
  productVariantId: string;
  sku: string;
  productName: string;
  reorderPoint: string;
  quantityOnHand: string;
  status: LowStockStatus;
}

/**
 * BPD sec.14.5 "Low Stock / Out of Stock" report — Br. Manager, Owner.
 * Only variants with a configured (non-null) reorderPoint are alertable;
 * an unconfigured product is not "fine," it's simply not being monitored
 * yet (see the reorder-points settings page).
 */
export async function getLowStockAlerts(prisma: PrismaClient, params: { actorRole: RoleName; branchId?: string }): Promise<LowStockAlertRow[]> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.low-stock.view" });

  const variants = await prisma.productVariant.findMany({
    where: { reorderPoint: { not: null } },
    select: { id: true, sku: true, reorderPoint: true, product: { select: { name: true } } },
  });
  if (variants.length === 0) return [];

  const balances = await prisma.stockBalance.findMany({
    where: {
      productVariantId: { in: variants.map((v) => v.id) },
      ...(params.branchId ? { warehouseLocation: { warehouse: { branchId: params.branchId } } } : {}),
    },
    select: {
      productVariantId: true,
      quantityOnHand: true,
      warehouseLocation: { select: { warehouse: { select: { branch: { select: { id: true, code: true, name: true } } } } } },
    },
  });

  const qtyByVariantBranch = new Map<string, { branchId: string; branchCode: string; branchName: string; qty: number }>();
  for (const b of balances) {
    const branch = b.warehouseLocation.warehouse.branch;
    const key = `${b.productVariantId}:${branch.id}`;
    const existing = qtyByVariantBranch.get(key);
    qtyByVariantBranch.set(key, {
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      qty: (existing?.qty ?? 0) + Number(b.quantityOnHand),
    });
  }

  const branches = await prisma.branch.findMany({
    where: params.branchId ? { id: params.branchId } : {},
    select: { id: true, code: true, name: true },
  });

  const rows: LowStockAlertRow[] = [];
  for (const variant of variants) {
    const reorderPoint = Number(variant.reorderPoint);
    for (const branch of branches) {
      const key = `${variant.id}:${branch.id}`;
      const qty = qtyByVariantBranch.get(key)?.qty ?? 0;
      if (qty > reorderPoint) continue;
      rows.push({
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        productVariantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        reorderPoint: reorderPoint.toString(),
        quantityOnHand: qty.toString(),
        status: qty === 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
      });
    }
  }

  return rows.sort((a, b) => (a.status === b.status ? a.sku.localeCompare(b.sku) : a.status === "OUT_OF_STOCK" ? -1 : 1));
}
