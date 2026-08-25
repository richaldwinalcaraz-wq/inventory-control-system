import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export interface ConsolidatedBranchStockRow {
  productVariantId: string;
  sku: string;
  productName: string;
  byBranch: Record<string, { branchId: string; branchCode: string; branchName: string; quantityOnHand: string }>;
  totalQuantityOnHand: string;
}

/**
 * MB-7: read-only "availability at other branches" view, no transact
 * capability. Sums StockBalance per branch per product variant across the
 * whole company — a Branch Manager checking another branch's stock before
 * requesting an InterBranchTransfer, or the Owner's cross-branch dashboard.
 */
export async function getConsolidatedBranchStockView(prisma: PrismaClient, params: { actorRole: RoleName }): Promise<ConsolidatedBranchStockRow[]> {
  await assertPermission(prisma, { role: params.actorRole, action: "multibranch.stock.view-other-branch" });

  const balances = await prisma.stockBalance.findMany({
    where: { quantityOnHand: { gt: 0 } },
    select: {
      quantityOnHand: true,
      productVariant: { select: { id: true, sku: true, product: { select: { name: true } } } },
      warehouseLocation: {
        select: { warehouse: { select: { branch: { select: { id: true, code: true, name: true } } } } },
      },
    },
  });

  const byVariant = new Map<string, ConsolidatedBranchStockRow>();

  for (const balance of balances) {
    const branch = balance.warehouseLocation.warehouse.branch;
    const variant = balance.productVariant;

    let row = byVariant.get(variant.id);
    if (!row) {
      row = { productVariantId: variant.id, sku: variant.sku, productName: variant.product.name, byBranch: {}, totalQuantityOnHand: "0" };
      byVariant.set(variant.id, row);
    }

    const existingBranchRow = row.byBranch[branch.id];
    const existingBranchQty = existingBranchRow ? Number(existingBranchRow.quantityOnHand) : 0;
    const newBranchQty = existingBranchQty + Number(balance.quantityOnHand);
    row.byBranch[branch.id] = { branchId: branch.id, branchCode: branch.code, branchName: branch.name, quantityOnHand: newBranchQty.toString() };
    row.totalQuantityOnHand = (Number(row.totalQuantityOnHand) + Number(balance.quantityOnHand)).toString();
  }

  return Array.from(byVariant.values()).sort((a, b) => a.sku.localeCompare(b.sku));
}
