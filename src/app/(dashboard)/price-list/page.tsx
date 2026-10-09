import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { navAllows } from "@/components/layout/nav-items";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ProductPricePicker, type PickerProduct } from "@/components/catalog/ProductPricePicker";
import { getProductMaster } from "@/server/application/catalog/productMaster";

const LISTS = [
  { key: "wholesale", label: "Wholesale", priceList: "WHOLESALE" },
  { key: "retail", label: "Retail", priceList: "RETAIL" },
] as const;

export default async function PriceListPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (!navAllows(session.user.role, "/price-list")) redirect("/");

  const { list } = await searchParams;
  const active = LISTS.find((l) => l.key === list) ?? LISTS[0];
  const master = await getProductMaster(prisma, { priceList: active.priceList });
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
      <PageHeader title="Price List" description="Pick a product, variant and unit to see its price. Prices come from the product master, so nobody types them." />
      <nav aria-label="Price list" className="mb-4 inline-flex rounded-md border border-slate-300 bg-white p-1">
        {LISTS.map((l) => (
          <Link
            key={l.key}
            href={`/price-list?list=${l.key}`}
            aria-current={l.key === active.key ? "page" : undefined}
            className={`rounded px-4 py-1.5 text-sm font-medium ${l.key === active.key ? "bg-brand-700 text-white" : "text-slate-700 hover:bg-slate-50"}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <Card className="p-5">
        <ProductPricePicker key={active.key} products={products} />
      </Card>
    </div>
  );
}
