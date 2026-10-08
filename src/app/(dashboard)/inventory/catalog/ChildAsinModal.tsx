"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatVariation } from "@/lib/variation";
import { inputClass, labelClass, orNull, primaryButton, secondaryButton, sendJson } from "./api";

export interface ChildParentContext {
  id: string;
  asin: string | null;
  name: string;
  baseUnitId: string;
  baseUnitCode: string;
}

export interface ChildFormInitial {
  id: string;
  asin: string | null;
  sku: string;
  name: string | null;
  variationData: unknown;
  barcode: string | null;
  notes: string | null;
  status: string;
}

type VariationRow = { key: string; value: string };

function toRows(data: unknown): VariationRow[] {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rows = Object.entries(data as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value ?? "") }));
    if (rows.length > 0) return rows;
  }
  return [
    { key: "Size", value: "" },
    { key: "Color", value: "" },
  ];
}

const parentLabel = (p: ChildParentContext) => (p.asin ? `${p.name} (ASIN ${p.asin})` : p.name);

export function ChildAsinModal({
  parent,
  initial,
  moveTargets,
  onClose,
  onSaved,
}: {
  parent: ChildParentContext;
  /** Omitted = add a new variant under `parent`. */
  initial?: ChildFormInitial;
  /** Live parents with the same base unit — the only legal destinations for a move. */
  moveTargets: ChildParentContext[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = !!initial;
  const [asin, setAsin] = useState(initial?.asin ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [variation, setVariation] = useState<VariationRow[]>(toRows(initial?.variationData));
  const [basePrice, setBasePrice] = useState("");
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [status, setStatus] = useState(initial?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE");
  const [targetParentId, setTargetParentId] = useState(parent.id);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variationData = Object.fromEntries(variation.filter((r) => r.key.trim() && r.value.trim()).map((r) => [r.key.trim(), r.value.trim()]));
  const variationText = formatVariation(variationData);
  const displayName = name.trim() || variationText || parent.name;

  function updateRow(index: number, patch: Partial<VariationRow>) {
    setVariation((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    const body = {
      asin: orNull(asin),
      sku: sku.trim(),
      name: orNull(name),
      variationData: Object.keys(variationData).length ? variationData : null,
      barcode: orNull(barcode),
      notes: orNull(notes),
      status: status as "ACTIVE" | "INACTIVE",
    };
    try {
      if (editing) {
        await sendJson(`/api/v1/catalog/children/${initial.id}`, "PATCH", {
          ...body,
          ...(targetParentId !== parent.id ? { parentProductId: targetParentId } : {}),
        });
        onSaved(`${displayName} updated.`);
      } else {
        await sendJson(`/api/v1/catalog/parents/${parent.id}/children`, "POST", { ...body, sellingPrice: Number(basePrice) });
        onSaved(`${displayName} added to ${parent.name}. Add more selling units (Sack, Pack…) from its View page.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setConfirming(false);
      setPending(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) void save();
    else setConfirming(true);
  }

  if (confirming) {
    return (
      <Modal
        title="Add this variant?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={secondaryButton}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={pending} className={primaryButton}>
              {pending ? "Adding…" : "Add variant"}
            </button>
          </>
        }
      >
        <dl className="grid grid-cols-[6rem_1fr] gap-y-3 text-sm">
          <dt className="font-medium text-slate-500">Product</dt>
          <dd className="text-slate-900">{parent.name}</dd>
          <dt className="font-medium text-slate-500">Variant</dt>
          <dd className="text-slate-900">{displayName}</dd>
          <dt className="font-medium text-slate-500">SKU</dt>
          <dd className="font-mono text-slate-900">{sku.trim()}</dd>
          <dt className="font-medium text-slate-500">Price</dt>
          <dd className="text-slate-900">
            ₱{Number(basePrice).toLocaleString("en-PH", { minimumFractionDigits: 2 })} per {parent.baseUnitCode}
          </dd>
        </dl>
      </Modal>
    );
  }

  return (
    <Modal
      title={editing ? `Edit ${initial.name ?? initial.sku}` : `Add a variant to ${parent.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" form="child-asin-form" disabled={pending} className={primaryButton}>
            {pending ? "Saving…" : editing ? "Save changes" : "Save variant"}
          </button>
        </>
      }
    >
      <form id="child-asin-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="c-name" className={labelClass}>
              Variant name
            </label>
            <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="K9 Tiny White/Colored" className={inputClass} />
          </div>
          <div>
            <label htmlFor="c-sku" className={labelClass}>
              SKU *
            </label>
            <input id="c-sku" required value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SB-K9-TINY" className={`${inputClass} font-mono`} />
          </div>
        </div>

        <fieldset>
          <legend className={labelClass}>Variation</legend>
          <div className="flex flex-col gap-2">
            {variation.map((row, i) => (
              <div key={i} className="flex gap-2">
                <input aria-label={`Variation ${i + 1} attribute`} value={row.key} onChange={(e) => updateRow(i, { key: e.target.value })} placeholder="Attribute" className={`${inputClass} w-2/5`} />
                <input aria-label={`Variation ${i + 1} value`} value={row.value} onChange={(e) => updateRow(i, { value: e.target.value })} placeholder="Value" className={inputClass} />
                <button type="button" aria-label={`Remove variation ${i + 1}`} onClick={() => setVariation((rows) => rows.filter((_, j) => j !== i))} className="rounded-md px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  ✕
                </button>
              </div>
            ))}
          </div>
          {variation.length < 10 ? (
            <button type="button" onClick={() => setVariation((rows) => [...rows, { key: "", value: "" }])} className="mt-2 text-sm font-medium text-brand-700 hover:underline">
              + Add attribute
            </button>
          ) : null}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {editing ? null : (
            <div>
              <label htmlFor="c-price" className={labelClass}>
                Price per {parent.baseUnitCode} (₱) *
              </label>
              <input id="c-price" type="number" step="0.01" min="0.01" required value={basePrice} onChange={(e) => setBasePrice(e.target.value)} className={inputClass} />
            </div>
          )}
          <div>
            <label htmlFor="c-asin" className={labelClass}>
              ASIN <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input id="c-asin" value={asin} onChange={(e) => setAsin(e.target.value)} maxLength={10} className={`${inputClass} font-mono uppercase`} />
          </div>
          <div>
            <label htmlFor="c-barcode" className={labelClass}>
              Barcode
            </label>
            <input id="c-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="c-status" className={labelClass}>
              Status
            </label>
            <select id="c-status" value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")} className={inputClass}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="c-notes" className={labelClass}>
            Notes
          </label>
          <textarea id="c-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </div>

        {editing ? (
          <div>
            <label htmlFor="c-parent" className={labelClass}>
              Product
            </label>
            <select id="c-parent" value={targetParentId} onChange={(e) => setTargetParentId(e.target.value)} className={inputClass}>
              <option value={parent.id}>{parentLabel(parent)} (current)</option>
              {moveTargets
                .filter((p) => p.id !== parent.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {parentLabel(p)}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Moving a variant takes its stock, prices and history with it. Only products that count stock in the same unit are listed.</p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
