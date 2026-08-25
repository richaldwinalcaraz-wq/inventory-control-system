import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class CycleCountRecordNotFoundError extends Error {}
export class InvalidCycleCountRecordStateError extends Error {}
export class CycleCountSlipAlreadySubmittedError extends Error {}
export class PrimaryCountMissingError extends Error {}
export class SecondaryCounterMustNotBePrimaryError extends Error {}
export class WitnessRequiredError extends Error {}
export class CollectorMustNotBeCounterError extends Error {}

export interface SubmitCycleCountParams {
  actorUserId: string;
  actorRole: RoleName;
  cycleCountRecordId: string;
  countedQty: number;
  /** G-24 chain of custody — nullable, ignored for existing (non-cycle-count) CountSlip roles. */
  completedAt?: Date;
  collectedBy?: string;
  submissionMethod?: "THIRD_PARTY_COLLECTED" | "INSTANT_PHOTO_SUBMIT";
}

async function getCountingRecord(prisma: PrismaClient, cycleCountRecordId: string) {
  const record = await prisma.cycleCountRecord.findUnique({ where: { id: cycleCountRecordId } });
  if (!record) throw new CycleCountRecordNotFoundError(cycleCountRecordId);
  if (record.status !== "COUNTING") {
    throw new InvalidCycleCountRecordStateError(`Cannot submit a count while the record is ${record.status} — it must be COUNTING.`);
  }
  return record;
}

function assertCustodyFields(params: SubmitCycleCountParams) {
  if (params.collectedBy && params.collectedBy === params.actorUserId) {
    throw new CollectorMustNotBeCounterError("G-24: the person who collected the count sheet must not be the counter themself.");
  }
}

/** G-24's blind first count. */
export async function submitPrimaryCount(prisma: PrismaClient, params: SubmitCycleCountParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.count.primary.create" });
  assertCustodyFields(params);

  const record = await getCountingRecord(prisma, params.cycleCountRecordId);
  const existing = await prisma.countSlip.findFirst({ where: { referenceType: "CycleCountRecord", referenceId: record.id, role: "CYCLE_COUNT_PRIMARY" } });
  if (existing) throw new CycleCountSlipAlreadySubmittedError("A primary count has already been submitted and is read-only.");

  return prisma.countSlip.create({
    data: {
      referenceType: "CycleCountRecord",
      referenceId: record.id,
      role: "CYCLE_COUNT_PRIMARY",
      countedBy: params.actorUserId,
      completedAt: params.completedAt,
      collectedBy: params.collectedBy,
      submissionMethod: params.submissionMethod,
      lines: { create: [{ productVariantId: record.productVariantId, countedQty: params.countedQty }] },
    },
    include: { lines: true },
  });
}

export interface SubmitSecondaryCountResult {
  countSlip: { id: string };
  matched: boolean;
}

/**
 * G-24's blind second count — never reads back the primary counter's
 * figure to the caller, and the secondary counter must not be the primary
 * counter. On disagreement, the record moves to TIEBREAK_PENDING; on
 * agreement it stays COUNTING (ready for evaluateCycleCountVariance) — in
 * neither case is systemExpectedQty computed here (count first, compare
 * after, only at evaluation time).
 */
export async function submitSecondaryCount(prisma: PrismaClient, params: SubmitCycleCountParams): Promise<SubmitSecondaryCountResult> {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.count.secondary.create" });
  assertCustodyFields(params);

  const record = await getCountingRecord(prisma, params.cycleCountRecordId);
  const primarySlip = await prisma.countSlip.findFirst({ where: { referenceType: "CycleCountRecord", referenceId: record.id, role: "CYCLE_COUNT_PRIMARY" }, include: { lines: true } });
  if (!primarySlip) throw new PrimaryCountMissingError("The primary count must be submitted first.");
  if (primarySlip.countedBy === params.actorUserId) {
    throw new SecondaryCounterMustNotBePrimaryError("The secondary counter must not be the same person as the primary counter.");
  }
  const existingSecondary = await prisma.countSlip.findFirst({ where: { referenceType: "CycleCountRecord", referenceId: record.id, role: "CYCLE_COUNT_SECONDARY" } });
  if (existingSecondary) throw new CycleCountSlipAlreadySubmittedError("A secondary count has already been submitted and is read-only.");

  const secondarySlip = await prisma.countSlip.create({
    data: {
      referenceType: "CycleCountRecord",
      referenceId: record.id,
      role: "CYCLE_COUNT_SECONDARY",
      countedBy: params.actorUserId,
      completedAt: params.completedAt,
      collectedBy: params.collectedBy,
      submissionMethod: params.submissionMethod,
      lines: { create: [{ productVariantId: record.productVariantId, countedQty: params.countedQty }] },
    },
    include: { lines: true },
  });

  const matched = (primarySlip.lines[0]?.countedQty.toString() ?? null) === (secondarySlip.lines[0]?.countedQty.toString() ?? null);
  if (!matched) {
    await prisma.cycleCountRecord.update({ where: { id: record.id }, data: { status: "TIEBREAK_PENDING" } });
  }

  return { countSlip: { id: secondarySlip.id }, matched };
}

export interface SubmitTiebreakCountParams extends SubmitCycleCountParams {
  witnessedBy: string;
}

/** Independent third count by a Supervisor, only reachable when primary/secondary disagree. */
export async function submitTiebreakCount(prisma: PrismaClient, params: SubmitTiebreakCountParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.count.tiebreak.create" });
  if (!params.witnessedBy) throw new WitnessRequiredError("A tie-break count requires a witnessed-by user.");
  assertCustodyFields(params);

  const record = await prisma.cycleCountRecord.findUnique({ where: { id: params.cycleCountRecordId } });
  if (!record) throw new CycleCountRecordNotFoundError(params.cycleCountRecordId);
  if (record.status !== "TIEBREAK_PENDING") {
    throw new InvalidCycleCountRecordStateError(`Cannot submit a tie-break count while the record is ${record.status} — it must be TIEBREAK_PENDING.`);
  }

  const existing = await prisma.countSlip.findFirst({ where: { referenceType: "CycleCountRecord", referenceId: record.id, role: "TIEBREAK" } });
  if (existing) throw new CycleCountSlipAlreadySubmittedError("A tie-break count has already been submitted and is read-only.");

  const tiebreakSlip = await prisma.countSlip.create({
    data: {
      referenceType: "CycleCountRecord",
      referenceId: record.id,
      role: "TIEBREAK",
      countedBy: params.actorUserId,
      witnessedBy: params.witnessedBy,
      completedAt: params.completedAt,
      collectedBy: params.collectedBy,
      submissionMethod: params.submissionMethod,
      lines: { create: [{ productVariantId: record.productVariantId, countedQty: params.countedQty }] },
    },
    include: { lines: true },
  });

  // Tie resolved — back to COUNTING, ready for evaluateCycleCountVariance.
  await prisma.cycleCountRecord.update({ where: { id: record.id }, data: { status: "COUNTING" } });

  return tiebreakSlip;
}
