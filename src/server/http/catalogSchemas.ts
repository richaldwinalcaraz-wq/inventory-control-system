import { z } from "zod";

// Shared request shapes for /api/v1/catalog/*. Strict: unknown fields are rejected.
const optionalText = (max: number) => z.string().max(max).nullable().optional();
const optionalAsin = z.string().max(20).nullable().optional();
/** Pesos, up to 2 decimal places. */
export const money = z.number().positive().max(9_999_999_999).multipleOf(0.01);
const editableStatus = z.enum(["ACTIVE", "INACTIVE"]);
const variationData = z
  .record(z.string().min(1).max(40), z.string().max(80))
  .refine((v) => Object.keys(v).length <= 10, "At most 10 variation attributes.")
  .nullable()
  .optional();

const parentFields = {
  productName: z.string().trim().min(1).max(200),
  sku: optionalText(64),
  brand: optionalText(120),
  categoryId: z.string().min(1).nullable().optional(),
  description: optionalText(2000),
  notes: optionalText(2000),
  status: editableStatus.optional(),
};

export const createParentSchema = z
  .object({
    asin: optionalAsin,
    ...parentFields,
    baseUnitId: z.string().min(1),
    cycleCountClass: z.enum(["A", "B", "C"]).optional(),
    unitWeightKg: z.number().positive().nullable().optional(),
  })
  .strict();

export const updateParentSchema = z.object({ asin: optionalAsin, ...parentFields, productName: parentFields.productName.optional() }).strict();

const childFields = {
  sku: z.string().trim().min(1).max(64),
  name: optionalText(200),
  variationData,
  barcode: optionalText(64),
  notes: optionalText(2000),
  status: editableStatus.optional(),
};

/** sellingPrice = wholesale price per the product's base unit. */
export const addChildSchema = z.object({ asin: optionalAsin, ...childFields, sellingPrice: money }).strict();

export const updateChildSchema = z
  .object({
    asin: optionalAsin,
    ...childFields,
    sku: childFields.sku.optional(),
    parentProductId: z.string().min(1).optional(),
  })
  .strict();

// ── Selling units & prices ───────────────────────────────────────────────
const priceScope = {
  priceList: z.enum(["WHOLESALE", "RETAIL"]).optional(),
  branchId: z.string().min(1).nullable().optional(),
};
/** How many base units one selling unit holds (e.g. 40 rims in a sack). */
const baseQtyPerUnit = z.number().positive().max(1_000_000).multipleOf(0.0001);

export const setPriceSchema = z.object({ unitId: z.string().min(1), price: money, ...priceScope }).strict();
export const removePriceSchema = z.object({ unitId: z.string().min(1), ...priceScope }).strict();
export const proposePackSizeSchema = z.object({ unitId: z.string().min(1), baseQtyPerUnit }).strict();
export const addSellingUnitSchema = z.object({ unitId: z.string().min(1), baseQtyPerUnit, price: money, priceList: priceScope.priceList }).strict();
export const rejectPackSizeSchema = z.object({ countedBaseQty: baseQtyPerUnit, note: optionalText(500) }).strict();
