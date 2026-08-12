import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { ReceivingReportNotFoundError, InvalidReceivingReportStateError } from "./draft";

export class CountSlipAlreadySubmittedError extends Error {}
export class ReceiverCountMissingError extends Error {}
export class CheckerMustNotBeReceiverError extends Error {}
export class WitnessRequiredError extends Error {}
export class CountsDoNotDisagreeError extends Error {}

export interface CountLine {
  productVariantId: string;
  countedQty: number;
}

// Prisma reads Decimal columns back as Decimal instances, not plain
// numbers — the reconciliation helpers below accept either, since they're
// called both with fresh input (number) and DB-read rows (Decimal).
interface StoredCountLine {
  productVariantId: string;
  countedQty: { toString(): string };
}

/** Step 4 — first physical count, by the Receiver. */
export async function submitReceiverCount(
  prisma: PrismaClient,
  params: { rrId: string; actorUserId: string; actorRole: RoleName; lines: CountLine[] },
) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.count.receiver.create" });

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status !== "DRAFT") {
    throw new InvalidReceivingReportStateError(`Cannot submit a receiver count while the RR is ${rr.status}.`);
  }
  const existingSlips = await prisma.countSlip.findMany({ where: { referenceType: "ReceivingReport", referenceId: params.rrId } });
  if (existingSlips.some((s) => s.role === "RECEIVER")) {
    throw new CountSlipAlreadySubmittedError("A receiver count has already been submitted and is read-only.");
  }

  return prisma.countSlip.create({
    data: {
      referenceType: "ReceivingReport",
      referenceId: params.rrId,
      role: "RECEIVER",
      countedBy: params.actorUserId,
      lines: { create: params.lines.map((l) => ({ productVariantId: l.productVariantId, countedQty: l.countedQty })) },
    },
    include: { lines: true },
  });
}

export interface SubmitCheckerCountResult {
  countSlip: { id: string };
  matched: boolean;
}

/**
 * Step 5 — blind second count, by the Checker. "Blind" is a system
 * property here, not just paper discipline: this function never reads
 * back the Receiver's figures to the caller, and the Checker cannot be
 * the same person as the Receiver (SoD-3).
 */
export async function submitCheckerCount(
  prisma: PrismaClient,
  params: { rrId: string; actorUserId: string; actorRole: RoleName; lines: CountLine[] },
): Promise<SubmitCheckerCountResult> {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.count.checker.create" });

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status !== "DRAFT") {
    throw new InvalidReceivingReportStateError(`Cannot submit a checker count while the RR is ${rr.status}.`);
  }
  const existingSlips = await prisma.countSlip.findMany({
    where: { referenceType: "ReceivingReport", referenceId: params.rrId },
    include: { lines: true },
  });
  const receiverSlip = existingSlips.find((s) => s.role === "RECEIVER");
  if (!receiverSlip) throw new ReceiverCountMissingError("The receiver count must be submitted first.");
  if (receiverSlip.countedBy === params.actorUserId) {
    throw new CheckerMustNotBeReceiverError("The Checker must not be the same person as the Receiver (SoD-3).");
  }
  if (existingSlips.some((s) => s.role === "CHECKER")) {
    throw new CountSlipAlreadySubmittedError("A checker count has already been submitted and is read-only.");
  }

  const checkerSlip = await prisma.countSlip.create({
    data: {
      referenceType: "ReceivingReport",
      referenceId: params.rrId,
      role: "CHECKER",
      countedBy: params.actorUserId,
      lines: { create: params.lines.map((l) => ({ productVariantId: l.productVariantId, countedQty: l.countedQty })) },
    },
    include: { lines: true },
  });

  const matched = countsMatch(receiverSlip.lines, checkerSlip.lines);
  if (matched) {
    await finalizeLines(prisma, params.rrId, checkerSlip.lines);
    await prisma.receivingReport.update({ where: { id: params.rrId }, data: { status: "PENDING_INSPECTION" } });
  }
  // On mismatch, the RR deliberately stays in DRAFT — a Supervisor-led
  // tie-break (submitTieBreakCount) is required before it can proceed.

  return { countSlip: { id: checkerSlip.id }, matched };
}

/** Step 5, tie-break — Supervisor + a second on-duty witness, an independent third count. */
export async function submitTieBreakCount(
  prisma: PrismaClient,
  params: { rrId: string; actorUserId: string; actorRole: RoleName; witnessedBy: string; lines: CountLine[] },
) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.count.tiebreak.create" });
  if (!params.witnessedBy) throw new WitnessRequiredError("A tie-break count requires a witnessed-by user.");

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status !== "DRAFT") {
    throw new InvalidReceivingReportStateError(`Cannot submit a tie-break count while the RR is ${rr.status}.`);
  }
  const existingSlips = await prisma.countSlip.findMany({
    where: { referenceType: "ReceivingReport", referenceId: params.rrId },
    include: { lines: true },
  });
  const receiverSlip = existingSlips.find((s) => s.role === "RECEIVER");
  const checkerSlip = existingSlips.find((s) => s.role === "CHECKER");
  if (!receiverSlip || !checkerSlip) {
    throw new ReceiverCountMissingError("Both the receiver and checker counts must exist before a tie-break.");
  }
  if (countsMatch(receiverSlip.lines, checkerSlip.lines)) {
    throw new CountsDoNotDisagreeError("The receiver and checker counts already match — no tie-break is needed.");
  }

  const tieBreakSlip = await prisma.countSlip.create({
    data: {
      referenceType: "ReceivingReport",
      referenceId: params.rrId,
      role: "TIEBREAK",
      countedBy: params.actorUserId,
      witnessedBy: params.witnessedBy,
      lines: { create: params.lines.map((l) => ({ productVariantId: l.productVariantId, countedQty: l.countedQty })) },
    },
    include: { lines: true },
  });

  await finalizeLines(prisma, params.rrId, tieBreakSlip.lines);
  await prisma.receivingReport.update({ where: { id: params.rrId }, data: { status: "PENDING_INSPECTION" } });

  return tieBreakSlip;
}

function countsMatch(a: StoredCountLine[], b: StoredCountLine[]): boolean {
  if (a.length !== b.length) return false;
  const byVariant = new Map(a.map((l) => [l.productVariantId, l.countedQty.toString()]));
  return b.every((l) => byVariant.get(l.productVariantId) === l.countedQty.toString());
}

async function finalizeLines(prisma: PrismaClient, rrId: string, finalLines: StoredCountLine[]) {
  for (const line of finalLines) {
    await prisma.receivingReportLine.updateMany({
      where: { receivingReportId: rrId, productVariantId: line.productVariantId },
      data: { finalQty: line.countedQty.toString() },
    });
  }
}
