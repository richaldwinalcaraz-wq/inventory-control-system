"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Line {
  productVariantId: string;
  orderedQty: string;
}

export function NewSalesOrderForm({
  variants,
  customers,
}: {
  variants: Array<{ id: string; label: string }>;
  customers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([{ productVariantId: variants[0]?.id ?? "", orderedQty: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { productVariantId: variants[0]?.id ?? "", orderedQty: "" }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/sales-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          lines: lines.map((l) => ({ productVariantId: l.productVariantId, orderedQty: Number(l.orderedQty) })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not create the order.");
        return;
      }
      router.push(`/wholesale/${json.data.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Customer</label>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2">
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

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
              <label className="mb-1 block text-xs text-slate-500">Ordered qty</label>
              <input
                type="number"
                step="any"
                required
                value={line.orderedQty}
                onChange={(e) => updateLine(i, { orderedQty: e.target.value })}
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
        {pending ? "Creating…" : "Create Order"}
      </button>
    </form>
  );
}
