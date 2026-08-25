import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

const WINDOW_DAYS = 90; // matches the Damage-vs-Shrinkage report's trailing-window convention

/**
 * Reason codes the schema's own enum comments annotate "(Negative)" —
 * genuine unexplained loss, matching the glossary's "loss of inventory with
 * no matching transaction" (business-process-design.md sec.B-1/glossary).
 * ADJ_07 (sample/promotional/own use) is deliberately excluded: it's an
 * authorized business consumption with a stated reason, not shrinkage.
 * ADJ_04/ADJ_05 ("Either") are corrections, not loss, and excluded too.
 *
 * PLACEHOLDER FORMULA, same posture as TRANSIT_EVIDENCE_THRESHOLD_PESOS —
 * BPD states the *target* ("shrinkage ≤ 0.5% of COGS/year", B-1) but never
 * specifies the calculation itself. This is a defensible, documented
 * interpretation pending client confirmation, not a value taken from BPD:
 *   shrinkage value = SUM(AdjustmentRequest.value) for POSTED loss-coded
 *     adjustments in the window
 *   COGS = SUM(|quantityDeltaBase| * unitCostAtMovement) for SALE_OUT
 *     StockLedger rows in the window — the only ledger movement type that
 *     represents cost of goods actually sold.
 */
const SHRINKAGE_REASON_CODES = ["ADJ_01", "ADJ_03", "ADJ_08", "ADJ_09", "ADJ_10"] as const;

export interface ShrinkageRateRow {
  branchId: string;
  branchCode: string;
  branchName: string;
  windowDays: number;
  shrinkageValue: string;
  cogs: string;
  shrinkageRatePercent: number | null; // null when COGS is 0 (no sales in window — rate is undefined, not zero)
}

export async function getShrinkageRateKpi(prisma: PrismaClient, params: { actorRole: RoleName }): Promise<ShrinkageRateRow[]> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.shrinkage-rate.view" });

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true } });

  const [shortageAdjustments, saleMovements] = await Promise.all([
    prisma.adjustmentRequest.findMany({
      where: { status: "POSTED", reasonCode: { in: [...SHRINKAGE_REASON_CODES] }, createdAt: { gte: windowStart } },
      select: { branchId: true, value: true },
    }),
    prisma.stockLedger.findMany({
      where: { movementType: "SALE_OUT", createdAt: { gte: windowStart } },
      select: { branchId: true, quantityDeltaBase: true, unitCostAtMovement: true },
    }),
  ]);

  const shrinkageByBranch = new Map<string, number>();
  for (const a of shortageAdjustments) {
    shrinkageByBranch.set(a.branchId, (shrinkageByBranch.get(a.branchId) ?? 0) + Number(a.value));
  }

  const cogsByBranch = new Map<string, number>();
  for (const m of saleMovements) {
    const cost = Math.abs(Number(m.quantityDeltaBase)) * Number(m.unitCostAtMovement);
    cogsByBranch.set(m.branchId, (cogsByBranch.get(m.branchId) ?? 0) + cost);
  }

  return branches
    .map((b) => {
      const shrinkageValue = shrinkageByBranch.get(b.id) ?? 0;
      const cogs = cogsByBranch.get(b.id) ?? 0;
      return {
        branchId: b.id,
        branchCode: b.code,
        branchName: b.name,
        windowDays: WINDOW_DAYS,
        shrinkageValue: shrinkageValue.toFixed(2),
        cogs: cogs.toFixed(2),
        shrinkageRatePercent: cogs === 0 ? null : Math.round((shrinkageValue / cogs) * 10000) / 100,
      };
    })
    .sort((a, b) => a.branchCode.localeCompare(b.branchCode));
}
