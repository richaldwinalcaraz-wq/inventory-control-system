import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { ReceivingReportNotFoundError, InvalidReceivingReportStateError } from "./draft";

export class SupervisorRequiredForRejectionError extends Error {}

const SUPERVISOR_OR_ABOVE: readonly RoleName[] = ["WAREHOUSE_SUPERVISOR", "BRANCH_MANAGER", "OWNER"];

export interface SubmitInspectionParams {
  actorUserId: string;
  actorRole: RoleName;
  rrId: string;
  outcome: "PASS" | "REJECT";
  rejectedProductVariantIds?: string[];
  notes?: string;
}

/**
 * Step 6 — quality inspection (sample-open ≥1/20 packs). A PASS moves the
 * RR straight to PENDING_VERIFICATION (Step 8's precondition). A REJECT
 * requires Supervisor-or-above and quarantines the RR — Phase 1 has no
 * automated path out of QUARANTINE (that's what DiscrepancyCase exists
 * for; the actual investigation workflow is Phase 3 scope).
 */
export async function submitInspection(prisma: PrismaClient, params: SubmitInspectionParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.inspect.create" });

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status !== "PENDING_INSPECTION") {
    throw new InvalidReceivingReportStateError(`Cannot inspect while the RR is ${rr.status}.`);
  }

  if (params.outcome === "REJECT") {
    if (!SUPERVISOR_OR_ABOVE.includes(params.actorRole)) {
      throw new SupervisorRequiredForRejectionError("Rejecting inspected goods requires Supervisor approval or above.");
    }
    if (params.rejectedProductVariantIds?.length) {
      await prisma.receivingReportLine.updateMany({
        where: { receivingReportId: params.rrId, productVariantId: { in: params.rejectedProductVariantIds } },
        data: { lineStatus: "QUARANTINED" },
      });
    }
    return prisma.receivingReport.update({ where: { id: params.rrId }, data: { status: "QUARANTINE" } });
  }

  return prisma.receivingReport.update({ where: { id: params.rrId }, data: { status: "PENDING_VERIFICATION" } });
}
