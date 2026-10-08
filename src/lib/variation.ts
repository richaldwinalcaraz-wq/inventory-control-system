export type VariationData = Record<string, string>;

/** "Small / Black" from {"Size":"Small","Color":"Black"}; empty string when there's no variation data. */
export function formatVariation(variationData: unknown): string {
  if (!variationData || typeof variationData !== "object" || Array.isArray(variationData)) return "";
  return Object.values(variationData as Record<string, unknown>)
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(" / ");
}

export interface PickableVariant {
  sku: string;
  asin: string | null;
  name: string | null;
  variationData: unknown;
  product: { name: string; baseUnit?: { code: string } };
}

/** Prisma `where` for items a transaction may use: an ACTIVE child under an ACTIVE parent. */
export const PICKABLE_VARIANT_WHERE = { status: "ACTIVE", product: { status: "ACTIVE" } } as const;
export const PICKABLE_VARIANT_SELECT = { id: true, sku: true, asin: true, name: true, variationData: true, product: { select: { name: true, baseUnit: { select: { code: true } } } } } as const;

/** "Sando Bag — K9 Tiny White/Colored (Large / Black) · counted in RIM" — the one label every product picker uses, so quantities are entered in the right unit. */
export function variantPickerLabel(v: PickableVariant): string {
  const variation = formatVariation(v.variationData);
  const name = v.name && v.name !== v.product.name ? `${v.product.name} — ${v.name}` : v.product.name;
  return `${name}${variation ? ` (${variation})` : ""}${v.product.baseUnit ? ` · counted in ${v.product.baseUnit.code}` : ""} · ${v.sku}`;
}
