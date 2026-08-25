import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/LinkButton";
import { ExportLinks } from "@/components/ui/ExportLinks";
import { getConsolidatedBranchStockView } from "@/server/application/reporting/consolidatedBranchView";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const { q } = await searchParams;

  let balanceRows;
  try {
    balanceRows = await getConsolidatedBranchStockView(prisma, { actorRole: session.user.role });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });

  // getConsolidatedBranchStockView only returns variants with positive stock
  // somewhere (it's built for the MB-7 "availability at other branches" report).
  // The catalog browse page needs every active variant, including ones just
  // added that haven't received their first delivery/adjustment yet — so
  // start from the full catalog and merge in whatever balances exist.
  const variants = await prisma.productVariant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, sku: true, product: { select: { name: true } } },
  });
  const balanceByVariant = new Map(balanceRows.map((r) => [r.productVariantId, r]));
  const rows = variants
    .map((v) => balanceByVariant.get(v.id) ?? { productVariantId: v.id, sku: v.sku, productName: v.product.name, byBranch: {}, totalQuantityOnHand: "0" })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  const query = q?.trim().toLowerCase();
  const filtered = query
    ? rows.filter((r) => r.sku.toLowerCase().includes(query) || r.productName.toLowerCase().includes(query))
    : rows;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Inventory"
        description="Current stock on hand, by product and branch."
        action={
          <div className="flex items-center gap-2">
            <LinkButton href="/inventory/new">Add Product</LinkButton>
            <ExportLinks reportId="consolidated-branch-view" />
          </div>
        }
      />

      <form method="get" className="mb-4">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by SKU or product name…"
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
      </form>

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Product</th>
              {branches.map((b) => (
                <th key={b.id} className="px-4 py-2 text-right">
                  {b.code}
                </th>
              ))}
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={branches.length + 3}>
                  No products match that search.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.productVariantId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-900">{r.sku}</td>
                  <td className="px-4 py-2">{r.productName}</td>
                  {branches.map((b) => (
                    <td key={b.id} className="px-4 py-2 text-right tabular-nums">
                      {r.byBranch[b.id]?.quantityOnHand ?? "0"}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{r.totalQuantityOnHand}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
