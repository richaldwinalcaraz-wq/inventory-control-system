import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DiscrepancyCaseActionPanel } from "./DiscrepancyCaseActionPanel";
import { DISCREPANCY_CASE_STATUS_TONE } from "../status";

const VIEWER_ROLES = new Set(["BRANCH_MANAGER", "AUDITOR", "OWNER"]);

export default async function DiscrepancyCaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (!VIEWER_ROLES.has(session.user.role)) redirect("/");

  const discrepancyCase = await prisma.discrepancyCase.findUnique({ where: { id: caseId } });
  if (!discrepancyCase) notFound();

  // Cross-branch: DiscrepancyCase isn't branch-scoped, so assignment isn't
  // limited to the current user's branch either.
  const assignableUsers = await prisma.user.findMany({
    where: { status: "ACTIVE", role: { in: ["BRANCH_MANAGER", "AUDITOR", "WAREHOUSE_SUPERVISOR"] } },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, role: true },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          Discrepancy Case — {discrepancyCase.referenceType} ({discrepancyCase.referenceId.slice(0, 8)})
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <StatusBadge label={discrepancyCase.status} tone={DISCREPANCY_CASE_STATUS_TONE[discrepancyCase.status] ?? "neutral"} />
          Opened {discrepancyCase.openedAt.toISOString().slice(0, 10)}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 p-4 text-sm">
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-slate-500">Reference</dt>
          <dd>
            {discrepancyCase.referenceType} — {discrepancyCase.referenceId}
          </dd>
          <dt className="text-slate-500">Opened by</dt>
          <dd>{discrepancyCase.openedBy}</dd>
          <dt className="text-slate-500">Assigned to</dt>
          <dd>{discrepancyCase.assignedTo ?? "Unassigned"}</dd>
          {discrepancyCase.notes ? (
            <>
              <dt className="text-slate-500">Notes</dt>
              <dd className="col-span-2 whitespace-pre-wrap text-slate-700">{discrepancyCase.notes}</dd>
            </>
          ) : null}
          {discrepancyCase.resolution ? (
            <>
              <dt className="text-slate-500">Resolution</dt>
              <dd className="col-span-2 whitespace-pre-wrap text-slate-700">{discrepancyCase.resolution}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <DiscrepancyCaseActionPanel
        caseId={discrepancyCase.id}
        status={discrepancyCase.status}
        assignedTo={discrepancyCase.assignedTo}
        currentUser={{ role: session.user.role }}
        assignableUsers={assignableUsers}
      />
    </div>
  );
}
