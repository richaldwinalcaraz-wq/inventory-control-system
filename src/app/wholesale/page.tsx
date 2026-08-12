import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  CONFIRMED: "bg-slate-100 text-slate-700",
  RESERVED: "bg-blue-100 text-blue-800",
  PICKING: "bg-blue-100 text-blue-800",
  STAGED: "bg-amber-100 text-amber-800",
  CHECKED: "bg-amber-100 text-amber-800",
  PENDING_RELEASE_APPROVAL: "bg-amber-100 text-amber-800",
  RELEASED_PARTIAL: "bg-purple-100 text-purple-800",
  RELEASED: "bg-green-100 text-green-800",
  VOID: "bg-slate-200 text-slate-500 line-through",
};

export default async function WholesaleListPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const orders = await prisma.salesOrder.findMany({
    where: { branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      customer: { select: { name: true } },
      lines: { select: { orderedQty: true, unitPrice: true } },
    },
  });

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Wholesale Orders</h1>
        <Link href="/wholesale/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          New Order
        </Link>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-slate-500">No wholesale orders yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const value = o.lines.reduce((sum, l) => sum + Number(l.orderedQty) * Number(l.unitPrice), 0);
                return (
                  <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/wholesale/${o.id}`} className="text-blue-700 hover:underline">
                        {o.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{o.customer.name}</td>
                    <td className="px-4 py-2">₱{value.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_STYLES[o.status] ?? ""}`}>{o.status}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">{o.createdAt.toISOString().slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
