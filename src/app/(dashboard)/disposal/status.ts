import type { StatusTone } from "@/components/ui/StatusBadge";

export const DAMAGE_REPORT_STATUS_TONE: Record<string, StatusTone> = {
  REPORTED: "neutral",
  INVESTIGATED: "info",
  DISPOSED: "success",
  CLOSED: "void",
};

export const DISPOSAL_CERTIFICATE_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  FOR_DISPOSAL: "warning",
  POSTED: "success",
  VOID: "void",
};
