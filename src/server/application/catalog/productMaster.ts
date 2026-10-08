import type { PriceList, PrismaClient } from "@prisma/client";
import { getSellingUnits, type SellingUnit } from "../../domain/catalog/pricing";

export interface ProductMasterVariant {
  productVariantId: string;
  sku: string;
  name: string;
  asin: string | null;
  /** Units on hand in the product's base unit — for the given branch, or all branches. */
  onHandBase: number;
  sellingUnits: SellingUnit[];
}

export interface ProductMasterProduct {
  productId: string;
  name: string;
  category: string | null;
  baseUnit: { id: string; code: string; name: string };
  variants: ProductMasterVariant[];
}

/**
 * The single source of product data for every app that sells: ACTIVE
 * products -> ACTIVE variants -> selling units with current prices and pack
 * sizes -> stock on hand. The future Order App reads this instead of
 * keeping its own product list, so names and prices can't drift apart.
 */
export async function getProductMaster(prisma: PrismaClient, params: { branchId?: string | null; priceList?: PriceList } = {}): Promise<ProductMasterProduct[]> {
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
      baseUnit: { select: { id: true, code: true, name: true } },
      variants: { where: { status: "ACTIVE" }, orderBy: [{ displayOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }, { sku: "asc" }], select: { id: true, sku: true, name: true, asin: true } },
    },
  });
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const [units, stock] = await Promise.all([
    getSellingUnits(prisma, variantIds, { branchId: params.branchId ?? null, priceList: params.priceList }),
    prisma.stockBalance.groupBy({
      by: ["productVariantId"],
      where: { productVariantId: { in: variantIds }, ...(params.branchId ? { warehouseLocation: { warehouse: { branchId: params.branchId } } } : {}) },
      _sum: { quantityOnHand: true },
    }),
  ]);
  const onHand = new Map(stock.map((s) => [s.productVariantId, Number(s._sum.quantityOnHand ?? 0)]));

  return products
    .filter((p) => p.variants.length > 0)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      category: p.category?.name ?? null,
      baseUnit: p.baseUnit,
      variants: p.variants.map((v) => ({
        productVariantId: v.id,
        sku: v.sku,
        name: v.name ?? p.name,
        asin: v.asin,
        onHandBase: onHand.get(v.id) ?? 0,
        sellingUnits: units.get(v.id) ?? [],
      })),
    }));
}
