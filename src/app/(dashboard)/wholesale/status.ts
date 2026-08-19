import type { StatusTone } from "@/components/ui/StatusBadge";

export const WHOLESALE_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  CONFIRMED: "neutral",
  RESERVED: "info",
  PICKING: "info",
  STAGED: "warning",
  CHECKED: "warning",
  PENDING_RELEASE_APPROVAL: "warning",
  RELEASED_PARTIAL: "purple",
  RELEASED: "success",
  VOID: "void",
};
