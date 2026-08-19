import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/LinkButton";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RETAIL_STATUS_TONE } from "./status";

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
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Retail Sales" action={<LinkButton href="/retail/new">New Sale</LinkButton>} />

      {sales.length === 0 ? (
        <p className="text-sm text-slate-500">No retail sales yet.</p>
      ) : (
        <Card className="overflow-x-auto">
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
                      <Link href={`/retail/${s.id}`} className="text-brand-700 hover:underline">
                        {s.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{s.documentNumber?.fullNumber ?? "—"}</td>
                    <td className="px-4 py-2">₱{total.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <StatusBadge label={s.status} tone={RETAIL_STATUS_TONE[s.status] ?? "neutral"} />
                    </td>
                    <td className="px-4 py-2 text-slate-500">{s.createdAt.toISOString().slice(0, 10)}</td>
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
