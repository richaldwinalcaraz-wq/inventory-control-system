import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DISCREPANCY_CASE_STATUS_TONE } from "./status";
import { RunAgingCheckButton } from "./RunAgingCheckButton";

const VIEWER_ROLES = new Set(["BRANCH_MANAGER", "AUDITOR", "OWNER"]);
const AGING_CHECK_ROLES = new Set(["BRANCH_MANAGER", "AUDITOR"]);

export default async function DiscrepancyCasesListPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (!VIEWER_ROLES.has(session.user.role)) redirect("/");

  // DiscrepancyCase isn't branch-scoped (it references arbitrary source
  // records — AdjustmentRequest, ReceivingReport, etc. — each of which is
  // branch-scoped on its own), so this list is intentionally cross-branch
  // for the investigation-tier roles that can see it.
  const cases = await prisma.discrepancyCase.findMany({
    orderBy: [{ status: "asc" }, { openedAt: "desc" }],
    take: 100,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Discrepancy Cases"
        description="Investigations opened whenever expected and actual quantities don't match."
        action={AGING_CHECK_ROLES.has(session.user.role) ? <RunAgingCheckButton /> : undefined}
      />

      <p className="mb-4 text-sm text-slate-500">
        Reports:{" "}
        <Link href="/reports/quarantine-disposal-aging" className="text-brand-700 hover:underline">
          Quarantine &amp; Disposal Aging
        </Link>{" "}
        ·{" "}
        <Link href="/reports/damage-vs-shrinkage" className="text-brand-700 hover:underline">
          Damage vs. Shrinkage
        </Link>
      </p>

      {cases.length === 0 ? (
        <p className="text-sm text-slate-500">No discrepancy cases yet.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Opened</th>
                <th className="px-4 py-2">Assigned to</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/discrepancy-cases/${c.id}`} className="text-brand-700 hover:underline">
                      {c.referenceType} — {c.referenceId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{c.openedAt.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-2">{c.assignedTo ?? "—"}</td>
                  <td className="px-4 py-2">
                    <StatusBadge label={c.status} tone={DISCREPANCY_CASE_STATUS_TONE[c.status] ?? "neutral"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
