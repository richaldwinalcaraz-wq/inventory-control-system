import { Prisma } from "@prisma/client";
import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { assertAsinAvailable, ChildAsinExistsError, normalizeOptionalAsin } from "../../domain/catalog/asin";
import {
  assertSkuAvailable,
  CatalogRecordArchivedError,
  CatalogRecordNotFoundError,
  cleanText,
  cleanVariation,
  DuplicateCatalogSkuError,
  uniqueViolationFields,
  writeCatalogAudit,
  type EditableStatus,
} from "./shared";

export class ProductStillInUseError extends Error {}
export class IncompatibleParentError extends Error {}

interface Actor {
  actorRole: RoleName;
  actorUserId: string;
}

/**
 * Refuses to hide variants from every picker (archive or set Inactive)
 * while they still hold stock or a receiving report/adjustment for them is
 * in flight — stock must never sit on an item nobody can select to count,
 * adjust or sell. `what` names the item(s) and `verb` the action in the message.
 */
export async function assertVariantsCanBeHidden(tx: Prisma.TransactionClient, productVariantIds: string[], what: string, verb: string) {
  if (productVariantIds.length === 0) return;
  const [stock, openReceiving, openAdjustments] = await Promise.all([
    tx.stockBalance.aggregate({ where: { productVariantId: { in: productVariantIds } }, _sum: { quantityOnHand: true } }),
    tx.receivingReportLine.count({ where: { productVariantId: { in: productVariantIds }, receivingReport: { status: { notIn: ["POSTED", "VOID"] } } } }),
    tx.adjustmentRequest.count({ where: { productVariantId: { in: productVariantIds }, status: { notIn: ["POSTED", "REJECTED", "VOID"] } } }),
  ]);
  const onHand = Number(stock._sum.quantityOnHand ?? 0);
  if (onHand !== 0) {
    throw new ProductStillInUseError(`${what} still has ${onHand} on hand across all branches — bring it to zero with a Stock Adjustment before ${verb}.`);
  }
  if (openReceiving > 0 || openAdjustments > 0) {
    throw new ProductStillInUseError(`${what} has ${openReceiving} receiving report(s) and ${openAdjustments} adjustment(s) still in progress — finish or void them before ${verb}.`);
  }
}

async function requireLiveParent(tx: Prisma.TransactionClient, productId: string) {
  const parent = await tx.product.findUnique({ where: { id: productId } });
  if (!parent) throw new CatalogRecordNotFoundError(`Parent ${productId} was not found.`);
  if (parent.status === "ARCHIVED") throw new CatalogRecordArchivedError(`${parent.name} is archived — restore it first.`);
  return parent;
}

export interface AddChildAsinParams extends Actor {
  parentProductId: string;
  /** Optional Amazon ASIN. */
  asin?: string | null;
  sku: string;
  /** Wholesale price per the product's base unit — becomes the variant's first VariantPrice row. */
  sellingPrice: number;
  name?: string | null;
  variationData?: Record<string, string> | null;
  barcode?: string | null;
  notes?: string | null;
  status?: EditableStatus;
}

/** Adds a variant (Child ASIN) under an existing, non-archived product, priced per the product's base unit. Starts at zero stock. */
export async function addChildAsin(prisma: PrismaClient, params: AddChildAsinParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.create" });
  const asin = normalizeOptionalAsin(params.asin);
  const sku = params.sku.trim();

  try {
    return await prisma.$transaction(async (tx) => {
      const parent = await requireLiveParent(tx, params.parentProductId);
      if (asin) await assertAsinAvailable(tx, asin);
      await assertSkuAvailable(tx, sku);

      const child = await tx.productVariant.create({
        data: {
          productId: parent.id,
          asin,
          sku,
          name: cleanText(params.name),
          variationData: cleanVariation(params.variationData) ?? undefined,
          barcode: cleanText(params.barcode),
          notes: cleanText(params.notes),
          sellingPrice: params.sellingPrice,
          status: params.status ?? "ACTIVE",
        },
      });
      await tx.variantPrice.create({
        data: { productVariantId: child.id, unitId: parent.baseUnitId, priceList: "WHOLESALE", price: params.sellingPrice, createdBy: params.actorUserId },
      });
      await writeCatalogAudit(tx, {
        actorUserId: params.actorUserId,
        action: "catalog.child.added",
        entityType: "ProductVariant",
        entityId: child.id,
        after: { parentAsin: parent.asin, parentProductId: parent.id, childAsin: asin, sku, name: child.name, variation: child.variationData ?? null, basePrice: String(params.sellingPrice) },
      });
      return child;
    });
  } catch (err) {
    const fields = uniqueViolationFields(err);
    if (fields.includes("asin")) throw new ChildAsinExistsError(`Child ASIN already exists: ${asin}.`);
    if (fields.includes("sku")) throw new DuplicateCatalogSkuError(`SKU "${sku}" is already in use.`);
    throw err;
  }
}

export interface UpdateChildAsinParams extends Actor {
  productVariantId: string;
  /** Adds, corrects, or (null/"") clears the optional ASIN. */
  asin?: string | null;
  sku?: string;
  name?: string | null;
  variationData?: Record<string, string> | null;
  barcode?: string | null;
  notes?: string | null;
  status?: EditableStatus;
  /** Moves the child under a different parent — logged separately as catalog.child.parent_changed. Its stock and history move with it. */
  parentProductId?: string;
}

/** Edits a variant's details, including moving it to another product. Prices change through sellingUnits.ts, not here. Archived variants must be restored first; setting Inactive has the same stock checks as archiving. */
export async function updateChildAsin(prisma: PrismaClient, params: UpdateChildAsinParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.update" });

  return prisma.$transaction(async (tx) => {
    const current = await tx.productVariant.findUnique({ where: { id: params.productVariantId }, include: { product: true } });
    if (!current) throw new CatalogRecordNotFoundError(`Child ${params.productVariantId} was not found.`);
    if (current.status === "ARCHIVED") throw new CatalogRecordArchivedError("This variant is archived — restore it before editing.");

    const next = {
      asin: params.asin !== undefined ? normalizeOptionalAsin(params.asin) : current.asin,
      sku: params.sku !== undefined ? params.sku.trim() : current.sku,
      name: params.name !== undefined ? cleanText(params.name) : current.name,
      barcode: params.barcode !== undefined ? cleanText(params.barcode) : current.barcode,
      notes: params.notes !== undefined ? cleanText(params.notes) : current.notes,
      status: params.status ?? current.status,
    };
    if (next.status === "INACTIVE" && current.status !== "INACTIVE") await assertVariantsCanBeHidden(tx, [current.id], current.name ?? current.sku, "setting it Inactive");
    if (next.asin && next.asin !== current.asin) await assertAsinAvailable(tx, next.asin, { productVariantId: current.id });
    if (next.sku !== current.sku) await assertSkuAvailable(tx, next.sku, { productVariantId: current.id });

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const k of Object.keys(next) as Array<keyof typeof next>) {
      if (next[k] !== current[k]) changes[k] = { before: current[k], after: next[k] };
    }
    const nextVariation = params.variationData !== undefined ? cleanVariation(params.variationData) : (current.variationData as Record<string, string> | null);
    if (JSON.stringify(nextVariation) !== JSON.stringify(current.variationData ?? null)) {
      changes.variationData = { before: current.variationData ?? null, after: nextVariation };
    }

    let newParent = current.product;
    if (params.parentProductId && params.parentProductId !== current.productId) {
      newParent = await requireLiveParent(tx, params.parentProductId);
      // Stock is held in the parent's base unit — moving across base units would silently reinterpret every quantity.
      if (newParent.baseUnitId !== current.product.baseUnitId) {
        throw new IncompatibleParentError(`Can't move ${current.name ?? current.sku} to ${newParent.name}: the two products count stock in different base units.`);
      }
    }
    const parentChanged = newParent.id !== current.productId;
    if (Object.keys(changes).length === 0 && !parentChanged) return current;

    const updated = await tx.productVariant.update({
      where: { id: current.id },
      data: {
        ...next,
        variationData: nextVariation ?? Prisma.DbNull,
        productId: newParent.id,
      },
    });

    if (Object.keys(changes).length > 0) {
      await writeCatalogAudit(tx, {
        actorUserId: params.actorUserId,
        action: "catalog.child.updated",
        entityType: "ProductVariant",
        entityId: current.id,
        before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.before])) as Prisma.InputJsonValue,
        after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after])) as Prisma.InputJsonValue,
      });
    }
    if (parentChanged) {
      await writeCatalogAudit(tx, {
        actorUserId: params.actorUserId,
        action: "catalog.child.parent_changed",
        entityType: "ProductVariant",
        entityId: current.id,
        before: { parentProductId: current.productId, parentAsin: current.product.asin },
        after: { parentProductId: newParent.id, parentAsin: newParent.asin, childAsin: updated.asin },
      });
    }
    return updated;
  });
}

/**
 * Archive, never delete — past receiving reports, adjustments and ledger
 * rows keep pointing at it; it only drops out of every product picker.
 * Blocked while stock remains or a receiving report/adjustment for it is
 * still in flight, so stock can never sit on an item nobody can see:
 * zero it with a Stock Adjustment first.
 */
export async function archiveChildAsin(prisma: PrismaClient, params: Actor & { productVariantId: string }) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.archive" });

  return prisma.$transaction(async (tx) => {
    const child = await tx.productVariant.findUnique({ where: { id: params.productVariantId }, include: { product: { select: { asin: true } } } });
    if (!child) throw new CatalogRecordNotFoundError(`Child ${params.productVariantId} was not found.`);
    if (child.status === "ARCHIVED") throw new CatalogRecordArchivedError(`${child.name ?? child.sku} is already archived.`);

    await assertVariantsCanBeHidden(tx, [child.id], child.name ?? child.sku, "archiving");

    const archived = await tx.productVariant.update({ where: { id: child.id }, data: { status: "ARCHIVED" } });
    await writeCatalogAudit(tx, {
      actorUserId: params.actorUserId,
      action: "catalog.child.archived",
      entityType: "ProductVariant",
      entityId: child.id,
      before: { status: child.status },
      after: { status: "ARCHIVED", childAsin: child.asin, sku: child.sku, parentAsin: child.product.asin },
    });
    return archived;
  });
}

/** Brings an archived child back as ACTIVE. Its parent must not be archived. */
export async function restoreChildAsin(prisma: PrismaClient, params: Actor & { productVariantId: string }) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.update" });

  return prisma.$transaction(async (tx) => {
    const child = await tx.productVariant.findUnique({ where: { id: params.productVariantId } });
    if (!child) throw new CatalogRecordNotFoundError(`Child ${params.productVariantId} was not found.`);
    if (child.status !== "ARCHIVED") return child;
    const parent = await requireLiveParent(tx, child.productId);

    const restored = await tx.productVariant.update({ where: { id: child.id }, data: { status: "ACTIVE" } });
    await writeCatalogAudit(tx, {
      actorUserId: params.actorUserId,
      action: "catalog.child.restored",
      entityType: "ProductVariant",
      entityId: child.id,
      before: { status: "ARCHIVED" },
      after: { status: "ACTIVE", childAsin: child.asin, parentAsin: parent.asin },
    });
    return restored;
  });
}
