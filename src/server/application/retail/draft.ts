import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class RetailSaleNotFoundError extends Error {}
export class InvalidRetailSaleStateError extends Error {}
export class EmptyRetailSaleError extends Error {}

export interface DraftRetailSaleParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  lines: Array<{ productVariantId: string; quantity: number }>;
}

/**
 * Steps 1-3 — product selection, availability display, and the sale being
 * opened. List price only (BPD sec.8.1's own build-scope note — discounting
 * belongs to a future POS module): unitPrice is always snapshotted from
 * ProductVariant.sellingPrice at draft time, never accepted from the client.
 */
export async function draftRetailSale(prisma: PrismaClient, params: DraftRetailSaleParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "retail.sale.draft.create" });

  if (params.lines.length === 0) {
    throw new EmptyRetailSaleError("A retail sale needs at least one line.");
  }

  const variantIds = params.lines.map((l) => l.productVariantId);
  const variants = await prisma.productVariant.findMany({ where: { id: { in: variantIds } } });
  const priceByVariant = new Map(variants.map((v) => [v.id, v.sellingPrice]));

  return prisma.retailSale.create({
    data: {
      branchId: params.branchId,
      cashierId: params.actorUserId,
      status: "DRAFT",
      lines: {
        create: params.lines.map((l) => ({
          productVariantId: l.productVariantId,
          quantity: l.quantity,
          unitPrice: priceByVariant.get(l.productVariantId) ?? 0,
        })),
      },
    },
    include: { lines: true },
  });
}
