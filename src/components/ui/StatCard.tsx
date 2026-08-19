import type { ReactNode } from "react";

export type StatAccent = "brand" | "warning" | "critical" | "info";

const ACCENT_BORDER: Record<StatAccent, string> = {
  brand: "border-t-brand-600",
  warning: "border-t-amber-500",
  critical: "border-t-red-500",
  info: "border-t-blue-500",
};

const ACCENT_ICON_BG: Record<StatAccent, string> = {
  brand: "bg-brand-50 text-brand-700",
  warning: "bg-amber-50 text-amber-600",
  critical: "bg-red-50 text-red-600",
  info: "bg-blue-50 text-blue-600",
};

export function StatCard({
  label,
  value,
  sublabel,
  accent,
  icon,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  accent: StatAccent;
  icon: ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 border-t-4 bg-white p-5 ${ACCENT_BORDER[accent]}`}>
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-md ${ACCENT_ICON_BG[accent]}`}>
        {icon}
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
      {sublabel ? <p className="mt-1 text-xs text-slate-400">{sublabel}</p> : null}
    </div>
  );
}
