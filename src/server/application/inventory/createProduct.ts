import type { PrismaClient, RoleName, CycleCountClass } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class DuplicateSkuError extends Error {}

export interface CreateProductParams {
  actorRole: RoleName;
  actorUserId: string;
  name: string;
  categoryId?: string | null;
  baseUnitId: string;
  unitWeightKg?: number | null;
  cycleCountClass?: CycleCountClass;
  sku: string;
  barcode?: string | null;
  sellingPrice: number;
}

export interface CreatedProduct {
  productId: string;
  productVariantId: string;
  sku: string;
}

/**
 * Catalog-only: creates a Product + its first ProductVariant. Deliberately
 * does not touch stock — a brand-new product starts at zero on-hand, same
 * as any other product, and gets its first real quantity through the
 * normal audited paths (Receiving for an actual delivery, Adjustments for
 * a found/corrected quantity). Opening Balance (postOpeningBalance.ts) is
 * reserved for the one-time Phase 5 go-live cutover and stays locked
 * behind OPENING_BALANCE_ENABLED — this function never touches it.
 */
export async function createProduct(prisma: PrismaClient, params: CreateProductParams): Promise<CreatedProduct> {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.create" });

  const existing = await prisma.productVariant.findUnique({ where: { sku: params.sku } });
  if (existing) {
    throw new DuplicateSkuError(`SKU "${params.sku}" is already in use.`);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: params.name,
          categoryId: params.categoryId ?? null,
          baseUnitId: params.baseUnitId,
          unitWeightKg: params.unitWeightKg ?? null,
          cycleCountClass: params.cycleCountClass ?? "C",
        },
      });

      const variant = await tx.productVariant.create({
        data: {
          productId: product.id,
          sku: params.sku,
          barcode: params.barcode ?? null,
          sellingPrice: params.sellingPrice,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: params.actorUserId,
          action: "inventory.product.created",
          entityType: "ProductVariant",
          entityId: variant.id,
          afterState: { productId: product.id, sku: variant.sku, name: product.name, sellingPrice: params.sellingPrice.toString() },
        },
      });

      return { productId: product.id, productVariantId: variant.id, sku: variant.sku };
    });

    return result;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new DuplicateSkuError(`SKU "${params.sku}" was just taken by a concurrent request.`);
    }
    throw err;
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}
