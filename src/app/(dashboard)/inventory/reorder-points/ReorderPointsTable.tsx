"use client";

import { useState } from "react";
import type { ReorderPointRow } from "@/server/application/inventory/reorderPoints";

function EditableRow({ row }: { row: ReorderPointRow }) {
  const [value, setValue] = useState(row.reorderPoint ?? "");
  const [saved, setSaved] = useState(row.reorderPoint);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== (saved ?? "");

  async function save() {
    setPending(true);
    setError(null);
    try {
      const reorderPoint = value.trim() === "" ? null : Number(value);
      const res = await fetch("/api/v1/inventory/reorder-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productVariantId: row.productVariantId, reorderPoint }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not save.");
        return;
      }
      setSaved(json.data.reorderPoint);
      setValue(json.data.reorderPoint ?? "");
    } finally {
      setPending(false);
    }
  }

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-4 py-2 font-medium text-slate-900">{row.sku}</td>
      <td className="px-4 py-2">{row.productName}</td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="any"
          placeholder="Not monitored"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-32 rounded-md border border-slate-300 px-2 py-1 text-right text-sm focus:border-brand-600 focus:outline-none"
        />
      </td>
      <td className="px-4 py-2">
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={save}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {error ? <span className="ml-2 text-xs text-red-600">{error}</span> : null}
      </td>
    </tr>
  );
}

export function ReorderPointsTable({ rows }: { rows: ReorderPointRow[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-slate-50 text-slate-600">
        <tr>
          <th className="px-4 py-2">SKU</th>
          <th className="px-4 py-2">Product</th>
          <th className="px-4 py-2">Reorder point</th>
          <th className="px-4 py-2"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <EditableRow key={row.productVariantId} row={row} />
        ))}
      </tbody>
    </table>
  );
}
