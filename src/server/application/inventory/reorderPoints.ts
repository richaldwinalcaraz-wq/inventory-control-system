import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export interface ReorderPointRow {
  productVariantId: string;
  sku: string;
  productName: string;
  reorderPoint: string | null;
}

export async function listReorderPoints(prisma: PrismaClient, params: { actorRole: RoleName }): Promise<ReorderPointRow[]> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.low-stock.manage" });

  const variants = await prisma.productVariant.findMany({
    select: { id: true, sku: true, reorderPoint: true, product: { select: { name: true } } },
    orderBy: { sku: "asc" },
  });

  return variants.map((v) => ({
    productVariantId: v.id,
    sku: v.sku,
    productName: v.product.name,
    reorderPoint: v.reorderPoint === null ? null : v.reorderPoint.toString(),
  }));
}

export class InvalidReorderPointError extends Error {}

/** BPD's own recommendation: "set reorder points on the top 50 products" — per-product, editable by Branch Manager/Owner. `reorderPoint: null` clears the alert (unconfigured). */
export async function setReorderPoint(
  prisma: PrismaClient,
  params: { actorRole: RoleName; actorUserId: string; productVariantId: string; reorderPoint: number | null },
): Promise<ReorderPointRow> {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.low-stock.manage" });

  if (params.reorderPoint !== null && (!Number.isFinite(params.reorderPoint) || params.reorderPoint < 0)) {
    throw new InvalidReorderPointError("reorderPoint must be a non-negative number or null.");
  }

  const before = await prisma.productVariant.findUniqueOrThrow({
    where: { id: params.productVariantId },
    select: { reorderPoint: true, sku: true, product: { select: { name: true } } },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.update({
      where: { id: params.productVariantId },
      data: { reorderPoint: params.reorderPoint },
      select: { id: true, sku: true, reorderPoint: true, product: { select: { name: true } } },
    });

    await tx.auditLog.create({
      data: {
        actorId: params.actorUserId,
        action: "inventory.reorder_point.updated",
        entityType: "ProductVariant",
        entityId: params.productVariantId,
        beforeState: { reorderPoint: before.reorderPoint === null ? null : before.reorderPoint.toString() },
        afterState: { reorderPoint: params.reorderPoint === null ? null : params.reorderPoint.toString() },
      },
    });

    return variant;
  });

  return {
    productVariantId: updated.id,
    sku: updated.sku,
    productName: updated.product.name,
    reorderPoint: updated.reorderPoint === null ? null : updated.reorderPoint.toString(),
  };
}
