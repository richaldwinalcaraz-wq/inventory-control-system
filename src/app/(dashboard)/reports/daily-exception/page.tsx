import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ExportLinks } from "@/components/ui/ExportLinks";
import { generateDailyExceptionReport } from "@/server/application/reporting/dailyExceptionReport";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

function detailLine(row: Record<string, unknown>, omit: string[]): string {
  const entries = Object.entries(row).filter(([key]) => !omit.includes(key));
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "bigint" ? value.toString() : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

function CategoryCard({ title, rows, idKey, omit = [] }: { title: string; rows: Array<Record<string, unknown>>; idKey: string; omit?: string[] }) {
  return (
    <Card className="overflow-x-auto">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-500">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">None today.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map((row, i) => (
              // idKey alone isn't always unique (e.g. unaccountedFormsProxy's
              // documentType repeats across branches) — the index suffix
              // guarantees a unique React key regardless.
              <tr key={`${String(row[idKey] ?? "row")}-${i}`} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-700">{detailLine(row, [idKey, ...omit])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default async function DailyExceptionReportPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const { date } = await searchParams;
  const businessDate = date ? new Date(date) : new Date();

  let report;
  try {
    report = await generateDailyExceptionReport(prisma, { actorRole: session.user.role, businessDate });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Daily Exception Report"
        description={`Business date: ${report.businessDate}. Owner/Auditor only — not suppressible by any branch role (G-28).`}
        action={<ExportLinks reportId="daily-exception" extraParams={{ date: report.businessDate }} />}
      />

      <form method="get" className="mb-4">
        <input
          type="date"
          name="date"
          defaultValue={report.businessDate}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        <button type="submit" className="ml-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Go
        </button>
      </form>

      <div className="flex flex-col gap-4">
        <CategoryCard title="Adjustments" rows={report.adjustments} idKey="id" />
        <CategoryCard title="Count variances" rows={report.countVariances} idKey="id" />
        <CategoryCard title="Blocked negative-stock attempts" rows={report.blockedNegativeStockAttempts as unknown as Array<Record<string, unknown>>} idKey="id" />
        <CategoryCard title="Late encodings (proxy)" rows={report.lateEncodingsProxy as unknown as Array<Record<string, unknown>>} idKey="receivingReportId" />
        <CategoryCard title="Unaccounted forms (proxy)" rows={report.unaccountedFormsProxy as unknown as Array<Record<string, unknown>>} idKey="documentType" />
        <CategoryCard title="Overdue transfers" rows={report.overdueTransfers} idKey="id" />
        <CategoryCard title="Open discrepancy cases" rows={report.openDiscrepancyCases} idKey="id" />
        <CategoryCard title="Overdue proofs of delivery" rows={report.overduePods} idKey="id" />
        <CategoryCard title="Emergency role elevations" rows={report.emergencyElevations} idKey="id" />
      </div>
    </div>
  );
}
