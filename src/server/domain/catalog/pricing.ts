import { Prisma } from "@prisma/client";
import type { PriceList, PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

// Product -> Variant -> Selling unit -> Price. A variant is sold in a unit
// when it has a current VariantPrice for it AND (the unit is the product's
// base unit, or the unit's pack size — "1 Sack = 40 Rim" — is an ACTIVE,
// two-person-verified ConversionRateVersion). Prices are read here and
// nowhere else, so the Inventory pages and the future Order App always
// agree on what something costs.

export class NoPriceForUnitError extends Error {}
export class PackSizeNotConfirmedError extends Error {}

export interface PackSizeInfo {
  conversionRateVersionId: string;
  /** Base units in one of this unit. */
  rate: number;
}

export interface PendingPackSizeInfo extends PackSizeInfo {
  proposedBy: string;
  verifiedByUser1: string | null;
}

export interface CurrentPrice {
  variantPriceId: string;
  amount: string;
  /** null = the all-branch price; set = an override for that branch. */
  branchId: string | null;
  effectiveFrom: Date;
}

export interface SellingUnit {
  unitId: string;
  unitCode: string;
  unitName: string;
  isBaseUnit: boolean;
  /** Base units in one of this unit: 1 for the base unit, the ACTIVE pack size otherwise, null while unconfirmed. */
  baseQtyPerUnit: number | null;
  activePackSize: PackSizeInfo | null;
  pendingPackSize: PendingPackSizeInfo | null;
  price: CurrentPrice | null;
  sellable: boolean;
}

export interface PriceScope {
  priceList?: PriceList;
  /** Prices for this branch: its own override where one exists, else the all-branch price. */
  branchId?: string | null;
}

/** Every selling unit of each variant (base unit always included), largest unit first. */
export async function getSellingUnits(db: Db, productVariantIds: string[], scope: PriceScope = {}): Promise<Map<string, SellingUnit[]>> {
  const result = new Map<string, SellingUnit[]>();
  if (productVariantIds.length === 0) return result;
  const priceList = scope.priceList ?? "WHOLESALE";
  const branchId = scope.branchId ?? null;

  const [variants, prices, packSizes] = await Promise.all([
    db.productVariant.findMany({
      where: { id: { in: productVariantIds } },
      select: { id: true, product: { select: { baseUnit: { select: { id: true, code: true, name: true } } } } },
    }),
    db.variantPrice.findMany({
      where: { productVariantId: { in: productVariantIds }, priceList, supersededAt: null, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
      include: { unit: { select: { id: true, code: true, name: true } } },
    }),
    db.conversionRateVersion.findMany({
      where: { productVariantId: { in: productVariantIds }, status: { in: ["ACTIVE", "PENDING_VERIFICATION"] } },
      include: { fromUnit: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  for (const variant of variants) {
    const base = variant.product.baseUnit;
    const units = new Map<string, SellingUnit>();
    const unitFor = (u: { id: string; code: string; name: string }): SellingUnit => {
      let row = units.get(u.id);
      if (!row) {
        const isBaseUnit = u.id === base.id;
        row = { unitId: u.id, unitCode: u.code, unitName: u.name, isBaseUnit, baseQtyPerUnit: isBaseUnit ? 1 : null, activePackSize: null, pendingPackSize: null, price: null, sellable: false };
        units.set(u.id, row);
      }
      return row;
    };
    unitFor(base);

    for (const cr of packSizes) {
      if (cr.productVariantId !== variant.id || cr.toUnitId !== base.id || cr.fromUnitId === base.id) continue;
      const row = unitFor(cr.fromUnit);
      const info = { conversionRateVersionId: cr.id, rate: Number(cr.rate) };
      if (cr.status === "ACTIVE") {
        row.activePackSize = info;
        row.baseQtyPerUnit = info.rate;
      } else {
        row.pendingPackSize = { ...info, proposedBy: cr.proposedBy, verifiedByUser1: cr.verifiedByUser1 };
      }
    }

    for (const p of prices) {
      if (p.productVariantId !== variant.id) continue;
      const row = unitFor(p.unit);
      // A branch override beats the all-branch price for that branch.
      if (row.price && row.price.branchId && !p.branchId) continue;
      row.price = { variantPriceId: p.id, amount: p.price.toFixed(2), branchId: p.branchId, effectiveFrom: p.effectiveFrom };
    }

    const rows = [...units.values()].map((r) => ({ ...r, sellable: !!r.price && r.baseQtyPerUnit !== null }));
    const size = (r: SellingUnit) => r.baseQtyPerUnit ?? r.pendingPackSize?.rate ?? 0;
    rows.sort((a, b) => size(b) - size(a) || a.unitCode.localeCompare(b.unitCode));
    result.set(variant.id, rows);
  }
  return result;
}

export interface QuoteLineParams extends PriceScope {
  productVariantId: string;
  unitId: string;
  /** In the selling unit (e.g. 10 rims), not the base unit. */
  quantity: number;
}

export interface QuotedLine {
  productVariantId: string;
  unitId: string;
  unitCode: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  /** What the order line must keep as its price snapshot reference. */
  variantPriceId: string;
  /** Quantity in the product's base unit — what stock moves by. */
  baseQuantity: string;
  conversionRateVersionId: string | null;
}

/**
 * The authoritative price for selling `quantity` of a variant in a unit —
 * an order copies unitPrice/lineTotal from here at the moment of sale and
 * never accepts a price from the client. Throws when the unit has no price
 * or its pack size hasn't been confirmed yet.
 */
export async function quoteLine(db: Db, params: QuoteLineParams): Promise<QuotedLine> {
  const units = (await getSellingUnits(db, [params.productVariantId], params)).get(params.productVariantId);
  const unit = units?.find((u) => u.unitId === params.unitId);
  if (!unit?.price) throw new NoPriceForUnitError(`This item has no ${params.priceList ?? "WHOLESALE"} price for ${unit?.unitName ?? "that unit"}.`);
  if (unit.baseQtyPerUnit === null) {
    throw new PackSizeNotConfirmedError(`How many base units are in one ${unit.unitName} hasn't been confirmed yet, so it can't be sold by the ${unit.unitName} until it is.`);
  }
  const qty = new Prisma.Decimal(params.quantity);
  return {
    productVariantId: params.productVariantId,
    unitId: unit.unitId,
    unitCode: unit.unitCode,
    quantity: qty.toString(),
    unitPrice: unit.price.amount,
    lineTotal: qty.mul(unit.price.amount).toFixed(2),
    variantPriceId: unit.price.variantPriceId,
    baseQuantity: qty.mul(unit.baseQtyPerUnit).toString(),
    conversionRateVersionId: unit.activePackSize?.conversionRateVersionId ?? null,
  };
}
