export type StatusTone = "neutral" | "warning" | "info" | "success" | "purple" | "critical" | "void";

const TONE_STYLES: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
  success: "bg-brand-100 text-brand-800",
  purple: "bg-purple-100 text-purple-800",
  critical: "bg-red-100 text-red-800",
  void: "bg-slate-200 text-slate-500 line-through",
};

/** Small status pill. Pass the domain status label plus which tone it maps to — keeps the traffic-light meaning explicit at each call site instead of a shared cross-domain status->color table. */
export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={`inline-block rounded px-2 py-1 text-xs font-medium ${TONE_STYLES[tone]}`}>
      {label}
    </span>
  );
}
