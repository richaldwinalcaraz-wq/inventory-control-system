const FORMATS = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "Excel" },
  { format: "pdf", label: "PDF" },
] as const;

/** Download links for a report registered in server/application/reporting/export/registry.ts. */
export function ExportLinks({ reportId, extraParams }: { reportId: string; extraParams?: Record<string, string> }) {
  const query = new URLSearchParams(extraParams);
  return (
    <div className="flex items-center gap-2">
      {FORMATS.map(({ format, label }) => {
        query.set("format", format);
        return (
          <a
            key={format}
            href={`/api/v1/reports/${reportId}/export?${query.toString()}`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
          >
            {label}
          </a>
        );
      })}
    </div>
  );
}
