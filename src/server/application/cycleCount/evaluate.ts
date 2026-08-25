import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { computeToleranceExceeded } from "../../domain/cycleCount/tolerance";
import { markCycleCountScheduleCounted } from "./schedule";
import { CycleCountRecordNotFoundError, InvalidCycleCountRecordStateError } from "./submitCount";

export class BothCountsRequiredError extends Error {}

export interface EvaluateCycleCountVarianceParams {
  actorRole: RoleName;
  cycleCountRecordId: string;
}

/**
 * "Count first, compare after" — systemExpectedQty is deliberately not
 * computed until this exact call, live off StockBalance, and frozen from
 * then on (Phase 4 plan sec.2.2 step 3). Requires status COUNTING (i.e.
 * primary/secondary agreed, or a tie-break already resolved a
 * disagreement) and both a primary and secondary slip to actually exist —
 * COUNTING is also the record's brand-new starting status, so status alone
 * doesn't guarantee a secondary slip was ever submitted.
 */
export async function evaluateCycleCountVariance(prisma: PrismaClient, params: EvaluateCycleCountVarianceParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.evaluate.create" });

  const record = await prisma.cycleCountRecord.findUnique({ where: { id: params.cycleCountRecordId } });
  if (!record) throw new CycleCountRecordNotFoundError(params.cycleCountRecordId);
  if (record.status !== "COUNTING") {
    throw new InvalidCycleCountRecordStateError(`Cannot evaluate a record that is ${record.status} — it must be COUNTING.`);
  }

  const slips = await prisma.countSlip.findMany({
    where: { referenceType: "CycleCountRecord", referenceId: record.id },
    include: { lines: true },
  });
  const primarySlip = slips.find((s) => s.role === "CYCLE_COUNT_PRIMARY");
  const secondarySlip = slips.find((s) => s.role === "CYCLE_COUNT_SECONDARY");
  const tiebreakSlip = slips.find((s) => s.role === "TIEBREAK");
  if (!primarySlip || !secondarySlip) {
    throw new BothCountsRequiredError("Both a primary and secondary count are required before evaluation.");
  }

  const decisiveSlip = tiebreakSlip ?? primarySlip;
  const decisiveCountedQty = Number(decisiveSlip.lines[0]?.countedQty ?? 0);

  return prisma.$transaction(async (tx) => {
    const balance = await tx.stockBalance.aggregate({
      where: { productVariantId: record.productVariantId, warehouseLocationId: record.warehouseLocationId },
      _sum: { quantityOnHand: true },
    });
    const systemExpectedQty = Number(balance._sum.quantityOnHand ?? 0);

    const toleranceExceeded = computeToleranceExceeded({
      cycleCountClass: record.cycleCountClass,
      systemExpectedQty,
      decisiveCountedQty,
    });

    const updated = await tx.cycleCountRecord.update({
      where: { id: record.id },
      data: {
        systemExpectedQty,
        decisiveCountedQty,
        toleranceExceeded,
        status: toleranceExceeded ? "RECOUNT_PENDING" : "CLOSED_CLEAN",
      },
    });

    // On a clean close, the item was physically counted on time — mark the
    // schedule counted now. On a variance, deliberately NOT marked yet:
    // recount.ts does it once VARIANCE_CONFIRMED, so a record that never
    // gets its required recount doesn't silently look "on schedule."
    if (!toleranceExceeded && record.cycleCountScheduleId) {
      await markCycleCountScheduleCounted(tx, {
        cycleCountScheduleId: record.cycleCountScheduleId,
        cycleCountClass: record.cycleCountClass,
      });
    }

    return updated;
  });
}
