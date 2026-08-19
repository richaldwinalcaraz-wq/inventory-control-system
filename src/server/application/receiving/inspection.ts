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
 * requires Supervisor-or-above and quarantines the RR — see
 * exitQuarantine below for how it proceeds from here (Phase 3).
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

export interface ExitQuarantineParams {
  actorUserId: string;
  actorRole: RoleName;
  rrId: string;
}

/**
 * Phase 3 — the exit path QUARANTINE never had. finalQty/lineStatus were
 * already resolved back at counting/inspection time, so this is purely an
 * RR-level unblock: it lets the paperwork continue into the SAME
 * verification -> approval -> encoding pipeline every other RR goes
 * through. It does NOT release the physical goods — encodeReceivingReport
 * posts QUARANTINED lines into the QUARANTINE zone (not RECEIVING/
 * STORAGE), so the goods stay physically quarantined with a real
 * StockBalance row. Actually releasing them is a Damage & Disposal
 * decision downstream (DamageReport sourceType "RECEIVING"), not this
 * function's job.
 */
export async function exitQuarantine(prisma: PrismaClient, params: ExitQuarantineParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.inspect.create" });
  if (!SUPERVISOR_OR_ABOVE.includes(params.actorRole)) {
    throw new SupervisorRequiredForRejectionError("Exiting quarantine requires Supervisor approval or above.");
  }

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status !== "QUARANTINE") {
    throw new InvalidReceivingReportStateError(`Cannot exit quarantine while the RR is ${rr.status} — it must be QUARANTINE.`);
  }

  return prisma.receivingReport.update({ where: { id: params.rrId }, data: { status: "PENDING_VERIFICATION" } });
}
