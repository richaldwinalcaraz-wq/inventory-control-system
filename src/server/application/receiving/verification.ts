import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { ReceivingReportNotFoundError, InvalidReceivingReportStateError } from "./draft";

/** BR-025: assembly is hard-blocked unless both a Receiver and a Checker/tie-break count slip exist. */
export class BothCountSlipsRequiredError extends Error {}
export class VerifierMustNotBeReceiverError extends Error {}

async function hasBothCountSlips(prisma: PrismaClient, rrId: string): Promise<boolean> {
  const slips = await prisma.countSlip.findMany({ where: { referenceType: "ReceivingReport", referenceId: rrId } });
  const hasReceiver = slips.some((s) => s.role === "RECEIVER");
  const hasResolution = slips.some((s) => s.role === "CHECKER" || s.role === "TIEBREAK");
  return hasReceiver && hasResolution;
}

/**
 * Step 7 — assembling the RR for handoff to the Supervisor. Validation
 * only (BR-025); does not change status, since PENDING_VERIFICATION is
 * already the state inspection-PASS leaves the RR in. verifyReceivingReport
 * re-checks the same condition regardless, so this step being skipped by a
 * client never bypasses the control.
 */
export async function prepareReceivingReport(
  prisma: PrismaClient,
  params: { actorUserId: string; actorRole: RoleName; rrId: string },
) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.prepare.create" });

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status !== "PENDING_VERIFICATION") {
    throw new InvalidReceivingReportStateError(`Cannot prepare an RR that is ${rr.status}.`);
  }
  if (!(await hasBothCountSlips(prisma, params.rrId))) {
    throw new BothCountSlipsRequiredError("Both a receiver count and a resolved checker/tie-break count are required (BR-025).");
  }

  return { ready: true };
}

/** Step 8 — Supervisor verification. The verifier must not be the same person who received the goods. */
export async function verifyReceivingReport(
  prisma: PrismaClient,
  params: { actorUserId: string; actorRole: RoleName; rrId: string },
) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.verify.create" });

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status !== "PENDING_VERIFICATION") {
    throw new InvalidReceivingReportStateError(`Cannot verify an RR that is ${rr.status}.`);
  }
  if (rr.receivedBy === params.actorUserId) {
    throw new VerifierMustNotBeReceiverError("The verifier must not be the same person who received the goods.");
  }
  if (!(await hasBothCountSlips(prisma, params.rrId))) {
    throw new BothCountSlipsRequiredError("Both a receiver count and a resolved checker/tie-break count are required (BR-025).");
  }

  return prisma.receivingReport.update({
    where: { id: params.rrId },
    data: { status: "PENDING_APPROVAL", verifiedBy: params.actorUserId },
  });
}
