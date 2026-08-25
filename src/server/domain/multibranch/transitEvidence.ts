// Placeholder pending client confirmation, same status as every other
// peso/rate default in this codebase (ApprovalThreshold.isPlaceholder,
// wholesale/spotRecount.ts's MATERIALITY_THRESHOLD_PESOS).
export const TRANSIT_EVIDENCE_THRESHOLD_PESOS = 20000;

/** G-35: transfers at or above this value require independent transit evidence, confirmed by the Auditor. */
export function computeTransitEvidenceRequired(transferValue: number): boolean {
  return transferValue >= TRANSIT_EVIDENCE_THRESHOLD_PESOS;
}
