"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SOURCE_TYPES = [
  { value: "RECEIVING", label: "Receiving" },
  { value: "STORAGE", label: "Storage" },
  { value: "RETURN", label: "Customer return" },
  { value: "HANDLING", label: "Handling" },
] as const;

export function NewDamageReportForm({
  variants,
  locations,
}: {
  variants: Array<{ id: string; label: string }>;
  locations: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [productVariantId, setProductVariantId] = useState(variants[0]?.id ?? "");
  const [warehouseLocationId, setWarehouseLocationId] = useState(locations[0]?.id ?? "");
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]["value"]>("STORAGE");
  const [quantity, setQuantity] = useState("");
  const [cause, setCause] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/disposal/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productVariantId, warehouseLocationId, sourceType, quantity: Number(quantity), cause }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not create the damage report.");
        return;
      }
      router.push(`/disposal/${json.data.id}`);
    } finally {
      setPending(false);
    }
  }

  if (variants.length === 0 || locations.length === 0) {
    return <p className="text-sm text-slate-500">No products or warehouse locations are configured yet.</p>;
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
        <label className="mb-1 block text-sm font-medium text-slate-700">Source</label>
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value as typeof sourceType)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
          {SOURCE_TYPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Quantity</label>
        <input
          type="number"
          step="any"
          min="0"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Cause (required — no-fault reporting, but "Damaged" alone is not acceptable)</label>
        <textarea
          required
          value={cause}
          onChange={(e) => setCause(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
          placeholder="What happened — e.g. forklift impact during restacking, water damage from roof leak, torn packaging on arrival..."
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-brand-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {pending ? "Reporting…" : "Report Damage"}
      </button>
    </form>
  );
}
