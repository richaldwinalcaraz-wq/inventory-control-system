"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinTokenField } from "@/components/PinTokenField";

const REASON_CODES = [
  { value: "WRONG_ITEM", label: "Wrong item" },
  { value: "WRONG_SIZE_GAUGE", label: "Wrong size / gauge" },
  { value: "DAMAGED_ON_DELIVERY", label: "Damaged on delivery" },
  { value: "DEFECTIVE", label: "Defective" },
  { value: "OVER_DELIVERED", label: "Over-delivered" },
  { value: "CUSTOMER_CANCELLED", label: "Customer cancelled" },
  { value: "UNSOLD_STOCK_RETURN", label: "Unsold stock return" },
] as const;

const IDENTITY_OPTIONS = [
  { value: "PHYSICAL_RECEIPT", label: "Physical receipt / invoice presented" },
  { value: "MATCHED_IDENTITY", label: "Customer identity matched on file" },
  { value: "NONE", label: "None — invoice number recall only (high risk)" },
] as const;

type EligibleLine = { originalSaleType: "RetailSale" | "SalesOrder"; originalSaleLineId: string; label: string };

export function NewReturnForm({ eligibleLines }: { eligibleLines: EligibleLine[] }) {
  const router = useRouter();
  const [lineKey, setLineKey] = useState(eligibleLines[0] ? `${eligibleLines[0].originalSaleType}:${eligibleLines[0].originalSaleLineId}` : "");
  const [requestedQty, setRequestedQty] = useState("");
  const [reasonCode, setReasonCode] = useState(REASON_CODES[0].value);
  const [identityVerification, setIdentityVerification] = useState<(typeof IDENTITY_OPTIONS)[number]["value"]>("PHYSICAL_RECEIPT");
  const [verifiedIdName, setVerifiedIdName] = useState("");
  const [verifiedIdContact, setVerifiedIdContact] = useState("");
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pinTokenId) return;
    setPending(true);
    setError(null);
    try {
      const [originalSaleType, originalSaleLineId] = lineKey.split(":") as ["RetailSale" | "SalesOrder", string];
      const res = await fetch("/api/v1/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalSaleType,
          originalSaleLineId,
          requestedQty: Number(requestedQty),
          reasonCode,
          identityVerification,
          verifiedIdName: verifiedIdName || undefined,
          verifiedIdContact: verifiedIdContact || undefined,
          pinTokenId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not issue the return authorization.");
        return;
      }
      router.push(`/returns/${json.data.returnAuthorization.id}`);
    } finally {
      setPending(false);
    }
  }

  if (eligibleLines.length === 0) {
    return <p className="text-sm text-slate-500">No posted retail sales or released wholesale lines are available to return against yet.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Original sale line</label>
        <select value={lineKey} onChange={(e) => setLineKey(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
          {eligibleLines.map((l) => (
            <option key={`${l.originalSaleType}:${l.originalSaleLineId}`} value={`${l.originalSaleType}:${l.originalSaleLineId}`}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Quantity to return</label>
        <input
          type="number"
          step="any"
          min="0"
          required
          value={requestedQty}
          onChange={(e) => setRequestedQty(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Reason</label>
        <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)} className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none">
          {REASON_CODES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Identity verification</label>
        <select
          value={identityVerification}
          onChange={(e) => setIdentityVerification(e.target.value as typeof identityVerification)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
        >
          {IDENTITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {identityVerification === "NONE" ? (
          <p className="mt-1 text-xs text-amber-700">This will be auto-flagged high risk and routed through the stricter approval tier (G-15).</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Verified ID name (optional)</label>
          <input
            value={verifiedIdName}
            onChange={(e) => setVerifiedIdName(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Verified ID contact (optional)</label>
          <input
            value={verifiedIdContact}
            onChange={(e) => setVerifiedIdContact(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none"
          />
        </div>
      </div>

      <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !pinTokenId}
        className="mt-2 rounded-md bg-brand-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {pending ? "Issuing…" : "Issue Return Authorization"}
      </button>
    </form>
  );
}
