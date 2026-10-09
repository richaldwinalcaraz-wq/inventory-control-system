"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { PackSizeCheck } from "@/components/catalog/PackSizeCheck";
import { peso } from "@/lib/money";
import { inputClass, labelClass, primaryButton, secondaryButton, sendJson } from "../../catalog/api";

export interface PanelUnit {
  unitId: string;
  unitCode: string;
  unitName: string;
  isBaseUnit: boolean;
  baseQtyPerUnit: number | null;
  /** Current all-branch WHOLESALE price. */
  price: string | null;
  /** Current all-branch RETAIL price. */
  retailPrice: string | null;
  pending: { conversionRateVersionId: string; rate: number; checksDone: number; canCheck: boolean } | null;
}

type Editing = { kind: "price"; unit: PanelUnit } | { kind: "size"; unit: PanelUnit } | { kind: "add" } | null;

const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 4 });

/** The variant's selling units: what it's sold in, how big each unit is, and its wholesale and retail prices. */
export function SellingUnitsPanel({
  variantId,
  baseUnit,
  units,
  addableUnits,
  canManage,
}: {
  variantId: string;
  baseUnit: { code: string; name: string };
  units: PanelUnit[];
  addableUnits: Array<{ id: string; code: string; name: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [price, setPrice] = useState("");
  const [retail, setRetail] = useState("");
  const [qty, setQty] = useState("");
  const [unitId, setUnitId] = useState(addableUnits[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function open(next: Editing) {
    setEditing(next);
    setMessage(null);
    setPrice(next?.kind === "price" && next.unit.price ? String(Number(next.unit.price)) : "");
    setRetail(next?.kind === "price" && next.unit.retailPrice ? String(Number(next.unit.retailPrice)) : "");
    setQty(next?.kind === "size" ? String(next.unit.pending?.rate ?? next.unit.baseQtyPerUnit ?? "") : "");
  }

  /** Runs one or more POSTs in order; stops at the first failure. */
  async function run(calls: Array<[url: string, body: unknown]>, ok: string) {
    setPending(true);
    setMessage(null);
    try {
      for (const [url, body] of calls) await sendJson(url, "POST", body);
      setEditing(null);
      setMessage({ tone: "ok", text: ok });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setPending(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const prices = `/api/v1/catalog/children/${variantId}/prices`;
    if (editing.kind === "price") {
      const u = editing.unit;
      const calls: Array<[string, unknown]> = [];
      if (price.trim() === "") {
        if (u.price) calls.push([`${prices}/remove`, { unitId: u.unitId, priceList: "WHOLESALE" }]);
      } else calls.push([prices, { unitId: u.unitId, priceList: "WHOLESALE", price: Number(price) }]);
      if (retail.trim() === "") {
        if (u.retailPrice) calls.push([`${prices}/remove`, { unitId: u.unitId, priceList: "RETAIL" }]);
      } else calls.push([prices, { unitId: u.unitId, priceList: "RETAIL", price: Number(retail) }]);
      void run(calls, `${u.unitName} prices saved. Old prices stay in the history.`);
    } else if (editing.kind === "size") {
      void run([[`/api/v1/catalog/children/${variantId}/pack-sizes`, { unitId: editing.unit.unitId, baseQtyPerUnit: Number(qty) }]], `New ${editing.unit.unitName.toLowerCase()} size proposed — it counts once two people have checked it.`);
    } else {
      const unit = addableUnits.find((u) => u.id === unitId);
      const body = { unitId, baseQtyPerUnit: Number(qty), price: Number(price), ...(retail.trim() !== "" ? { retailPrice: Number(retail) } : {}) };
      void run([[`/api/v1/catalog/children/${variantId}/selling-units`, body]], `${unit?.name ?? "Unit"} added. Its size counts once two people have checked it.`);
    }
  }

  const unitLabel = editing?.kind === "add" ? (addableUnits.find((u) => u.id === unitId)?.name ?? "unit") : (editing?.unit.unitName ?? "");

  return (
    <Card className="mb-6 overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Selling units &amp; prices</h2>
        {canManage && addableUnits.length > 0 && editing?.kind !== "add" ? (
          <button type="button" onClick={() => open({ kind: "add" })} className="text-sm font-medium text-brand-700 hover:underline">
            + Add selling unit
          </button>
        ) : null}
      </div>

      {message ? (
        <p role="status" className={`mx-4 mt-3 rounded-md px-3 py-2 text-sm ${message.tone === "ok" ? "bg-brand-50 text-brand-900" : "bg-red-50 text-red-800"}`}>
          {message.text}
        </p>
      ) : null}

      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-2">Unit</th>
            <th className="px-4 py-2">Contains</th>
            <th className="px-4 py-2 text-right">Wholesale</th>
            <th className="px-4 py-2 text-right">Retail</th>
            {canManage ? <th className="px-4 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.unitId} className="border-t border-slate-100 align-top">
              <td className="px-4 py-2 font-medium text-slate-900">
                {u.unitName}
                {u.isBaseUnit ? <span className="block text-xs font-normal text-slate-500">Stock is counted in this</span> : null}
              </td>
              <td className="px-4 py-2">
                {u.isBaseUnit ? (
                  <span className="text-slate-600">1 {baseUnit.code}</span>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {u.baseQtyPerUnit !== null ? <span className="text-slate-700">{fmt(u.baseQtyPerUnit)} {baseUnit.code}</span> : null}
                    {u.pending ? (
                      <div className="rounded-md bg-amber-50 px-2 py-1.5">
                        <span className="text-xs text-amber-900">
                          {u.baseQtyPerUnit !== null ? "Change pending" : "Waiting for checks"}: {fmt(u.pending.rate)} {baseUnit.code} ({u.pending.checksDone} of 2 checks)
                        </span>
                        {u.pending.canCheck ? (
                          <div className="mt-1.5">
                            <PackSizeCheck conversionRateVersionId={u.pending.conversionRateVersionId} unitName={u.unitName} baseUnitCode={baseUnit.code} rate={u.pending.rate} checksDone={u.pending.checksDone} />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {u.baseQtyPerUnit === null && !u.pending ? <span className="text-slate-400">Size not set</span> : null}
                  </div>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{u.price ? <span className="font-medium text-slate-900">{peso(u.price)}</span> : <span className="text-slate-400">Not sold</span>}</td>
              <td className="px-4 py-2 text-right tabular-nums">{u.retailPrice ? <span className="font-medium text-slate-900">{peso(u.retailPrice)}</span> : <span className="text-slate-400">Not sold</span>}</td>
              {canManage ? (
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-3 whitespace-nowrap text-sm">
                    <button type="button" onClick={() => open({ kind: "price", unit: u })} className="font-medium text-slate-700 hover:underline">
                      {u.price || u.retailPrice ? "Change prices" : "Set prices"}
                    </button>
                    {u.isBaseUnit ? null : (
                      <button type="button" onClick={() => open({ kind: "size", unit: u })} className="font-medium text-slate-700 hover:underline">
                        Change size
                      </button>
                    )}
                    {u.price || u.retailPrice ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            (["WHOLESALE", "RETAIL"] as const).map((priceList): [string, unknown] => [`/api/v1/catalog/children/${variantId}/prices/remove`, { unitId: u.unitId, priceList }]),
                            `No longer sold by the ${u.unitName.toLowerCase()}.`,
                          )
                        }
                        className="font-medium text-red-700 hover:underline disabled:opacity-50"
                      >
                        Stop selling
                      </button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {editing ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          {editing.kind === "add" ? (
            <div>
              <label htmlFor="su-unit" className={labelClass}>
                Unit
              </label>
              <select id="su-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
                {addableUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {editing.kind !== "price" ? (
            <div>
              <label htmlFor="su-qty" className={labelClass}>
                {baseUnit.code} in 1 {unitLabel} *
              </label>
              <input id="su-qty" type="number" min="0.0001" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} className={`${inputClass} w-32`} />
            </div>
          ) : null}
          {editing.kind !== "size" ? (
            <>
              <div>
                <label htmlFor="su-price" className={labelClass}>
                  Wholesale per {unitLabel} (₱){editing.kind === "add" ? " *" : ""}
                </label>
                <input id="su-price" type="number" min="0.01" step="0.01" required={editing.kind === "add"} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Not sold" className={`${inputClass} w-36`} />
              </div>
              <div>
                <label htmlFor="su-retail" className={labelClass}>
                  Retail per {unitLabel} (₱)
                </label>
                <input id="su-retail" type="number" min="0.01" step="0.01" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="Not sold" className={`${inputClass} w-36`} />
              </div>
            </>
          ) : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(null)} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          {editing.kind !== "price" ? <p className="w-full text-xs text-slate-500">A new size only counts after two people other than you open one and confirm the count.</p> : null}
          {editing.kind !== "size" && price !== "" && retail !== "" && Number(retail) < Number(price) ? (
            <p className="w-full rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Retail is lower than wholesale. Check this isn&apos;t a typo.</p>
          ) : null}
          {editing.kind === "price" ? <p className="w-full text-xs text-slate-500">Leave a box empty if it isn&apos;t sold that way.</p> : null}
          {editing.kind === "price" && ((editing.unit.price && price.trim() === "") || (editing.unit.retailPrice && retail.trim() === "")) ? (
            <p role="alert" className="w-full rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Saving with an empty box stops selling by the {editing.unit.unitName.toLowerCase()} at{" "}
              {[editing.unit.price && price.trim() === "" ? "wholesale" : null, editing.unit.retailPrice && retail.trim() === "" ? "retail" : null].filter(Boolean).join(" and ")}.
            </p>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}
