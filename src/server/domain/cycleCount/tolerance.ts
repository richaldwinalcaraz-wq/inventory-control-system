import type { CycleCountClass } from "@prisma/client";

// BPD sec.12.1 — Class A: 0-unit tolerance (any variance fails), B: 0.5%, C: 1%.
const TOLERANCE_PERCENT: Record<CycleCountClass, number> = { A: 0, B: 0.5, C: 1 };

export function computeToleranceExceeded(params: {
  cycleCountClass: CycleCountClass;
  systemExpectedQty: number;
  decisiveCountedQty: number;
}): boolean {
  const variance = Math.abs(params.decisiveCountedQty - params.systemExpectedQty);
  if (params.cycleCountClass === "A") return variance !== 0;
  const toleranceQty = params.systemExpectedQty * (TOLERANCE_PERCENT[params.cycleCountClass] / 100);
  return variance > toleranceQty;
}
