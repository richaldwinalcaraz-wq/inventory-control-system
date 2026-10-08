import type { Prisma, PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

// Parent ASIN = Product, Child ASIN = ProductVariant. Every transaction in
// the system already references a ProductVariant, so Child -> Parent ->
// Product resolution needs no extra links — see resolveAsin below.

export class InvalidAsinError extends Error {}
export class ParentAsinExistsError extends Error {}
export class ChildAsinExistsError extends Error {}

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/** Trims and upper-cases, then requires Amazon's format: exactly 10 letters/digits. */
export function normalizeAsin(raw: string): string {
  const asin = raw.trim().toUpperCase();
  if (!ASIN_PATTERN.test(asin)) {
    throw new InvalidAsinError(`"${raw.trim()}" is not a valid ASIN — an ASIN is exactly 10 letters or digits (e.g. B0CHILD001).`);
  }
  return asin;
}

/** ASINs are optional (most of the client's items are not sold on Amazon): blank -> null, anything else must be valid. */
export function normalizeOptionalAsin(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  return normalizeAsin(raw);
}

/**
 * An ASIN may exist exactly once across both levels. Each column is unique
 * on its own in the database; this covers the cross-table case (an ASIN
 * used as a parent can never also be a child, or vice versa).
 */
export async function assertAsinAvailable(db: Db, asin: string, ignore?: { productId?: string; productVariantId?: string }): Promise<void> {
  const [parent, child] = await Promise.all([
    db.product.findUnique({ where: { asin }, select: { id: true } }),
    db.productVariant.findUnique({ where: { asin }, select: { id: true } }),
  ]);
  if (parent && parent.id !== ignore?.productId) throw new ParentAsinExistsError(`Parent ASIN already exists: ${asin}.`);
  if (child && child.id !== ignore?.productVariantId) throw new ChildAsinExistsError(`Child ASIN already exists: ${asin}.`);
}

export interface ResolvedAsin {
  level: "PARENT" | "CHILD";
  parent: { productId: string; asin: string | null; productName: string; status: string };
  child: { productVariantId: string; asin: string | null; sku: string; name: string; status: string } | null;
}

/** Resolves any ASIN (or a child SKU) to its Child -> Parent -> Product context; null when unknown. */
export async function resolveAsin(db: Db, raw: string): Promise<ResolvedAsin | null> {
  const key = raw.trim().toUpperCase();
  const child = await db.productVariant.findFirst({
    where: { OR: [{ asin: key }, { sku: raw.trim() }] },
    include: { product: true },
  });
  if (child) {
    return {
      level: "CHILD",
      parent: { productId: child.product.id, asin: child.product.asin, productName: child.product.name, status: child.product.status },
      child: { productVariantId: child.id, asin: child.asin, sku: child.sku, name: child.name ?? child.product.name, status: child.status },
    };
  }
  const parent = await db.product.findUnique({ where: { asin: key } });
  if (parent) {
    return { level: "PARENT", parent: { productId: parent.id, asin: parent.asin, productName: parent.name, status: parent.status }, child: null };
  }
  return null;
}

