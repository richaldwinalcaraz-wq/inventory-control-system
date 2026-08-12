import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  POSTED: "bg-green-100 text-green-800",
  VOID: "bg-slate-200 text-slate-500 line-through",
};

export default async function RetailSalesListPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const sales = await prisma.retailSale.findMany({
    where: { branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      documentNumber: { select: { fullNumber: true } },
      lines: { select: { quantity: true, unitPrice: true } },
    },
  });

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Retail Sales</h1>
        <Link href="/retail/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          New Sale
        </Link>
      </div>

      {sales.length === 0 ? (
        <p className="text-sm text-slate-500">No retail sales yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">Sale</th>
                <th className="px-4 py-2">Document #</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const total = s.lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
                return (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/retail/${s.id}`} className="text-blue-700 hover:underline">
                        {s.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{s.documentNumber?.fullNumber ?? "—"}</td>
                    <td className="px-4 py-2">₱{total.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_STYLES[s.status] ?? ""}`}>{s.status}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">{s.createdAt.toISOString().slice(0, 10)}</td>
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
