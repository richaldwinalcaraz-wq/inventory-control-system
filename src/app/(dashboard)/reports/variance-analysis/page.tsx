import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ExportLinks } from "@/components/ui/ExportLinks";
import { getVarianceAnalysis } from "@/server/application/reporting/varianceAnalysis";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

export default async function VarianceAnalysisPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  let analysis;
  try {
    analysis = await getVarianceAnalysis(prisma, { actorRole: session.user.role });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Variance Analysis"
        description={`Trailing ${analysis.windowDays} days — posted adjustment value, grouped by requester and by location.`}
        action={<ExportLinks reportId="variance-analysis" />}
      />

      <div className="flex flex-col gap-4">
        <Card className="overflow-x-auto">
          <div className="border-b border-slate-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-900">By person</h3>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">Requester</th>
                <th className="px-4 py-2 text-right">Adjustments</th>
                <th className="px-4 py-2 text-right">Total value (₱)</th>
              </tr>
            </thead>
            <tbody>
              {analysis.byPerson.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={3}>
                    No posted adjustments in this window.
                  </td>
                </tr>
              ) : (
                analysis.byPerson.map((p) => (
                  <tr key={p.userId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">{p.fullName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.requestCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">₱{p.totalValue}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto">
          <div className="border-b border-slate-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-900">By location</h3>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">Location</th>
                <th className="px-4 py-2 text-right">Adjustments</th>
                <th className="px-4 py-2 text-right">Total value (₱)</th>
              </tr>
            </thead>
            <tbody>
              {analysis.byLocation.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={3}>
                    No posted adjustments in this window.
                  </td>
                </tr>
              ) : (
                analysis.byLocation.map((l) => (
                  <tr key={l.warehouseLocationId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">{l.locationLabel}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.requestCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">₱{l.totalValue}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
