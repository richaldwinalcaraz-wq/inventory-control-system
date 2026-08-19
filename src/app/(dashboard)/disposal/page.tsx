import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/LinkButton";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DAMAGE_REPORT_STATUS_TONE } from "./status";

export default async function DisposalListPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const reports = await prisma.damageReport.findMany({
    where: { branchId },
    orderBy: { reportedAt: "desc" },
    take: 50,
    select: {
      id: true,
      sourceType: true,
      quantity: true,
      cause: true,
      status: true,
      quarantineEnteredAt: true,
      productVariant: { select: { sku: true } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Damage & Disposal" action={<LinkButton href="/disposal/new">Report Damage</LinkButton>} />

      {reports.length === 0 ? (
        <p className="text-sm text-slate-500">No damage reports yet.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Cause</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">In quarantine since</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/disposal/${r.id}`} className="text-brand-700 hover:underline">
                      {r.productVariant.sku}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.sourceType}</td>
                  <td className="px-4 py-2">{r.quantity.toString()}</td>
                  <td className="px-4 py-2">{r.cause}</td>
                  <td className="px-4 py-2">
                    <StatusBadge label={r.status} tone={DAMAGE_REPORT_STATUS_TONE[r.status] ?? "neutral"} />
                  </td>
                  <td className="px-4 py-2 text-slate-500">{r.quarantineEnteredAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
