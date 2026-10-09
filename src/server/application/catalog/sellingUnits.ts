import { Prisma } from "@prisma/client";
import type { PriceList, PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { proposeConversionRate, verifyConversionRate, ConversionRateVerificationError } from "../../domain/catalog/conversionRate";
import { CatalogRecordArchivedError, CatalogRecordNotFoundError, writeCatalogAudit } from "./shared";
import { MAX_PRICE } from "../../../lib/money";

export class PackSizeRequiredError extends Error {}
export class InvalidPriceError extends Error {}

interface Actor {
  actorRole: RoleName;
  actorUserId: string;
}

interface PriceKey {
  productVariantId: string;
  unitId: string;
  priceList?: PriceList;
  /** null/omitted = the all-branch price. */
  branchId?: string | null;
}

/** Locks the variant row so concurrent price/pack-size changes to one item run one at a time. */
async function lockVariant(tx: Prisma.TransactionClient, productVariantId: string) {
  await tx.$queryRaw`SELECT id FROM product_variant WHERE id = ${productVariantId} FOR UPDATE`;
  const variant = await tx.productVariant.findUnique({
    where: { id: productVariantId },
    include: { product: { select: { baseUnitId: true, status: true, name: true } } },
  });
  if (!variant) throw new CatalogRecordNotFoundError(`Variant ${productVariantId} was not found.`);
  if (variant.status === "ARCHIVED") throw new CatalogRecordArchivedError(`${variant.name ?? variant.sku} is archived — restore it before changing its prices.`);
  return variant;
}

async function requireUnit(tx: Prisma.TransactionClient, unitId: string) {
  const unit = await tx.unitOfMeasure.findUnique({ where: { id: unitId } });
  if (!unit) throw new CatalogRecordNotFoundError(`Unit ${unitId} was not found.`);
  return unit;
}

async function hasPackSize(tx: Prisma.TransactionClient, productVariantId: string, fromUnitId: string, toUnitId: string) {
  const count = await tx.conversionRateVersion.count({ where: { productVariantId, fromUnitId, toUnitId, status: { in: ["ACTIVE", "PENDING_VERIFICATION"] } } });
  return count > 0;
}

async function setPriceTx(tx: Prisma.TransactionClient, params: Actor & PriceKey & { price: number }) {
  // Enforced here, not only at the HTTP boundary, so no caller can save a free or absurd price.
  if (!Number.isFinite(params.price) || params.price <= 0 || params.price > MAX_PRICE || Math.round(params.price * 100) !== params.price * 100) {
    throw new InvalidPriceError(`A price must be above ₱0 with at most 2 decimals (got ${params.price}).`);
  }
  const variant = await lockVariant(tx, params.productVariantId);
  const unit = await requireUnit(tx, params.unitId);
  const baseUnitId = variant.product.baseUnitId;
  if (unit.id !== baseUnitId && !(await hasPackSize(tx, variant.id, unit.id, baseUnitId))) {
    throw new PackSizeRequiredError(`Set how many base units are in one ${unit.name} before pricing ${variant.name ?? variant.sku} by the ${unit.name}.`);
  }
  const priceList = params.priceList ?? "WHOLESALE";
  const branchId = params.branchId ?? null;
  const amount = new Prisma.Decimal(params.price).toDecimalPlaces(2);

  const current = await tx.variantPrice.findFirst({ where: { productVariantId: variant.id, unitId: unit.id, priceList, branchId, supersededAt: null } });
  if (current && current.price.equals(amount)) return current;

  const now = new Date();
  if (current) await tx.variantPrice.update({ where: { id: current.id }, data: { supersededAt: now } });
  const created = await tx.variantPrice.create({
    data: { productVariantId: variant.id, unitId: unit.id, priceList, branchId, price: amount, effectiveFrom: now, createdBy: params.actorUserId },
  });
  // Keep the legacy single price in step with the base-unit wholesale price (see schema note on sellingPrice).
  if (unit.id === baseUnitId && priceList === "WHOLESALE" && branchId === null) {
    await tx.productVariant.update({ where: { id: variant.id }, data: { sellingPrice: amount } });
  }
  await writeCatalogAudit(tx, {
    actorUserId: params.actorUserId,
    action: "catalog.price.set",
    entityType: "ProductVariant",
    entityId: variant.id,
    before: current ? { unit: unit.code, priceList, branchId, price: current.price.toFixed(2) } : undefined,
    after: { unit: unit.code, priceList, branchId, price: amount.toFixed(2) },
  });
  return created;
}

async function proposePackSizeTx(tx: Prisma.TransactionClient, params: Actor & { productVariantId: string; unitId: string; baseQtyPerUnit: number }) {
  const variant = await lockVariant(tx, params.productVariantId);
  const unit = await requireUnit(tx, params.unitId);
  const baseUnitId = variant.product.baseUnitId;
  if (unit.id === baseUnitId) throw new PackSizeRequiredError(`${unit.name} is this item's base unit — it always contains exactly 1.`);

  const existing = await tx.conversionRateVersion.findMany({
    where: { productVariantId: variant.id, fromUnitId: unit.id, toUnitId: baseUnitId, status: { in: ["ACTIVE", "PENDING_VERIFICATION"] } },
  });
  const active = existing.find((c) => c.status === "ACTIVE");
  const pending = existing.find((c) => c.status === "PENDING_VERIFICATION");
  if (pending && Number(pending.rate) === params.baseQtyPerUnit) return pending;
  if (!pending && active && Number(active.rate) === params.baseQtyPerUnit) return active;

  // A newer proposal replaces an unconfirmed one; the ACTIVE size stays in force until the new one is verified.
  if (pending) await tx.conversionRateVersion.update({ where: { id: pending.id }, data: { status: "REJECTED" } });
  const proposed = await proposeConversionRate(tx, {
    productVariantId: variant.id,
    fromUnitId: unit.id,
    toUnitId: baseUnitId,
    rate: params.baseQtyPerUnit,
    proposedBy: params.actorUserId,
  });
  await writeCatalogAudit(tx, {
    actorUserId: params.actorUserId,
    action: "catalog.pack_size.proposed",
    entityType: "ProductVariant",
    entityId: variant.id,
    before: active || pending ? { unit: unit.code, activeRate: active ? Number(active.rate) : null, replacedPendingRate: pending ? Number(pending.rate) : null } : undefined,
    after: { unit: unit.code, rate: params.baseQtyPerUnit, status: "PENDING_VERIFICATION" },
  });
  return proposed;
}

/** Sets (or changes) the price of a variant in one unit. The old price is kept as history, never overwritten. Owner only. */
export async function setVariantPrice(prisma: PrismaClient, params: Actor & PriceKey & { price: number }) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.price.update" });
  return prisma.$transaction((tx) => setPriceTx(tx, params));
}

/** Stops selling a variant in one unit ("not sold this way") by retiring its current price. History is kept. */
export async function removeVariantPrice(prisma: PrismaClient, params: Actor & PriceKey) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.price.update" });
  return prisma.$transaction(async (tx) => {
    const variant = await lockVariant(tx, params.productVariantId);
    const priceList = params.priceList ?? "WHOLESALE";
    const branchId = params.branchId ?? null;
    const current = await tx.variantPrice.findFirst({ where: { productVariantId: variant.id, unitId: params.unitId, priceList, branchId, supersededAt: null }, include: { unit: true } });
    if (!current) return null;
    const retired = await tx.variantPrice.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
    await writeCatalogAudit(tx, {
      actorUserId: params.actorUserId,
      action: "catalog.price.removed",
      entityType: "ProductVariant",
      entityId: variant.id,
      before: { unit: current.unit.code, priceList, branchId, price: current.price.toFixed(2) },
      after: { unit: current.unit.code, priceList, branchId, price: null },
    });
    return retired;
  });
}

/**
 * Proposes "1 <unit> = N <base unit>" for a variant. It starts PENDING and
 * only counts once two people other than the proposer have physically
 * checked it (confirmPackSize). Owner only.
 */
export async function proposePackSize(prisma: PrismaClient, params: Actor & { productVariantId: string; unitId: string; baseQtyPerUnit: number }) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.price.update" });
  return prisma.$transaction((tx) => proposePackSizeTx(tx, params));
}

/** Adds a new selling unit in one transaction: its pack size (pending until checked), its wholesale price and, optionally, its retail price. Owner only. */
export async function addSellingUnit(
  prisma: PrismaClient,
  params: Actor & { productVariantId: string; unitId: string; baseQtyPerUnit: number; price: number; retailPrice?: number },
) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.price.update" });
  return prisma.$transaction(async (tx) => {
    const packSize = await proposePackSizeTx(tx, params);
    const price = await setPriceTx(tx, { ...params, priceList: "WHOLESALE" });
    const retailPrice = params.retailPrice !== undefined ? await setPriceTx(tx, { ...params, priceList: "RETAIL", price: params.retailPrice }) : null;
    return { packSize, price, retailPrice };
  });
}

/**
 * One witnessed physical check of a pending pack size. The second check by
 * a different person (neither may be the proposer — BR-068) activates it.
 */
export async function confirmPackSize(prisma: PrismaClient, params: Actor & { conversionRateVersionId: string }) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.pack_size.verify" });
  return prisma.$transaction(async (tx) => {
    const version = await tx.conversionRateVersion.findUnique({ where: { id: params.conversionRateVersionId }, include: { fromUnit: true } });
    if (!version) throw new CatalogRecordNotFoundError(`Pack size ${params.conversionRateVersionId} was not found.`);
    await lockVariant(tx, version.productVariantId);
    const updated = await verifyConversionRate(tx, { conversionRateVersionId: version.id, verifiedBy: params.actorUserId });
    await writeCatalogAudit(tx, {
      actorUserId: params.actorUserId,
      action: updated.status === "ACTIVE" ? "catalog.pack_size.activated" : "catalog.pack_size.checked",
      entityType: "ProductVariant",
      entityId: version.productVariantId,
      after: { unit: version.fromUnit.code, rate: Number(version.rate), check: updated.status === "ACTIVE" ? 2 : 1 },
    });
    return updated;
  });
}

/** Records that a physical check found a different count. The proposal is rejected; the Owner re-proposes the right number. */
export async function rejectPackSize(prisma: PrismaClient, params: Actor & { conversionRateVersionId: string; countedBaseQty: number; note?: string | null }) {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.pack_size.verify" });
  return prisma.$transaction(async (tx) => {
    const version = await tx.conversionRateVersion.findUnique({ where: { id: params.conversionRateVersionId }, include: { fromUnit: true } });
    if (!version) throw new CatalogRecordNotFoundError(`Pack size ${params.conversionRateVersionId} was not found.`);
    await lockVariant(tx, version.productVariantId);
    const fresh = await tx.conversionRateVersion.findUniqueOrThrow({ where: { id: version.id } });
    if (fresh.status !== "PENDING_VERIFICATION") throw new ConversionRateVerificationError("This pack size is no longer waiting for a check.");
    const rejected = await tx.conversionRateVersion.update({ where: { id: version.id }, data: { status: "REJECTED" } });
    await writeCatalogAudit(tx, {
      actorUserId: params.actorUserId,
      action: "catalog.pack_size.rejected",
      entityType: "ProductVariant",
      entityId: version.productVariantId,
      before: { unit: version.fromUnit.code, rate: Number(version.rate) },
      after: { unit: version.fromUnit.code, countedBaseQty: params.countedBaseQty, note: params.note?.trim() || null },
    });
    return rejected;
  });
}
