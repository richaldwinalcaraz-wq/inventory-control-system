import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ExportLinks } from "@/components/ui/ExportLinks";
import { getShrinkageRateKpi } from "@/server/application/reporting/shrinkageRate";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

export default async function ShrinkageRatePage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  let rows;
  try {
    rows = await getShrinkageRateKpi(prisma, { actorRole: session.user.role });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Shrinkage Rate"
        description={`Trailing ${rows[0]?.windowDays ?? 90} days — unexplained loss (ADJ-01/03/08/09/10) as a percentage of cost of goods sold, per branch.`}
        action={<ExportLinks reportId="shrinkage-rate" />}
      />

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2 text-right">Shrinkage value (₱)</th>
              <th className="px-4 py-2 text-right">COGS (₱)</th>
              <th className="px-4 py-2 text-right">Shrinkage rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={4}>
                  No branches found.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.branchId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">{r.branchName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">₱{r.shrinkageValue}</td>
                  <td className="px-4 py-2 text-right tabular-nums">₱{r.cogs}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.shrinkageRatePercent === null ? "N/A — no sales in window" : `${r.shrinkageRatePercent}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
