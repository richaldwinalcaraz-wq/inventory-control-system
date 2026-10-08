"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { inputClass, labelClass, orNull, primaryButton, secondaryButton, sendJson } from "./api";

export interface ParentFormInitial {
  id: string;
  asin: string | null;
  name: string;
  sku: string | null;
  brand: string | null;
  categoryId: string | null;
  description: string | null;
  notes: string | null;
  status: string;
}

interface Option {
  id: string;
  label: string;
}

export function ParentAsinModal({
  initial,
  categories,
  units,
  brands,
  onClose,
  onSaved,
}: {
  /** Omitted = create a new product. */
  initial?: ParentFormInitial;
  categories: Option[];
  units: Option[];
  brands: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = !!initial;
  const [asin, setAsin] = useState(initial?.asin ?? "");
  const [productName, setProductName] = useState(initial?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [status, setStatus] = useState(initial?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE");
  const [baseUnitId, setBaseUnitId] = useState(units.find((u) => u.label.includes("(PC)"))?.id ?? units[0]?.id ?? "");
  const [cycleCountClass, setCycleCountClass] = useState<"A" | "B" | "C">("C");
  const [unitWeightKg, setUnitWeightKg] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const shared = {
      productName: productName.trim(),
      sku: orNull(sku),
      brand: orNull(brand),
      categoryId: categoryId || null,
      description: orNull(description),
      notes: orNull(notes),
      status: status as "ACTIVE" | "INACTIVE",
    };
    try {
      if (editing) {
        await sendJson(`/api/v1/catalog/parents/${initial.id}`, "PATCH", { ...shared, asin: orNull(asin) });
        onSaved(`${productName.trim()} updated.`);
      } else {
        await sendJson("/api/v1/catalog/parents", "POST", {
          ...shared,
          asin: orNull(asin),
          baseUnitId,
          cycleCountClass,
          unitWeightKg: unitWeightKg.trim() === "" ? null : Number(unitWeightKg),
        });
        onSaved(`${productName.trim()} created. Open it to add variants.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setPending(false);
    }
  }

  return (
    <Modal
      title={editing ? "Edit product" : "Add product"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" form="parent-asin-form" disabled={pending} className={primaryButton}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create product"}
          </button>
        </>
      }
    >
      <form id="parent-asin-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="p-name" className={labelClass}>
              Product name *
            </label>
            <input id="p-name" required value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Sando Bag" className={inputClass} />
          </div>
          <div>
            <label htmlFor="p-asin" className={labelClass}>
              ASIN <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input id="p-asin" value={asin} onChange={(e) => setAsin(e.target.value)} maxLength={10} className={`${inputClass} font-mono uppercase`} />
            <p className="mt-1 text-xs text-slate-500">Only for items sold on Amazon: 10 letters or digits.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="p-brand" className={labelClass}>
              Brand
            </label>
            <input id="p-brand" list="known-brands" value={brand} onChange={(e) => setBrand(e.target.value)} className={inputClass} />
            <datalist id="known-brands">
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="p-category" className={labelClass}>
              Category
            </label>
            <select id="p-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="p-sku" className={labelClass}>
              Parent SKU
            </label>
            <input id="p-sku" value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="p-status" className={labelClass}>
              Status
            </label>
            <select id="p-status" value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")} className={inputClass}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="p-description" className={labelClass}>
            Description
          </label>
          <textarea id="p-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="p-notes" className={labelClass}>
            Notes
          </label>
          <textarea id="p-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </div>

        {editing ? null : (
          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Inventory settings</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="p-unit" className={labelClass}>
                  Count stock in *
                </label>
                <select id="p-unit" required value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} className={inputClass}>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="p-cycle" className={labelClass}>
                  Count class
                </label>
                <select id="p-cycle" value={cycleCountClass} onChange={(e) => setCycleCountClass(e.target.value as "A" | "B" | "C")} className={inputClass}>
                  <option value="A">A — most often</option>
                  <option value="B">B</option>
                  <option value="C">C — least often</option>
                </select>
              </div>
              <div>
                <label htmlFor="p-weight" className={labelClass}>
                  Unit weight, kg
                </label>
                <input id="p-weight" type="number" step="0.001" min="0" value={unitWeightKg} onChange={(e) => setUnitWeightKg(e.target.value)} className={inputClass} />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Use the smallest unit you sell (e.g. Rim). Every variant counts stock in it, bigger units (Sack) are converted to it, and it can&apos;t be changed later.</p>
          </fieldset>
        )}

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
