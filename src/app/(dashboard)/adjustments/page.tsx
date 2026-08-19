import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/LinkButton";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ADJUSTMENT_STATUS_TONE } from "./status";

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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Adjustments"
        action={<LinkButton href="/adjustments/new">New Adjustment Request</LinkButton>}
      />

      {requests.length === 0 ? (
        <p className="text-sm text-slate-500">No adjustment requests yet.</p>
      ) : (
        <Card className="overflow-x-auto">
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
                    <Link href={`/adjustments/${r.id}`} className="text-brand-700 hover:underline">
                      {r.productVariant.sku}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.reasonCode}</td>
                  <td className="px-4 py-2">{r.quantityDelta.toString()}</td>
                  <td className="px-4 py-2">₱{Number(r.value).toFixed(2)}</td>
                  <td className="px-4 py-2">{r.documentNumber?.fullNumber ?? "—"}</td>
                  <td className="px-4 py-2">
                    <StatusBadge label={r.status} tone={ADJUSTMENT_STATUS_TONE[r.status] ?? "neutral"} />
                  </td>
                  <td className="px-4 py-2 text-slate-500">{r.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
