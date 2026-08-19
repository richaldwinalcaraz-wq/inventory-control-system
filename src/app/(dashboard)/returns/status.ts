import type { StatusTone } from "@/components/ui/StatusBadge";

export const RETURN_STATUS_TONE: Record<string, StatusTone> = {
  ISSUED: "neutral",
  GOODS_RECEIVED: "info",
  GRADING_DISPUTED: "critical",
  GRADED: "success",
  REJECTED_NOT_OURS: "void",
  VOID: "void",
  EXPIRED: "void",
};
