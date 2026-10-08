import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { navAllows } from "@/components/layout/nav-items";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ProductPricePicker, type PickerProduct } from "@/components/catalog/ProductPricePicker";
import { getProductMaster } from "@/server/application/catalog/productMaster";

export default async function PriceListPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (!navAllows(session.user.role, "/price-list")) redirect("/");

  const master = await getProductMaster(prisma);
  const products: PickerProduct[] = master.map((p) => ({
    id: p.productId,
    name: p.name,
    category: p.category,
    baseUnitCode: p.baseUnit.code,
    variants: p.variants.map((v) => ({
      id: v.productVariantId,
      name: v.name,
      sku: v.sku,
      onHandBase: v.onHandBase,
      units: v.sellingUnits.map((u) => ({
        unitId: u.unitId,
        code: u.unitCode,
        name: u.unitName,
        isBaseUnit: u.isBaseUnit,
        price: u.price?.amount ?? null,
        baseQtyPerUnit: u.baseQtyPerUnit,
        pendingBaseQty: u.pendingPackSize?.rate ?? null,
        sellable: u.sellable,
      })),
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Price List" description="Pick a product, variant and unit to see the wholesale price. Prices come from the product master, so nobody types them." />
      <Card className="p-5">
        <ProductPricePicker products={products} />
      </Card>
    </div>
  );
}
