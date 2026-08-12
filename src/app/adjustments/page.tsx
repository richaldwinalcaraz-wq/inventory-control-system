import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING_INVESTIGATION: "bg-amber-100 text-amber-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  PENDING_POSTING: "bg-blue-100 text-blue-800",
  POSTED: "bg-green-100 text-green-800",
  REJECTED: "bg-slate-200 text-slate-500",
  VOID: "bg-slate-200 text-slate-500 line-through",
};

export default async function AdjustmentsListPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const requests = await prisma.adjustmentRequest.findMany({
    where: { branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      reasonCode: true,
      quantityDelta: true,
      value: true,
      status: true,
      createdAt: true,
      documentNumber: { select: { fullNumber: true } },
      productVariant: { select: { sku: true } },
    },
  });

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Adjustments</h1>
        <Link href="/adjustments/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          New Adjustment Request
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-slate-500">No adjustment requests yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Qty Δ</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Document #</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/adjustments/${r.id}`} className="text-blue-700 hover:underline">
                      {r.productVariant.sku}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.reasonCode}</td>
                  <td className="px-4 py-2">{r.quantityDelta.toString()}</td>
                  <td className="px-4 py-2">₱{Number(r.value).toFixed(2)}</td>
                  <td className="px-4 py-2">{r.documentNumber?.fullNumber ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_STYLES[r.status] ?? ""}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{r.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
