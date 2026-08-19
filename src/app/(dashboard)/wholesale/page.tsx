import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/LinkButton";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WHOLESALE_STATUS_TONE } from "./status";

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
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Wholesale Orders" action={<LinkButton href="/wholesale/new">New Order</LinkButton>} />

      {orders.length === 0 ? (
        <p className="text-sm text-slate-500">No wholesale orders yet.</p>
      ) : (
        <Card className="overflow-x-auto">
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
                      <Link href={`/wholesale/${o.id}`} className="text-brand-700 hover:underline">
                        {o.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{o.customer.name}</td>
                    <td className="px-4 py-2">₱{value.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <StatusBadge label={o.status} tone={WHOLESALE_STATUS_TONE[o.status] ?? "neutral"} />
                    </td>
                    <td className="px-4 py-2 text-slate-500">{o.createdAt.toISOString().slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
