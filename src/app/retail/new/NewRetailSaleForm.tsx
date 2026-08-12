"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Line {
  productVariantId: string;
  quantity: string;
}

export function NewRetailSaleForm({ variants }: { variants: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([{ productVariantId: variants[0]?.id ?? "", quantity: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { productVariantId: variants[0]?.id ?? "", quantity: "" }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/retail-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({ productVariantId: l.productVariantId, quantity: Number(l.quantity) })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not create the sale.");
        return;
      }
      router.push(`/retail/${json.data.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-slate-700">Items</label>
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
              <label className="mb-1 block text-xs text-slate-500">Quantity</label>
              <input
                type="number"
                step="any"
                required
                value={line.quantity}
                onChange={(e) => updateLine(i, { quantity: e.target.value })}
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
          + Add another item
        </button>
      </div>

      <p className="text-xs text-slate-500">List price only — no discounts in this phase. Price is captured automatically at list price when the sale is created.</p>

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
        {pending ? "Creating…" : "Start Sale"}
      </button>
    </form>
  );
}
