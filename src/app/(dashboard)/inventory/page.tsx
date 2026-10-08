import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { isOwner } from "@/lib/roleModel";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportLinks } from "@/components/ui/ExportLinks";
import { getConsolidatedBranchStockView } from "@/server/application/reporting/consolidatedBranchView";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";
import { getSellingUnits } from "@/server/domain/catalog/pricing";
import { buildCatalogView, parseCatalogFilters } from "./catalogView";
import { CatalogTree } from "./catalog/CatalogTree";

const selectClass = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none";
const filterLabel = "mb-1 block text-xs font-medium text-slate-600";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const filters = parseCatalogFilters(await searchParams);

  let balanceRows;
  try {
    balanceRows = await getConsolidatedBranchStockView(prisma, { actorRole: session.user.role });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const [branches, products, categories, units] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } }),
    prisma.product.findMany({
      include: {
        category: { select: { name: true } },
        baseUnit: { select: { code: true } },
        variants: { orderBy: [{ displayOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }, { sku: "asc" }] },
      },
    }),
    prisma.category.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.unitOfMeasure.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const sellingUnits = await getSellingUnits(
    prisma,
    products.flatMap((p) => p.variants.map((v) => v.id)),
  );

  const stockByVariant = new Map(
    balanceRows.map((r) => [r.productVariantId, Object.fromEntries(Object.entries(r.byBranch).map(([branchId, b]) => [branchId, Number(b.quantityOnHand)]))]),
  );

  const rows = buildCatalogView(
    products.map((p) => ({
      id: p.id,
      asin: p.asin,
      name: p.name,
      sku: p.sku,
      brand: p.brand,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      description: p.description,
      notes: p.notes,
      status: p.status,
      baseUnitId: p.baseUnitId,
      baseUnitCode: p.baseUnit.code,
      children: p.variants.map((v) => ({
        id: v.id,
        asin: v.asin,
        sku: v.sku,
        name: v.name,
        variationData: v.variationData,
        units: (sellingUnits.get(v.id) ?? []).map((u) => ({
          code: u.unitCode,
          name: u.unitName,
          price: u.price?.amount ?? null,
          baseQtyPerUnit: u.baseQtyPerUnit,
          pendingBaseQty: u.pendingPackSize?.rate ?? null,
          isBaseUnit: u.isBaseUnit,
        })),
        barcode: v.barcode,
        notes: v.notes,
        status: v.status,
      })),
    })),
    stockByVariant,
    filters,
  );

  const brands = [...new Set(products.map((p) => p.brand).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b));
  const moveTargets = products
    .filter((p) => p.status !== "ARCHIVED")
    .map((p) => ({ id: p.id, asin: p.asin, name: p.name, baseUnitId: p.baseUnitId, baseUnitCode: p.baseUnit.code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Inventory"
        description="Each product holds its variants like a folder. Open a product to see each variant's selling units, prices, and stock by branch."
        action={<ExportLinks reportId="consolidated-branch-view" />}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-56 flex-1">
          <label htmlFor="catalog-q" className={filterLabel}>
            Search
          </label>
          <input
            id="catalog-q"
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Product or variant name, SKU, or ASIN…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="catalog-view" className={filterLabel}>
            Show
          </label>
          <select id="catalog-view" name="view" defaultValue={filters.view} className={selectClass}>
            <option value="parents">Products</option>
            <option value="children">Variants</option>
          </select>
        </div>
        <div>
          <label htmlFor="catalog-status" className={filterLabel}>
            Status
          </label>
          <select id="catalog-status" name="status" defaultValue={filters.status} className={selectClass}>
            <option value="live">Active &amp; inactive</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <div>
          <label htmlFor="catalog-brand" className={filterLabel}>
            Brand
          </label>
          <select id="catalog-brand" name="brand" defaultValue={filters.brand} className={selectClass}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="catalog-category" className={filterLabel}>
            Category
          </label>
          <select id="catalog-category" name="category" defaultValue={filters.categoryId} className={selectClass}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900">
          Apply
        </button>
      </form>

      <CatalogTree
        key={JSON.stringify(filters)}
        rows={rows}
        view={filters.view}
        branches={branches}
        categories={categories.map((c) => ({ id: c.id, label: c.name }))}
        units={units.map((u) => ({ id: u.id, label: `${u.name} (${u.code})` }))}
        brands={brands}
        moveTargets={moveTargets}
        canManage={isOwner(session.user.role)}
      />
    </div>
  );
}
