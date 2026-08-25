import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class DailyReconciliationNotFoundError extends Error {}
export class NotAllLinesReviewedError extends Error {}
export class ReconciliationAlreadySignedOffError extends Error {}

export interface SignOffDailyReconciliationParams {
  actorUserId: string;
  actorRole: RoleName;
  dailyReconciliationId: string;
}

/**
 * BPD sec.14.4 step 8 — Branch Manager's final EOD sign-off. Requires every
 * line reviewed (reviewedBy set), but does NOT require every line to be
 * matched/eligible — open DiscrepancyCases from routed-to-Auditor lines
 * don't block sign-off, matching BPD's own EOD flow that closes the day
 * "whether or not anything is wrong," attaching exceptions rather than
 * gating on them.
 */
export async function signOffDailyReconciliation(prisma: PrismaClient, params: SignOffDailyReconciliationParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "reconciliation.sign-off.create" });

  const reconciliation = await prisma.dailyReconciliation.findUnique({
    where: { id: params.dailyReconciliationId },
    include: { lines: true },
  });
  if (!reconciliation) throw new DailyReconciliationNotFoundError(params.dailyReconciliationId);
  if (reconciliation.signedOffBy) {
    throw new ReconciliationAlreadySignedOffError(`Reconciliation ${reconciliation.id} is already signed off.`);
  }

  const unreviewed = reconciliation.lines.filter((l) => !l.reviewedBy);
  if (unreviewed.length > 0) {
    throw new NotAllLinesReviewedError(`${unreviewed.length} line(s) have not been reviewed yet — every line must be reviewed before sign-off.`);
  }

  const result = await prisma.dailyReconciliation.updateMany({
    where: { id: reconciliation.id, signedOffBy: null },
    data: { signedOffBy: params.actorUserId, signedOffAt: new Date() },
  });
  if (result.count === 0) {
    throw new ReconciliationAlreadySignedOffError(`Reconciliation ${reconciliation.id} was signed off by a concurrent request.`);
  }

  return prisma.dailyReconciliation.findUniqueOrThrow({ where: { id: reconciliation.id }, include: { lines: true } });
}
