import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ExportLinks } from "@/components/ui/ExportLinks";
import { getDailyStockMovementSummary } from "@/server/application/reporting/dailyStockMovement";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

export default async function DailyStockMovementPage({ searchParams }: { searchParams: Promise<{ date?: string; branch?: string }> }) {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const { date, branch } = await searchParams;

  const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const branchId = session.user.branchId ?? branch ?? branches[0]?.id;
  if (!branchId) redirect("/");

  const businessDate = date ? new Date(date) : new Date();

  let summary;
  try {
    summary = await getDailyStockMovementSummary(prisma, { actorRole: session.user.role, branchId, businessDate });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Daily Stock Movement Summary"
        description={`Business date: ${summary.businessDate}. Everything in and out today, by document type.`}
        action={<ExportLinks reportId="daily-stock-movement" extraParams={{ date: summary.businessDate, branchId }} />}
      />

      <form method="get" className="mb-4 flex items-center gap-2">
        <input
          type="date"
          name="date"
          defaultValue={summary.businessDate}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        {session.user.branchId ? null : (
          <select name="branch" defaultValue={branchId} className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Go
        </button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total in</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-700">+{summary.totalIn}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total out</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-red-700">{summary.totalOut}</p>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">Movement type</th>
              <th className="px-4 py-2">Document type</th>
              <th className="px-4 py-2 text-right">Documents</th>
              <th className="px-4 py-2 text-right">Total qty</th>
            </tr>
          </thead>
          <tbody>
            {summary.lines.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={4}>
                  No stock movement recorded for this branch and date.
                </td>
              </tr>
            ) : (
              summary.lines.map((l) => (
                <tr key={`${l.movementType}:${l.referenceType}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">{l.movementType}</td>
                  <td className="px-4 py-2">{l.referenceType}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.documentCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.totalQuantity}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
