import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { getQuarantineDisposalAgingReport } from "@/server/application/reporting/quarantineDisposalAging";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

export default async function QuarantineDisposalAgingReportPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  let reports, certificates;
  try {
    ({ reports, certificates } = await getQuarantineDisposalAgingReport(prisma, { actorRole: session.user.role }));
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Quarantine & Disposal Aging" description="Oldest first — G-09's dwell clocks: 14 days in quarantine, 30 days for-disposal." />

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Damage reports in quarantine</h2>
      <Card className="mb-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Days in quarantine</th>
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={5}>
                  Nothing in quarantine.
                </td>
              </tr>
            ) : (
              reports.map((r) => {
                const days = daysSince(r.quarantineEnteredAt);
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/disposal/${r.id}`} className="text-brand-700 hover:underline">
                        {r.productVariant.sku}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{r.branch.name}</td>
                    <td className="px-4 py-2">{r.quantity.toString()}</td>
                    <td className="px-4 py-2">{r.status}</td>
                    <td className={`px-4 py-2 ${days >= 14 ? "font-medium text-red-700" : ""}`}>{days}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Certificates awaiting disposal</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">Disposition</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Days for-disposal</th>
            </tr>
          </thead>
          <tbody>
            {certificates.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={5}>
                  Nothing awaiting disposal.
                </td>
              </tr>
            ) : (
              certificates.map((c) => {
                const days = c.forDisposalEnteredAt ? daysSince(c.forDisposalEnteredAt) : 0;
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/disposal/certificates/${c.id}`} className="text-brand-700 hover:underline">
                        {c.damageReport.productVariant.sku}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{c.damageReport.branch.name}</td>
                    <td className="px-4 py-2">{c.disposition}</td>
                    <td className="px-4 py-2">{c.quantity.toString()}</td>
                    <td className={`px-4 py-2 ${days >= 30 ? "font-medium text-red-700" : ""}`}>{days}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
