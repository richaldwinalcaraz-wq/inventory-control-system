import type { CycleCountClass, PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { assertAsinAvailable, normalizeOptionalAsin, ParentAsinExistsError } from "../../domain/catalog/asin";
import {
  assertSkuAvailable,
  CatalogRecordArchivedError,
  CatalogRecordNotFoundError,
  cleanText,
  DuplicateCatalogSkuError,
  uniqueViolationFields,
  writeCatalogAudit,
  type EditableStatus,
} from "./shared";
import { assertVariantsCanBeHidden } from "./childAsins";

export class ParentHasChildrenError extends Error {}

interface Actor {
  actorRole: RoleName;
  actorUserId: string;
}

export interface ParentAsinFields {
  productName: string;
  sku?: string | null;
  brand?: string | null;
  categoryId?: string | null;
  description?: string | null;
  notes?: string | null;
  status?: EditableStatus;
}

export interface CreateParentAsinParams extends Actor, ParentAsinFields {
  /** Optional Amazon ASIN. */
  asin?: string | null;
  baseUnitId: string;
  cycleCountClass?: CycleCountClass;
  unitWeightKg?: number | null;
}

/** Creates a product (Parent ASIN) with no variants yet. Products are containers only — never sold or stocked directly. */
export async function createParentAsin(prisma: PrismaClient, params: CreateParentAsinParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.create" });
  const asin = normalizeOptionalAsin(params.asin);
  const sku = cleanText(params.sku);

  try {
    return await prisma.$transaction(async (tx) => {
      if (asin) await assertAsinAvailable(tx, asin);
      if (sku) await assertSkuAvailable(tx, sku);

      const product = await tx.product.create({
        data: {
          asin,
          name: params.productName.trim(),
          sku,
          brand: cleanText(params.brand),
          categoryId: params.categoryId || null,
          description: cleanText(params.description),
          notes: cleanText(params.notes),
          status: params.status ?? "ACTIVE",
          baseUnitId: params.baseUnitId,
          cycleCountClass: params.cycleCountClass ?? "C",
          unitWeightKg: params.unitWeightKg ?? null,
        },
      });
      await writeCatalogAudit(tx, {
        actorUserId: params.actorUserId,
        action: "catalog.parent.created",
        entityType: "Product",
        entityId: product.id,
        after: { parentAsin: asin, productName: product.name, brand: product.brand, sku: product.sku, status: product.status },
      });
      return product;
    });
  } catch (err) {
    const fields = uniqueViolationFields(err);
    if (fields.includes("asin")) throw new ParentAsinExistsError(`Parent ASIN already exists: ${asin}.`);
    if (fields.includes("sku")) throw new DuplicateCatalogSkuError(`SKU "${sku}" is already in use.`);
    throw err;
  }
}

export interface UpdateParentAsinParams extends Actor, Partial<ParentAsinFields> {
  productId: string;
  /** Adds, corrects, or (null/"") clears the optional ASIN. */
  asin?: string | null;
}

/** Edits a Parent ASIN's details. Archived parents must be restored first. Setting it Inactive hides all its variants, so it has the same stock checks as archiving them. Logs only the fields that actually changed. */
export async function updateParentAsin(prisma: PrismaClient, params: UpdateParentAsinParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.update" });

  return prisma.$transaction(async (tx) => {
    const current = await tx.product.findUnique({ where: { id: params.productId } });
    if (!current) throw new CatalogRecordNotFoundError(`Parent ${params.productId} was not found.`);
    if (current.status === "ARCHIVED") throw new CatalogRecordArchivedError("This product is archived — restore it before editing.");

    const next = {
      asin: params.asin !== undefined ? normalizeOptionalAsin(params.asin) : current.asin,
      name: params.productName !== undefined ? params.productName.trim() : current.name,
      sku: params.sku !== undefined ? cleanText(params.sku) : current.sku,
      brand: params.brand !== undefined ? cleanText(params.brand) : current.brand,
      categoryId: params.categoryId !== undefined ? params.categoryId || null : current.categoryId,
      description: params.description !== undefined ? cleanText(params.description) : current.description,
      notes: params.notes !== undefined ? cleanText(params.notes) : current.notes,
      status: params.status ?? current.status,
    };
    if (next.status === "INACTIVE" && current.status !== "INACTIVE") {
      const variants = await tx.productVariant.findMany({ where: { productId: current.id, status: { not: "ARCHIVED" } }, select: { id: true } });
      await assertVariantsCanBeHidden(tx, variants.map((v) => v.id), current.name, "setting it Inactive");
    }
    if (next.asin && next.asin !== current.asin) await assertAsinAvailable(tx, next.asin, { productId: current.id });
    if (next.sku && next.sku !== current.sku) await assertSkuAvailable(tx, next.sku, { productId: current.id });

    const changedKeys = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== current[k]);
    if (changedKeys.length === 0) return current;

    const updated = await tx.product.update({ where: { id: current.id }, data: next });
    await writeCatalogAudit(tx, {
      actorUserId: params.actorUserId,
      action: "catalog.parent.updated",
      entityType: "Product",
      entityId: current.id,
      before: Object.fromEntries(changedKeys.map((k) => [k, current[k]])),
      after: Object.fromEntries(changedKeys.map((k) => [k, next[k]])),
    });
    return updated;
  });
}

/**
 * Archive, never delete: every past document still points at this parent's
 * children. Blocked while it still holds any non-archived child — those
 * must be archived or moved to another parent first, so archiving a parent
 * can never silently hide live stock.
 */
export async function archiveParentAsin(prisma: PrismaClient, params: Actor & { productId: string }) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.archive" });

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: params.productId } });
    if (!product) throw new CatalogRecordNotFoundError(`Parent ${params.productId} was not found.`);
    if (product.status === "ARCHIVED") throw new CatalogRecordArchivedError("This product is already archived.");

    const liveChildren = await tx.productVariant.count({ where: { productId: product.id, status: { not: "ARCHIVED" } } });
    if (liveChildren > 0) {
      throw new ParentHasChildrenError(
        `This product contains ${liveChildren} variant${liveChildren === 1 ? "" : "s"}. Archive them or move them to another product first.`,
      );
    }

    const archived = await tx.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
    await writeCatalogAudit(tx, {
      actorUserId: params.actorUserId,
      action: "catalog.parent.archived",
      entityType: "Product",
      entityId: product.id,
      before: { status: product.status },
      after: { status: "ARCHIVED", parentAsin: product.asin },
    });
    return archived;
  });
}

/** Brings an archived parent back as ACTIVE. Its children stay archived until restored individually. */
export async function restoreParentAsin(prisma: PrismaClient, params: Actor & { productId: string }) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.update" });

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: params.productId } });
    if (!product) throw new CatalogRecordNotFoundError(`Parent ${params.productId} was not found.`);
    if (product.status !== "ARCHIVED") return product;

    const restored = await tx.product.update({ where: { id: product.id }, data: { status: "ACTIVE" } });
    await writeCatalogAudit(tx, {
      actorUserId: params.actorUserId,
      action: "catalog.parent.restored",
      entityType: "Product",
      entityId: product.id,
      before: { status: "ARCHIVED" },
      after: { status: "ACTIVE", parentAsin: product.asin },
    });
    return restored;
  });
}
