"use client";

import { useState } from "react";
import { PinTokenField } from "@/components/PinTokenField";

export function TransferForm({ variants }: { variants: Array<{ id: string; label: string }> }) {
  const [productVariantId, setProductVariantId] = useState(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/v1/inventory/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productVariantId, quantity: Number(quantity), pinTokenId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not transfer stock.");
        return;
      }
      setSuccess(true);
      setQuantity("");
      setPinTokenId(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Product variant</label>
        <select
          value={productVariantId}
          onChange={(e) => setProductVariantId(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Quantity (Storage → Counter)</label>
        <input
          type="number"
          step="any"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
        />
      </div>

      <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {success ? <p className="text-sm text-green-700">Transferred.</p> : null}

      <button
        disabled={pending || !pinTokenId || !quantity}
        type="submit"
        className="rounded-md bg-brand-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {pending ? "Transferring…" : "Transfer to Counter"}
      </button>
    </form>
  );
}
