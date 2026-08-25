import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { RunCheckButton } from "./RunCheckButton";

export default async function IntegrityChecksPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Integrity Checks"
        description="On-demand fraud/compliance sweeps — each opens or reassigns a Discrepancy Case where a rule is violated. No scheduler runs these; someone with access needs to click them."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Quarantine & Disposal Aging (G-09)</h2>
          <p className="mb-3 text-sm text-slate-500">
            Flags damage reports quarantined 14+ days, or disposal certificates FOR_DISPOSAL 30+ days, still
            undecided — escalates to the branch manager for mandatory physical re-inspection.
          </p>
          <RunCheckButton endpoint="/api/v1/integrity-checks/quarantine-disposal-aging" label="Run aging check" />
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Overdue Inter-Branch Transfers</h2>
          <p className="mb-3 text-sm text-slate-500">
            Flags transfers still in transit or pending count 3+ days after dispatch — escalates to the sending
            branch&apos;s manager for follow-up.
          </p>
          <RunCheckButton endpoint="/api/v1/integrity-checks/overdue-transfers" label="Run overdue-transfer check" />
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Deactivated User Reassignment (G-31)</h2>
          <p className="mb-3 text-sm text-slate-500">
            Reassigns any open Discrepancy Case still sitting with a deactivated user to their branch&apos;s current
            manager (or the Owner if none is configured).
          </p>
          <RunCheckButton endpoint="/api/v1/integrity-checks/deactivated-users" label="Run reassignment check" />
        </Card>
      </div>
    </div>
  );
}
