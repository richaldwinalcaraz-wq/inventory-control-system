"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const REASON_CODES: Array<{ value: string; label: string; direction: "positive" | "negative" | "either" }> = [
  { value: "ADJ_01", label: "ADJ-01 — Physical count variance (shortage)", direction: "negative" },
  { value: "ADJ_02", label: "ADJ-02 — Physical count variance (overage)", direction: "positive" },
  { value: "ADJ_03", label: "ADJ-03 — Damage found in storage", direction: "negative" },
  { value: "ADJ_04", label: "ADJ-04 — Encoding error correction", direction: "either" },
  { value: "ADJ_05", label: "ADJ-05 — Wrong variation / conversion posted", direction: "either" },
  { value: "ADJ_06", label: "ADJ-06 — Found stock (previously written off)", direction: "positive" },
  { value: "ADJ_07", label: "ADJ-07 — Sample / promotional / own use", direction: "negative" },
  { value: "ADJ_08", label: "ADJ-08 — Expiry / degradation", direction: "negative" },
  { value: "ADJ_09", label: "ADJ-09 — Repacking loss / conversion remainder", direction: "negative" },
  { value: "ADJ_10", label: "ADJ-10 — Theft / confirmed loss (always requires Owner approval)", direction: "negative" },
];

export function NewAdjustmentForm({
  variants,
  locations,
  damageReports,
}: {
  variants: Array<{ id: string; label: string }>;
  locations: Array<{ id: string; label: string }>;
  damageReports: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [productVariantId, setProductVariantId] = useState(variants[0]?.id ?? "");
  const [warehouseLocationId, setWarehouseLocationId] = useState(locations[0]?.id ?? "");
  const [reasonCode, setReasonCode] = useState(REASON_CODES[0]!.value);
  const [quantityMagnitude, setQuantityMagnitude] = useState("");
  const [reconciliationNotes, setReconciliationNotes] = useState("");
  const [damageReportId, setDamageReportId] = useState(damageReports[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedReason = REASON_CODES.find((r) => r.value === reasonCode)!;
  const isAdj03 = reasonCode === "ADJ_03";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const magnitude = Math.abs(Number(quantityMagnitude));
      const quantityDelta = selectedReason.direction === "negative" ? -magnitude : magnitude;
      const res = await fetch("/api/v1/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productVariantId,
          warehouseLocationId,
          reasonCode,
          quantityDelta,
          reconciliationNotes,
          damageReportId: isAdj03 ? damageReportId : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not create the adjustment request.");
        return;
      }
      router.push(`/adjustments/${json.data.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Product variant</label>
        <select value={productVariantId} onChange={(e) => setProductVariantId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Location</label>
        <select value={warehouseLocationId} onChange={(e) => setWarehouseLocationId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Reason code</label>
        <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
          {REASON_CODES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {isAdj03 ? (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Linked damage report (required — ADJ-03 write-offs go through Damage &amp; Disposal now)</label>
          {damageReports.length === 0 ? (
            <p className="text-xs text-amber-700">No fully-disposed damage reports available to link yet. Complete a Disposal Certificate first.</p>
          ) : (
            <select value={damageReportId} onChange={(e) => setDamageReportId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
              {damageReports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : null}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Quantity {selectedReason.direction !== "either" ? `(${selectedReason.direction})` : "(sign follows the reason)"}
        </label>
        <input
          type="number"
          step="any"
          min="0"
          required
          value={quantityMagnitude}
          onChange={(e) => setQuantityMagnitude(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">Enter the magnitude — the direction is applied automatically from the reason code above.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Search &amp; reconcile notes (required — A-1)</label>
        <textarea
          required
          value={reconciliationNotes}
          onChange={(e) => setReconciliationNotes(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
          placeholder="What was checked before concluding an adjustment is needed — unencoded documents, wrong location, wrong variation, unconfirmed transfers, staged-but-unreleased, returns pending..."
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || (isAdj03 && !damageReportId)}
        className="mt-2 rounded-md bg-brand-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit for Investigation"}
      </button>
    </form>
  );
}
