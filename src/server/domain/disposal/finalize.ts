import type { Prisma } from "@prisma/client";
import { computePostedDisposalQty } from "./disposalLock";

/**
 * Bookkeeping only, not a control gate: once every unit on a DamageReport
 * has a POSTED DisposalCertificate against it, flips the report to DISPOSED
 * so it stops showing as an open item.
 *
 * Deliberately uses computePostedDisposalQty (POSTED-only), not
 * computeRemainingUndisposedQty (which also counts DRAFT/FOR_DISPOSAL as
 * "spoken for") — a report split across one certificate that posts and a
 * second left sitting in DRAFT must NOT read DISPOSED, or it silently drops
 * out of the G-09 aging report and the ADJ_03 gate's own re-check, exactly
 * the fraud-audit finding this status exists to support. Call after each
 * disposition's own posting commits.
 */
export async function markDamageReportDisposedIfComplete(tx: Prisma.TransactionClient, damageReportId: string): Promise<void> {
  const report = await tx.damageReport.findUnique({ where: { id: damageReportId } });
  if (!report || report.status === "DISPOSED" || report.status === "CLOSED") return;

  const postedQty = await computePostedDisposalQty(tx, { damageReportId });
  if (postedQty >= Number(report.quantity)) {
    await tx.damageReport.update({ where: { id: damageReportId }, data: { status: "DISPOSED" } });
  }
}
