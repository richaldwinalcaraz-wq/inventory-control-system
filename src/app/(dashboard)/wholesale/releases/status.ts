import type { StatusTone } from "@/components/ui/StatusBadge";

export const RELEASE_STATUS_TONE: Record<string, StatusTone> = {
  PENDING_GATE_CHECK: "warning",
  RELEASED: "info",
  POSTED: "success",
  VOID: "void",
};
