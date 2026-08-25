"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewProductForm({
  categories,
  units,
}: {
  categories: Array<{ id: string; label: string }>;
  units: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [baseUnitId, setBaseUnitId] = useState(units[0]?.id ?? "");
  const [cycleCountClass, setCycleCountClass] = useState<"A" | "B" | "C">("C");
  const [unitWeightKg, setUnitWeightKg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/inventory/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sku,
          barcode: barcode.trim() === "" ? undefined : barcode,
          sellingPrice: Number(sellingPrice),
          categoryId: categoryId === "" ? undefined : categoryId,
          baseUnitId,
          cycleCountClass,
          unitWeightKg: unitWeightKg.trim() === "" ? undefined : Number(unitWeightKg),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not create the product.");
        return;
      }
      router.push("/inventory");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Product name</label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">SKU</label>
          <input
            type="text"
            required
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Barcode (optional)</label>
          <input
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Base unit</label>
          <select value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} required className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Selling price (₱)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Cycle-count class</label>
          <select value={cycleCountClass} onChange={(e) => setCycleCountClass(e.target.value as "A" | "B" | "C")} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
            <option value="A">A — counted most often</option>
            <option value="B">B</option>
            <option value="C">C — counted least often</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Unit weight, kg (optional)</label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={unitWeightKg}
            onChange={(e) => setUnitWeightKg(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Required for wholesale release gate-weight checks — leave blank only for products never sold wholesale.
      </p>

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
        {pending ? "Creating…" : "Create Product"}
      </button>
    </form>
  );
}
