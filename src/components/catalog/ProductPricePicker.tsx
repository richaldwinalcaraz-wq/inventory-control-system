"use client";

import { useState } from "react";
import { peso } from "@/lib/money";

export interface PickerUnit {
  unitId: string;
  code: string;
  name: string;
  isBaseUnit: boolean;
  price: string | null;
  baseQtyPerUnit: number | null;
  pendingBaseQty: number | null;
  sellable: boolean;
}

export interface PickerVariant {
  id: string;
  name: string;
  sku: string;
  onHandBase: number;
  units: PickerUnit[];
}

export interface PickerProduct {
  id: string;
  name: string;
  category: string | null;
  baseUnitCode: string;
  variants: PickerVariant[];
}

const selectClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";
const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 4 });

/** Pesos from a 2-dp price string × quantity, computed in centavos so ₱4.50 × 3 is exactly ₱13.50. */
function lineTotal(price: string, quantity: number): number {
  return (Math.round(Number(price) * 100) * quantity) / 100;
}

/**
 * Product -> Variant -> Unit -> Quantity -> Price -> Subtotal. Prices come
 * from the product master and are never typed. This is the same selection
 * the Order App will use; the order itself re-prices on the server
 * (GET /api/v1/catalog/quote) and keeps that price as its snapshot.
 */
export function ProductPricePicker({ products }: { products: PickerProduct[] }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId);
  const [variantId, setVariantId] = useState(product?.variants[0]?.id ?? "");
  const variant = product?.variants.find((v) => v.id === variantId);
  const priced = variant?.units.filter((u) => u.price !== null) ?? [];
  const [unitId, setUnitId] = useState(priced[0]?.unitId ?? "");
  const unit = priced.find((u) => u.unitId === unitId) ?? priced[0];
  const [quantity, setQuantity] = useState("1");
  const qty = Number(quantity);
  const validQty = Number.isFinite(qty) && qty > 0;

  function pickProduct(id: string) {
    const next = products.find((p) => p.id === id);
    setProductId(id);
    const firstVariant = next?.variants[0];
    setVariantId(firstVariant?.id ?? "");
    setUnitId(firstVariant?.units.find((u) => u.price !== null)?.unitId ?? "");
  }

  function pickVariant(id: string) {
    setVariantId(id);
    setUnitId(product?.variants.find((v) => v.id === id)?.units.find((u) => u.price !== null)?.unitId ?? "");
  }

  if (products.length === 0) return <p className="text-sm text-slate-500">No active products with prices yet.</p>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="pp-product" className="mb-1 block text-sm font-medium text-slate-700">
            Product
          </label>
          <select id="pp-product" value={productId} onChange={(e) => pickProduct(e.target.value)} className={selectClass}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.category && p.category !== p.name ? ` (${p.category})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pp-variant" className="mb-1 block text-sm font-medium text-slate-700">
            Variant
          </label>
          <select id="pp-variant" value={variantId} onChange={(e) => pickVariant(e.target.value)} className={selectClass}>
            {product?.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="pp-unit" className="mb-1 block text-sm font-medium text-slate-700">
              Unit
            </label>
            <select id="pp-unit" value={unit?.unitId ?? ""} onChange={(e) => setUnitId(e.target.value)} disabled={priced.length === 0} className={selectClass}>
              {priced.length === 0 ? <option value="">No prices yet</option> : null}
              {priced.map((u) => (
                <option key={u.unitId} value={u.unitId}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pp-qty" className="mb-1 block text-sm font-medium text-slate-700">
              Quantity
            </label>
            <input id="pp-qty" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={selectClass} />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 rounded-md border border-brand-100 bg-brand-50 p-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-brand-800">Price</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{unit?.price ? `${peso(unit.price)} / ${unit.name}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-brand-800">Subtotal</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900" aria-live="polite">
              {unit?.price && validQty ? peso(lineTotal(unit.price, qty)) : "—"}
            </dd>
          </div>
        </dl>
        {unit && !unit.sellable ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            How many {product?.baseUnitCode} are in one {unit.name.toLowerCase()} hasn&apos;t been confirmed yet
            {unit.pendingBaseQty !== null ? ` (price list says ${fmt(unit.pendingBaseQty)})` : ""}, so orders can&apos;t use this unit until two people check it on delivery.
          </p>
        ) : null}
      </div>

      {variant ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">{variant.name}: all selling units</h2>
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Contains</th>
                  <th className="px-3 py-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {variant.units.map((u) => (
                  <tr key={u.unitId} className={`border-t border-slate-100 ${u.unitId === unit?.unitId ? "bg-brand-50/60" : ""}`}>
                    <td className="px-3 py-2 font-medium">{u.name}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {u.isBaseUnit ? `1 ${product?.baseUnitCode}` : u.baseQtyPerUnit !== null ? `${fmt(u.baseQtyPerUnit)} ${product?.baseUnitCode}` : u.pendingBaseQty !== null ? `${fmt(u.pendingBaseQty)} ${product?.baseUnitCode} (unconfirmed)` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{u.price ? peso(u.price) : <span className="text-slate-400">Not sold this way</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            On hand: <span className="font-medium tabular-nums text-slate-900">{fmt(variant.onHandBase)}</span> {product?.baseUnitCode} · SKU <span className="font-mono text-xs">{variant.sku}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
