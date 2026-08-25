import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { markCycleCountScheduleCounted } from "./schedule";
import { CycleCountRecordNotFoundError, InvalidCycleCountRecordStateError, CycleCountSlipAlreadySubmittedError } from "./submitCount";

export class RecounterMustDifferFromPriorCountersError extends Error {}

export interface SubmitCycleCountRecountParams {
  actorUserId: string;
  actorRole: RoleName;
  cycleCountRecordId: string;
  countedQty: number;
  completedAt?: Date;
  collectedBy?: string;
  submissionMethod?: "THIRD_PARTY_COLLECTED" | "INSTANT_PHOTO_SUBMIT";
}

/**
 * Post-tiebreak, beyond-tolerance recount by a 4th distinct person — SoD
 * check rejects if the candidate counted primary, secondary, or tiebreak
 * for this record, same shape as receiving's CheckerMustNotBeReceiverError.
 * Confirms the variance (this codebase never auto-clears a variance from a
 * single recount disagreeing with the recount itself — the recount's own
 * figure is definitive here, matching BPD 12.1's "immediate recount by a
 * different person before any adjustment" with no further tie-break tier).
 */
export async function submitCycleCountRecount(prisma: PrismaClient, params: SubmitCycleCountRecountParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.recount.create" });
  if (params.collectedBy && params.collectedBy === params.actorUserId) {
    throw new RecounterMustDifferFromPriorCountersError("G-24: the person who collected the count sheet must not be the counter themself.");
  }

  const record = await prisma.cycleCountRecord.findUnique({ where: { id: params.cycleCountRecordId } });
  if (!record) throw new CycleCountRecordNotFoundError(params.cycleCountRecordId);
  if (record.status !== "RECOUNT_PENDING") {
    throw new InvalidCycleCountRecordStateError(`Cannot submit a recount while the record is ${record.status} — it must be RECOUNT_PENDING.`);
  }

  const existingRecount = await prisma.countSlip.findFirst({ where: { referenceType: "CycleCountRecord", referenceId: record.id, role: "CYCLE_COUNT_RECOUNT" } });
  if (existingRecount) throw new CycleCountSlipAlreadySubmittedError("A recount has already been submitted and is read-only.");

  const priorSlips = await prisma.countSlip.findMany({
    where: { referenceType: "CycleCountRecord", referenceId: record.id, role: { in: ["CYCLE_COUNT_PRIMARY", "CYCLE_COUNT_SECONDARY", "TIEBREAK"] } },
  });
  if (priorSlips.some((s) => s.countedBy === params.actorUserId)) {
    throw new RecounterMustDifferFromPriorCountersError("The recount must be performed by someone who did not already count this item (primary, secondary, or tie-break).");
  }

  return prisma.$transaction(async (tx) => {
    await tx.countSlip.create({
      data: {
        referenceType: "CycleCountRecord",
        referenceId: record.id,
        role: "CYCLE_COUNT_RECOUNT",
        countedBy: params.actorUserId,
        completedAt: params.completedAt,
        collectedBy: params.collectedBy,
        submissionMethod: params.submissionMethod,
        lines: { create: [{ productVariantId: record.productVariantId, countedQty: params.countedQty }] },
      },
    });

    const discrepancyCase = await tx.discrepancyCase.create({
      data: {
        referenceType: "CycleCountRecord",
        referenceId: record.id,
        openedBy: params.actorUserId,
        notes: `Cycle count variance confirmed on recount: system expected ${record.systemExpectedQty?.toString()}, recount found ${params.countedQty} (class ${record.cycleCountClass}).`,
      },
    });

    const updated = await tx.cycleCountRecord.update({
      where: { id: record.id },
      data: { decisiveCountedQty: params.countedQty, status: "VARIANCE_CONFIRMED", discrepancyCaseId: discrepancyCase.id },
    });

    if (record.cycleCountScheduleId) {
      await markCycleCountScheduleCounted(tx, {
        cycleCountScheduleId: record.cycleCountScheduleId,
        cycleCountClass: record.cycleCountClass,
      });
    }

    return updated;
  });
}
