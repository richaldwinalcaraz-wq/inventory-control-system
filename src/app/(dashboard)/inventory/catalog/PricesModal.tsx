"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { isValidPrice } from "@/lib/money";
import type { CatalogUnitSummary } from "../catalogView";
import { primaryButton, secondaryButton, sendJson } from "./api";

type PriceList = "WHOLESALE" | "RETAIL";
type Prices = Record<string, Record<PriceList, string>>;

const LISTS: PriceList[] = ["WHOLESALE", "RETAIL"];
const cellInput = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";
const asInput = (price: string | null) => (price === null ? "" : String(Number(price)));
const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 4 });

/**
 * Wholesale and retail price per selling unit for one variant. Blank = not
 * sold that way on that list. Only changed cells are sent, one at a time; if
 * one fails, the ones already saved are remembered so a retry sends only
 * the rest, and the list behind the window is refreshed either way.
 */
export function PricesModal({
  variantId,
  variantName,
  baseUnitCode,
  units,
  onClose,
  onSaved,
  onPartialSave,
}: {
  variantId: string;
  variantName: string;
  baseUnitCode: string;
  units: CatalogUnitSummary[];
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Some changes were saved before one failed — refresh what's behind the window. */
  onPartialSave: () => void;
}) {
  const [saved, setSaved] = useState<Prices>(() => Object.fromEntries(units.map((u) => [u.unitId, { WHOLESALE: asInput(u.price), RETAIL: asInput(u.retailPrice) }])));
  const [draft, setDraft] = useState<Prices>(saved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cell = (unitId: string, list: PriceList) => draft[unitId]![list].trim();
  const changes = units.flatMap((u) => LISTS.filter((list) => cell(u.unitId, list) !== saved[u.unitId]![list]).map((list) => ({ unit: u, list, value: cell(u.unitId, list) })));
  const invalid = changes.filter((c) => c.value !== "" && !isValidPrice(c.value));
  const cleared = changes.filter((c) => c.value === "");
  const retailBelowWholesale = units.filter((u) => {
    const [w, r] = [cell(u.unitId, "WHOLESALE"), cell(u.unitId, "RETAIL")];
    return w !== "" && r !== "" && Number(r) < Number(w);
  });
  const label = (c: { unit: CatalogUnitSummary; list: PriceList }) => `${c.unit.name} ${c.list.toLowerCase()}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pending || changes.length === 0 || invalid.length > 0) return;
    setPending(true);
    setError(null);
    let savedAny = false;
    for (const c of changes) {
      try {
        if (c.value === "") await sendJson(`/api/v1/catalog/children/${variantId}/prices/remove`, "POST", { unitId: c.unit.unitId, priceList: c.list });
        else await sendJson(`/api/v1/catalog/children/${variantId}/prices`, "POST", { unitId: c.unit.unitId, priceList: c.list, price: Number(c.value) });
        savedAny = true;
        setSaved((s) => ({ ...s, [c.unit.unitId]: { ...s[c.unit.unitId]!, [c.list]: c.value } }));
      } catch (err) {
        setError(`${savedAny ? "Some prices were saved, but " : ""}${label(c)} was not: ${err instanceof Error ? err.message : "could not save."} Fix it and save again — only the unsaved changes will be sent.`);
        setPending(false);
        if (savedAny) onPartialSave();
        return;
      }
    }
    onSaved(`Prices saved for ${variantName}. Old prices stay in its price history.`);
  }

  // Closing mid-save would hide a failure partway through the list.
  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Modal
      title={`Prices — ${variantName}`}
      onClose={close}
      footer={
        <>
          <button type="button" onClick={close} disabled={pending} className={secondaryButton}>
            {error ? "Close" : "Cancel"}
          </button>
          <button type="submit" form="prices-form" disabled={pending || changes.length === 0 || invalid.length > 0} className={primaryButton}>
            {pending ? "Saving…" : changes.length === 0 ? "No changes" : `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <form id="prices-form" onSubmit={save} className="flex flex-col gap-3">
        <fieldset disabled={pending} className="contents">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Wholesale (₱)</th>
                <th className="py-2">Retail (₱)</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.unitId} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-slate-900">{u.name}</span>
                    <span className="block text-xs text-slate-500">
                      {u.isBaseUnit ? "Stock unit" : u.baseQtyPerUnit !== null ? `${fmt(u.baseQtyPerUnit)} ${baseUnitCode}` : u.pendingBaseQty !== null ? `${fmt(u.pendingBaseQty)} ${baseUnitCode}, not yet checked` : "Size not set"}
                    </span>
                  </td>
                  {LISTS.map((list) => (
                    <td key={list} className={`py-2 ${list === "WHOLESALE" ? "pr-3" : ""}`}>
                      <input
                        aria-label={`${u.name} ${list.toLowerCase()} price`}
                        inputMode="decimal"
                        value={draft[u.unitId]![list]}
                        onChange={(e) => setDraft((d) => ({ ...d, [u.unitId]: { ...d[u.unitId]!, [list]: e.target.value } }))}
                        placeholder="Not sold"
                        className={cellInput}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>

        <p className="text-xs text-slate-500">
          Leave a box empty if it isn&apos;t sold that way. To add another unit (Sack, Pack…), open the{" "}
          <Link href={`/inventory/items/${variantId}`} className="font-medium text-brand-700 hover:underline">
            item page
          </Link>
          .
        </p>

        {invalid.length > 0 ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Enter prices as pesos above zero with at most 2 decimals (check {invalid.map(label).join(", ")}).</p>
        ) : null}
        {cleared.length > 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Saving will stop selling at {cleared.map(label).join(", ")} — those boxes are now empty.</p>
        ) : null}
        {retailBelowWholesale.length > 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Retail is lower than wholesale for {retailBelowWholesale.map((u) => u.name).join(", ")}. Check this isn&apos;t a typo before saving.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
