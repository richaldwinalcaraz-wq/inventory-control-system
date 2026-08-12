import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { RetailSaleNotFoundError, InvalidRetailSaleStateError } from "./draft";

export class CannotVoidPostedRetailSaleError extends Error {}

export interface VoidRetailSaleParams {
  actorUserId: string;
  actorRole: RoleName;
  retailSaleId: string;
  reason: string;
}

/**
 * Voiding is only possible pre-post (BPD sec.8.1 G-12) — once goods have
 * been handed over and stock posted, a void is never a simple reversal, it
 * has to go through the Customer Return process (Phase 3). A DRAFT sale
 * (payment not yet collected / goods not yet handed over) can always be
 * cancelled outright.
 */
export async function voidRetailSale(prisma: PrismaClient, params: VoidRetailSaleParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "retail.sale.void.create" });

  const sale = await prisma.retailSale.findUnique({ where: { id: params.retailSaleId } });
  if (!sale) throw new RetailSaleNotFoundError(params.retailSaleId);
  if (sale.status === "POSTED") {
    throw new CannotVoidPostedRetailSaleError(
      "A posted retail sale cannot be voided — post-handover corrections go through the Customer Return process (Phase 3), not a void.",
    );
  }
  if (sale.status === "VOID") {
    throw new InvalidRetailSaleStateError("This retail sale is already void.");
  }

  return prisma.retailSale.update({ where: { id: sale.id }, data: { status: "VOID", voidReason: params.reason } });
}
