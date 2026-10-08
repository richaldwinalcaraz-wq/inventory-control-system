import type { Prisma } from "@prisma/client";

export class CatalogRecordNotFoundError extends Error {}
export class CatalogRecordArchivedError extends Error {}
export class DuplicateCatalogSkuError extends Error {}

export type EditableStatus = "ACTIVE" | "INACTIVE";

/** Trims a free-text field; empty becomes null so "cleared" and "never set" are stored the same way. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Drops blank keys/values from variation input like {"Size":"Small","Color":""}; null when nothing is left. */
export function cleanVariation(input: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!input) return null;
  const entries = Object.entries(input)
    .map(([k, v]) => [k.trim(), v.trim()] as const)
    .filter(([k, v]) => k !== "" && v !== "");
  return entries.length === 0 ? null : Object.fromEntries(entries);
}

/** The column names a Prisma unique-constraint violation (P2002) hit, or [] for any other error. */
export function uniqueViolationFields(err: unknown): string[] {
  if (typeof err !== "object" || err === null || (err as { code?: unknown }).code !== "P2002") return [];
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  return typeof target === "string" ? [target] : [];
}

/** Rejects a SKU already used by any parent or child (one SKU namespace, so search never returns two records for one SKU). */
export async function assertSkuAvailable(tx: Prisma.TransactionClient, sku: string, ignore?: { productId?: string; productVariantId?: string }) {
  const [parent, child] = await Promise.all([
    tx.product.findUnique({ where: { sku }, select: { id: true } }),
    tx.productVariant.findUnique({ where: { sku }, select: { id: true } }),
  ]);
  if ((parent && parent.id !== ignore?.productId) || (child && child.id !== ignore?.productVariantId)) {
    throw new DuplicateCatalogSkuError(`SKU "${sku}" is already in use.`);
  }
}

export async function writeCatalogAudit(
  tx: Prisma.TransactionClient,
  params: { actorUserId: string; action: string; entityType: "Product" | "ProductVariant"; entityId: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
) {
  await tx.auditLog.create({
    data: {
      actorId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeState: params.before,
      afterState: params.after,
    },
  });
}
