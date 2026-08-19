"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinTokenField } from "@/components/PinTokenField";

interface OrderLine {
  id: string;
  productVariantId: string;
  sku: string;
  orderedQty: string;
  checkedQty: string | null;
  releasedQty: string;
}

interface OrderData {
  id: string;
  status: string;
  pickedBy: string | null;
  spotRecountRequired: boolean;
  hasActiveReleases: boolean;
  lines: OrderLine[];
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Request failed.");
  return json.data;
}

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-slate-200 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

export function SalesOrderActionPanel({ order, currentUser }: { order: OrderData; currentUser: { id: string; role: string } }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickQtys, setPickQtys] = useState<Record<string, string>>(Object.fromEntries(order.lines.map((l) => [l.id, l.orderedQty])));
  const [checkQtys, setCheckQtys] = useState<Record<string, string>>(Object.fromEntries(order.lines.map((l) => [l.productVariantId, ""])));
  const [spotQtys, setSpotQtys] = useState<Record<string, string>>(Object.fromEntries(order.lines.map((l) => [l.productVariantId, ""])));
  const [releaseQtys, setReleaseQtys] = useState<Record<string, string>>(Object.fromEntries(order.lines.map((l) => [l.id, ""])));
  const [pinTokenId, setPinTokenId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      setPinTokenId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const cards: React.ReactNode[] = [];

  if (order.status === "DRAFT" && currentUser.role === "SALES_REP") {
    cards.push(
      <ActionCard key="confirm" title="Confirm order">
        <button disabled={pending} onClick={() => run(() => postJson(`/api/v1/sales-orders/${order.id}/confirm`, {}))} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          Confirm
        </button>
      </ActionCard>,
    );
  }

  if (order.status === "CONFIRMED" && currentUser.role === "WAREHOUSE_SUPERVISOR") {
    cards.push(
      <ActionCard key="reserve" title="Reserve stock">
        <button disabled={pending} onClick={() => run(() => postJson(`/api/v1/sales-orders/${order.id}/reserve`, {}))} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          Reserve
        </button>
      </ActionCard>,
    );
  }

  if (order.status === "RESERVED" && currentUser.role === "WAREHOUSE_PICKER") {
    cards.push(
      <ActionCard key="pick" title="Pick order">
        <div className="flex flex-col gap-2">
          {order.lines.map((l) => (
            <div key={l.id} className="flex items-center gap-2">
              <span className="w-40 text-sm">{l.sku}</span>
              <input
                type="number"
                step="any"
                value={pickQtys[l.id] ?? ""}
                onChange={(e) => setPickQtys((prev) => ({ ...prev, [l.id]: e.target.value }))}
                className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
          ))}
        </div>
        <button
          disabled={pending}
          onClick={() =>
            run(() =>
              postJson(`/api/v1/sales-orders/${order.id}/pick`, {
                lines: order.lines.map((l) => ({ salesOrderLineId: l.id, pickedQty: Number(pickQtys[l.id] ?? 0) })),
              }),
            )
          }
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Submit Picking List
        </button>
      </ActionCard>,
    );
  }

  if (order.status === "STAGED" && currentUser.role === "WAREHOUSE_CHECKER") {
    const isPicker = order.pickedBy === currentUser.id;
    cards.push(
      <ActionCard key="check" title="Blind checker recount">
        {isPicker ? (
          <p className="text-sm text-red-600">You picked this order — a different person must perform the check (SoD).</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-500">Count independently against the order — the picker&apos;s figures are not shown to you.</p>
            <div className="flex flex-col gap-2">
              {order.lines.map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <span className="w-40 text-sm">{l.sku}</span>
                  <input
                    type="number"
                    step="any"
                    value={checkQtys[l.productVariantId] ?? ""}
                    onChange={(e) => setCheckQtys((prev) => ({ ...prev, [l.productVariantId]: e.target.value }))}
                    className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              ))}
            </div>
            <button
              disabled={pending}
              onClick={() =>
                run(() =>
                  postJson(`/api/v1/sales-orders/${order.id}/check`, {
                    lines: order.lines.map((l) => ({ productVariantId: l.productVariantId, countedQty: Number(checkQtys[l.productVariantId] ?? 0) })),
                  }),
                )
              }
              className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              Submit Count
            </button>
          </>
        )}
      </ActionCard>,
    );
  }

  if (order.status === "CHECKED") {
    if (order.spotRecountRequired && (currentUser.role === "WAREHOUSE_SUPERVISOR" || currentUser.role === "AUDITOR")) {
      cards.push(
        <ActionCard key="spot" title="Independent spot recount (G-10 — randomly flagged)">
          <p className="mb-2 text-xs text-slate-500">You must have had no role in picking, checking, or authorizing any order at this branch today.</p>
          <div className="flex flex-col gap-2">
            {order.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <span className="w-40 text-sm">{l.sku}</span>
                <input
                  type="number"
                  step="any"
                  value={spotQtys[l.productVariantId] ?? ""}
                  onChange={(e) => setSpotQtys((prev) => ({ ...prev, [l.productVariantId]: e.target.value }))}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
            ))}
          </div>
          <button
            disabled={pending}
            onClick={() =>
              run(() =>
                postJson(`/api/v1/sales-orders/${order.id}/spot-recount`, {
                  lines: order.lines.map((l) => ({ productVariantId: l.productVariantId, countedQty: Number(spotQtys[l.productVariantId] ?? 0) })),
                }),
              )
            }
            className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Submit Spot Recount
          </button>
        </ActionCard>,
      );
    }

    if (currentUser.role === "WAREHOUSE_SUPERVISOR") {
      cards.push(
        <ActionCard key="authorize" title="Authorize release">
          <button disabled={pending} onClick={() => run(() => postJson(`/api/v1/sales-orders/${order.id}/authorize-release`, {}))} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            Authorize
          </button>
        </ActionCard>,
      );
    }
  }

  if ((order.status === "PENDING_RELEASE_APPROVAL" || order.status === "RELEASED_PARTIAL") && currentUser.role === "WAREHOUSE_SUPERVISOR") {
    cards.push(
      <ActionCard key="release" title="Create release (supports partial delivery)">
        <div className="flex flex-col gap-2">
          {order.lines.map((l) => {
            const remaining = Number(l.checkedQty ?? 0) - Number(l.releasedQty);
            return (
              <div key={l.id} className="flex items-center gap-2">
                <span className="w-40 text-sm">
                  {l.sku} <span className="text-xs text-slate-400">(remaining: {remaining})</span>
                </span>
                <input
                  type="number"
                  step="any"
                  value={releaseQtys[l.id] ?? ""}
                  onChange={(e) => setReleaseQtys((prev) => ({ ...prev, [l.id]: e.target.value }))}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <PinTokenField tokenId={pinTokenId} onTokenIssued={setPinTokenId} />
        </div>
        <button
          disabled={pending || !pinTokenId}
          onClick={() =>
            run(async () => {
              const lines = order.lines
                .map((l) => ({ salesOrderLineId: l.id, qty: Number(releaseQtys[l.id] ?? 0) }))
                .filter((l) => l.qty > 0);
              const result = await postJson(`/api/v1/sales-orders/${order.id}/releases`, { lines, pinTokenId });
              router.push(`/wholesale/releases/${result.id}`);
            })
          }
          className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Create Release
        </button>
      </ActionCard>,
    );
  }

  const canVoid = (currentUser.role === "BRANCH_MANAGER" || currentUser.role === "OWNER") && order.status !== "VOID" && !order.hasActiveReleases;
  if (canVoid) {
    cards.push(
      <ActionCard key="void" title="Void this order">
        <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason" className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none" />
        <button
          disabled={pending || !voidReason}
          onClick={() => run(() => postJson(`/api/v1/sales-orders/${order.id}/void`, { reason: voidReason }))}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Void
        </button>
      </ActionCard>,
    );
  }

  if (order.status === "VOID") {
    cards.push(
      <ActionCard key="void-status" title="Void">
        <p className="text-sm text-slate-500">This order has been voided.</p>
      </ActionCard>,
    );
  }

  return (
    <div className="flex flex-col">
      {error ? (
        <p className="mb-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {cards.length === 0 ? <p className="text-sm text-slate-500">No action available for your role at this stage.</p> : cards}
    </div>
  );
}
