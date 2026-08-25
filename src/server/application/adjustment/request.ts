import type { AdjustmentReasonCode, PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { resolveRequiredApprover } from "../../domain/approval/resolveRequiredApprover";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { lockAdjustmentVelocity, computeRollingAdjustmentTotal, downgradeInsufficientApprovedSiblings } from "../../domain/adjustment/velocity";

export class AdjustmentRequestNotFoundError extends Error {}
export class InvalidAdjustmentStateError extends Error {}
export class ReconciliationNotesRequiredError extends Error {}
export class WrongAdjustmentDirectionError extends Error {}
export class DamageReportRequiredForAdj03Error extends Error {}

const A8_WINDOW_DAYS = 90;
const A8_THRESHOLD_COUNT = 3;

// Fixed direction per business-process-design.md sec.10.2 — ADJ_04/ADJ_05
// deliberately omitted (BPD lists them as "Either").
const FIXED_DIRECTION: Partial<Record<AdjustmentReasonCode, "POSITIVE" | "NEGATIVE">> = {
  ADJ_01: "NEGATIVE",
  ADJ_02: "POSITIVE",
  ADJ_03: "NEGATIVE",
  ADJ_06: "POSITIVE",
  ADJ_07: "NEGATIVE",
  ADJ_08: "NEGATIVE",
  ADJ_09: "NEGATIVE",
  ADJ_10: "NEGATIVE",
};

export interface RequestAdjustmentParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  productVariantId: string;
  warehouseLocationId: string;
  reasonCode: AdjustmentReasonCode;
  quantityDelta: number;
  reconciliationNotes: string;
  damageReportId?: string;
  /** Phase 4: paper-trail link back to the CycleCountRecord this write-off resolves — reuses ADJ_01/ADJ_02, never a dedicated reason code. */
  cycleCountRecordId?: string;
}

/**
 * BPD sec.10 steps 1-4: freeze the item, recount, search & reconcile
 * (A-1 — reconciliationNotes is mandatory, never optional), then raise the
 * request. Never the first response to a discrepancy — this function
 * assumes that search-and-reconcile has already happened; it only enforces
 * that it was documented, not that it actually occurred (no technical hook
 * exists to verify that without much larger scope).
 */
export async function requestAdjustment(prisma: PrismaClient, params: RequestAdjustmentParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "adjustment.request.create" });

  const notes = params.reconciliationNotes?.trim();
  if (!notes) {
    throw new ReconciliationNotesRequiredError("Search-and-reconcile notes are required before an adjustment can be requested (A-1).");
  }

  const fixedDirection = FIXED_DIRECTION[params.reasonCode];
  if (fixedDirection === "POSITIVE" && params.quantityDelta <= 0) {
    throw new WrongAdjustmentDirectionError(`${params.reasonCode} must be a positive quantity delta.`);
  }
  if (fixedDirection === "NEGATIVE" && params.quantityDelta >= 0) {
    throw new WrongAdjustmentDirectionError(`${params.reasonCode} must be a negative quantity delta.`);
  }
  if (params.quantityDelta === 0) {
    throw new WrongAdjustmentDirectionError("An adjustment must have a non-zero quantity delta.");
  }

  // ADJ_03 retirement (Phase 3): "Damage found in storage" is no longer an
  // independent write-off path now that Damage & Disposal has real
  // controls (two witnesses, evidence, benchmarked scrap pricing). A
  // linked DamageReport is required from the moment the request is raised
  // — adjustment/post.ts separately re-checks that the report is fully
  // disposed before this can ever post as a ledger no-op.
  if (params.reasonCode === "ADJ_03") {
    if (!params.damageReportId) {
      throw new DamageReportRequiredForAdj03Error("ADJ_03 requires a linked DamageReport — damage write-offs go through Damage & Disposal now.");
    }
    const report = await prisma.damageReport.findUnique({ where: { id: params.damageReportId } });
    if (!report) throw new DamageReportRequiredForAdj03Error(`DamageReport ${params.damageReportId} was not found.`);
  }

  return prisma.$transaction(async (tx) => {
    // Held for the whole request-creation transaction so a concurrent
    // submission by the same requester can't compute a stale rolling total
    // (see downgrade step below).
    await lockAdjustmentVelocity(tx, params.actorUserId);

    const unitCost = await getCurrentUnitCost(tx, {
      productVariantId: params.productVariantId,
      warehouseLocationId: params.warehouseLocationId,
    });
    const value = Math.abs(params.quantityDelta) * Number(unitCost);

    const created = await tx.adjustmentRequest.create({
      data: {
        branchId: params.branchId,
        productVariantId: params.productVariantId,
        warehouseLocationId: params.warehouseLocationId,
        reasonCode: params.reasonCode,
        quantityDelta: params.quantityDelta,
        unitCostAtRequest: unitCost,
        value,
        reconciliationNotes: notes,
        status: "PENDING_INVESTIGATION",
        requestedBy: params.actorUserId,
        damageReportId: params.damageReportId,
        cycleCountRecordId: params.cycleCountRecordId,
      },
    });

    // A-8: 3+ adjustments on the same product/location within a rolling
    // 90 days auto-opens an investigation, reusing the existing minimal
    // DiscrepancyCase table exactly as-is.
    const since90 = new Date(Date.now() - A8_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const priorCount = await tx.adjustmentRequest.count({
      where: {
        productVariantId: params.productVariantId,
        warehouseLocationId: params.warehouseLocationId,
        status: { notIn: ["VOID", "REJECTED"] },
        createdAt: { gte: since90 },
      },
    });
    if (priorCount >= A8_THRESHOLD_COUNT) {
      await tx.discrepancyCase.create({
        data: {
          referenceType: "AdjustmentRequest",
          referenceId: created.id,
          openedBy: params.actorUserId,
          notes: `A-8: ${priorCount} adjustments on this product/location within the trailing ${A8_WINDOW_DAYS} days — auto-flagged for Auditor review.`,
        },
      });
    }

    // G-21: this new request can only ever push the requester's rolling
    // total up. Recompute now and pull back any already-APPROVED sibling
    // whose granted tier is no longer sufficient.
    const rollingTotal = await computeRollingAdjustmentTotal(tx, params.actorUserId);
    const threshold = await resolveRequiredApprover(tx, { branchId: params.branchId, transactionType: "ADJUSTMENT", value: rollingTotal });
    const requiredTier = params.reasonCode === "ADJ_10" ? "OWNER" : threshold.requiredApproverRole; // A-5: theft always Owner
    await downgradeInsufficientApprovedSiblings(tx, { requesterId: params.actorUserId, excludeRequestId: created.id, requiredTier });

    return created;
  });
}
