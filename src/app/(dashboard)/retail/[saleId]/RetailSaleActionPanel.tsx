"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinTokenField } from "@/components/PinTokenField";

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Request failed.");
  return json.data;
}

export function RetailSaleActionPanel({
  saleId,
  status,
  currentUserRole,
}: {
  saleId: string;
  status: string;
  currentUserRole: string;
}) {
  const router = useRouter();
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidWithoutReturnReason, setVoidWithoutReturnReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (status === "POSTED") {
    const canVoidWithoutReturn = currentUserRole === "BRANCH_MANAGER" || currentUserRole === "OWNER";
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-green-700">This sale has been posted to the stock ledger.</p>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {canVoidWithoutReturn ? (
          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Void without goods returned (G-12)</h2>
            <p className="mb-3 text-xs text-slate-500">
              Goods already left and are not physically coming back. This does not reverse the sale&apos;s stock movement — it voids the sale and
              raises a separate, independently-approved shortage adjustment (ADJ-01) for the loss. If goods ARE coming back, use Customer Returns
              instead.
            </p>
            <input
              value={voidWithoutReturnReason}
              onChange={(e) => setVoidWithoutReturnReason(e.target.value)}
              placeholder="Reason"
              className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            />
            <button
              disabled={pending || !voidWithoutReturnReason}
              onClick={() => run(() => postJson(`/api/v1/retail-sales/${saleId}/void-without-return`, { reason: voidWithoutReturnReason }))}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Void without return
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  if (status === "VOID") {
    return <p className="text-sm text-slate-500">This sale has been voided.</p>;
  }

  const canPost = currentUserRole === "CASHIER";
  const canVoid = currentUserRole === "CASHIER" || currentUserRole === "BRANCH_MANAGER";

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {canPost ? (
        <div className="rounded-lg border border-slate-200 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Collect payment &amp; complete sale</h2>
          <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
          <button
            disabled={pending || !pinTokenId}
            onClick={() => run(() => postJson(`/api/v1/retail-sales/${saleId}/post`, { pinTokenId }))}
            className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Complete sale &amp; issue invoice
          </button>
        </div>
      ) : null}

      {canVoid ? (
        <div className="rounded-lg border border-slate-200 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Cancel this sale</h2>
          <input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Reason"
            className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
          />
          <button
            disabled={pending || !voidReason}
            onClick={() => run(() => postJson(`/api/v1/retail-sales/${saleId}/void`, { reason: voidReason }))}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Cancel sale
          </button>
        </div>
      ) : null}
    </div>
  );
}
