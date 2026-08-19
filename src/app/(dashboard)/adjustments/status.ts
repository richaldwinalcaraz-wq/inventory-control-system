import type { StatusTone } from "@/components/ui/StatusBadge";

export const ADJUSTMENT_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  PENDING_INVESTIGATION: "warning",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  PENDING_POSTING: "info",
  POSTED: "success",
  REJECTED: "neutral",
  VOID: "void",
};
