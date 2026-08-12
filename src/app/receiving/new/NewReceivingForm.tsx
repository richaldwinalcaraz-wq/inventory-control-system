"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Line {
  productVariantId: string;
  expectedQty: string;
  unitCost: string;
}

export function NewReceivingForm({
  suppliers,
  variants,
}: {
  suppliers: Array<{ id: string; name: string }>;
  variants: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [drNumber, setDrNumber] = useState("");
  const [poReference, setPoReference] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productVariantId: variants[0]?.id ?? "", expectedQty: "", unitCost: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { productVariantId: variants[0]?.id ?? "", expectedQty: "", unitCost: "" }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          drNumber,
          poReference: poReference || undefined,
          lines: lines.map((l) => ({
            productVariantId: l.productVariantId,
            expectedQty: l.expectedQty ? Number(l.expectedQty) : undefined,
            unitCost: Number(l.unitCost),
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not create the receiving report.");
        return;
      }
      router.push(`/receiving/${json.data.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Supplier</label>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required className="w-full rounded-md border border-slate-300 px-3 py-2">
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Delivery Receipt (DR) number</label>
        <input value={drNumber} onChange={(e) => setDrNumber(e.target.value)} required className="w-full rounded-md border border-slate-300 px-3 py-2" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">PO reference (optional)</label>
        <input value={poReference} onChange={(e) => setPoReference(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
        <p className="mt-1 text-xs text-slate-500">
          Leaving this blank means a supplier call-back must be confirmed (G-04) before this can be approved.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-slate-700">Line items</label>
        {lines.map((line, i) => (
          <div key={i} className="flex items-end gap-2 rounded-md border border-slate-200 p-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-slate-500">Product variant</label>
              <select
                value={line.productVariantId}
                onChange={(e) => updateLine(i, { productVariantId: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs text-slate-500">Expected qty</label>
              <input
                type="number"
                step="any"
                value={line.expectedQty}
                onChange={(e) => updateLine(i, { expectedQty: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs text-slate-500">Unit cost</label>
              <input
                type="number"
                step="any"
                required
                value={line.unitCost}
                onChange={(e) => updateLine(i, { unitCost: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            {lines.length > 1 ? (
              <button type="button" onClick={() => removeLine(i)} className="pb-2 text-sm text-red-600">
                Remove
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" onClick={addLine} className="self-start text-sm text-blue-700 hover:underline">
          + Add another line
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-base font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create Receiving Report"}
      </button>
    </form>
  );
}
