import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveRequiredApprover } from "../../domain/approval/resolveRequiredApprover";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { ReceivingReportNotFoundError, InvalidReceivingReportStateError } from "./draft";

export class SupplierCallbackRequiredError extends Error {}
export class WrongApproverRoleError extends Error {}

export interface ApproveReceivingReportParams {
  actorUserId: string;
  actorRole: RoleName;
  rrId: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * Step 9 — approval/posting authorization. Routes through the
 * approval-threshold engine (fails closed on an unconfigured transaction
 * type) and requires a fresh PIN token — this is a posting/approval
 * action under G-30, unlike the earlier workflow steps.
 */
export async function approveReceivingReport(prisma: PrismaClient, params: ApproveReceivingReportParams) {
  return prisma.$transaction(async (tx) => {
    await assertPermission(tx, { role: params.actorRole, action: "receiving.approve.create" });

    const rr = await tx.receivingReport.findUnique({ where: { id: params.rrId }, include: { lines: true } });
    if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
    if (rr.status !== "PENDING_APPROVAL") {
      throw new InvalidReceivingReportStateError(`Cannot approve an RR that is ${rr.status}.`);
    }
    if (!rr.poReference && !rr.supplierCallbackConfirmedAt) {
      throw new SupplierCallbackRequiredError(
        "This delivery has no PO on file — the supplier call-back (G-04) must be confirmed before approval.",
      );
    }

    // Computed server-side from the RR's own lines — never trust a
    // caller-supplied value for the number that decides which approval
    // tier applies, or approval routing becomes trivially bypassable.
    const totalValue = rr.lines.reduce((sum, line) => {
      const qty = line.finalQty ?? line.expectedQty ?? 0;
      return sum + Number(qty) * Number(line.unitCost);
    }, 0);

    const threshold = await resolveRequiredApprover(tx, {
      branchId: rr.branchId,
      transactionType: "RECEIVING",
      value: totalValue,
    });
    if (threshold.requiredApproverRole !== params.actorRole) {
      throw new WrongApproverRoleError(
        `This receiving report (value=${totalValue}) requires ${threshold.requiredApproverRole} approval, not ${params.actorRole}.`,
      );
    }

    await requirePostingAuthorization(tx, {
      session: params.session,
      pinTokenId: params.pinTokenId,
      action: `receiving.approve:${params.rrId}`,
    });

    return tx.receivingReport.update({
      where: { id: params.rrId },
      data: { status: "APPROVED", approvedBy: params.actorUserId },
    });
  });
}
