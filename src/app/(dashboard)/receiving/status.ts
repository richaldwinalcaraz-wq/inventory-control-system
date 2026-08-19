import type { StatusTone } from "@/components/ui/StatusBadge";

export const RECEIVING_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  PENDING_INSPECTION: "warning",
  QUARANTINE: "critical",
  PENDING_VERIFICATION: "warning",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  PENDING_ENCODING: "info",
  POSTED: "success",
  VOID: "void",
};
