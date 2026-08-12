import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { RetailSaleActionPanel } from "./RetailSaleActionPanel";

export default async function RetailSaleDetailPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");

  const sale = await prisma.retailSale.findUnique({
    where: { id: saleId },
    include: {
      documentNumber: { select: { fullNumber: true } },
      lines: {
        select: {
          id: true,
          productVariantId: true,
          quantity: true,
          unitPrice: true,
          productVariant: { select: { sku: true, product: { select: { name: true } } } },
        },
      },
    },
  });
  if (!sale) notFound();

  const total = sale.lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Retail Sale — {sale.id.slice(0, 8)}</h1>
        <p className="text-sm text-slate-500">
          Status: <span className="font-medium">{sale.status}</span>
          {sale.documentNumber ? <> · Document #: {sale.documentNumber.fullNumber}</> : null}
        </p>
      </div>

      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Unit price</th>
              <th className="px-3 py-2">Line total</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{l.productVariant.sku}</td>
                <td className="px-3 py-2">{l.productVariant.product.name}</td>
                <td className="px-3 py-2">{l.quantity.toString()}</td>
                <td className="px-3 py-2">₱{Number(l.unitPrice).toFixed(2)}</td>
                <td className="px-3 py-2">₱{(Number(l.quantity) * Number(l.unitPrice)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-3 py-2" colSpan={4}>
                Total
              </td>
              <td className="px-3 py-2">₱{total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <RetailSaleActionPanel saleId={sale.id} status={sale.status} currentUserRole={session.user.role} />
    </main>
  );
}
