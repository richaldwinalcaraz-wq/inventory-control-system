import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/LinkButton";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RECEIVING_STATUS_TONE } from "./status";

export default async function ReceivingListPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const reports = await prisma.receivingReport.findMany({
    where: { branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      drNumber: true,
      status: true,
      createdAt: true,
      supplier: { select: { name: true } },
      documentNumber: { select: { fullNumber: true } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Receiving Reports"
        action={<LinkButton href="/receiving/new">New Receiving Report</LinkButton>}
      />

      {reports.length === 0 ? (
        <p className="text-sm text-slate-500">No receiving reports yet.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">DR #</th>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Document #</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/receiving/${r.id}`} className="text-brand-700 hover:underline">
                      {r.drNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.supplier.name}</td>
                  <td className="px-4 py-2">{r.documentNumber?.fullNumber ?? "—"}</td>
                  <td className="px-4 py-2">
                    <StatusBadge label={r.status} tone={RECEIVING_STATUS_TONE[r.status] ?? "neutral"} />
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
